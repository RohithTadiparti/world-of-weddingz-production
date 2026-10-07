import { saveBusiness } from './business-entries';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProfileDetails } from './entities/profile-details.entity';
import { isKnownSubCaste, OTHER_NOT_LISTED } from './caste-catalog';
import { ProfileSibling } from './entities/profile-sibling.entity';
import { ProfileAsset } from './entities/profile-asset.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { RedisService } from '../../platform/redis/redis.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
import {
  AssetDto,
  EducationDetailsDto,
  OccupationDetailsDto,
  FamilyDetailsDto,
  HoroscopeDetailsDto,
  MaritalDetailsDto,
  PartnerPreferencesDto,
  PersonalDetailsDto,
  ReligionDetailsDto,
  SetPrimaryPhotoDto,
  SiblingDto,
} from './dto/profile-details.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  InterestStatus,
  MatchFixedState,
  MaritalStatus,
  ProfileLifecycle,
  ProfileVisibility,
  UserRole,
} from '../../common/enums';
import { Interest } from '../matchmaking/entities/interest.entity';
import { hasFullProfileAccess } from '../users/profile-visibility';
import { ageBand, ageOf, toCardFacts } from '../users/dto/public-profile.dto';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../../platform/storage/storage.service';
import { parseKey } from '../../platform/storage/storage-keys';
import { BIODATA_DOCUMENT_EXTENSIONS, BIODATA_IMAGE_EXTENSIONS } from '../media/dto/media.dto';
import { matchGender } from '../matchmaking/match-gender';
import { CLOSED_ENGAGEMENT_MESSAGE, stewardMayEditBiodata } from '../users/stewardship';

/** The most brothers and sisters a profile may list (EZ1-I102). */
export const SIBLING_LIMIT = 10;

/** A biodata file the extractor can read, judged by the extension in its key. */
const BIODATA_FILE = new RegExp(`\\.(${BIODATA_IMAGE_EXTENSIONS})$`, 'i');
const BIODATA_DOCUMENT = new RegExp(`\\.(${BIODATA_DOCUMENT_EXTENSIONS})$`, 'i');

/** The sections a profile has to complete before it is considered ready. */
export const REQUIRED_SECTIONS = [
  'personal',
  'religion',
  'horoscope',
  'marital',
  'family',
  'education',
  'occupation',
  'preferences',
  'identity',
] as const;

export type ProfileSection = (typeof REQUIRED_SECTIONS)[number];

export interface CompletionReport {
  profileId: string;
  complete: boolean;
  /** Fraction complete, for the progress bar. */
  percent: number;
  sections: { section: ProfileSection; complete: boolean; label: string }[];
  missing: ProfileSection[];
}

const SECTION_LABEL: Record<ProfileSection, string> = {
  personal: 'Personal details',
  religion: 'Religion and community',
  horoscope: 'Horoscope',
  marital: 'Marital status',
  family: 'Family',
  education: 'Education',
  occupation: 'Occupation',
  preferences: 'Partner preferences',
  identity: 'Identity verification',
};

/**
 * The occupation fields of an education or occupation save.
 *
 * Only what was sent changes. Switching the occupation without a business
 * leaves the saved businesses alone, so a family that tries another option
 * and switches back has not lost them; what is shown follows the occupation.
 * A business is merged through `saveBusiness`, which keeps the extra entries a
 * single-business client cannot see.
 */
function occupationFields(
  row: ProfileDetails,
  dto: Pick<EducationDetailsDto, 'occupationStatus' | 'employment' | 'business' | 'incomeVisible'>,
): Partial<ProfileDetails> {
  const fields: Partial<ProfileDetails> = {};
  if (dto.occupationStatus !== undefined) fields.occupationStatus = dto.occupationStatus;
  if (dto.employment !== undefined) fields.employment = dto.employment;
  if (dto.business !== undefined) fields.business = saveBusiness(row.business ?? {}, dto.business);
  if (dto.incomeVisible !== undefined) fields.incomeVisible = dto.incomeVisible;
  return fields;
}

/**
 * The matrimonial biodata, section by section.
 *
 * Each section saves independently: somebody filling in their own profile
 * stops halfway, and a form that only saves as a whole loses everything they
 * had typed. Completion is computed from what is actually stored rather than
 * tracked as a flag, so it cannot drift away from the truth.
 */
