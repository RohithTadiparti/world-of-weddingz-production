import { ValidationPipe } from '@nestjs/common';
import { SuggestionsQueryDto } from '../matchmaking/dto/matchmaking.dto';
import { Repository } from 'typeorm';
import { ProfileDetailsService } from './profile-details.service';
import { ProfileDetails } from './entities/profile-details.entity';
import { ProfileSibling } from './entities/profile-sibling.entity';
import { ProfileAsset } from './entities/profile-asset.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../../platform/storage/storage.service';
import { RedisService } from '../../platform/redis/redis.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  Complexion,
  FamilyType,
  MaritalStatus,
  OccupationStatus,
  ProfileLifecycle,
  UserRole,
} from '../../common/enums';
import {
  EducationDetailsDto,
  OccupationDetailsDto,
  FamilyDetailsDto,
  HoroscopeDetailsDto,
  MaritalDetailsDto,
  PartnerPreferencesDto,
  PersonalDetailsDto,
  ReligionDetailsDto,
} from './dto/profile-details.dto';

const owner: AuthUser = {
  userId: 'u1',
  email: 'u1@example.com',
  role: UserRole.BRIDE,
  managedByAgentId: null,
};

/**
 * Saving one biodata section must never blank another (the reported "personal
 * details are getting wiped").
 *
 * The repository stand-in behaves as TypeORM's `save` does for a loaded row:
 * a property left `undefined` is not written, and every read is a fresh copy of
 * what is stored. That is what makes a `?? null` in a section save visible
 * here: it turns "not sent" into a real write of nothing.
 */
