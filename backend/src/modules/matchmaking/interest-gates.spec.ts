import { ConflictException, ForbiddenException } from '@nestjs/common';
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

const actor = (userId: string, role: UserRole): AuthUser => ({
  userId,
  email: `${userId}@example.com`,
  role,
  managedByAgentId: null,
});

const groomUser = actor('groom-user', UserRole.GROOM);
const brideUser = actor('bride-user', UserRole.BRIDE);
const agentUser = actor('agent-1', UserRole.AGENT);

const profile = (id: string, over: Partial<Profile> = {}): Profile =>
  ({
    id,
    userId: `${id}-user`,
    managedByUserId: null,
    managingFor: null,
    displayName: `Profile ${id}`,
    profileCode: `WOW${id}`,
    gender: 'female',
    city: 'Hyderabad',
    dateOfBirth: '1996-04-02',
    photos: ['p1.jpg', 'p2.jpg', 'p3.jpg'],
    visibility: ProfileVisibility.MATCHES_ONLY,
    lifecycle: ProfileLifecycle.ACTIVE,
    profileCompleted: true,
    idSubmittedAt: new Date('2026-09-01T10:00:00Z'),
    idVerifiedAt: new Date('2026-09-01T10:05:00Z'),
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastActiveAt: null,
    ...over,
  }) as Profile;

/** A biodata row that clears every completion rule. */
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

/** Just enough of TypeORM's `where` to run the service's own queries in memory. */
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
 * The gates on the interest path: a complete biodata to send (ISS-03), a
 * verified subject profile to send, accept or fix (ISS-02), the suggestions'
 * own readiness rule for the recipient (ISS-08), a conflict for a repeat
 * (ISS-17), and a profile-code prefix in search (ISS-19).
 */
