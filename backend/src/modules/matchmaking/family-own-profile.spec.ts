import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { MatchmakingService } from './matchmaking.service';
import { MatchLifecycleService } from './match-lifecycle.service';
import { Interest } from './entities/interest.entity';
import { CompatibilityEngine } from './compatibility.engine';
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
import {
  InterestStatus,
  MatchFixedState,
  ProfileLifecycle,
  ProfileVisibility,
  UserRole,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { nonMatchableProfileIds, stewardRolesFor } from './matchable-profiles';

const actor = (userId: string, role: UserRole): AuthUser => ({
  userId,
  email: `${userId}@example.com`,
  role,
  managedByAgentId: null,
});

const groomUser = actor('groom-user', UserRole.GROOM);
const brideUser = actor('bride-user', UserRole.BRIDE);
const motherUser = actor('mother-user', UserRole.FAMILY);

const profile = (id: string, over: Partial<Profile> = {}): Profile =>
  ({
    id,
    userId: `${id}-user`,
    managedByUserId: null,
    managingFor: null,
    stewardRelation: null,
    displayName: `Profile ${id}`,
    gender: 'female',
    city: 'Hyderabad',
    dateOfBirth: '1996-04-02',
    photos: ['p1.jpg', 'p2.jpg', 'p3.jpg'],
    visibility: ProfileVisibility.MATCHES_ONLY,
    lifecycle: ProfileLifecycle.ACTIVE,
    profileCompleted: true,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastActiveAt: null,
    ...over,
  }) as Profile;

const matches = (row: object, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, want]) => {
    const have = (row as Record<string, unknown>)[key];
    if (want instanceof FindOperator) {
      return want.type === 'in' ? (want.value as unknown[]).includes(have) : true;
    }
    return have === want;
  });
const filter = <T extends object>(rows: T[], where?: object | object[]) => {
  if (!where) return rows;
  const clauses = (Array.isArray(where) ? where : [where]) as Record<string, unknown>[];
  return rows.filter((row) => clauses.some((clause) => matches(row, clause)));
};

/**
 * A family account's own profile holds the parent's details (a 56-year-old
 * mother, in the reported case). It was being served to grooms as a bride, took
 * interests, was shortlisted and chatted with. It is never a matchmaking
 * subject; the daughter she manages is.
 */