@Injectable()
export class ProfileDetailsService {
  constructor(
    @InjectRepository(ProfileDetails) private readonly details: Repository<ProfileDetails>,
    @InjectRepository(ProfileSibling) private readonly siblings: Repository<ProfileSibling>,
    @InjectRepository(ProfileAsset) private readonly assets: Repository<ProfileAsset>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly redis: RedisService,
    private readonly moderation: ModerationService,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @Inject(forwardRef(() => AiService)) private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------- sections

  /** How many photographs a profile needs before the rest can be filled in. */
  private static readonly REQUIRED_PHOTOS = 3;

  async savePersonal(actor: AuthUser, profileId: string, dto: PersonalDetailsDto) {
    const row = await this.editable(actor, profileId);

    // Photographs first. A biodata with no picture is one nobody looks at, and
    // asking at the end means asking somebody who has already finished — so the
    // section that starts the form is the one that requires them.
    const profile = await this.load(profileId);
    const photos = profile.photos?.length ?? 0;
    if (photos < ProfileDetailsService.REQUIRED_PHOTOS) {
      throw new BadRequestException(
        `Add ${ProfileDetailsService.REQUIRED_PHOTOS} photographs before filling in the details — ` +
          `${photos} so far.`,
      );
    }

    // Surname and last name were two fields and are now one. A client that has
    // not been updated still sends a surname, and dropping it would lose a name
    // somebody typed; refusing the request outright would break them mid-deploy.
    const lastName = (dto.lastName || dto.surname || '').trim();
    if (!lastName) {
      throw new BadRequestException('A last name is required');
    }

    Object.assign(row, {
      firstName: dto.firstName,
      // One name field now. A client still sending a surname has it folded in
      // where there is no last name, rather than silently dropped.
      surname: null,
      lastName: lastName,
      heightCm: dto.heightCm,
      complexion: dto.complexion,
      // Native place moved to the family section. A client still sending it
      // here has it routed rather than dropped; place of birth is no longer
      // collected and is ignored.
      ...(dto.nativePlace ? { nativePlace: dto.nativePlace } : {}),
      communicationAddress: dto.communicationAddress,
      /*
       * Written only when sent. Both used to be `?? null` / `?? {}`, so a
       * client that simply did not send them -- the web form never sends a
       * residence at all -- blanked what was stored on every save of this
       * section. Absent means "not part of this save"; an explicit null (or an
       * empty string) is how a client clears one.
       */
      ...(dto.alternateMobile !== undefined
        ? { alternateMobile: dto.alternateMobile || null }
        : {}),
      ...(dto.residence !== undefined
        ? { residence: (dto.residence ?? {}) as Record<string, string> }
        : {}),
    });

    // A family member fills the biodata in for the bride/groom they manage, but
    // the profile was created with the family member's own account name — so
    // every card and title read as the parent's name, not the bride/groom's
    // (EZ1-I151). The biodata name is the authoritative one for a managed
    // profile, so it becomes the profile's display name. The family member's
    // own name stays on their user account and surfaces only as the "managed
    // by their <relation>" line. Left untouched for a self-registered
    // individual, whose display name is already their own.
    if (profile.managingFor) {
      let touched = false;
      if (dto.firstName) {
        const biodataName = `${dto.firstName} ${lastName}`.trim();
        if (biodataName && profile.displayName !== biodataName) {
          profile.displayName = biodataName;
          touched = true;
        }
      }
      if (touched) await this.profiles.save(profile);
    }

    /*
     * The date of birth, written whenever one was sent.
     *
     * This used to sit inside the `managingFor` branch above, so it was only
     * ever saved for a profile carrying that column — and a profile created
     * through the stewardship intake does not carry it. The result was that a
     * family member typed their daughter's date of birth, pressed save, got no
     * error, and the field came back empty: the write was being skipped
     * silently (EZ1-I182).
     *
     * `managingFor` is the right gate for the display-name rename above, which
     * is genuinely about a profile named after the account that created it. It
     * is the wrong gate for a date of birth, which simply belongs to whichever
     * profile this biodata is for. `editable()` has already established that
     * the caller may write to it, and the form only offers the field when the
     * profile is somebody the caller is filling in on behalf of.
     */
    if (dto.dateOfBirth && profile.dateOfBirth !== dto.dateOfBirth) {
      profile.dateOfBirth = dto.dateOfBirth;
      await this.profiles.save(profile);
    }

    // Extraction may suggest a gender, but it must never replace the one set
    // when a bride/groom registered.  An unassigned managed profile can use
    // the reviewed form value to establish its identity exactly once.
    if (!profile.gender && dto.gender) {
      profile.gender = dto.gender;
      await this.profiles.save(profile);
    }

    return this.persist(row);
  }

  async saveReligion(actor: AuthUser, profileId: string, dto: ReligionDetailsDto) {
    const row = await this.editable(actor, profileId);
    if (dto.subCaste !== OTHER_NOT_LISTED && !isKnownSubCaste(dto.caste, dto.subCaste)) {
      throw new BadRequestException('Sub-caste is not valid for the selected caste.');
    }
    Object.assign(row, {
      religion: dto.religion,
      caste: dto.caste,
      subCaste: dto.subCaste,
      motherTongue: dto.motherTongue,
      // The web form no longer sends it, and `?? null` wiped a stored one on
      // every save; only a value actually sent (null clears) is written.
      ...(dto.denomination !== undefined ? { denomination: dto.denomination || null } : {}),
    });
    return this.persist(row);
  }

  async saveHoroscope(actor: AuthUser, profileId: string, dto: HoroscopeDetailsDto) {
    const row = await this.editable(actor, profileId);
    const { horoscopeAvailable, horoscopeDocumentUrl, birthPlace, timeOfBirth, ...chart } = dto;

    row.horoscopeAvailable = horoscopeAvailable;

    /*
     * Where and when somebody was born is not part of the chart.
     *
     * Clearing the chart when the answer turns to "no" matters — a stale rashi
     * left behind would be shown as fact on a profile that has just said it
     * keeps no horoscope. But the birthplace and the time of birth are facts
     * about the person, true whether or not anybody drew a chart from them,
     * and wiping them with the rest meant a family who does not use horoscopes
     * could not record a birthplace they plainly know. They are kept on both
     * branches and merged over whatever was there, so clearing one is done by
     * emptying the field rather than by unticking a different question.
     */
    const born = {
      ...(timeOfBirth !== undefined ? { timeOfBirth } : {}),
      ...(birthPlace !== undefined ? { birthPlace } : {}),
    };
    const existing = (row.horoscope ?? {}) as Record<string, unknown>;
    const keptBorn = {
      ...(existing.timeOfBirth !== undefined ? { timeOfBirth: existing.timeOfBirth } : {}),
      ...(existing.birthPlace !== undefined ? { birthPlace: existing.birthPlace } : {}),
    };

    row.horoscope = horoscopeAvailable
      ? ({ ...keptBorn, ...(chart as Record<string, unknown>), ...born } as Record<string, unknown>)
      : ({ ...keptBorn, ...born } as Record<string, unknown>);

    // The document goes with the chart: a family saying they keep no horoscope
    // should not still have one attached to the profile.
    row.horoscopeDocumentUrl = horoscopeAvailable ? (horoscopeDocumentUrl ?? null) : null;
    return this.persist(row);
  }

  async saveMarital(actor: AuthUser, profileId: string, dto: MaritalDetailsDto) {
    const row = await this.editable(actor, profileId);
    const { maritalStatus, ...history } = dto;

    row.maritalStatus = maritalStatus;
    // Never-married carries no history, and keeping fields somebody typed
    // before correcting the status would be worse than losing them.
    row.maritalHistory =
      maritalStatus === MaritalStatus.NEVER_MARRIED ? {} : (history as Record<string, unknown>);
    return this.persist(row);
  }

  async saveFamily(actor: AuthUser, profileId: string, dto: FamilyDetailsDto) {
    const row = await this.editable(actor, profileId);
    const profile = await this.load(profileId);
    const isGroom = matchGender(profile) === 'male';
    if (isGroom && (dto.familyNetWorth === undefined || dto.familyNetWorth < 1)) {
      throw new BadRequestException('Family net worth is required for a groom biodata.');
    }

    Object.assign(row, {
      father: dto.father as unknown as Record<string, unknown>,
      mother: dto.mother as unknown as Record<string, unknown>,
      familyType: dto.familyType,
      familyStatus: dto.familyStatus,
      ...(dto.nativePlace ? { nativePlace: dto.nativePlace } : {}),
      ...(dto.nativeState ? { nativeState: dto.nativeState } : {}),
      ...(dto.nativeCountry ? { nativeCountry: dto.nativeCountry } : {}),
      ...(dto.nativeDistrict ? { nativeDistrict: dto.nativeDistrict } : {}),
      brothers: dto.brothers,
      sisters: dto.sisters,
      /*
       * Settled abroad, and where.
       *
       * `isNri` is written whenever it is sent, including false — that is a
       * real answer and has to be able to replace a yes. The city and country
       * are cleared when the answer is no, so a pair left behind by somebody
       * who changed their mind cannot sit on the record invisibly and
       * reappear if the answer ever flips back.
       */
      ...(dto.isNri === undefined
        ? {}
        : dto.isNri === true
          ? {
              isNri: true,
              nriCity: dto.nriCity ?? null,
              nriCountry: dto.nriCountry ?? null,
            }
          : { isNri: false, nriCity: null, nriCountry: null }),
      // Sent as a number, stored as numeric, and only written when the family
      // actually answered — `undefined` here would blank a figure entered on a
      // previous save, which is the shape of bug this whole file exists to
      // avoid.
      ...(isGroom
        ? {
            familyNetWorth: String(dto.familyNetWorth),
            familyNetWorthVisible: dto.familyNetWorthVisible === true,
          }
        : { familyNetWorth: null, familyNetWorthVisible: false }),
    });
    return this.persist(row);
  }

  async saveEducation(actor: AuthUser, profileId: string, dto: EducationDetailsDto) {
    const row = await this.editable(actor, profileId);
    const salary = dto.employment && typeof dto.employment === 'object'
      ? (dto.employment as Record<string, unknown>).salary
      : undefined;
    if (typeof salary === 'string' && /^\d+$/.test(salary) && !/[1-9]/.test(salary)) {
      throw new BadRequestException('Salary must be greater than zero');
    }
    Object.assign(row, {
      ...(dto.highestQualification !== undefined ? { highestQualification: dto.highestQualification } : {}),
      ...(dto.course !== undefined ? { course: dto.course } : {}),
      // Absent leaves the stored value alone; null (or '') clears it.
      ...(dto.institution !== undefined ? { institution: dto.institution || null } : {}),
      ...(dto.collegePlace !== undefined ? { collegePlace: dto.collegePlace || null } : {}),
      ...occupationFields(row, dto),
      // Absent leaves the list alone, so an older client cannot wipe it.
      ...(dto.otherIncome !== undefined
        ? {
            otherIncome: dto.otherIncome.map(({ source, details, annualIncome }) => ({
              source,
              ...(details?.trim() ? { details: details.trim() } : {}),
              ...(annualIncome ? { annualIncome } : {}),
            })),
          }
        : {}),
    });
    return this.persist(row);
  }

  async saveOccupation(actor: AuthUser, profileId: string, dto: OccupationDetailsDto) {
    const row = await this.editable(actor, profileId);
    const salary = dto.employment && typeof dto.employment === 'object'
      ? (dto.employment as Record<string, unknown>).salary
      : undefined;
    if (typeof salary === 'string' && /^\d+$/.test(salary) && !/[1-9]/.test(salary)) {
      throw new BadRequestException('Salary must be greater than zero');
    }
    Object.assign(row, {
      ...occupationFields(row, dto),
      ...(dto.highestQualification !== undefined ? { highestQualification: dto.highestQualification } : {}),
      ...(dto.course !== undefined ? { course: dto.course } : {}),
      ...(dto.institution !== undefined ? { institution: dto.institution || null } : {}),
      ...(dto.collegePlace !== undefined ? { collegePlace: dto.collegePlace || null } : {}),
    });
    return this.persist(row);
  }

  async savePreferences(actor: AuthUser, profileId: string, dto: PartnerPreferencesDto) {
    const row = await this.editable(actor, profileId);

    const packageMin = dto.preferredPackageMin === undefined ? row.preferredPackageMin : dto.preferredPackageMin;
    const packageMax = dto.preferredPackageMax === undefined ? row.preferredPackageMax : dto.preferredPackageMax;
    if (packageMin != null && packageMax != null && packageMin > packageMax) {
      throw new BadRequestException('The minimum package cannot be above the maximum');
    }

    if (dto.preferredAgeMin > dto.preferredAgeMax) {
      throw new BadRequestException('The minimum age cannot be above the maximum');
    }
    if (dto.preferredHeightMinCm > dto.preferredHeightMaxCm) {
      throw new BadRequestException('The minimum height cannot be above the maximum');
    }

    /*
     * The horoscope answers are preferences and are stored with the rest of
     * them. The *document* is not: it is this person's own chart rather than a
     * preference about anybody else's, so it goes where charts go. Attaching it
     * from this screen is a convenience — a family filling in preferences
     * usually has it to hand, and sending them to another section to attach it
     * is where they stop — but it lands in exactly one place.
     */
    Object.assign(row, {
      preferredPackageMin: packageMin,
      preferredPackageMax: packageMax,
      preferredAgeMin: dto.preferredAgeMin,
      preferredAgeMax: dto.preferredAgeMax,
      preferredHeightMinCm: dto.preferredHeightMinCm,
      preferredHeightMaxCm: dto.preferredHeightMaxCm,
      partnerPreferences: {
        ...(dto.preferences ?? {}),
        ...(dto.horoscopeExpectation ? { horoscopeExpectation: dto.horoscopeExpectation } : {}),
        ...(dto.kujaDosham ? { kujaDosham: dto.kujaDosham } : {}),
        ...(dto.preferredStars ? { preferredStars: dto.preferredStars } : {}),
        // Rashi, Padam and Gothram were accepted by the DTO and shown on the
        // form, but never written here — so they saved as nothing and came back
        // empty on the next visit (EZ1-I15). They live in the same bag as the
        // rest of the horoscope preferences.
        ...(dto.preferredRashi ? { preferredRashi: dto.preferredRashi } : {}),
        ...(dto.preferredPadam ? { preferredPadam: dto.preferredPadam } : {}),
        ...(dto.preferredGothram ? { preferredGothram: dto.preferredGothram } : {}),
        /*
         * The NRI preference, and where (EZ1-I246, EZ1-I247).
         *
         * Written whenever it is sent, including "no" — that is an answer, not
         * an absence, and dropping it would leave a family who has said no
         * reading as one who has not said anything. The country only means
         * something alongside a yes, so anything else clears it rather than
         * leaving "Canada" attached to a preference for somebody living here.
         */
        ...(dto.nriPreference ? { nriPreference: dto.nriPreference } : {}),
        ...(dto.nriPreference === 'yes' && dto.preferredNriCountry
          ? { preferredNriCountry: dto.preferredNriCountry.trim() }
          : {}),
      },
      ...(dto.horoscopeDocumentUrl ? { horoscopeDocumentUrl: dto.horoscopeDocumentUrl } : {}),
    });
    const saved = await this.persist(row);

    // The biodata is where preferences are *entered*; the compatibility engine
    // reads them from `profiles.preferences`. Those were two unconnected
    // stores, so somebody could fill in their partner preferences in full and
    // the engine would still score them against `{}` — which is exactly the
    // reported symptom: matchmaking "not working" while the data was plainly
    // there.
    await this.projectPreferences(profileId, row);
    return saved;
  }

  /**
   * Copies the answers the engine needs onto the profile itself.
   *
   * A projection, not a second source of truth: `profile_details` stays
   * authoritative and this is derived from it on every save. The alternative —
   * having the engine join across to the biodata — would put a second table in
   * the hot path of every suggestion query, on a rule that changes rarely.
   *
   * Only the fields the engine actually scores are copied. Copying everything
   * would quietly widen what a suggestion query can see into a record that has
   * its own visibility rules.
   */
  private async projectPreferences(profileId: string, row: ProfileDetails): Promise<void> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return;

    const bag = (row.partnerPreferences ?? {}) as Record<string, unknown>;
    const text = (key: string): string | undefined => {
      const v = bag[key];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };
    const list = (key: string): string[] | undefined => {
      const v = bag[key];
      if (Array.isArray(v)) {
        const items = v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
        return items.length > 0 ? items : undefined;
      }
      // Somebody typing "Hyderabad, Bengaluru" into a free-text box is the
      // common case, and dropping it because it is not an array would be the
      // same failure in a smaller way.
      const single = text(key);
      return single ? single.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    };

    profile.preferences = {
      ...profile.preferences,
      religion: text('religion') ?? profile.preferences?.religion,
      community: text('caste') ?? text('community') ?? profile.preferences?.community,
      education: text('education') ?? profile.preferences?.education,
      lifestyle: list('lifestyle') ?? profile.preferences?.lifestyle,
      preferredLocations:
        list('locations') ?? list('preferredLocations') ?? profile.preferences?.preferredLocations,
      preferredAgeMin: row.preferredAgeMin ?? profile.preferences?.preferredAgeMin,
      preferredAgeMax: row.preferredAgeMax ?? profile.preferences?.preferredAgeMax,
    };
    await this.profiles.save(profile);

    // The profile is cached per account, so writing it here and stopping would
    // leave every reader — including the matchmaking suggestion query — looking
    // at the copy from before the preferences were entered. Saving and not
    // invalidating is the exact shape of the vendor-profile bug fixed earlier:
    // the write lands, and nothing that reads it can tell.
  }

