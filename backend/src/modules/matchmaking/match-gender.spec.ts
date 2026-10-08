import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { MatchmakingService } from './matchmaking.service';
import { Interest } from './entities/interest.entity';
import { CompatibilityEngine } from './compatibility.engine';
import { matchGender, soughtGender } from './match-gender';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { ProfileSibling } from '../profile-details/entities/profile-sibling.entity';
import { ProfileShortlist } from './entities/shortlist.entity';
import { ProfileShare } from '../circulation/entities/profile-share.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../platform/redis/redis.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { Neo4jService } from '../../platform/neo4j/neo4j.service';
import { ProfileLifecycle, ProfileVisibility, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const profile = (id: string, over: Partial<Profile> = {}): Profile =>
  ({
    id,
    userId: `${id}-user`,
    managedByUserId: null,
    managingFor: null,
    displayName: `Profile ${id}`,
    gender: 'female',
    city: 'Hyderabad',
    dateOfBirth: '1996-04-02',
    photos: ['p1.jpg', 'p2.jpg', 'p3.jpg'],
    idVerifiedAt: new Date('2026-09-01T10:00:00Z'),
    visibility: ProfileVisibility.MATCHES_ONLY,
    lifecycle: ProfileLifecycle.ACTIVE,
    profileCompleted: true,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastActiveAt: null,
    ...over,
  }) as Profile;

/**
 * A biodata row that clears every completion rule, so the interest gates
 * (biodata, identity, a ready recipient) stay out of the way of what these
 * tests are about.
 */
const readyBiodata = (profileId: string) =>
  ({
    profileId,
    firstName: 'First',
    lastName: 'Last',
    heightCm: 165,
    complexion: 'Fair',
    communicationAddress: 'Hyderabad',
    religion: 'Hindu',
    caste: 'Kamma',
    motherTongue: 'Telugu',
    horoscopeAvailable: false,
    maritalStatus: 'never_married',
    father: 'Father',
    mother: 'Mother',
    familyType: 'nuclear',
    familyNetWorth: '10000000',
    brothers: 0,
    sisters: 0,
    highestQualification: 'B.Tech',
    course: 'CSE',
    occupationStatus: 'employed',
    preferredAgeMin: 24,
    preferredHeightMinCm: 150,
  }) as unknown as ProfileDetails;
const biodataRepo = {
  findOne: jest.fn(async (opts: { where: { profileId: string } }) => readyBiodata(opts.where.profileId)),
  find: jest.fn(async (opts: { where: { profileId: FindOperator<string[]> } }) =>
    (opts.where.profileId.value as unknown as string[]).map(readyBiodata),
  ),
};

/**
 * Which side of a match a profile is on.
 *
 * The reported case: a mother opened a family account for her son. Her profile
 * records her own gender, "Female", and says it is managing for a groom — and
 * her son was offered grooms, because the suggestions excluded "the profile's
 * gender" and compared "Female" with the seed's "female" as two different
 * words.
 */
describe('matchGender', () => {
  it('reads the side from managingFor before the account holder’s gender', () => {
    expect(matchGender({ gender: 'Female', managingFor: 'groom' })).toBe('male');
    expect(matchGender({ gender: 'male', managingFor: 'bride' })).toBe('female');
    expect(soughtGender({ gender: 'Female', managingFor: 'groom' })).toBe('female');
  });

  it('falls back to gender, whatever its case', () => {
    expect(matchGender({ gender: 'Female', managingFor: null })).toBe('female');
    expect(matchGender({ gender: 'male', managingFor: null })).toBe('male');
    expect(matchGender({ gender: ' MALE ', managingFor: '' })).toBe('male');
  });

  it('says nothing when neither is known, so nobody is filtered on a guess', () => {
    expect(matchGender({ gender: null as unknown as string, managingFor: null })).toBeNull();
    expect(soughtGender({ gender: '', managingFor: null })).toBeNull();
  });
});

describe('MatchmakingService gender rule for a family steward', () => {
  let service: MatchmakingService;
  let byId: Map<string, Profile>;
  let pool: Profile[];

  const family: AuthUser = {
    userId: 'mother-user',
    email: 'mother@example.com',
    role: UserRole.FAMILY,
    managedByAgentId: null,
  };
  // The son's profile the mother manages. It was saved with her own gender,
  // "Female", while managingFor says whose match it actually is.
  const son = profile('son', {
    userId: null,
    managedByUserId: family.userId,
    gender: 'Female',
    managingFor: 'groom',
  });
  // The mother's own account profile: her details, not a bride's or groom's.
  const mother = profile('mother', { userId: family.userId, gender: 'Female' });
  const forSon = { page: 1, limit: 10, profileId: son.id } as never;

  const profilesRepo = {
    findOne: jest.fn(async (opts: { where: { id?: string; userId?: string } }) =>
      opts.where.id ? (byId.get(opts.where.id) ?? null) : mother,
    ),
    find: jest.fn(async () => pool),
  };
  const empty = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
  let owners: Pick<User, 'id' | 'role' | 'isActive'>[] = [];
  const usersRepo = {
    find: jest.fn(async () => owners),
    findOne: jest.fn(
      async (opts: { where: { id: string } }) => owners.find((u) => u.id === opts.where.id) ?? null,
    ),
  };
  const interestsRepo = {
    ...empty,
    count: jest.fn(async () => 0),
    create: jest.fn((row: Partial<Interest>) => row),
    save: jest.fn(async (row: Partial<Interest>) => ({ id: 'interest-1', ...row })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    byId = new Map([
      [son.id, son],
      [mother.id, mother],
    ]);
    pool = [];
    owners = [];

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        { provide: getRepositoryToken(Interest), useValue: interestsRepo },
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(ProfileDetails), useValue: biodataRepo },
        { provide: getRepositoryToken(ProfileSibling), useValue: empty },
        { provide: getRepositoryToken(ProfileShortlist), useValue: empty },
        { provide: getRepositoryToken(ProfileShare), useValue: empty },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(AgentProfile), useValue: empty },
        {
          provide: CompatibilityEngine,
          useValue: { score: () => ({ score: 60, breakdown: {} }) },
        },
        {
          provide: AppConfigService,
          useValue: {
            matchmaking: { maxSuggestions: 50, minScore: 0, suggestionsCacheTtlSeconds: 1 },
            features: { matchmakingRequiresIdentity: true },
          },
        },
        {
          provide: RedisService,
          useValue: {
            wrap: (_k: string, _t: number, fn: () => unknown) => fn(),
            raw: { keys: async () => [] },
            del: jest.fn(),
          },
        },
        { provide: OutboxService, useValue: { record: jest.fn() } },
        { provide: Neo4jService, useValue: { ready: false, recordInterest: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MatchmakingService);
  });

  it.each(Object.values(ProfileVisibility))('applies private-profile eligibility for %s', async visibility => {
    const candidate = profile('candidate', { userId: null, gender: 'female', visibility });
    pool = [candidate];
    byId.set(candidate.id, candidate);
    const result = await service.suggestions(family, forSon);
    const [{ where }] = profilesRepo.find.mock.calls[0] as unknown as [{ where: object[] }];
    for (const branch of where) {
      expect(branch).toMatchObject({
        visibility: expect.objectContaining({
          _type: 'not',
          _value: ProfileVisibility.PRIVATE,
        }),
      });
    }
    if (visibility === ProfileVisibility.PRIVATE) {
      await expect(service.sendInterest(family, candidate.id, son.id)).rejects.toThrow(
        'not accepting interests',
      );
      return;
    }
    expect(result.data.map(row => row.profile.id)).toContain(candidate.id);
    await expect(service.sendInterest(family, candidate.id, son.id)).resolves.toMatchObject({
      fromProfileId: son.id, toProfileId: candidate.id,
    });
  });

  it('suggests brides to the groom, not grooms to the mother', async () => {
    // Unclaimed, agency-built profiles, so no owner account needs looking up.
    const unclaimed = { userId: null };
    pool = [
      profile('bride', { ...unclaimed, gender: 'female' }),
      profile('groom', { ...unclaimed, gender: 'male', displayName: 'Rohit Paruchuri' }),
      // Another family's profile: a father ("Male") looking for his daughter.
      profile('daughter', { ...unclaimed, gender: 'Male', managingFor: 'bride' }),
      // And a sister looking for her brother — a groom, whatever her gender.
      profile('brother', { ...unclaimed, gender: 'female', managingFor: 'groom' }),
    ];

    const result = await service.suggestions(family, forSon);

    expect(result.data.map((s) => s.profile.id).sort()).toEqual(['bride', 'daughter']);
    expect(result.counts?.total).toBe(2);
    // And the database is asked for brides in the first place — by side
    // (managingFor) or, failing that, by gender — rather than for "not Female".
    const [{ where }] = profilesRepo.find.mock.calls[0] as unknown as [{ where: object[] }];
    expect(where).toHaveLength(2);
    expect(where[0]).toHaveProperty('managingFor');
    expect(where[1]).toHaveProperty('gender');
  });

  it('refuses an interest from the groom to another groom', async () => {
    const groom = profile('groom', { gender: 'male' });
    byId.set(groom.id, groom);

    const attempt = service.sendInterest(family, groom.id, son.id);
    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow('opposite gender');
  });

  it('lets the groom approach a bride whose profile her father runs', async () => {
    const daughter = profile('daughter', { gender: 'Male', managingFor: 'bride', userId: null });
    byId.set(daughter.id, daughter);

    await expect(service.sendInterest(family, daughter.id, son.id)).resolves.toMatchObject({
      fromProfileId: son.id,
      toProfileId: daughter.id,
    });
  });

  // The family account is the parent, not the person being matched.
  it('asks a family account to choose the relative it is acting for', async () => {
    await expect(
      service.suggestions(family, { page: 1, limit: 10 } as never),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.suggestions(family, { page: 1, limit: 10, profileId: mother.id } as never),
    ).rejects.toThrow('relatives they manage');
    await expect(service.sendInterest(family, son.id, mother.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('never suggests a family account’s own profile to anybody', async () => {
    pool = [
      profile('bride', { userId: 'bride-user', gender: 'female' }),
      profile('another-mother', { userId: 'other-family-user', gender: 'female' }),
      profile('relative', { userId: null, managedByUserId: 'other-family-user', gender: 'female' }),
    ];
    owners = [
      { id: 'bride-user', role: UserRole.BRIDE, isActive: true },
      { id: 'other-family-user', role: UserRole.FAMILY, isActive: true },
    ];

    const result = await service.suggestions(family, forSon);

    expect(result.data.map((s) => s.profile.id).sort()).toEqual(['bride', 'relative']);
  });

  it('refuses an interest addressed to a family account’s own profile', async () => {
    const otherMother = profile('another-mother', { userId: 'other-family-user', gender: 'female' });
    byId.set(otherMother.id, otherMother);
    owners = [{ id: 'other-family-user', role: UserRole.FAMILY, isActive: true }];

    await expect(service.sendInterest(family, otherMother.id, son.id)).rejects.toThrow(
      'individual profiles',
    );
  });
});
