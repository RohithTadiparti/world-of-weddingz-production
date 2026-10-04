import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MatchmakingService } from './matchmaking.service';
import { Interest } from './entities/interest.entity';
import { CompatibilityEngine } from './compatibility.engine';
import { matchGender, soughtGender } from './match-gender';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
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
    photos: [],
    visibility: ProfileVisibility.MATCHES_ONLY,
    lifecycle: ProfileLifecycle.ACTIVE,
    profileCompleted: true,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastActiveAt: null,
    ...over,
  }) as Profile;

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
  // The mother's own profile row, which is the groom's profile.
  const son = profile('son', {
    userId: family.userId,
    gender: 'Female',
    managingFor: 'groom',
  });

  const profilesRepo = {
    findOne: jest.fn(async (opts: { where: { id?: string; userId?: string } }) =>
      opts.where.id ? (byId.get(opts.where.id) ?? null) : son,
    ),
    find: jest.fn(async () => pool),
  };
  const empty = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
  const interestsRepo = {
    ...empty,
    count: jest.fn(async () => 0),
    create: jest.fn((row: Partial<Interest>) => row),
    save: jest.fn(async (row: Partial<Interest>) => ({ id: 'interest-1', ...row })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    byId = new Map([[son.id, son]]);
    pool = [];

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        { provide: getRepositoryToken(Interest), useValue: interestsRepo },
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(ProfileDetails), useValue: empty },
        { provide: getRepositoryToken(ProfileShortlist), useValue: empty },
        { provide: getRepositoryToken(ProfileShare), useValue: empty },
        { provide: getRepositoryToken(User), useValue: empty },
        { provide: getRepositoryToken(AgentProfile), useValue: empty },
        {
          provide: CompatibilityEngine,
          useValue: { score: () => ({ score: 60, breakdown: {} }) },
        },
        {
          provide: AppConfigService,
          useValue: {
            matchmaking: { maxSuggestions: 50, minScore: 0, suggestionsCacheTtlSeconds: 1 },
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
    const result = await service.suggestions(family, { page: 1, limit: 10 } as never);
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

    const result = await service.suggestions(family, { page: 1, limit: 10 } as never);

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
});