  // ------------------------------------------------------------- photographs
  //
  // Photographs hang off the profile, not off `profile_details`, because they
  // are what matchmaking and circulation both show. The routes live here
  // because this is the screen the subject actually fills their biodata in on
  // — until now the only way to attach one was through the agency console,
  // which is why a self-managed profile could never have a photograph at all.

  /** How many photographs one profile may carry. */
  private static readonly MAX_PHOTOS = 20;

  async addPhoto(actor: AuthUser, profileId: string, url: string) {
    await this.editable(actor, profileId);

    // A matrimonial profile is a claim about a real person. A generated face
    // makes the government ID, the officer's visit and the family's consent all
    // attach to somebody who does not exist, so this is an identity control
    // rather than a content filter — and it runs before anything is stored
    // against the profile.
    await this.moderation.assertGenuinePhoto(url, { userId: actor.userId, kind: 'biodata' });

    const profile = await this.load(profileId);

    const photos = profile.photos ?? [];
    if (photos.includes(url)) return this.photoState(profile);
    if (photos.length >= ProfileDetailsService.MAX_PHOTOS) {
      throw new BadRequestException(
        `A profile can hold at most ${ProfileDetailsService.MAX_PHOTOS} photos.`,
      );
    }

    profile.photos = [...photos, url];
    const saved = await this.profiles.save(profile);

    // The first photograph somebody uploads becomes the one shown first,
    // because the alternative is a profile with pictures on it and a blank
    // avatar next to them.
    const row = await this.details.findOne({ where: { profileId } });
    if (row && !row.primaryPhotoUrl) {
      row.primaryPhotoUrl = url;
      await this.details.save(row);
    }

    return this.photoState(saved);
  }

