import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from './entities/agent-profile.entity';
import {
  AddProfilePhotoDto,
  CreateManagedProfileDto,
  ManagedProfileSearchDto,
  UpdateManagedProfileDto,
} from './dto/managed-profile.dto';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { ConsentService } from '../circulation/consent.service';
import { AgentBillingService } from './agent-billing.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
import { assertNewMediaUploaded } from '../../platform/storage/kept-media';
import { ConsentScope, FamilyType, MaritalStatus, NetworkVisibility, OccupationStatus, ProfileLifecycle, ProfileVisibility } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { ProfileClaimStatus, UserRole } from '../../common/enums';
import { CLOSED_ENGAGEMENT_MESSAGE, stewardMayEditBiodata } from '../users/stewardship';

/*
 * The words a biodata document uses for the three fixed-choice intake fields,
 * folded to lower case with runs of spaces, hyphens and slashes as `_`. The
 * enum values themselves are always accepted too.
 */
const MARITAL_WORDS: Record<string, MaritalStatus> = {
  never_married: MaritalStatus.NEVER_MARRIED,
  unmarried: MaritalStatus.NEVER_MARRIED,
  single: MaritalStatus.NEVER_MARRIED,
  divorced: MaritalStatus.DIVORCED,
  divorce: MaritalStatus.DIVORCED,
  widowed: MaritalStatus.WIDOWED,
  widow: MaritalStatus.WIDOWED,
  widower: MaritalStatus.WIDOWED,
  separated: MaritalStatus.SEPARATED,
  annulled: MaritalStatus.ANNULLED,
};

const FAMILY_TYPE_WORDS: Record<string, FamilyType> = {
  joint: FamilyType.JOINT,
  joint_family: FamilyType.JOINT,
  nuclear: FamilyType.NUCLEAR,
  nuclear_family: FamilyType.NUCLEAR,
  extended: FamilyType.EXTENDED,
  extended_family: FamilyType.EXTENDED,
  single_parent: FamilyType.SINGLE_PARENT,
};

const OCCUPATION_WORDS: Record<string, OccupationStatus> = {
  employed: OccupationStatus.EMPLOYED,
  self_employed: OccupationStatus.SELF_EMPLOYED,
  business: OccupationStatus.SELF_EMPLOYED,
  student: OccupationStatus.STUDENT,
  homemaker: OccupationStatus.HOMEMAKER,
  housewife: OccupationStatus.HOMEMAKER,
  not_employed: OccupationStatus.NOT_EMPLOYED,
  unemployed: OccupationStatus.NOT_EMPLOYED,
  retired: OccupationStatus.RETIRED,
};

/** One fixed-choice intake value, or a 400 naming the field when it matches none. */
export function intakeChoice<T extends string>(
  field: string,
  raw: string | undefined,
  words: Record<string, T>,
): T | undefined {
  if (!raw || !raw.trim()) return undefined;
  const folded = raw.trim().toLowerCase().replace(/[\s/-]+/g, '_');
  const value = words[folded];
  if (!value) {
    const choices = [...new Set(Object.values(words))].join(', ');
    throw new BadRequestException(
      `biodata.${field}: "${raw}" is not a recognised value. Use one of: ${choices}.`,
    );
  }
  return value;
}

/**
 * Profiles built and maintained on somebody else's behalf.
 *
 * This is the "no account yet" path: an agent (or a family member looking after
 * a relative) creates a complete, matchable profile — photos, preferences,
 * contact details — for a person who has never signed up. The profile is a
 * first-class matchmaking citizen from the moment it is saved; the account only
 * appears if and when the subject accepts an invitation.
 *
 * Claiming does not end the engagement. The agency keeps circulating the
 * profile, managing its photographs and running its lifecycle, because the
 * family hired them to find a match and the subject getting an account is
 * usually the point at which that work matters most. What the agency loses is
 * the biodata: two writers with no rule about who wins produces a profile that
 * contradicts itself. Delete stays available, but on a claimed profile it ends
 * the engagement rather than destroying a record its owner now depends on.
 */
