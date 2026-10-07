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
      announceToStewards: jest.fn().mockResolvedValue(undefined),
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
    const fetchSockets = jest.fn().mockResolvedValue([]);
    const inRoom = jest.fn(() => ({ fetchSockets }));
    gateway.server = { to, in: inRoom } as never;
    return { gateway, chat, jwt, users, presence, emit, to, inRoom, fetchSockets, ...overrides };
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

  it('joins every authenticated socket to its own user room', async () => {
    const { gateway } = createGateway();
    const client = socket();
    await gateway.handleConnection(client as never);
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it.each(['onCallCandidate', 'onCallEnd', 'onCallAnswer', 'onCallIceServers'] as const)(
    'authorizes %s before relaying',
    async (method) => {
      const { gateway, chat, emit } = createGateway();
      chat.assertCanChat.mockRejectedValue(new Error('forbidden'));
      const client = { data: { userId: 'user-1' } };
      const result = await gateway[method](client as never, {
        toUserId: 'stranger',
        sdp: 'v=0',
        candidate: { value: 'ice' },
        reason: 'ended',
      } as never);
      expect(chat.assertCanChat).toHaveBeenCalledWith('user-1', 'stranger');
      expect(result).toEqual({ error: 'Call rejected' });
      expect(emit).not.toHaveBeenCalled();
    },
  );

  it('refuses to ring somebody without a chat relationship', async () => {
    const { gateway, chat, emit, inRoom } = createGateway();
    chat.assertCanChat.mockRejectedValue(new Error('Interest not accepted'));
    const result = await gateway.onCallOffer({ data: { userId: 'user-1' } } as never, {
      toUserId: 'stranger',
      sdp: 'v=0',
      media: 'audio',
    });
    expect(result).toEqual({ error: 'Interest not accepted' });
    expect(inRoom).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rings the callee's user room with the caller's id and the offer", async () => {
    const { gateway, chat, to, emit, inRoom, fetchSockets } = createGateway();
    fetchSockets.mockResolvedValue([{ id: 'callee-socket' }]);
    const result = await gateway.onCallOffer({ data: { userId: 'bride-user' } } as never, {
      toUserId: 'groom-user',
      sdp: 'v=0 offer',
      media: 'video',
    });

    expect(chat.assertCanChat).toHaveBeenCalledWith('bride-user', 'groom-user');
    expect(inRoom).toHaveBeenCalledWith('user:groom-user');
    expect(to).toHaveBeenCalledWith('user:groom-user');
    expect(emit).toHaveBeenCalledWith('call:incoming', {
      fromUserId: 'bride-user',
      sdp: 'v=0 offer',
      media: 'video',
    });
    expect(result).toEqual(
      expect.objectContaining({ ringing: true, iceServers: expect.any(Array) }),
    );
  });

  it('reports an offline callee as unavailable instead of ringing nobody', async () => {
    const { gateway, emit } = createGateway();
    const result = await gateway.onCallOffer({ data: { userId: 'bride-user' } } as never, {
      toUserId: 'groom-user',
      sdp: 'v=0 offer',
      media: 'audio',
    });
    expect(result).toEqual(expect.objectContaining({ error: 'unavailable' }));
    expect(emit).not.toHaveBeenCalled();
  });

  it("relays the callee's answer back to the caller's user room", async () => {
    const { gateway, to, emit } = createGateway();
    const result = await gateway.onCallAnswer({ data: { userId: 'groom-user' } } as never, {
      toUserId: 'bride-user',
      sdp: 'v=0 answer',
    });
    expect(to).toHaveBeenCalledWith('user:bride-user');
    expect(emit).toHaveBeenCalledWith('call:answered', {
      fromUserId: 'groom-user',
      sdp: 'v=0 answer',
    });
    expect(result).toEqual(expect.objectContaining({ ok: true }));
  });

  it('hands ICE servers to an authorized participant before the call is built', async () => {
    const { gateway, chat } = createGateway();
    const result = await gateway.onCallIceServers({ data: { userId: 'groom-user' } } as never, {
      toUserId: 'bride-user',
    });
    expect(chat.assertCanChat).toHaveBeenCalledWith('groom-user', 'bride-user');
    expect(result).toEqual({
      iceServers: expect.arrayContaining([
        expect.objectContaining({ urls: expect.arrayContaining([expect.stringMatching(/^stun:/)]) }),
      ]),
    });
  });

  it('refuses ICE servers to an unauthenticated socket', async () => {
    const { gateway, chat } = createGateway();
    const result = await gateway.onCallIceServers({ data: {} } as never, { toUserId: 'bride-user' });
    expect(result).toEqual({ error: 'unauthenticated' });
    expect(chat.assertCanChat).not.toHaveBeenCalled();
  });
});