  async setFamilyPhoto(actor: AuthUser, profileId: string, url: string) {
    const row = await this.editable(actor, profileId);
    await this.moderation.assertGenuinePhoto(url, { userId: actor.userId, kind: 'biodata' });
    row.familyPhotoUrl = url;
    return this.persist(row);
  }

  async removePhoto(actor: AuthUser, profileId: string, url: string) {
    await this.editable(actor, profileId);
    const profile = await this.load(profileId);

    profile.photos = (profile.photos ?? []).filter((p) => p !== url);
    const saved = await this.profiles.save(profile);

    // Removing the primary leaves the pointer dangling, so it moves to whatever
    // is left rather than to nothing.
    const row = await this.details.findOne({ where: { profileId } });
    if (row?.primaryPhotoUrl === url) {
      row.primaryPhotoUrl = saved.photos[0] ?? null;
      await this.details.save(row);
    }

    return this.photoState(saved);
  }

  /**
   * Clears the biodata: the details, the siblings, the family assets and the
   * photographs.
   *
   * Deliberately *not* the account, and not the profile row. "Delete profile"
   * on a biodata screen means "I want to start this again" far more often than
   * it means "close my account", and the second is a different action with
   * different consequences — it lives under Security, needs a password, and
   * refuses while money is in flight.
   *
   * What survives: the account, the consent record, the agency's books, and any
   * interests already sent or received. Those are either somebody else's
   * record or the platform's own, and a person clearing their biodata is not a
   * reason to lose them. The profile does become incomplete, which is what
   * takes it out of matchmaking.
   */
  async clearBiodata(actor: AuthUser, profileId: string): Promise<{ success: true }> {
    await this.editable(actor, profileId);

    await this.siblings.delete({ profileId });
    await this.assets.delete({ profileId });
    await this.details.delete({ profileId });

    const profile = await this.load(profileId);
    profile.photos = [];
    profile.profileCompleted = false;
    await this.profiles.save(profile);

    return { success: true };
  }