describe('A family account own profile is never a matchmaking subject', () => {
  let matchmaking: MatchmakingService;
  let lifecycle: MatchLifecycleService;
  let profiles: Profile[];
  let interests: Interest[];
  let shortlists: {
    ownerProfileId: string;
    profileId: string;
    note: string | null;
    createdAt: Date;
  }[];
  let accounts: Map<string, UserRole>;

  const groom = profile('groom', { userId: groomUser.userId, gender: 'male' });
  const bride = profile('bride', { userId: brideUser.userId });
  const motherOwn = profile('mother-own', {
    userId: motherUser.userId,
    managingFor: 'bride',
    dateOfBirth: '1970-01-01',
  });
  const daughter = profile('daughter', {
    userId: null,
    managedByUserId: motherUser.userId,
    stewardRelation: 'Parent',
  });

  const profilesRepo = {
    findOne: jest.fn(async (opts: { where: object }) => filter(profiles, opts.where)[0] ?? null),
    find: jest.fn(async (opts: { where?: object }) => filter(profiles, opts?.where)),
  };
  const interestsRepo = {
    findOne: jest.fn(async (opts: { where: object }) => filter(interests, opts.where)[0] ?? null),
    find: jest.fn(async (opts: { where?: object }) => filter(interests, opts?.where)),
    count: jest.fn(async (opts: { where?: object }) => filter(interests, opts?.where).length),
    create: jest.fn((row: Partial<Interest>) => row),
    save: jest.fn(async (row: Interest) => row),
  };
  const shortlistRepo = {
    findOne: jest.fn(async (opts: { where: object }) => filter(shortlists, opts.where)[0] ?? null),
    find: jest.fn(async (opts: { where?: object }) => filter(shortlists, opts?.where)),
    create: jest.fn((row: object) => ({ ...row, createdAt: new Date() })),
    save: jest.fn(async (row: (typeof shortlists)[number]) => {
      shortlists.push(row);
      return row;
    }),
  };
  const usersRepo = {
    findOne: jest.fn(async (opts: { where: { id: string } }) => {
      const role = accounts.get(opts.where.id);
      return role ? ({ id: opts.where.id, role, isActive: true } as User) : null;
    }),
    find: jest.fn(async (opts: { where: { id: FindOperator<string[]> } }) =>
      (opts.where.id.value as unknown as string[])
        .filter((id) => accounts.has(id))
        .map((id) => ({ id, role: accounts.get(id), isActive: true }) as User),
    ),
  };
  const empty = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
  // Every profile here has a complete biodata, so these cases exercise who may
  // be matched rather than the completion and identity gates (interest-gates.spec).
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
    findOne: jest.fn(async (opts: { where: { profileId: string } }) =>
      readyBiodata(opts.where.profileId),
    ),
    find: jest.fn(async (opts: { where: { profileId: FindOperator<string[]> } }) =>
      (opts.where.profileId.value as unknown as string[]).map(readyBiodata),
    ),
  };
  const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() };
  const audit = { record: jest.fn() };

  const interest = (id: string, from: Profile, to: Profile, over: Partial<Interest> = {}) =>
    ({
      id,
      fromProfileId: from.id,
      toProfileId: to.id,
      status: InterestStatus.PENDING,
      matchFixedState: MatchFixedState.NONE,
      screening: null,
      createdAt: new Date('2026-09-10T10:00:00Z'),
      updatedAt: new Date('2026-09-10T10:00:00Z'),
      ...over,
    }) as Interest;

  beforeEach(async () => {
    jest.clearAllMocks();
    profiles = [groom, bride, motherOwn, daughter];
    interests = [];
    shortlists = [];
    accounts = new Map([
      [groomUser.userId, UserRole.GROOM],
      [brideUser.userId, UserRole.BRIDE],
      [motherUser.userId, UserRole.FAMILY],
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        { provide: getRepositoryToken(Interest), useValue: interestsRepo },
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(ProfileDetails), useValue: biodataRepo },
        { provide: getRepositoryToken(ProfileSibling), useValue: empty },
        { provide: getRepositoryToken(ProfileShortlist), useValue: shortlistRepo },
        { provide: getRepositoryToken(ProfileShare), useValue: empty },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(AgentProfile), useValue: empty },
        {
          provide: CompatibilityEngine,
          useValue: { score: () => ({ score: 80, breakdown: {} }) },
        },
        {
          provide: AppConfigService,
          useValue: { features: { matchmakingRequiresIdentity: false } },
        },
        { provide: RedisService, useValue: redis },
        { provide: OutboxService, useValue: { record: jest.fn() } },
        { provide: Neo4jService, useValue: { ready: false, recordInterest: jest.fn() } },
      ],
    }).compile();
    matchmaking = moduleRef.get(MatchmakingService);
    lifecycle = new MatchLifecycleService(
      interestsRepo as never,
      profilesRepo as never,
      usersRepo as never,
      matchmaking,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      { record: jest.fn() } as never,
      {} as never,
    );
  });

  it('refuses an interest sent to it', async () => {
    await expect(matchmaking.sendInterest(groomUser, motherOwn.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses the family acting from it, while the daughter she manages may act', async () => {
    await expect(
      matchmaking.sendInterest(motherUser, groom.id, motherOwn.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(matchmaking.sendInterest(motherUser, groom.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a shortlist of it, but keeps the managed daughter shortlistable', async () => {
    await expect(matchmaking.shortlist(groomUser, motherOwn.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(matchmaking.shortlist(groomUser, daughter.id)).resolves.toEqual({
      shortlisted: true,
    });
  });

  it('drops a shortlist row kept before the refusal', async () => {
    shortlists = [
      { ownerProfileId: groom.id, profileId: motherOwn.id, note: null, createdAt: new Date() },
      { ownerProfileId: groom.id, profileId: daughter.id, note: null, createdAt: new Date() },
    ];
    const rows = await matchmaking.shortlisted(groomUser);
    expect(rows.map((r) => r.profile.id)).toEqual([daughter.id]);
    // The managed daughter's card says who answers for her.
    expect(rows[0].profile.stewardship).toEqual({
      kind: 'family',
      label: 'Managed by a family member',
      relation: 'Parent',
    });
  });

  it('lets a legacy interest from it be declined but never accepted', async () => {
    interests = [interest('legacy', motherOwn, groom)];
    await expect(matchmaking.respond(groomUser, 'legacy', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(matchmaking.respond(groomUser, 'legacy', false)).resolves.toMatchObject({
      status: InterestStatus.REJECTED,
    });
  });

  it('refuses the family accepting on it', async () => {
    interests = [interest('incoming', groom, motherOwn)];
    await expect(matchmaking.respond(motherUser, 'incoming', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses fixing a legacy accepted match with it', async () => {
    interests = [interest('legacy', groom, motherOwn, { status: InterestStatus.ACCEPTED })];
    await expect(lifecycle.confirmMatchFixed(groomUser, 'legacy')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still fixes a match between a groom and the daughter the family manages', async () => {
    interests = [interest('real', groom, daughter, { status: InterestStatus.ACCEPTED })];
    await expect(lifecycle.confirmMatchFixed(groomUser, 'real')).resolves.toMatchObject({
      state: MatchFixedState.PENDING_CONFIRMATION,
    });
  });

  describe('helpers', () => {
    it('treats unclaimed and bride/groom profiles as candidates, everything else not', async () => {
      const agencyOwn = profile('agency-own', { userId: 'agent-user' });
      const orphan = profile('orphan', { userId: 'gone-user' });
      accounts.set('agent-user', UserRole.AGENT);
      const ids = await nonMatchableProfileIds(usersRepo as never, [
        groom,
        bride,
        daughter,
        motherOwn,
        agencyOwn,
        orphan,
      ]);
      expect([...ids].sort()).toEqual(['agency-own', 'mother-own', 'orphan']);
    });

    it('reads the steward role of managed profiles only', async () => {
      const roles = await stewardRolesFor(usersRepo as never, [groom, daughter]);
      expect([...roles.entries()]).toEqual([[daughter.id, UserRole.FAMILY]]);
    });
  });
});