describe('Interest gates', () => {
  let matchmaking: MatchmakingService;
  let lifecycle: MatchLifecycleService;
  let profiles: Profile[];
  let interests: Interest[];
  let biodata: Map<string, ProfileDetails>;
  const features = { matchmakingRequiresIdentity: true };
  const outbox = { record: jest.fn() };

  const accounts = new Map<string, UserRole>([
    [groomUser.userId, UserRole.GROOM],
    [brideUser.userId, UserRole.BRIDE],
    [agentUser.userId, UserRole.AGENT],
  ]);
  const groom = profile('groom', { userId: groomUser.userId, gender: 'male' });
  const bride = profile('bride', { userId: brideUser.userId });

  const profilesRepo = {
    findOne: jest.fn(async (opts: { where: object }) => filter(profiles, opts.where)[0] ?? null),
    find: jest.fn(async (opts: { where?: object }) => filter(profiles, opts?.where)),
  };
  const interestsRepo = {
    findOne: jest.fn(async (opts: { where: object }) => filter(interests, opts.where)[0] ?? null),
    find: jest.fn(async (opts: { where?: object }) => filter(interests, opts?.where)),
    count: jest.fn(async (opts: { where?: object }) => filter(interests, opts?.where).length),
    create: jest.fn((row: Partial<Interest>) => row),
    save: jest.fn(async (row: Interest) => {
      if (!row.id) {
        Object.assign(row, { id: `i${interests.length + 1}`, createdAt: new Date() });
        interests.push(row);
      }
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
  const biodataRepo = {
    findOne: jest.fn(
      async (opts: { where: { profileId: string } }) => biodata.get(opts.where.profileId) ?? null,
    ),
    find: jest.fn(async (opts: { where: { profileId: FindOperator<string[]> } }) =>
      (opts.where.profileId.value as unknown as string[])
        .map((id) => biodata.get(id))
        .filter((row): row is ProfileDetails => Boolean(row)),
    ),
  };
  const empty = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };

  const suggestionsFor = (user: AuthUser, q: Record<string, unknown> = {}) =>
    matchmaking.suggestions(user, { page: 1, limit: 50, sort: 'recent', ...q } as never);

  beforeEach(async () => {
    jest.clearAllMocks();
    features.matchmakingRequiresIdentity = true;
    profiles = [groom, bride];
    interests = [];
    biodata = new Map([
      [groom.id, readyBiodata(groom.id)],
      [bride.id, readyBiodata(bride.id)],
    ]);

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
        { provide: CompatibilityEngine, useValue: { score: () => ({ score: 60, breakdown: {} }) } },
        {
          provide: AppConfigService,
          useValue: {
            features,
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
        { provide: OutboxService, useValue: outbox },
        { provide: Neo4jService, useValue: { ready: false, recordInterest: jest.fn() } },
      ],
    }).compile();
    matchmaking = moduleRef.get(MatchmakingService);
    // Only the collaborators the confirmation path touches before provisioning.
    const audit = { record: jest.fn() };
    lifecycle = new MatchLifecycleService(
      interestsRepo as never,
      profilesRepo as never,
      usersRepo as never,
      matchmaking,
      {} as never,
      {} as never,
      { features } as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      outbox as never,
      {} as never,
    );
  });

  describe('a complete biodata to send (ISS-03)', () => {
    it('refuses a sender whose biodata is empty, naming what is missing', async () => {
      biodata.delete(groom.id);
      const attempt = matchmaking.sendInterest(groomUser, bride.id);
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(attempt).rejects.toThrow(/Complete the biodata.*Religion and community/);
      expect(interests).toHaveLength(0);
    });

    it('refuses one missing a single section, even with profileCompleted set', async () => {
      biodata.set(groom.id, { ...readyBiodata(groom.id), religion: null } as ProfileDetails);
      await expect(matchmaking.sendInterest(groomUser, bride.id)).rejects.toThrow(
        'Still needed: Religion and community.',
      );
    });

    it('lets a complete biodata through without asking for identity as a biodata section', async () => {
      // Identity is its own gate, not a hole in the biodata.
      await expect(matchmaking.sendInterest(groomUser, bride.id)).resolves.toMatchObject({
        fromProfileId: groom.id,
        toProfileId: bride.id,
      });
    });

    it('still lets an incomplete biodata browse', async () => {
      biodata.delete(groom.id);
      await expect(suggestionsFor(groomUser)).resolves.toBeDefined();
    });
  });

  describe('a verified subject profile (ISS-02)', () => {
    const unverified = { idSubmittedAt: null, idVerifiedAt: null };

    it('refuses an unverified sender with an identity reason', async () => {
      profiles = [{ ...groom, ...unverified } as Profile, bride];
      const attempt = matchmaking.sendInterest(groomUser, bride.id);
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(attempt).rejects.toThrow(/Identity verification is required/);
    });

    it('says the check is unfinished when an OTP was started but not completed', async () => {
      profiles = [{ ...groom, idVerifiedAt: null } as Profile, bride];
      await expect(matchmaking.sendInterest(groomUser, bride.id)).rejects.toThrow(
        /Identity verification is not finished/,
      );
    });

    it('leaves browsing open to an unverified profile', async () => {
      profiles = [{ ...groom, ...unverified } as Profile, bride];
      const page = await suggestionsFor(groomUser);
      expect(page.data.map((s) => s.profile.id)).toEqual([bride.id]);
    });

    it('holds a steward to the managed profile’s verification, not their own', async () => {
      const client = profile('client', {
        userId: null,
        managedByUserId: agentUser.userId,
        gender: 'male',
        ...unverified,
      });
      profiles = [client, bride];
      biodata.set(client.id, readyBiodata(client.id));
      await expect(matchmaking.sendInterest(agentUser, bride.id, client.id)).rejects.toThrow(
        /Identity verification/,
      );

      profiles = [{ ...client, idVerifiedAt: new Date() } as Profile, bride];
      await expect(matchmaking.sendInterest(agentUser, bride.id, client.id)).resolves.toMatchObject({
        fromProfileId: client.id,
        sentByUserId: agentUser.userId,
      });
    });

    it('refuses an unverified recipient accepting, and still lets them decline', async () => {
      await matchmaking.sendInterest(groomUser, bride.id);
      profiles = [groom, { ...bride, ...unverified } as Profile];
      const [sent] = interests;

      await expect(matchmaking.respond(brideUser, sent.id, true)).rejects.toThrow(
        /Identity verification is required before you can accept an interest/,
      );
      expect(sent.status).toBe(InterestStatus.PENDING);
      await expect(matchmaking.respond(brideUser, sent.id, false)).resolves.toMatchObject({
        status: InterestStatus.REJECTED,
      });
    });

    it('refuses an unverified side confirming a match as fixed', async () => {
      await matchmaking.sendInterest(groomUser, bride.id);
      const [sent] = interests;
      await matchmaking.respond(brideUser, sent.id, true);
      profiles = [groom, { ...bride, ...unverified } as Profile];

      await expect(lifecycle.confirmMatchFixed(brideUser, sent.id)).rejects.toThrow(
        /Identity verification is required before you can confirm a match as fixed/,
      );
      expect(sent.fixedConfirmedToAt ?? null).toBeNull();

      // The verified side may still record its own confirmation.
      const result = await lifecycle.confirmMatchFixed(groomUser, sent.id);
      expect(result.state).toBe(MatchFixedState.PENDING_CONFIRMATION);
    });

    it('is switched off by MATCHMAKING_REQUIRES_IDENTITY=false', async () => {
      features.matchmakingRequiresIdentity = false;
      profiles = [
        { ...groom, ...unverified } as Profile,
        { ...bride, ...unverified } as Profile,
      ];
      const sent = await matchmaking.sendInterest(groomUser, bride.id);
      await expect(matchmaking.respond(brideUser, sent.id, true)).resolves.toMatchObject({
        status: InterestStatus.ACCEPTED,
      });
      await expect(lifecycle.confirmMatchFixed(groomUser, sent.id)).resolves.toMatchObject({
        state: MatchFixedState.PENDING_CONFIRMATION,
      });
    });
  });

  describe('the suggestions’ readiness rule for the recipient (ISS-08)', () => {
    it.each([
      ['basics not completed', { profileCompleted: false }, true],
      ['biodata incomplete', {}, false],
    ])(
      'neither suggests nor accepts interests for a profile with %s',
      async (_label, over, hasBiodata) => {
        profiles = [groom, { ...bride, ...over } as Profile];
        if (!hasBiodata) biodata.delete(bride.id);

        const page = await suggestionsFor(groomUser);
        expect(page.data.map((s) => s.profile.id)).not.toContain(bride.id);
        await expect(matchmaking.sendInterest(groomUser, bride.id)).rejects.toThrow(
          'That profile is not accepting interests',
        );
        expect(interests).toHaveLength(0);
      },
    );

    it('suggests and accepts interests for a ready matches_only profile alike', async () => {
      const page = await suggestionsFor(groomUser);
      expect(page.data.map((s) => s.profile.id)).toEqual([bride.id]);
      await expect(matchmaking.sendInterest(groomUser, bride.id)).resolves.toMatchObject({
        status: InterestStatus.PENDING,
      });
    });

    it('reads the biodata for the pool in one query, not one per candidate', async () => {
      profiles = [
        groom,
        bride,
        profile('bride2', { userId: null }),
        profile('bride3', { userId: null }),
      ];
      for (const p of profiles) biodata.set(p.id, readyBiodata(p.id));
      const page = await suggestionsFor(groomUser);
      expect(page.data).toHaveLength(3);
      expect(biodataRepo.findOne).not.toHaveBeenCalled();
      // One read for the whole pool (readiness and scoring), one for the
      // page's card facts — however many candidates there are.
      expect(biodataRepo.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('a repeat is a conflict (ISS-17)', () => {
    it('answers 409 to a second send while the first is pending, without re-notifying', async () => {
      await matchmaking.sendInterest(groomUser, bride.id);
      outbox.record.mockClear();

      const again = matchmaking.sendInterest(groomUser, bride.id);
      await expect(again).rejects.toThrow(ConflictException);
      await expect(again).rejects.toThrow('already sent an interest');
      expect(interests).toHaveLength(1);
      expect(outbox.record).not.toHaveBeenCalled();
    });

    it('answers 409 to a send, and to a second accept, once accepted', async () => {
      const sent = await matchmaking.sendInterest(groomUser, bride.id);
      await matchmaking.respond(brideUser, sent.id, true);
      outbox.record.mockClear();

      await expect(matchmaking.sendInterest(groomUser, bride.id)).rejects.toThrow(ConflictException);
      const reaccept = matchmaking.respond(brideUser, sent.id, true);
      await expect(reaccept).rejects.toThrow(ConflictException);
      await expect(reaccept).rejects.toThrow('already been accepted');
      expect(outbox.record).not.toHaveBeenCalled();
    });

    it('still re-opens a withdrawn or declined interest', async () => {
      const sent = await matchmaking.sendInterest(groomUser, bride.id);
      await matchmaking.respond(brideUser, sent.id, false);
      await expect(matchmaking.sendInterest(groomUser, bride.id)).resolves.toMatchObject({
        id: sent.id,
        status: InterestStatus.PENDING,
      });
    });
  });

  describe('profile-code search (ISS-19)', () => {
    beforeEach(() => {
      profiles = [
        groom,
        profile('10153', { userId: null, profileCode: 'WOW10153', displayName: 'Bhavna' }),
        profile('20001', { userId: null, profileCode: 'WOW20001', displayName: 'Anitha' }),
      ];
      for (const p of profiles) biodata.set(p.id, readyBiodata(p.id));
    });

    it('matches a code on its beginning, whatever the case', async () => {
      const page = await suggestionsFor(groomUser, { q: 'wow1015' });
      expect(page.data.map((s) => s.profile.profileCode)).toEqual(['WOW10153']);
    });

    it('does not match digits from the middle of a code', async () => {
      const page = await suggestionsFor(groomUser, { q: '015' });
      expect(page.data).toEqual([]);
    });

    it('asks the database for an anchored, escaped prefix', async () => {
      await suggestionsFor(groomUser, { q: 'wow_1%' });
      const [{ where }] = profilesRepo.find.mock.calls.at(-1) as unknown as [
        { where: Record<string, FindOperator<string>>[] },
      ];
      const codes = where.map((w) => w.profileCode).filter(Boolean);
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        expect(code.type).toBe('like');
        expect(code.value).toBe('WOW\\_1\\%%');
      }
      const names = where.map((w) => w.displayName).filter(Boolean);
      for (const name of names) expect(name.value).toBe('%wow\\_1\\%%');
    });
  });
});