describe('ProfileDetailsService section saves', () => {
  let stored: Record<string, unknown> | null;
  let profile: Profile;

  const details = {
    findOne: jest.fn(async () => (stored ? ({ ...stored } as unknown as ProfileDetails) : null)),
    create: jest.fn((init: Partial<ProfileDetails>) => ({ ...init }) as ProfileDetails),
    save: jest.fn(async (row: ProfileDetails) => {
      const written = Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== undefined),
      );
      stored = { ...(stored ?? {}), ...written };
      return { ...stored } as unknown as ProfileDetails;
    }),
  } as unknown as Repository<ProfileDetails>;

  const profiles = {
    findOne: jest.fn(async () => profile),
    save: jest.fn(async (p: Profile) => p),
  } as unknown as Repository<Profile>;

  const users = {
    findOne: jest.fn(),
  } as unknown as Repository<User>;

  const cachedSuggestionKeys = ['match:suggestions:p1:1:20:', 'match:suggestions:unrelated:1:20:'];
  const redis = {
    raw: {
      scan: jest.fn(async (_cursor: string, _match: string, pattern: string) => [
        '0',
        cachedSuggestionKeys.filter((key) => key.startsWith(pattern.replace('*', ''))),
      ]),
    },
    del: jest.fn(),
  } as unknown as RedisService;

  const service = new ProfileDetailsService(
    details,
    {} as Repository<ProfileSibling>,
    {} as Repository<ProfileAsset>,
    profiles,
    users,
    redis,
    {} as ModerationService,
    {} as Repository<Interest>,
    {} as AiService,
    {} as StorageService,
  );

  const personal = (over: Partial<PersonalDetailsDto> = {}) =>
    ({
      firstName: 'Bhavana',
      lastName: 'Rao',
      heightCm: 168,
      complexion: Complexion.WHEATISH,
      communicationAddress: '12 Test Road, Hyderabad',
      ...over,
    }) as PersonalDetailsDto;

  const PERSONAL = {
    firstName: 'Bhavana',
    lastName: 'Rao',
    heightCm: 168,
    complexion: Complexion.WHEATISH,
    communicationAddress: '12 Test Road, Hyderabad',
    alternateMobile: '+919876543210',
    residence: { city: 'Hyderabad', state: 'Telangana' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    profile = {
      id: 'p1',
      userId: 'u1',
      managedByUserId: null,
      managingFor: null,
      photos: ['a.jpg', 'b.jpg', 'c.jpg'],
      preferences: {},
    } as unknown as Profile;
    (users.findOne as jest.Mock).mockResolvedValue({
      id: 'u1',
      phone: '+918008862658',
      phoneVerifiedAt: new Date(),
      email: 'u1@example.com',
    });
  });

  it('uses the editable profile mobile in biodata contact details', async () => {
    profile.contactPhone = '+919177797410';
    const contact = await (
      service as unknown as { contactFor: (profile: Profile) => Promise<Record<string, unknown>> }
    ).contactFor(profile);

    expect(contact).toMatchObject({
      primaryMobile: '+919177797410',
      primaryMobileSource: 'profile',
      primaryMobileVerified: false,
    });
  });

  it.each([UserRole.BRIDE, UserRole.FAMILY])('persists package preferences for %s', async (role) => {
    const actor = { ...owner, role };
    if (role === UserRole.FAMILY) {
      profile.userId = null;
      profile.managedByUserId = actor.userId;
    }
    const result = await service.savePreferences(actor, 'p1', {
      preferredAgeMin: 24, preferredAgeMax: 34,
      preferredHeightMinCm: 150, preferredHeightMaxCm: 189,
      preferredPackageMin: 1000000, preferredPackageMax: 2000000,
    });
    expect(result).toMatchObject({ preferredPackageMin: 1000000, preferredPackageMax: 2000000 });
    expect(await details.findOne({ where: { profileId: 'p1' } })).toMatchObject({ preferredPackageMin: 1000000, preferredPackageMax: 2000000 });
  });

  it('validates package API bodies and converts query bounds', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const base = { preferredAgeMin: 24, preferredAgeMax: 34, preferredHeightMinCm: 150, preferredHeightMaxCm: 189 };
    for (const value of [-1, 1.5, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
      await expect(pipe.transform({ ...base, preferredPackageMin: value }, { type: 'body', metatype: PartnerPreferencesDto })).rejects.toThrow();
      await expect(pipe.transform({ packageMax: value }, { type: 'query', metatype: SuggestionsQueryDto })).rejects.toThrow();
    }
    expect(await pipe.transform({ ...base, preferredPackageMin: null, preferredPackageMax: 0 }, { type: 'body', metatype: PartnerPreferencesDto }))
      .toMatchObject({ preferredPackageMin: null, preferredPackageMax: 0 });
    expect(await pipe.transform({ packageMin: '0', packageMax: '2000000' }, { type: 'query', metatype: SuggestionsQueryDto }))
      .toMatchObject({ packageMin: 0, packageMax: 2000000 });
  });

  it('filters matches on the same height range the biodata accepts', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const query = (q: Record<string, string>) => pipe.transform(q, { type: 'query', metatype: SuggestionsQueryDto });
    const body = (min: number, max: number) =>
      pipe.transform(
        { preferredAgeMin: 24, preferredAgeMax: 34, preferredHeightMinCm: min, preferredHeightMaxCm: max },
        { type: 'body', metatype: PartnerPreferencesDto },
      );
    // 3 ft 0 in and 8 ft 0 in, the ends of the range.
    await expect(query({ heightMinCm: '91', heightMaxCm: '244' })).resolves.toMatchObject({ heightMinCm: 91, heightMaxCm: 244 });
    await expect(body(91, 244)).resolves.toBeDefined();
    for (const [min, max] of [['90', '200'], ['150', '245']]) {
      await expect(query({ heightMinCm: min, heightMaxCm: max })).rejects.toThrow();
      await expect(body(Number(min), Number(max))).rejects.toThrow();
    }
  });

  it('saves, preserves, edits and clears package bounds without losing other sections', async () => {
    stored = { profileId: 'p1', religion: 'Hindu' };
    const base = { preferredAgeMin: 24, preferredAgeMax: 34, preferredHeightMinCm: 150, preferredHeightMaxCm: 189 };
    await service.savePreferences(owner, 'p1', { ...base, preferredPackageMin: 0, preferredPackageMax: 1200000 });
    expect(stored).toMatchObject({ preferredPackageMin: 0, preferredPackageMax: 1200000, religion: 'Hindu' });
    await service.savePreferences(owner, 'p1', base);
    expect(stored).toMatchObject({ preferredPackageMin: 0, preferredPackageMax: 1200000 });
    await expect(service.savePreferences(owner, 'p1', { ...base, preferredPackageMin: 1200001 })).rejects.toThrow('minimum package');
    await service.savePreferences(owner, 'p1', { ...base, preferredPackageMin: 500000 });
    expect(stored).toMatchObject({ preferredPackageMin: 500000, preferredPackageMax: 1200000 });
    await service.savePreferences(owner, 'p1', { ...base, preferredPackageMin: null, preferredPackageMax: null });
    expect(stored).toMatchObject({ preferredPackageMin: null, preferredPackageMax: null, religion: 'Hindu' });
    expect(redis.raw.scan).toHaveBeenCalledWith('0', 'MATCH', 'match:suggestions:p1:*', 'COUNT', 100);
    expect(redis.del).toHaveBeenCalledWith('match:suggestions:p1:1:20:');
    expect(redis.del).not.toHaveBeenCalledWith('match:suggestions:unrelated:1:20:');
  });

  it('keeps the personal section intact while every other section is saved', async () => {
    await service.savePersonal(
      owner,
      'p1',
      personal({ alternateMobile: '+919876543210', residence: PERSONAL.residence }),
    );

    await service.saveReligion(owner, 'p1', {
      religion: 'Hindu',
      caste: 'Kamma',
      subCaste: '',
      motherTongue: 'Telugu',
    } as ReligionDetailsDto);
    await service.saveHoroscope(owner, 'p1', {
      horoscopeAvailable: true,
      rashi: 'Tula',
    } as HoroscopeDetailsDto);
    await service.saveMarital(owner, 'p1', {
      maritalStatus: MaritalStatus.NEVER_MARRIED,
    } as MaritalDetailsDto);
    await service.saveFamily(owner, 'p1', {
      father: { name: 'Ravi Rao' },
      mother: { name: 'Lata Rao' },
      familyType: FamilyType.NUCLEAR,
      familyStatus: 'middle_class',
      brothers: 1,
      sisters: 0,
    } as unknown as FamilyDetailsDto);
    await service.saveEducation(owner, 'p1', {
      highestQualification: 'Masters',
      course: 'M.Tech',
      occupationStatus: OccupationStatus.STUDENT,
    } as EducationDetailsDto);
    await service.savePreferences(owner, 'p1', {
      preferredAgeMin: 25,
      preferredAgeMax: 32,
      preferredHeightMinCm: 163,
      preferredHeightMaxCm: 189,
    } as PartnerPreferencesDto);

    expect(stored).toMatchObject(PERSONAL);
    expect(stored).toMatchObject({ religion: 'Hindu', maritalStatus: 'never_married' });
  });

  describe('a claimed client with an agency still engaged', () => {
    const agent: AuthUser = {
      userId: 'agent1',
      email: 'agent@example.com',
      role: UserRole.AGENT,
      managedByAgentId: null,
    };
    const religion = (caste: string) =>
      ({ religion: 'Hindu', caste, subCaste: '', motherTongue: 'Telugu' }) as ReligionDetailsDto;

    beforeEach(() => {
      // Claimed: the client owns the account, and the agency still manages it.
      profile = { ...profile, userId: 'u1', managedByUserId: 'agent1', lifecycle: ProfileLifecycle.ACTIVE } as Profile;
    });

    it('lets both the agency and the client write the one biodata', async () => {
      await service.saveReligion(agent, 'p1', religion('Kamma'));
      expect(stored).toMatchObject({ caste: 'Kamma' });

      await service.saveReligion(owner, 'p1', religion('Reddy'));
      expect(stored).toMatchObject({ caste: 'Reddy' });

      await service.saveReligion(agent, 'p1', religion('Kapu'));
      expect(stored).toMatchObject({ caste: 'Kapu' });
    });

    it('still lets a paused client be edited by their agency', async () => {
      profile.lifecycle = ProfileLifecycle.DEACTIVATED;
      await service.saveReligion(agent, 'p1', religion('Kamma'));
      expect(stored).toMatchObject({ caste: 'Kamma' });
    });

    it('refuses the agency once the engagement is closed, but not the client', async () => {
      profile.lifecycle = ProfileLifecycle.ARCHIVED;
      await expect(service.saveReligion(agent, 'p1', religion('Kamma'))).rejects.toThrow(
        /engagement is closed/,
      );
      await service.saveReligion(owner, 'p1', religion('Reddy'));
      expect(stored).toMatchObject({ caste: 'Reddy' });
    });

    it('refuses an agency that does not manage the profile', async () => {
      const other = { ...agent, userId: 'agent2' };
      await expect(service.saveReligion(other, 'p1', religion('Kamma'))).rejects.toThrow(
        /not yours to edit/,
      );
    });
  });

  it('leaves an unsent residence and alternate mobile alone on a personal save', async () => {
    stored = { profileId: 'p1', ...PERSONAL };

    // What the web form sends: it has no residence field at all.
    await service.savePersonal(owner, 'p1', personal({ heightCm: 165 }));

    expect(stored).toMatchObject({
      heightCm: 165,
      residence: PERSONAL.residence,
      alternateMobile: PERSONAL.alternateMobile,
    });
  });

  it('clears the alternate mobile when a null is sent for it', async () => {
    stored = { profileId: 'p1', ...PERSONAL };

    await service.savePersonal(
      owner,
      'p1',
      personal({ alternateMobile: null as unknown as string }),
    );

    expect(stored?.alternateMobile).toBeNull();
    expect(stored?.residence).toEqual(PERSONAL.residence);
  });

  it('keeps an unsent denomination, institution and college place', async () => {
    stored = { profileId: 'p1', denomination: 'Shaiva', institution: 'IIT', collegePlace: 'Delhi' };

    await service.saveReligion(owner, 'p1', {
      religion: 'Hindu',
      caste: 'Kamma',
      subCaste: '',
      motherTongue: 'Telugu',
    } as ReligionDetailsDto);
    await service.saveEducation(owner, 'p1', {
      highestQualification: 'Masters',
      course: 'M.Tech',
      occupationStatus: OccupationStatus.STUDENT,
    } as EducationDetailsDto);

    expect(stored).toMatchObject({ denomination: 'Shaiva', institution: 'IIT', collegePlace: 'Delhi' });

    await service.saveEducation(owner, 'p1', {
      highestQualification: 'Masters',
      course: 'M.Tech',
      occupationStatus: OccupationStatus.STUDENT,
      institution: null as unknown as string,
    } as EducationDetailsDto);
    expect(stored?.institution).toBeNull();
    expect(stored?.collegePlace).toBe('Delhi');
  });

  it('saves occupation details separately from education details', async () => {
    stored = { profileId: 'p1', highestQualification: 'B.Tech', course: 'CSE' };

    await service.saveOccupation(owner, 'p1', {
      occupationStatus: OccupationStatus.EMPLOYED,
      employment: { company: 'Google', designation: 'Software Engineer' },
      incomeVisible: true,
    } as OccupationDetailsDto);

    expect(stored).toMatchObject({
      highestQualification: 'B.Tech',
      course: 'CSE',
      occupationStatus: OccupationStatus.EMPLOYED,
      incomeVisible: true,
    });
  });

  it('requires and saves family net worth for a groom profile', async () => {
    profile.gender = 'male';

    const base = {
        father: { name: 'Ravi Rao' },
        mother: { name: 'Lata Rao' },
        familyType: FamilyType.NUCLEAR,
        familyStatus: 'middle_class',
        brothers: 0,
        sisters: 1,
      } as unknown as FamilyDetailsDto;

    await expect(service.saveFamily(owner, 'p1', base)).rejects.toThrow('Family net worth is required');
    await expect(service.saveFamily(owner, 'p1', {
      ...base,
      familyNetWorth: 7500000,
      familyNetWorthVisible: true,
    })).resolves.toMatchObject({ familyNetWorth: '7500000', familyNetWorthVisible: true });
  });

  it('hides and clears family net worth for a bride profile (female gender)', async () => {
    profile.gender = 'female';

    await expect(
      service.saveFamily(owner, 'p1', {
        father: { name: 'Ravi Rao' },
        mother: { name: 'Lata Rao' },
        familyType: FamilyType.NUCLEAR,
        familyStatus: 'middle_class',
        brothers: 2,
        sisters: 0,
        familyNetWorth: 7500000,
        familyNetWorthVisible: true,
        // familyNetWorth deliberately omitted — must not throw
      } as unknown as FamilyDetailsDto),
    ).resolves.toBeDefined();

    expect(stored).toMatchObject({ familyType: FamilyType.NUCLEAR, familyNetWorth: null, familyNetWorthVisible: false });
  });

  it('validates employment and business on an education save without an occupation', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const base = { highestQualification: 'Masters', course: 'M.Tech' };
    for (const body of [
      { employment: 'abc' },
      { business: 'abc' },
      { business: { entries: 'x' } },
      { business: { entries: [{ businessName: 'A', businessIncome: 'lots' }] } },
      { occupationStatus: OccupationStatus.EMPLOYED },
    ]) {
      await expect(
        pipe.transform({ ...base, ...body }, { type: 'body', metatype: EducationDetailsDto }),
      ).rejects.toThrow();
    }
    await expect(
      pipe.transform(
        { ...base, business: { entries: [{ businessName: 'A', businessIncome: '500000' }] } },
        { type: 'body', metatype: EducationDetailsDto },
      ),
    ).resolves.toBeDefined();
  });

  it('changes only the occupation blocks that were sent', async () => {
    stored = {
      profileId: 'p1',
      occupationStatus: OccupationStatus.SELF_EMPLOYED,
      business: { businessName: 'Shop', entries: [{ id: 'b1', businessName: 'Shop' }] },
    };

    await service.saveEducation(owner, 'p1', {
      highestQualification: 'Masters',
      course: 'M.Tech',
      occupationStatus: OccupationStatus.EMPLOYED,
      employment: { company: 'Acme', designation: 'Engineer' },
    } as EducationDetailsDto);

    expect(stored).toMatchObject({
      occupationStatus: OccupationStatus.EMPLOYED,
      employment: { company: 'Acme', designation: 'Engineer' },
      business: { businessName: 'Shop', entries: [{ id: 'b1', businessName: 'Shop' }] },
    });
  });

  const EDUCATION = {
    highestQualification: 'Masters',
    course: 'M.Tech',
    occupationStatus: OccupationStatus.EMPLOYED,
    employment: { company: 'Acme', designation: 'Engineer', salary: '1200000' },
  };

  it('keeps other income when a save does not send it, and replaces it when one does', async () => {
    await service.saveEducation(owner, 'p1', {
      ...EDUCATION,
      otherIncome: [{ source: 'business', details: '  Textile shop ', annualIncome: '600000' }],
    } as EducationDetailsDto);
    expect(stored?.otherIncome).toEqual([
      { source: 'business', details: 'Textile shop', annualIncome: '600000' },
    ]);

    // An older client, which knows nothing of the field.
    await service.saveEducation(owner, 'p1', EDUCATION as EducationDetailsDto);
    expect(stored?.otherIncome).toHaveLength(1);

    await service.saveEducation(owner, 'p1', {
      ...EDUCATION,
      otherIncome: [],
    } as EducationDetailsDto);
    expect(stored?.otherIncome).toEqual([]);
  });

  it('shares other income without the amounts unless income is shown', async () => {
    const sharing = new ProfileDetailsService(
      details,
      { find: jest.fn(async () => []) } as unknown as Repository<ProfileSibling>,
      { find: jest.fn(async () => []) } as unknown as Repository<ProfileAsset>,
      profiles,
      {} as Repository<User>,
      redis,
      {} as ModerationService,
      {} as Repository<Interest>,
      {} as AiService,
      {} as StorageService,
    );
    stored = {
      profileId: 'p1',
      ...EDUCATION,
      business: {},
      otherIncome: [{ source: 'rental', annualIncome: '300000' }],
      incomeVisible: false,
    };

    const hidden = await sharing.findShareable('p1');
    expect(hidden.details?.otherIncome).toEqual([{ source: 'rental' }]);
    expect(hidden.details?.employment).not.toHaveProperty('salary');

    stored.incomeVisible = true;
    const shown = await sharing.findShareable('p1');
    expect(shown.details?.otherIncome).toEqual([{ source: 'rental', annualIncome: '300000' }]);
  });
});