@Injectable()
export class ManagedProfilesService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationsService,
    private readonly consent: ConsentService,
    private readonly billing: AgentBillingService,
    private readonly moderation: ModerationService,
  ) {}

  /**
   * Agents must be vetted before they can create profiles or accounts for other
   * people. Without this gate anyone could self-register as an agent and start
   * minting real accounts. Family stewards are not gated: they look after a
   * couple of relatives, capped by config.
   */
  async assertMaySteward(actor: AuthUser): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (actor.role !== UserRole.AGENT) return; // family: allowed, capped below

    if (!this.cfg.stewardship.requireAgentApproval) return;
    const agency = await this.agencies.findOne({ where: { ownerUserId: actor.userId } });
    if (!agency) {
      throw new ForbiddenException(
        'Register your agency details before onboarding clients (PUT /agents/agency).',
      );
    }
    if (!agency.isApproved) {
      throw new ForbiddenException(
        'Your agency is awaiting approval by an administrator. You will be emailed when it is reviewed.',
      );
    }
  }

  private quotaFor(actor: AuthUser): number {
    if (actor.role === UserRole.FAMILY) return this.cfg.stewardship.maxManagedProfilesFamily;
    return this.cfg.stewardship.maxManagedProfiles;
  }

  /**
   * Builds a profile from what a family handed over at the desk.
   *
   * A supplied phone or email is an identity key. Either one may be missing at
   * the desk, but any value given is checked so the same biodata is not put in
   * circulation twice.
   */
  async create(actor: AuthUser, dto: CreateManagedProfileDto): Promise<Profile> {
    await this.assertMaySteward(actor);

    // A family account always creates a profile for somebody else. Keeping the
    // relationship on that managed profile prevents the account holder's own
    // identity from being mistaken for the bride/groom's, and makes the same
    // rule hold for direct API calls as for the form.
    if (actor.role === UserRole.FAMILY) {
      const relation = dto.stewardRelation?.trim();
      if (!relation || relation.toLowerCase() === 'self' || relation.toLowerCase() === 'other') {
        throw new BadRequestException(
          'Select your relationship to the person whose profile you are managing.',
        );
      }
      dto.stewardRelation = relation;
    }

    const held = await this.profiles.count({ where: { managedByUserId: actor.userId } });
    if (held >= this.quotaFor(actor)) {
      throw new BadRequestException(
        `You have reached your limit of ${this.quotaFor(actor)} managed profiles.`,
      );
    }

    // Intake consent is the agency's auditable record of a stranger's family
    // agreeing to be represented. A family member adding their own son,
    // daughter or relative is that agreement, so it is asked only of agents.
    const isFamily = actor.role === UserRole.FAMILY;
    if (!isFamily && !dto.consent) {
      throw new BadRequestException('Record how the family gave consent before saving the profile');
    }

    await this.assertNotDuplicate(actor, dto.contactPhone, dto.contactEmail);

    // Photographs handed over at intake are attached here rather than through
    // addPhoto, so they get addPhoto's check here: before the transaction, so
    // a refused photograph leaves no half-created profile behind.
    assertNewMediaUploaded('photos', dto.photos, []);
    await this.moderation.assertGenuinePhotos(dto.photos, [], {
      userId: actor.userId,
      kind: 'managed_profile',
    });

    const { inviteNow, consent, biodata, biodataDocumentUrl, ...fields } = dto;
    // Resolved before anything is written: a value the agent confirmed that
    // matches none of the choices is refused, never silently dropped.
    const maritalStatus = intakeChoice('maritalStatus', biodata?.maritalStatus, MARITAL_WORDS);
    const familyType = intakeChoice('familyType', biodata?.familyType, FAMILY_TYPE_WORDS);
    const occupationStatus = intakeChoice(
      'occupationStatus',
      biodata?.occupationStatus,
      OCCUPATION_WORDS,
    );
    const profile = await this.profiles.manager.transaction(async (manager) => {
      const profiles = manager.getRepository(Profile);
      const profile = await profiles.save(
        profiles.create({
          ...fields,
          contactPhone: dto.contactPhone ?? null,
          contactEmail: dto.contactEmail ?? null,
          userId: null,
          managedByUserId: actor.userId,
          claimStatus: ProfileClaimStatus.UNCLAIMED,
          // An imported biodata often arrives in stages. Keep an agency's new
          // client out of Matches until its details have been reviewed and the
          // agent deliberately makes it matchable. A family's relative is
          // matchable from the start, exactly as a bride or groom who signs up
          // is: the family is the one who decided to look.
          visibility: isFamily
            ? (fields.visibility ?? ProfileVisibility.MATCHES_ONLY)
            : ProfileVisibility.PRIVATE,
          profileCompleted: this.isComplete(fields),
        }),
      );

      if (biodata || biodataDocumentUrl) {
        const repo = manager.getRepository(ProfileDetails);
        const row = repo.create({
          profileId: profile.id,
          biodataDocumentUrl: biodataDocumentUrl ?? null,
        });

        if (biodata) {
          // Personal details
          if (biodata.firstName) row.firstName = biodata.firstName;
          if (biodata.lastName) row.lastName = biodata.lastName;
          else if (biodata.surname) row.lastName = biodata.surname;
          if (biodata.residence) row.residence = biodata.residence as Record<string, string>;
          if (biodata.business) row.business = biodata.business as Record<string, unknown>;
          if (biodata.heightCm) row.heightCm = Number(biodata.heightCm) || null;
          if (biodata.complexion) row.complexion = biodata.complexion;
          if (biodata.nativePlace) row.nativePlace = biodata.nativePlace;
          if (biodata.nativeState) row.nativeState = biodata.nativeState;
          if (biodata.nativeCountry) row.nativeCountry = biodata.nativeCountry;
          if (biodata.nativeDistrict) row.nativeDistrict = biodata.nativeDistrict;
          if (biodata.placeOfBirth) row.placeOfBirth = biodata.placeOfBirth;
          const address = biodata.communicationAddress || biodata.address;
          if (address) row.communicationAddress = address;
          if (biodata.alternateMobile) row.alternateMobile = biodata.alternateMobile;

          // Religion & Community
          if (biodata.religion) row.religion = biodata.religion;
          if (biodata.caste) row.caste = biodata.caste;
          if (biodata.subCaste) row.subCaste = biodata.subCaste;
          if (biodata.motherTongue) row.motherTongue = biodata.motherTongue;
          if (biodata.denomination) row.denomination = biodata.denomination;

          // Horoscope
          const horoscopeData: Record<string, unknown> = { ...(biodata.horoscope ?? {}) };
          if (biodata.rashi) horoscopeData.rashi = biodata.rashi;
          if (biodata.star) horoscopeData.star = biodata.star;
          if (biodata.padam) horoscopeData.padam = biodata.padam;
          if (biodata.gothram) horoscopeData.gothram = biodata.gothram;
          if (biodata.kujaDosham) horoscopeData.kujaDosham = biodata.kujaDosham;
          if (biodata.timeOfBirth) horoscopeData.timeOfBirth = biodata.timeOfBirth;
          if (Object.keys(horoscopeData).length > 0) {
            row.horoscope = horoscopeData;
            row.horoscopeAvailable = true;
          }

          // Marital Status
          if (maritalStatus) row.maritalStatus = maritalStatus;

          // Family details
          const fatherData: Record<string, unknown> = {
            ...(biodata.father ?? {}),
            ...(biodata.fatherName ? { name: biodata.fatherName } : {}),
            ...(biodata.fatherProfession ? { profession: biodata.fatherProfession } : {}),
          };
          if (Object.keys(fatherData).length > 0) row.father = fatherData;

          const motherData: Record<string, unknown> = {
            ...(biodata.mother ?? {}),
            ...(biodata.motherName ? { name: biodata.motherName } : {}),
            ...(biodata.motherProfession ? { profession: biodata.motherProfession } : {}),
          };
          if (Object.keys(motherData).length > 0) row.mother = motherData;

          if (familyType) row.familyType = familyType;
          if (biodata.familyStatus) row.familyStatus = biodata.familyStatus;
          if (biodata.brothers !== undefined) row.brothers = Number(biodata.brothers) || 0;
          if (biodata.sisters !== undefined) row.sisters = Number(biodata.sisters) || 0;

          // Education & Career
          if (biodata.highestQualification) row.highestQualification = biodata.highestQualification;
          if (biodata.course) row.course = biodata.course;
          if (biodata.institution) row.institution = biodata.institution;
          if (biodata.collegePlace) row.collegePlace = biodata.collegePlace;

          if (occupationStatus) row.occupationStatus = occupationStatus;

          const empData: Record<string, unknown> = {
            ...(biodata.employment ?? {}),
            ...(biodata.profession ? { designation: biodata.profession, role: biodata.profession } : {}),
            ...(biodata.designation ? { designation: biodata.designation } : {}),
            ...(biodata.company ? { company: biodata.company } : {}),
            ...(biodata.workLocation ? { workLocation: biodata.workLocation } : {}),
            ...(biodata.annualIncome || biodata.salary ? { salary: biodata.annualIncome || biodata.salary } : {}),
          };
          if (Object.keys(empData).length > 0) row.employment = empData;
        }

        await repo.save(row);
      }
      return profile;
    });

    // Consent is recorded with the profile, in the same request, so an agency's
    // profile can never exist without a record of who agreed to it. A family
    // member is not asked, but one sent by an older client is still kept.
    if (consent) {
      await this.consent.record(actor, profile.id, {
        scope: ConsentScope.INTAKE,
        method: consent.method,
        givenByRelation: consent.givenByRelation,
        givenByName: consent.givenByName,
        givenByPhone: consent.givenByPhone,
        givenAt: consent.givenAt,
        notes: consent.notes,
      });
    }
    // Compared rather than truthy-tested: agreeing to circulation is consent,
    // and the string "false" must not become one. See `StrictBoolean`.
    if (consent?.allowsCirculation === true) {
      await this.consent.record(actor, profile.id, {
        scope: ConsentScope.CIRCULATION,
        method: consent.method,
        givenByRelation: consent.givenByRelation,
        givenByName: consent.givenByName,
        givenByPhone: consent.givenByPhone,
        givenAt: consent.givenAt,
        notes: consent.notes,
      });
    }

    await this.audit.record({
      action: AuditAction.PROFILE_CREATED_BY_STEWARD,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { contactPhone: dto.contactPhone, hasEmail: Boolean(dto.contactEmail) },
    });

    // No profile-creation fee is raised. Agents collect whatever they arrange
    // with each client directly and independently, so the platform neither
    // charges nor records a profile-creation fee (EZ1-I146). The success-based
    // match-settlement fee, raised when a match is fixed, is unaffected.

    if (inviteNow) await this.invitations.invite(actor, profile.id);
    return this.findOne(actor, profile.id);
  }

  /**
   * Catches the same person being taken on twice.
   *
   * Phrasing matters: if another agency already holds them, saying so outright
   * would leak that agency's book, so the message stays neutral.
   */
  private async assertNotDuplicate(
    actor: AuthUser,
    phone?: string,
    email?: string,
    excludeProfileId?: string,
  ): Promise<void> {
    if (email) {
      const existingUser = await this.users.findOne({ where: { email } });
      if (existingUser) {
        throw new ConflictException(
          'Someone already uses that email address on WOW. Send them an interest instead.',
        );
      }
    }

    if (phone) {
      const byPhone = await this.profiles.find({ where: { contactPhone: phone } });
      const clash = byPhone.find((p) => p.id !== excludeProfileId);
      if (clash) {
        throw new ConflictException(
          clash.managedByUserId === actor.userId
            ? `You already have a profile for that number: ${clash.displayName}.`
            : 'A profile already exists for that mobile number.',
        );
      }
    }

    if (email) {
      const byEmail = await this.profiles.find({ where: { contactEmail: email } });
      if (byEmail.some((p) => p.id !== excludeProfileId)) {
        throw new ConflictException('A profile with that contact email already exists.');
      }
    }
  }

  /**
   * Loads a profile the caller stewards. Admins bypass; everyone else must be
   * the recorded steward.
   */
  async findOne(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (actor.role !== UserRole.ADMIN && profile.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That profile is not one you manage');
    }
    return profile;
  }

  /**
   * One profile, with what the agency may still do to it.
   *
   * The list route has carried this since the actions were introduced; opening
   * a single profile did not, so the same screen got a different answer
   * depending on how it was reached.
   */
  async findOneWithActions(actor: AuthUser, profileId: string) {
    const profile = await this.findOne(actor, profileId);
    return {
      ...profile,
      actions: this.agencyActions(profile),
      // A family keeps no consent record for its own relative (see create),
      // so there is no consent state to report.
      circulation:
        actor.role === UserRole.FAMILY ? null : await this.consent.stateForProfile(profile.id),
    };
  }

  async update(actor: AuthUser, profileId: string, dto: UpdateManagedProfileDto): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);

    // The steward keeps editing after a claim for as long as the engagement is
    // live (stewardMayEditBiodata). An administrator is not a steward and is
    // let through by findOne as before.
    if (actor.role !== UserRole.ADMIN && !stewardMayEditBiodata(profile, actor.userId)) {
      throw new ForbiddenException(CLOSED_ENGAGEMENT_MESSAGE);
    }

    const { inviteNow, ...fields } = dto;

    // What a claim does still change: the contact details and who can see the
    // profile. Before it the contacts are where the invitation goes; after it
    // they are the owner's own, reached through their account, and so is the
    // privacy choice. The agency keeps the biodata, not those.
    const claimed = profile.claimStatus === ProfileClaimStatus.CLAIMED;
    if (
      claimed &&
      actor.role !== UserRole.ADMIN &&
      fields.visibility !== undefined &&
      fields.visibility !== profile.visibility
    ) {
      throw new ForbiddenException(
        'The client has claimed this profile, so who can see it is their choice.',
      );
    }
    if (
      claimed &&
      actor.role !== UserRole.ADMIN &&
      ((fields.contactPhone !== undefined && fields.contactPhone !== profile.contactPhone) ||
        (fields.contactEmail !== undefined && fields.contactEmail !== profile.contactEmail))
    ) {
      throw new ForbiddenException(
        'The client has claimed this profile, so their contact details are theirs to change.',
      );
    }
    void inviteNow; // only meaningful at creation

    if (actor.role === UserRole.FAMILY && fields.stewardRelation !== undefined) {
      const relation = fields.stewardRelation?.trim();
      if (!relation || relation.toLowerCase() === 'self' || relation.toLowerCase() === 'other') {
        throw new BadRequestException(
          'Select your relationship to the person whose profile you are managing.',
        );
      }
      fields.stewardRelation = relation;
    }

    const phoneChanged = fields.contactPhone && fields.contactPhone !== profile.contactPhone;
    const emailChanged = fields.contactEmail && fields.contactEmail !== profile.contactEmail;
    if (phoneChanged || emailChanged) {
      await this.assertNotDuplicate(
        actor,
        fields.contactPhone ?? profile.contactPhone ?? '',
        emailChanged ? fields.contactEmail : undefined,
        profile.id,
      );
    }

    // A full photo list in an edit is another way to attach one; only the
    // photographs this profile does not already have are checked — for being
    // an upload here as well as for being genuine.
    assertNewMediaUploaded('photos', fields.photos, profile.photos);
    await this.moderation.assertGenuinePhotos(fields.photos, profile.photos, {
      userId: actor.userId,
      kind: 'managed_profile',
    });

    Object.assign(profile, fields);
    profile.profileCompleted = this.isComplete(profile);
    return this.profiles.save(profile);
  }

  /** Photo management, kept explicit so the array cap is enforced server-side. */
  async addPhoto(actor: AuthUser, profileId: string, dto: AddProfilePhotoDto): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    // The same rule as the subject's own upload. An agency photographing a
    // walk-in client is exactly the path where a stock or generated face is
    // most tempting, and least likely to be noticed.
    await this.moderation.assertGenuinePhoto(dto.url, {
      userId: actor.userId,
      kind: 'managed_profile',
    });
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new ForbiddenException('This profile is closed.');
    }
    const photos = profile.photos ?? [];
    if (photos.length >= 20) throw new BadRequestException('A profile can hold at most 20 photos.');
    if (photos.includes(dto.url)) return profile;

    profile.photos = [...photos, dto.url];
    return this.profiles.save(profile);
  }

  async removePhoto(actor: AuthUser, profileId: string, url: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new ForbiddenException('This profile is closed.');
    }
    profile.photos = (profile.photos ?? []).filter((p) => p !== url);
    return this.profiles.save(profile);
  }

  async list(actor: AuthUser, q: ManagedProfileSearchDto): Promise<PaginatedResult<Profile>> {
    const qb = this.profiles
      .createQueryBuilder('p')
      .where('p."managedByUserId" = :me', { me: actor.userId });

    if (q.claimStatus) qb.andWhere('p."claimStatus" = :cs', { cs: q.claimStatus });
    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('LOWER(p."displayName") LIKE :term', { term })
            .orWhere('LOWER(p."contactEmail") LIKE :term', { term })
            .orWhere('LOWER(p.city) LIKE :term', { term }),
        ),
      );
    }

    qb.orderBy('p."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();

    // Whether each one may actually be circulated, in one query rather than
    // forty. Without it the client shows a Circulate button that refuses, and
    // the agent has no way of telling which profiles are ready.
    // A family keeps no consent record for its own relatives (see create).
    const consent =
      actor.role === UserRole.FAMILY
        ? new Map<string, never>()
        : await this.consent.stateForMany(data.map((p) => p.id));

    // Each row carries what the agency may still do to it, so the client
    // renders the same rule the server enforces.
    const withActions = data.map((profile) => ({
      ...profile,
      actions: this.agencyActions(profile),
      circulation: consent.get(profile.id) ?? null,
    }));
    return paginate(withActions, total, q.page, q.limit);
  }

  /**
   * Pauses a profile at the client's request.
   *
   * Nothing is deleted and nothing is refunded: a family stepping back for a
   * few months is not ending the engagement, and treating a pause as a closure
   * would cost them their place and their history.
   */
  async deactivate(actor: AuthUser, profileId: string, reason?: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new BadRequestException('That profile is archived');
    }

    profile.lifecycle = ProfileLifecycle.DEACTIVATED;
    profile.deactivatedAt = new Date();
    profile.lifecycleReason = reason ?? null;
    // Pull it out of the shared pool too — a paused profile still circulating
    // is exactly what the client asked to stop.
    profile.networkVisibility = NetworkVisibility.PRIVATE;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.PROFILE_DEACTIVATED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { reason: reason ?? null },
    });
    return saved;
  }

  /** Brings a paused profile back. Circulation stays off until re-consented. */
  async reactivate(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new BadRequestException('An archived profile cannot be reactivated');
    }

    profile.lifecycle = ProfileLifecycle.ACTIVE;
    profile.deactivatedAt = null;
    profile.lifecycleReason = null;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.PROFILE_REACTIVATED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
    });
    return saved;
  }

  /**
   * Closes the engagement out.
   *
   * This is the soft delete: the row stays, so the consent record, the
   * circulation history and the agency's books remain answerable, but the
   * profile never matches or circulates again. Money still sitting in escrow
   * goes back — it was charged against an outcome that will not arrive.
   */
  async archive(actor: AuthUser, profileId: string, reason?: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);

    profile.lifecycle = ProfileLifecycle.ARCHIVED;
    profile.archivedAt = new Date();
    profile.lifecycleReason = reason ?? null;
    profile.networkVisibility = NetworkVisibility.PRIVATE;
    profile.visibility = ProfileVisibility.PRIVATE;
    const saved = await this.profiles.save(profile);

    const refunded = await this.billing.refundHeldFor(profileId, reason ?? 'Profile archived');

    await this.audit.record({
      action: AuditAction.PROFILE_ARCHIVED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { reason: reason ?? null, chargesRefunded: refunded },
    });
    return saved;
  }

  /**
   * What an agency may still do to this profile.
   *
   * Returned alongside the profile so the client renders the same rule the
   * server enforces, rather than showing buttons that will be refused.
   */
  agencyActions(profile: Profile): {
    canEdit: boolean;
    canManagePhotos: boolean;
    canCirculate: boolean;
    canInvite: boolean;
    canPause: boolean;
    canClose: boolean;
    canDelete: boolean;
  } {
    const archived = profile.lifecycle === ProfileLifecycle.ARCHIVED;

    // Claiming used to end every agency action. It no longer does: the family
    // engaged the agency to find a match, and the subject getting an account
    // does not end that engagement — it is usually the point at which the
    // agency's work becomes most useful. What claiming changes is that the
    // subject can now act for themselves as well.
    //
    // Editing the biodata now carries on as well: the client and the agency
    // both write the one profile (stewardMayEditBiodata). Only the invitation
    // ends with the claim, because there is nobody left to invite.
    const claimed = profile.claimStatus === ProfileClaimStatus.CLAIMED;

    return {
      canEdit: !archived,
      canManagePhotos: !archived,
      canCirculate: !archived,
      // A mobile number alone is enough to invite: the invitation goes out by
      // SMS and the client supplies an email when they claim (EZ1-I170). This
      // used to require an email, which hid the button for the phone-first
      // walk-in family that is the whole reason SMS invites exist. The invite
      // service enforces the same rule — a profile with neither is refused.
      canInvite: !claimed && Boolean(profile.contactEmail || profile.contactPhone),
      canPause: !archived,
      canClose: !archived,
      // Available after a claim too, but it means something different there:
      // ending the engagement rather than destroying somebody's account
      // profile. `remove()` carries that distinction, and says which happened.
      canDelete: true,
    };
  }

  /**
   * Take a profile off the agency's book.
   *
   * What that means depends on who owns the record, and the difference is not
   * cosmetic.
   *
   * An **unclaimed** profile exists only because the agency wrote it up. There
   * is no account behind it and nobody else has a claim on it, so deleting
   * removes it.
   *
   * A **claimed** profile is somebody's own. The specification asks for delete
   * to remain available after a claim, and it now is — but destroying the row
   * would take a real person's biodata, consents and matchmaking history with
   * it and leave them signed in to nothing. So for a claimed profile this ends
   * the *engagement*: the profile leaves the agency's book and the owner keeps
   * everything. That is what the button means to an agent either way — "get
   * this off my list" — and it is the only reading where it cannot destroy an
   * account that is not theirs.
   *
   * The consent record and the agency's own billing history survive both paths.
   * They are what the platform answers for its own conduct with, and an agency
   * closing a file is not a reason to lose them.
   */
  async remove(
    actor: AuthUser,
    profileId: string,
  ): Promise<{ success: true; released: boolean; message: string }> {
    const profile = await this.findOne(actor, profileId);
    const claimed = profile.claimStatus === ProfileClaimStatus.CLAIMED;

    if (claimed) {
      profile.managedByUserId = null;
      // Circulation runs on the agency's consent record and their reach. With
      // the engagement over, neither applies, so the profile goes back to
      // private rather than staying in a pool it was put into on the agency's
      // account.
      profile.networkVisibility = NetworkVisibility.PRIVATE;
      await this.profiles.save(profile);

      await this.audit.record({
        action: AuditAction.PROFILE_ARCHIVED,
        actor,
        resourceType: 'profile',
        resourceId: profileId,
        metadata: { released: true, ownerUserId: profile.userId },
      });

      return {
        success: true,
        released: true,
        message:
          'Removed from your book. The profile belongs to its owner, so their details and ' +
          'history stay with them.',
      };
    }

    await this.profiles.remove(profile);
    await this.audit.record({
      action: AuditAction.PROFILE_ARCHIVED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { released: false, deleted: true },
    });

    return {
      success: true,
      released: false,
      message: 'Deleted. Nobody had claimed this profile, so nothing of theirs was attached to it.',
    };
  }

  /**
   * Every profile the caller may act under: their own, plus any they steward.
   * This is the list the "acting as" selector is built from.
   */
  /**
   * The profiles this account may act as.
   *
   * An agency's own account is not one of them. It appeared in the client
   * picker on Matches, Biodata and the Network Pool as "(me)", which is an
   * agency being offered the chance to browse marriage proposals for itself —
   * and every screen that read the list had to know to skip it.
   *
   * Decided on the role rather than by hiding a name, which is the difference
   * between a fix and a patch. The same holds for a family account: its own
   * profile describes the parent or guardian, who is not being matched, so a
   * family acts only as the relatives it manages. Listing the account as one
   * of its own profiles offered it a biodata and a match list of its own.
   */
  async actableProfiles(actor: AuthUser): Promise<Profile[]> {
    const managed = await this.profiles.find({
      where: { managedByUserId: actor.userId },
      order: { createdAt: 'DESC' },
    });
    if (actor.role === UserRole.AGENT || actor.role === UserRole.FAMILY) return managed;

    const own = await this.profiles.find({ where: { userId: actor.userId } });
    const seen = new Set(own.map((p) => p.id));
    return [...own, ...managed.filter((p) => !seen.has(p.id))];
  }

  private isComplete(p: Partial<Profile>): boolean {
    return Boolean(p.displayName && p.gender && p.dateOfBirth && p.city);
  }
}