  /**
   * Read an uploaded biodata photo into fields for the form.
   *
   * The file is named by its storage key and must sit in the caller's own
   * biodata area, so the paid model can only ever be pointed at something this
   * person uploaded for this purpose. The link it reads is signed here and
   * lives only long enough for the one request.
   */
  async extractBiodata(actor: AuthUser, profileId: string, key: string) {
    await this.editable(actor, profileId);
    const scope = parseKey(key);
    if (
      !scope ||
      scope.owner !== 'users' ||
      scope.area !== 'biodata' ||
      scope.id !== actor.userId
    ) {
      throw new ForbiddenException('That is not a biodata you uploaded');
    }
    if (!BIODATA_FILE.test(key)) {
      throw new BadRequestException('Upload a photo of the biodata: a JPEG, PNG or WebP image.');
    }
    const url = await this.storage.signedUrl(key, {
      expiresInSeconds: ProfileDetailsService.EXTRACT_LINK_SECONDS,
    });
    return this.ai.extractBiodata(url);
  }

  /** Store the original upload without granting it any access outside this profile. */
  async saveBiodataSourceDocument(actor: AuthUser, profileId: string, key: string) {
    const row = await this.editable(actor, profileId);
    const scope = parseKey(key);
    if (!scope || scope.owner !== 'users' || scope.area !== 'biodata' || scope.id !== actor.userId) {
      throw new ForbiddenException('That is not a biodata you uploaded');
    }
    if (!BIODATA_DOCUMENT.test(key)) {
      throw new BadRequestException('That file type cannot be used as a biodata document.');
    }
    row.biodataDocumentUrl = `media://${key}`;
    return this.persist(row);
  }

  /** Long enough for the model to fetch the image once, and no longer. */
  static readonly EXTRACT_LINK_SECONDS = 300;

