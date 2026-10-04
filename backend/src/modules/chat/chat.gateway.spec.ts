import { UserRole } from '../../common/enums';
import { ChatGateway, isAllowedSocketOrigin } from './chat.gateway';

describe('ChatGateway security boundaries', () => {
  const config = {
    runtime: { corsOrigins: ['https://app.example.com'] },
    auth: { jwtSecret: 'test-secret' },
  };

  const createGateway = (overrides: Record<string, unknown> = {}) => {
    const chat = {
      assertCanChat: jest.fn().mockResolvedValue('match'),
      presenceAudienceOf: jest.fn().mockResolvedValue(['peer-1']),
    };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', tv: 4 }) };
    const users = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        role: UserRole.BRIDE,
        isActive: true,
        mustResetPassword: false,
        tokenVersion: 4,
      }),
    };
    const presence = { markOnline: jest.fn(), markOffline: jest.fn() };
    const gateway = new ChatGateway(
      chat as never,
      jwt as never,
      config as never,
      users as never,
      presence as never,
      {} as never,
    );
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    gateway.server = {
      to,
      in: jest.fn(() => ({ fetchSockets: jest.fn().mockResolvedValue([]) })),
    } as never;
    return { gateway, chat, jwt, users, presence, emit, to, ...overrides };
  };

  const socket = (origin = 'https://app.example.com') => ({
    handshake: { auth: { token: 'access-token' }, headers: { origin } },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
  });

  it('accepts only configured origins while permitting native clients without Origin', () => {
    expect(isAllowedSocketOrigin('https://app.example.com', config.runtime.corsOrigins)).toBe(true);
    expect(isAllowedSocketOrigin(undefined, config.runtime.corsOrigins)).toBe(true);
    expect(isAllowedSocketOrigin('https://hostile.example', config.runtime.corsOrigins)).toBe(false);
  });

  it('rejects a hostile handshake origin', async () => {
    const { gateway, users } = createGateway();
    const client = socket('https://hostile.example');
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it.each([
    [{ sub: 'user-1', tv: 3 }, { tokenVersion: 4, mustResetPassword: false }],
    [{ sub: 'user-1', tv: 4 }, { tokenVersion: 4, mustResetPassword: true }],
  ])('rejects revoked and forced-reset sessions', async (payload, state) => {
    const { gateway, jwt, users } = createGateway();
    jwt.verifyAsync.mockResolvedValue(payload);
    users.findOne.mockResolvedValue({ id: 'user-1', role: UserRole.BRIDE, isActive: true, ...state });
    const client = socket();
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('announces presence only to authorized peers', async () => {
    const { gateway, to, emit } = createGateway();
    const client = socket();
    await gateway.handleConnection(client as never);
    expect(to).toHaveBeenCalledWith('user:peer-1');
    expect(emit).toHaveBeenCalledWith('presence:changed', { userId: 'user-1', online: true });
    expect((gateway.server as unknown as { emit?: jest.Mock }).emit).toBeUndefined();
  });

  it.each(['onCallCandidate', 'onCallEnd'] as const)(
    'authorizes %s before relaying',
    async (method) => {
      const { gateway, chat, emit } = createGateway();
      chat.assertCanChat.mockRejectedValue(new Error('forbidden'));
      const client = { data: { userId: 'user-1' } };
      const result = await gateway[method](client as never, {
        toUserId: 'stranger',
        candidate: { value: 'ice' },
        reason: 'ended',
      } as never);
      expect(result).toEqual({ error: 'Call rejected' });
      expect(emit).not.toHaveBeenCalled();
    },
  );
});
