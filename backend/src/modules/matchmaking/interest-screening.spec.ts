import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { MatchmakingService } from './matchmaking.service';
import { InterestScreeningService } from './interest-screening.service';
import { Interest } from './entities/interest.entity';
import { CompatibilityEngine } from './compatibility.engine';
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
import {
  InterestScreening,
  InterestStatus,
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

const suitorUser = actor('suitor-user', UserRole.GROOM);
const clientUser = actor('client-user', UserRole.BRIDE);
const agentUser = actor('agent-1', UserRole.AGENT);

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
 * Interests to an agency's client go to the agency first.
 *
 * Harika's profile is run by an agency and she has claimed it. Vamsi sends her
 * an interest. Until the agency forwards it, only the agency may see or answer
 * it; once forwarded it is an ordinary interest; declined, it never reaches her.
 */
describe('Interest screening by the managing agency', () => {
  let matchmaking: MatchmakingService;
  let screening: InterestScreeningService;
  let profiles: Profile[];
  let interests: Interest[];
  let accounts: Map<string, UserRole>;
  const outbox = { record: jest.fn() };

  const suitor = profile('suitor', { userId: suitorUser.userId, gender: 'male' });
  const harika = profile('harika', { userId: clientUser.userId, managedByUserId: agentUser.userId });

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
        Object.assign(row, { id: `i${interests.length + 1}`, createdAt: new Date(), updatedAt: new Date() });
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
  };
  const empty = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
  const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() };

  /** A held interest from Vamsi to Harika, as sendInterest leaves it. */
  const held = (over: Partial<Interest> = {}): Interest =>
    ({
      id: 'held',
      fromProfileId: suitor.id,
      toProfileId: harika.id,
      sentByUserId: suitorUser.userId,
      status: InterestStatus.PENDING,
      screening: InterestScreening.WITH_AGENCY,
      createdAt: new Date('2026-09-10T10:00:00Z'),
      updatedAt: new Date('2026-09-10T10:00:00Z'),
      ...over,
    }) as Interest;

  beforeEach(async () => {
    jest.clearAllMocks();
    profiles = [suitor, harika];
    interests = [];
    accounts = new Map([
      [suitorUser.userId, UserRole.GROOM],
      [clientUser.userId, UserRole.BRIDE],
      [agentUser.userId, UserRole.AGENT],
      ['mother-1', UserRole.FAMILY],
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        InterestScreeningService,
        { provide: getRepositoryToken(Interest), useValue: interestsRepo },
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(ProfileDetails), useValue: empty },
        { provide: getRepositoryToken(ProfileShortlist), useValue: empty },
        { provide: getRepositoryToken(ProfileShare), useValue: empty },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(AgentProfile), useValue: empty },
        { provide: CompatibilityEngine, useValue: {} },
        { provide: AppConfigService, useValue: {} },
        { provide: RedisService, useValue: redis },
        { provide: OutboxService, useValue: outbox },
        { provide: Neo4jService, useValue: { ready: false, recordInterest: jest.fn() } },
      ],
    }).compile();
    matchmaking = moduleRef.get(MatchmakingService);
    screening = moduleRef.get(InterestScreeningService);
  });

  const sentEvent = () =>
    outbox.record.mock.calls
      .map(([event]) => event as { eventType: string; payload: Record<string, unknown> })
      .find((event) => event.eventType === 'match.interest_sent');

  describe('sending', () => {
    it('holds an interest to an agency-managed profile for the agency', async () => {
      const sent = await matchmaking.sendInterest(suitorUser, harika.id);
      expect(sent.screening).toBe(InterestScreening.WITH_AGENCY);
      expect(sent.status).toBe(InterestStatus.PENDING);
      expect(sentEvent()?.payload.screening).toBe(InterestScreening.WITH_AGENCY);
    });

    it('holds it whether or not the client has claimed the profile', async () => {
      profiles = [suitor, { ...harika, userId: null } as Profile];
      const sent = await matchmaking.sendInterest(suitorUser, harika.id);
      expect(sent.screening).toBe(InterestScreening.WITH_AGENCY);
    });

    it('does not hold one the agency sent itself', async () => {
      const other = profile('other', { managedByUserId: agentUser.userId, gender: 'male', userId: null });
      profiles.push(other);
      const sent = await matchmaking.sendInterest(agentUser, harika.id, other.id);
      expect(sent.screening).toBeNull();
      expect(sentEvent()?.payload.screening).toBeNull();
    });

    it('does not hold one to a profile a family member runs, or nobody does', async () => {
      const daughter = profile('daughter', { managedByUserId: 'mother-1', userId: null });
      const solo = profile('solo', { userId: clientUser.userId });
      profiles.push(daughter, solo);
      expect((await matchmaking.sendInterest(suitorUser, daughter.id)).screening).toBeNull();
      expect((await matchmaking.sendInterest(suitorUser, solo.id)).screening).toBeNull();
    });

    it('holds a re-sent interest again after the agency declined the first', async () => {
      interests = [held({ status: InterestStatus.REJECTED, screening: InterestScreening.DECLINED })];
      const sent = await matchmaking.sendInterest(suitorUser, harika.id);
      expect(sent.id).toBe('held');
      expect(sent.status).toBe(InterestStatus.PENDING);
      expect(sent.screening).toBe(InterestScreening.WITH_AGENCY);
    });
  });

  describe('while it is with the agency', () => {
    beforeEach(() => {
      interests = [held()];
    });

    it('is left out of everything the client reads', async () => {
      const board = await matchmaking.interestBoard(clientUser);
      expect(board.received).toEqual([]);
      expect(board.pending).toEqual([]);
      expect(board.counts.received).toBe(0);
      expect(board.counts.pending).toBe(0);
      expect(await matchmaking.incoming(clientUser)).toEqual([]);
    });

    it('is shown to the agent acting for the client, to forward or decline', async () => {
      const board = await matchmaking.interestBoard(agentUser, harika.id);
      expect(board.received).toHaveLength(1);
      const [row] = board.received;
      expect(row.screening).toBe(InterestScreening.WITH_AGENCY);
      expect(row.actions).toMatchObject({
        forward: true,
        agencyDecline: true,
        accept: false,
        decline: false,
      });
      expect(await matchmaking.incoming(agentUser, harika.id)).toHaveLength(1);
    });

    it('reads as with their agency to the sender, who can still take it back', async () => {
      const board = await matchmaking.interestBoard(suitorUser);
      expect(board.sent).toHaveLength(1);
      expect(board.sent[0].screening).toBe(InterestScreening.WITH_AGENCY);
      expect(board.sent[0].actions.unsend).toBe(true);
    });

    it('cannot be accepted or declined by the client, nor by the agent directly', async () => {
      await expect(matchmaking.respond(clientUser, 'held', true)).rejects.toThrow(ForbiddenException);
      await expect(matchmaking.respond(clientUser, 'held', false)).rejects.toThrow(ForbiddenException);
      await expect(matchmaking.respond(agentUser, 'held', true)).rejects.toThrow('with the agency');
      expect(interests[0].status).toBe(InterestStatus.PENDING);
    });

    it('is on the agency-wide list, marked for review', async () => {
      const list = await matchmaking.agencyInterests(agentUser);
      expect(list.data[0]).toMatchObject({ screening: InterestScreening.WITH_AGENCY, awaitingReview: true });
      expect(list.counts.with_agency).toBe(1);
    });
  });

  describe('forwarding', () => {
    beforeEach(() => {
      interests = [held()];
    });

    it('makes it an ordinary pending interest the client sees and answers', async () => {
      const forwarded = await screening.forward(agentUser, 'held');
      expect(forwarded.screening).toBe(InterestScreening.FORWARDED);
      expect(forwarded.status).toBe(InterestStatus.PENDING);
      expect(outbox.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'match.interest_forwarded' }),
      );

      const board = await matchmaking.interestBoard(clientUser);
      expect(board.received).toHaveLength(1);
      expect(board.received[0].actions).toMatchObject({ accept: true, decline: true, forward: false });

      await expect(matchmaking.respond(clientUser, 'held', true)).resolves.toMatchObject({
        status: InterestStatus.ACCEPTED,
      });
    });

    it('is the managing agency’s alone', async () => {
      await expect(screening.forward(clientUser, 'held')).rejects.toThrow(ForbiddenException);
      await expect(screening.forward(actor('agent-2', UserRole.AGENT), 'held')).rejects.toThrow(
        ForbiddenException,
      );
      expect(interests[0].screening).toBe(InterestScreening.WITH_AGENCY);
    });

    it('refuses an interest that is not waiting on the agency, or no longer open', async () => {
      interests = [held({ screening: null })];
      await expect(screening.forward(agentUser, 'held')).rejects.toThrow(BadRequestException);
      interests = [held({ status: InterestStatus.WITHDRAWN })];
      await expect(screening.forward(agentUser, 'held')).rejects.toThrow('no longer open');
    });
  });

  describe('declining', () => {
    beforeEach(() => {
      interests = [held()];
    });

    it('declines it for the client, tells the sender, and never shows it to the client', async () => {
      const declined = await screening.decline(agentUser, 'held');
      expect(declined).toMatchObject({
        status: InterestStatus.REJECTED,
        screening: InterestScreening.DECLINED,
        respondedByUserId: agentUser.userId,
      });
      expect(outbox.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'match.interest_declined_by_agency' }),
      );

      const mine = await matchmaking.interestBoard(clientUser);
      expect(mine.declined).toEqual([]);
      expect(mine.counts.declined).toBe(0);

      const theirs = await matchmaking.interestBoard(suitorUser);
      expect(theirs.declined).toHaveLength(1);
      expect(theirs.declined[0].screening).toBe(InterestScreening.DECLINED);

      // Nor can the client answer it afterwards.
      await expect(matchmaking.respond(clientUser, 'held', true)).rejects.toThrow(ForbiddenException);
    });

    it('is the managing agency’s alone', async () => {
      await expect(screening.decline(clientUser, 'held')).rejects.toThrow(ForbiddenException);
      expect(interests[0].status).toBe(InterestStatus.PENDING);
    });
  });

  it('leaves an interest nobody held exactly as it was', async () => {
    // Every row written before screening existed has none.
    interests = [held({ screening: null })];
    const board = await matchmaking.interestBoard(clientUser);
    expect(board.received).toHaveLength(1);
    expect(board.received[0].actions).toMatchObject({ accept: true, decline: true, forward: false });
    await expect(matchmaking.respond(clientUser, 'held', false)).resolves.toMatchObject({
      status: InterestStatus.REJECTED,
    });
  });
});