/**
 * The biodata reader may only be pointed at the caller's own biodata upload,
 * and reads it through a link signed here rather than one the client sent.
 */
describe('ProfileDetailsService.extractBiodata', () => {
  const profile = { id: 'p1', userId: 'u1', managedByUserId: null } as unknown as Profile;
  const details = {
    findOne: jest.fn(async () => null),
    create: jest.fn((init: Partial<ProfileDetails>) => ({ ...init }) as ProfileDetails),
  } as unknown as Repository<ProfileDetails>;
  const profiles = { findOne: jest.fn(async () => profile) } as unknown as Repository<Profile>;
  const ai = { extractBiodata: jest.fn(async () => ({ firstName: 'Bhavana' })) };
  const storage = { signedUrl: jest.fn(async (key: string) => `https://signed.example/${key}`) };

  const service = new ProfileDetailsService(
    details,
    {} as Repository<ProfileSibling>,
    {} as Repository<ProfileAsset>,
    profiles,
    {} as Repository<User>,
    {} as RedisService,
    {} as ModerationService,
    {} as Repository<Interest>,
    ai as unknown as AiService,
    storage as unknown as StorageService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('signs a short-lived link to the caller\'s own biodata and reads that', async () => {
    const key = 'users/u1/biodata/1767000000000-abcdef0123456789-biodata.jpg';
    await expect(service.extractBiodata(owner, 'p1', key)).resolves.toEqual({ firstName: 'Bhavana' });
    expect(storage.signedUrl).toHaveBeenCalledWith(key, {
      expiresInSeconds: ProfileDetailsService.EXTRACT_LINK_SECONDS,
    });
    expect(ai.extractBiodata).toHaveBeenCalledWith(`https://signed.example/${key}`);
  });

  it.each([
    ['somebody else\'s biodata', 'users/u2/biodata/1-a-biodata.jpg'],
    ['a file from another area', 'users/u1/attachments/1-a-receipt.jpg'],
    ['a key the platform never minted', 'https://attacker.example/x.jpg'],
    ['a key that climbs out', 'users/u1/biodata/../profile/x.jpg'],
  ])('refuses %s without calling the model', async (_what, key) => {
    await expect(service.extractBiodata(owner, 'p1', key)).rejects.toThrow('That is not a biodata you uploaded');
    expect(storage.signedUrl).not.toHaveBeenCalled();
    expect(ai.extractBiodata).not.toHaveBeenCalled();
  });

  it('refuses a document the reader cannot look at', async () => {
    await expect(
      service.extractBiodata(owner, 'p1', 'users/u1/biodata/1-a-biodata.pdf'),
    ).rejects.toThrow('JPEG, PNG or WebP');
    expect(ai.extractBiodata).not.toHaveBeenCalled();
  });
});