  async listPhotos(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);
    this.assertMayRead(actor, profile);
    return this.photoState(profile);
  }

  private async photoState(profile: Profile) {
    // The first photo is the profile photo: `setPrimaryPhoto` keeps the chosen
    // one at the front, so the order of the list is the source of truth.
    return {
      photos: profile.photos ?? [],
      primaryPhotoUrl: profile.photos?.[0] ?? null,
      max: ProfileDetailsService.MAX_PHOTOS,
    };
  }

  /**
   * The profile photo: the one shown first. Must be one the profile already has.
   *
   * It moves to the front of `profiles.photos` as well as being recorded on the
   * biodata. Match cards, chat, interests and circulation all show `photos[0]`,
   * so reordering the list is what makes the choice show up everywhere rather
   * than only on the screens that know to look for the pointer.
   */
  async setPrimaryPhoto(actor: AuthUser, profileId: string, dto: SetPrimaryPhotoDto) {
    const row = await this.editable(actor, profileId);
    const profile = await this.load(profileId);
    const photos = profile.photos ?? [];
    if (!photos.includes(dto.url)) {
      throw new BadRequestException('That photo is not on this profile');
    }
    profile.photos = [dto.url, ...photos.filter((p) => p !== dto.url)];
    const saved = await this.profiles.save(profile);

    // Photographs are the first biodata step, so there may be no biodata row
    // yet. The order above is enough on its own; the pointer is kept in step
    // only when the row already exists.
    if (row.id) {
      row.primaryPhotoUrl = dto.url;
      await this.details.save(row);
    }
    await this.invalidateSuggestions(profileId);
    return this.photoState(saved);
  }

  /**
   * The basic biodata a shared link may show (EZ1-I135): religion, community,
   * mother tongue, education and occupation — the details a family reads to
   * decide, without the native place, which stays behind a fixed match.
   */
  async basicCard(profileId: string) {
    return (await this.basicCards([profileId])).get(profileId) ?? null;
  }

  /** Card facts for a page of profiles, fetched in one details query. */
  async basicCards(profileIds: string[]) {
    if (!profileIds.length) return new Map();
    const rows = await this.details.find({ where: { profileId: In(profileIds) } });
    return new Map(rows.map((row) => [row.profileId, this.cardFor(row)]));
  }

  private cardFor(row: ProfileDetails) {
    const card = toCardFacts(row);
    return {
      religion: card.religion,
      caste: card.caste,
      subCaste: row.subCaste ?? null,
      motherTongue: card.motherTongue,
      highestQualification: card.highestQualification,
      occupationStatus: card.occupationStatus,
      profession: card.profession,
      heightCm: row.heightCm ?? null,
    };
  }

  // ------------------------------------------------- siblings and assets

  async addSibling(actor: AuthUser, profileId: string, dto: SiblingDto) {
    await this.editable(actor, profileId);
    const count = await this.siblings.count({ where: { profileId } });
    if (count >= SIBLING_LIMIT) {
      throw new BadRequestException(
        `You can add up to ${SIBLING_LIMIT} brothers and sisters.`,
      );
    }
    return this.siblings.save(this.siblings.create({ profileId, ...dto }));
  }

  async removeSibling(actor: AuthUser, profileId: string, siblingId: string) {
    await this.editable(actor, profileId);
    const row = await this.siblings.findOne({ where: { id: siblingId, profileId } });
    if (!row) throw new NotFoundException('Sibling not found');
    await this.siblings.remove(row);
    return { success: true as const };
  }

  async addAsset(actor: AuthUser, profileId: string, dto: AssetDto) {
    await this.editable(actor, profileId);
    return this.assets.save(
      this.assets.create({
        profileId,
        ...dto,
        estimatedValue: dto.estimatedValue !== undefined ? dto.estimatedValue.toFixed(2) : null,
        visible: dto.visible ?? false,
      }),
    );
  }

  async removeAsset(actor: AuthUser, profileId: string, assetId: string) {
    await this.editable(actor, profileId);
    const row = await this.assets.findOne({ where: { id: assetId, profileId } });
    if (!row) throw new NotFoundException('Asset not found');
    await this.assets.remove(row);
    return { success: true as const };
  }

  // -------------------------------------------------------------- reading

  /**
   * Everything, for whoever may see everything: the owner, the steward who
   * runs the profile, or staff.
   */
  async findFull(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);
    this.assertMayRead(actor, profile);

    const [details, siblings, assets] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId }, order: { createdAt: 'ASC' } }),
      this.assets.find({ where: { profileId }, order: { createdAt: 'ASC' } }),
    ]);

    return {
      profileId,
      // The shared account/profile fields deliberately remain on `profiles`.
      // Returning that single canonical record alongside the biodata prevents
      // the read-back from reviving a stale copy from `profile_details` after
      // somebody edits Your Profile.
      profile: {
        displayName: profile.displayName,
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth,
        contactPhone: profile.contactPhone,
        city: profile.city,
        address: profile.address,
        bio: profile.bio,
        visibility: profile.visibility,
        managingFor: profile.managingFor,
      },
      details: details ?? null,
      siblings,
      assets,
      contact: await this.contactFor(profile),
      completion: this.report(profileId, profile, details, siblings),
      // The managed profile's *own* date of birth, so the biodata form can seed
      // the field from what this profile has saved rather than from the logged-in
      // family member's account DOB (EZ1-I182). This is the same column
      // `savePersonal` writes the bride/groom's date into.
      dateOfBirth: profile.dateOfBirth,
      // The profile's own gender, for the silhouette shown until it has a photo.
      gender: profile.gender,
      // To start the first and last name from before the biodata has its own.
      displayName: profile.displayName,
    };
  }

  /**
   * Which number is which.
   *
   * The two live in different places for good reasons — the primary is on the
   * account because it is what signs you in and what an OTP goes to, and the
   * alternate is on the biodata because it is usually the family's landline —
   * but a page that shows one without the other reads as though the primary is
   * missing. That was the reported defect. They are returned together, each
   * labelled, with the verified state of the one that has one.
   */
  private async contactFor(profile: Profile): Promise<{
    primaryMobile: string | null;
    primaryMobileVerified: boolean;
    /** Where the primary is maintained. */
    primaryMobileSource: 'account' | 'profile' | 'agency_record';
    alternateMobile: string | null;
    email: string | null;
  }> {
    // An agent-built profile has no account behind it yet, so the number the
    // agency took at the desk is the primary one there is.
    if (!profile.userId) {
      return {
        primaryMobile: profile.contactPhone,
        primaryMobileVerified: false,
        primaryMobileSource: 'agency_record',
        alternateMobile: null,
        email: profile.contactEmail,
      };
    }

    const user = await this.users.findOne({
      where: { id: profile.userId },
      select: ['id', 'phone', 'phoneVerifiedAt', 'email'],
    });
    const details = await this.details.findOne({ where: { profileId: profile.id } });

    // `contactPhone` is the number the person edits on Your Profile. It must
    // win here too: returning the sign-in phone first made Biodata resurrect a
    // stale value immediately after a successful Profile save.
    const profileMobile = profile.contactPhone?.trim() || null;
    return {
      primaryMobile: profileMobile ?? user?.phone ?? null,
      primaryMobileVerified: Boolean(profileMobile && profileMobile === user?.phone && user?.phoneVerifiedAt),
      primaryMobileSource: profileMobile ? 'profile' : 'account',
      alternateMobile: details?.alternateMobile ?? null,
      email: user?.email ?? profile.contactEmail ?? null,
    };
  }

  /**
   * What a matched counterpart may see.
   *
   * The rule is subtractive and deliberately blunt: start from the full record
   * and remove the things that are nobody else's business unless explicitly
   * shared — income, invisible assets, the communication address, the second
   * phone number.
   */
  /**
   * One profile, as somebody browsing is allowed to see it.
   *
   * `findShareable` has existed since the biodata was built and was never
   * reachable, which is why a match could be listed but not opened: there was
   * nothing to open. The reported symptom — "the profile is not clickable" —
   * was a missing route rather than a missing link.
   *
   * Who may see it is deliberately the same rule that decides whether they
   * could have been *shown* it in the first place. Anything looser would make
   * a profile id guessable into a biodata; anything tighter would list people
   * you are not allowed to look at.
   */
  /** Shared visibility decision for profile APIs and stored profile media. */
  async canSeeFull(actor: AuthUser | undefined, profile: Profile): Promise<boolean> {
    // A steward needs the complete record to edit and administer a client, via
    // `findFull`. Viewing that client from Matches or Interests is different:
    // it is a viewer relationship and must honour the client's visibility.
    // Only the subject who owns the profile (and staff) bypasses this gate.
    if (actor && (actor.role === UserRole.ADMIN || profile.userId === actor.userId)) return true;
    if (hasFullProfileAccess(profile.visibility)) return true;
    if (!actor) return false;
    const mine = await this.profiles.find({
      where: [{ userId: actor.userId }, { managedByUserId: actor.userId }],
    });
    const ids = mine.map(p => p.id).filter(id => id !== profile.id);
    if (!ids.length) return false;
    const relationship = profile.visibility === ProfileVisibility.MATCHES_ONLY
      ? [{ status: InterestStatus.ACCEPTED }, { matchFixedState: MatchFixedState.CONFIRMED }]
      : [{ matchFixedState: MatchFixedState.CONFIRMED }];
    return Boolean(await this.interests.findOne({ where: relationship.flatMap(state => [
      { fromProfileId: In(ids), toProfileId: profile.id, ...state },
      { fromProfileId: profile.id, toProfileId: In(ids), ...state },
    ]) }));
  }

  async findViewable(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);

    const controlsIt =
      profile.userId === actor.userId ||
      profile.managedByUserId === actor.userId ||
      actor.role === UserRole.ADMIN;

    if (!controlsIt && profile.lifecycle !== ProfileLifecycle.ACTIVE) {
      throw new NotFoundException('That profile is not available');
    }
    const basicOnly = !(await this.canSeeFull(actor, profile));
    // Explicitly PRIVATE stays fully shut to anyone who does not control it,
    // until a match with it has been confirmed as fixed.
    if (basicOnly && !controlsIt && profile.visibility === ProfileVisibility.PRIVATE) {
      throw new ForbiddenException('That profile is private');
    }
    if (basicOnly) {
      const detail = await this.details.findOne({ where: { profileId } });
      // The horoscope headline (rashi, star, padam, gothram, kuja dosham) is on
      // the match card already and is what many families compare on before they
      // decide (EZ1-I48), so the basic profile view carries it too.
      const chart = detail?.horoscopeAvailable ? (detail.horoscope ?? {}) : {};
      const basicDetails = detail
        ? {
            ...this.cardFor(detail),
            horoscopeAvailable: detail.horoscopeAvailable,
            rashi: (chart.rashi as string | undefined) ?? null,
            star: (chart.star as string | undefined) ?? null,
            padam: (chart.padam as string | undefined) ?? null,
            gothram: (chart.gothram as string | undefined) ?? null,
            kujaDosham: (chart.kujaDosham as string | undefined) ?? null,
            // The chart itself travels before the mutual accept (EZ1-I231): in
            // this market it is what families compare before sending interest,
            // and everything computed from it is already shown above. Family,
            // contact, marital history and the rest of the gallery stay behind
            // the accept.
            horoscopeDocumentUrl: detail.horoscopeDocumentUrl ?? null,
          }
        : null;
      return {
        profileId,
        accessLevel: 'basic' as const,
        unlockRequirement:
          profile.visibility === ProfileVisibility.PRIVATE
            ? ('fixed_match' as const)
            : ('accepted_interest' as const),
        limited: true as const,
        // Empty, not absent: the profile view renders these lists, and the basic
        // card deliberately carries none of the private biodata behind them.
        siblings: [],
        assets: [],
        contact: null,
        details: basicDetails,
        profile: {
          id: profile.id,
          profileCode: profile.profileCode,
          displayName: profile.displayName,
          city: profile.city,
          gender: profile.gender,
          // The exact age (and the older band, for clients that still read it),
          // never the date of birth itself: that is what the mutual accept unlocks.
          ageRange: ageBand(profile.dateOfBirth),
          age: ageOf(profile.dateOfBirth),
          // One lead photo, so the family can decide whether to send interest.
          photos: (profile.photos ?? []).slice(0, 1),
          identityVerified: Boolean(profile.idVerifiedAt),
          managingFor: profile.managingFor,
          stewardship: await this.stewardshipOf(profile),
        },
      };
    }

    const shareable = await this.findShareable(profileId);
    return {
      ...shareable,
      limited: false as const,
      accessLevel: 'full' as const,
      unlockRequirement: null,
      profile: {
        id: profile.id,
        profileCode: profile.profileCode,
        displayName: profile.displayName,
        city: profile.city,
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth,
        // The same band the limited view shows, so a client renders one field
        // whichever view it was given.
        ageRange: ageBand(profile.dateOfBirth),
        age: ageOf(profile.dateOfBirth),
        photos: profile.photos ?? [],
        bio: profile.bio,
        // Whether a verification officer has seen the document, which is the
        // thing families ask about before anything else.
        identityVerified: Boolean(profile.idVerifiedAt),
        // What the managed person is — bride or groom — shown at the foot of the
        // profile when a family member opens it from chat (EZ1-I41).
        managingFor: profile.managingFor ?? null,
        // Who is answering for this person, and what they are to them.
        //
        // A family reading a biodata wants to know who they will actually be
        // speaking to. "Managed by a family member — their father" is a
        // materially different proposition from an agency listing, and the
        // profile said nothing about either.
        stewardship: await this.stewardshipOf(profile),
      },
    };
  }

  /**
   * Who manages this profile, in the words a reader uses.
   *
   * Returns null for a self-managed profile, which is the common case and
   * needs no label — saying "managed by themselves" on every card is noise.
   */
  private async stewardshipOf(
    profile: Profile,
  ): Promise<{ kind: 'family' | 'agency'; label: string; relation: string | null } | null> {
    if (!profile.managedByUserId || profile.managedByUserId === profile.userId) return null;

    const steward = await this.users.findOne({ where: { id: profile.managedByUserId } });
    if (!steward) return null;

    if (steward.role === UserRole.FAMILY) {
      return {
        kind: 'family',
        label: 'Managed by a family member',
        relation: profile.stewardRelation,
      };
    }
    return { kind: 'agency', label: 'Managed by an agency', relation: null };
  }

  async findShareable(profileId: string) {
    const [details, siblings, assets] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId }, order: { createdAt: 'ASC' } }),
      this.assets.find({ where: { profileId, visible: true } }),
    ]);
    if (!details) return { profileId, details: null, siblings: [], assets: [] };

    const {
      biodataDocumentUrl,
      communicationAddress,
      alternateMobile,
      employment,
      business,
      otherIncome,
      incomeVisible,
      ...rest
    } = details;

    const strip = (block: Record<string, unknown>): Record<string, unknown> => {
      if (incomeVisible) return block;
      const { salary, income, businessIncome, annualIncome, otherIncome, entries, ...safe } = block;
      return { ...safe, ...(Array.isArray(entries) ? { entries: entries.map((entry) => strip(entry)) } : {}) };
    };

    return {
      profileId,
      details: {
        ...rest,
        employment: strip(employment ?? {}),
        business: strip(business ?? {}),
        otherIncome: (otherIncome ?? []).map(strip),
      },
      siblings,
      assets,
    };
  }

  async completion(actor: AuthUser, profileId: string): Promise<CompletionReport> {
    const profile = await this.load(profileId);
    this.assertMayRead(actor, profile);

    const [details, siblings] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId } }),
    ]);
    return this.report(profileId, profile, details, siblings);
  }

  /**
   * Computed from the stored data every time it is asked for.
   *
   * A stored "complete" flag drifts the moment anything is edited or a rule
   * changes, and a profile that claims to be complete when it is not is worse
   * than one that admits it is not.
   */
  private report(
    profileId: string,
    profile: Profile,
    details: ProfileDetails | null,
    siblings: ProfileSibling[],
  ): CompletionReport {
    const has = (value: unknown) =>
      value !== null && value !== undefined && value !== '' &&
      !(typeof value === 'object' && Object.keys(value as object).length === 0);

    const done: Record<ProfileSection, boolean> = {
      // Native place moved to the family section and place of birth is no
      // longer collected, so neither can be a condition of this one being
      // complete — every existing profile would otherwise become incomplete on
      // deploy, and the fix would look like data loss.
      personal: Boolean(
        details &&
          has(details.firstName) &&
          has(details.lastName) &&
          has(profile.gender) &&
          has(profile.dateOfBirth) &&
          (profile.photos?.length ?? 0) >= ProfileDetailsService.REQUIRED_PHOTOS &&
          has(details.heightCm) &&
          has(details.complexion) &&
          has(details.communicationAddress),
      ),
      religion: Boolean(
        details && has(details.religion) && has(details.caste) && has(details.motherTongue),
      ),
      // Answering "no horoscope" completes the section: the question has been
      // answered, which is all the profile needs.
      horoscope: Boolean(
        details && (details.horoscopeAvailable === false || has(details.horoscope)),
      ),
      marital: Boolean(details && has(details.maritalStatus)),
      // The native place is asked here now.
      family: Boolean(
        details &&
          has(details.father) &&
          has(details.mother) &&
          has(details.familyType) &&
          (matchGender(profile) !== 'male' || has(details.familyNetWorth)) &&
          details.brothers !== null &&
          details.sisters !== null &&
          // Counts and records have to agree, or the family section is telling
          // two different stories.
          siblings.length >= 0,
      ),
      education: Boolean(
        details && has(details.highestQualification) && has(details.course),
      ),
      occupation: Boolean(
        details && has(details.occupationStatus),
      ),
      preferences: Boolean(
        details && has(details.preferredAgeMin) && has(details.preferredHeightMinCm),
      ),
      identity: Boolean(profile.governmentIdHash),
    };

    const sections = REQUIRED_SECTIONS.map((section) => ({
      section,
      complete: done[section],
      label: SECTION_LABEL[section],
    }));
    const missing = sections.filter((s) => !s.complete).map((s) => s.section);

    return {
      profileId,
      complete: missing.length === 0,
      percent: Math.round(((sections.length - missing.length) / sections.length) * 100),
      sections,
      missing,
    };
  }

  // --------------------------------------------------------------- guards

  private async load(profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  private assertMayRead(actor: AuthUser, profile: Profile): void {
    const mine = profile.userId === actor.userId || profile.managedByUserId === actor.userId;
    const staff = actor.role === UserRole.ADMIN || actor.role === UserRole.IN_PERSON;
    if (!mine && !staff) throw new ForbiddenException('That profile is not yours');
  }

  /**
   * Loads the details row for writing, creating it on first use.
   *
   * The owner always may. A steward (agent or family) may while the engagement
   * is live, claimed or not: see stewardMayEditBiodata for why a claim no
   * longer ends it and what does.
   */
  private async editable(actor: AuthUser, profileId: string): Promise<ProfileDetails> {
    const profile = await this.load(profileId);

    const owns = profile.userId !== null && profile.userId === actor.userId;
    const stewards = profile.managedByUserId === actor.userId;
    if (!owns && !stewards && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That profile is not yours to edit');
    }
    if (stewards && !owns && !stewardMayEditBiodata(profile, actor.userId)) {
      throw new ForbiddenException(CLOSED_ENGAGEMENT_MESSAGE);
    }

    const existing = await this.details.findOne({ where: { profileId } });
    return existing ?? this.details.create({ profileId });
  }

  /**
   * Saves a section, and drops the match suggestions computed from it.
   *
   * The compatibility engine reads the biodata, and its results are cached for
   * two minutes. Without this, a family could correct their religion or widen
   * their age range, watch the field save, and be shown the same scores
   * computed from what they had just changed — which reads as the edit not
   * having taken. The cache exists to keep a browse cheap, not to outlive the
   * data it was computed from.
   *
   * Both directions matter: this profile's own suggestions, and the suggestions
   * of anyone this profile appears in. The second cannot be enumerated without
   * scanning, so the key pattern covers it.
   */
  private async persist(row: ProfileDetails): Promise<ProfileDetails> {
    // Photographs come before the first biodata section, so the row is usually
    // created after they were uploaded and nothing recorded the profile photo.
    // Default it to the first photo — the one shown until somebody chooses.
    if (!row.primaryPhotoUrl) {
      const profile = await this.profiles.findOne({ where: { id: row.profileId }, select: ['id', 'photos'] });
      row.primaryPhotoUrl = profile?.photos?.[0] ?? null;
    }
    const saved = await this.details.save(row);
    await this.invalidateSuggestions(saved.profileId);
    return saved;
  }

  private async invalidateSuggestions(profileId: string): Promise<void> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await this.redis.raw.scan(
        cursor,
        'MATCH',
        `match:suggestions:${profileId}:*`,
        'COUNT',
        100,
      );
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');
    if (keys.length) await this.redis.del(...keys);
  }

  /**
   * Is the biodata complete enough to send to another family?
   *
   * Deliberately a different question from `profiles.profileCompleted`, which
   * gates matchmaking and asks only for the basics. Someone may look for
   * matches with a name, a date of birth and a city; nobody should be
   * circulating a biodata to strangers with the family section empty, because
   * the first thing the other side does is ask, and the agent has nothing.
   *
   * Identity is excluded: verification runs on its own track and should not
   * hold up an introduction.
   */
  async isBiodataComplete(profileId: string): Promise<boolean> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return false;

    const [details, siblings] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId } }),
    ]);
    const report = this.report(profileId, profile, details, siblings);
    return report.missing.every((section) => section === 'identity');
  }

  /** The sections still missing, for a message that says what to go and fill in. */
  async missingSections(profileId: string): Promise<string[]> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return [...REQUIRED_SECTIONS];

    const [details, siblings] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId } }),
    ]);
    return this.report(profileId, profile, details, siblings)
      .sections.filter((s) => !s.complete && s.section !== 'identity')
      .map((s) => s.label);
  }
}
