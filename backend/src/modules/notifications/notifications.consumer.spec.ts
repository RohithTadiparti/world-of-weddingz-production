import { NotificationsConsumer } from './notifications.consumer';
import { NotificationsService } from './notifications.service';
import { EventBus } from '../../platform/events/event-bus.service';
import { Profile } from '../users/entities/profile.entity';
import { InterestScreening, NotificationType, UserRole } from '../../common/enums';

type Handler = (e: { payload: Record<string, unknown> }) => void;

/**
 * An interest sent to a profile an agency manages.
 *
 * Such an interest is held for the agency (InterestScreening.WITH_AGENCY): the
 * agency is asked to review it and the client is told nothing. What this pins
 * down is who hears what at each step — sent, forwarded, declined — and that an
 * interest nobody held is announced exactly as it always was.
 */
describe('NotificationsConsumer interest to a managed profile', () => {
  const handlers = new Map<string, Handler>();
  const bus = {
    on: (event: string) => ({ subscribe: (fn: Handler) => handlers.set(event, fn) }),
  } as unknown as EventBus;
  const notifications = { create: jest.fn(async () => ({})) };

  let profiles: Profile[];
  let stewardRole: UserRole;
  const profilesRepo = {
    find: jest.fn(async () => profiles),
    findOne: jest.fn(async (opts: { where: { id: string } }) =>
      profiles.find((p) => p.id === opts.where.id) ?? null,
    ),
  };
  const usersRepo = { findOne: jest.fn(async () => ({ id: 'agent-1', role: stewardRole })) };
  const unused = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };

  const suitor = { id: 'from', userId: 'suitor-user', displayName: 'Vamsi', city: 'Vizag', photos: [] };
  const client = (over: Partial<Profile> = {}) =>
    ({
      id: 'to',
      userId: 'client-user',
      managedByUserId: 'agent-1',
      displayName: 'Harika',
      photos: [],
      ...over,
    }) as Profile;

  /** Fire an event and let the fire-and-forget handlers finish. */
  const fire = async (event: string, payload: Record<string, unknown>) => {
    handlers.get(event)?.({
      payload: { interestId: 'i1', fromProfileId: 'from', toProfileId: 'to', ...payload },
    });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (screening: InterestScreening | null, sentByUserId = 'suitor-user') =>
    fire('match.interest_sent', { sentByUserId, screening });
  const callsOf = (type: NotificationType) =>
    notifications.create.mock.calls.filter(
      (call) => (call as unknown[])[1] === type,
    ) as unknown as [string, NotificationType, Record<string, unknown>][];

  beforeEach(() => {
    jest.clearAllMocks();
    handlers.clear();
    stewardRole = UserRole.AGENT;
    const consumer = new NotificationsConsumer(
      bus,
      notifications as unknown as NotificationsService,
      profilesRepo as never,
      unused as never,
      unused as never,
      unused as never,
      unused as never,
      unused as never,
      usersRepo as never,
      unused as never,
    );
    consumer.onModuleInit();
  });

  it('asks only the agency about a held interest, naming the interested profile and its client', async () => {
    profiles = [suitor as unknown as Profile, client()];
    await send(InterestScreening.WITH_AGENCY);

    // The client has not been told: the agency has not let it through yet.
    expect(callsOf(NotificationType.MATCH_INTEREST)).toHaveLength(0);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    const [[recipient, , payload]] = callsOf(NotificationType.MATCH_INTEREST_FOR_CLIENT);
    expect(recipient).toBe('agent-1');
    expect(payload).toMatchObject({
      counterpartProfileId: 'from',
      counterpartName: 'Vamsi',
      counterpartCity: 'Vizag',
      subjectProfileId: 'to',
      subjectName: 'Harika',
    });
  });

  it('asks the agency to review one for a profile nobody has claimed, and nothing else', async () => {
    profiles = [suitor as unknown as Profile, client({ userId: null })];
    await send(InterestScreening.WITH_AGENCY);

    expect(callsOf(NotificationType.MATCH_INTEREST)).toHaveLength(0);
    expect(callsOf(NotificationType.MATCH_INTEREST_FOR_CLIENT)).toHaveLength(1);
  });

  it('announces an interest nobody held to the client as it always did', async () => {
    // The agency sent this one itself, so there was nothing to review.
    profiles = [suitor as unknown as Profile, client()];
    await send(null, 'agent-1');

    expect(callsOf(NotificationType.MATCH_INTEREST_FOR_CLIENT)).toHaveLength(0);
    expect(notifications.create).toHaveBeenCalledWith(
      'client-user',
      NotificationType.MATCH_INTEREST,
      expect.objectContaining({ forManagedProfile: false, counterpartName: 'Vamsi' }),
    );
  });

  it('leaves a profile a family member runs exactly as it was', async () => {
    stewardRole = UserRole.FAMILY;
    profiles = [suitor as unknown as Profile, client({ managedByUserId: 'mother-1' })];
    await send(null);

    expect(callsOf(NotificationType.MATCH_INTEREST_FOR_CLIENT)).toHaveLength(0);
    expect(callsOf(NotificationType.MATCH_INTEREST).map(([to]) => to)).toEqual(['client-user']);
  });

  it('asks nobody to review when whoever manages the profile is not an agency', async () => {
    stewardRole = UserRole.FAMILY;
    profiles = [suitor as unknown as Profile, client()];
    await send(InterestScreening.WITH_AGENCY);
    expect(callsOf(NotificationType.MATCH_INTEREST_FOR_CLIENT)).toHaveLength(0);
  });

  it('tells the client once the agency forwards it', async () => {
    profiles = [suitor as unknown as Profile, client()];
    await fire('match.interest_forwarded', { forwardedByUserId: 'agent-1' });

    const calls = callsOf(NotificationType.MATCH_INTEREST);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('client-user');
    expect(calls[0][2]).toMatchObject({ counterpartName: 'Vamsi', forManagedProfile: false });
  });

  it('tells nobody on forwarding a profile only the agency reads', async () => {
    profiles = [suitor as unknown as Profile, client({ userId: null })];
    await fire('match.interest_forwarded', { forwardedByUserId: 'agent-1' });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('tells the sender, and only the sender, when the agency declines', async () => {
    profiles = [suitor as unknown as Profile, client()];
    await fire('match.interest_declined_by_agency', { declinedByUserId: 'agent-1' });

    expect(notifications.create).toHaveBeenCalledTimes(1);
    const [[recipient, , payload]] = callsOf(NotificationType.MATCH_DECLINED_BY_AGENCY);
    expect(recipient).toBe('suitor-user');
    expect(payload).toMatchObject({ counterpartProfileId: 'to', counterpartName: 'Harika' });
  });
});
