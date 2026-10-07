import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useCallMock, useQueryMock, permissionsMock } = vi.hoisted(() => ({
  useCallMock: vi.fn(),
  useQueryMock: vi.fn(),
  permissionsMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../lib/useCall', () => ({ useCall: useCallMock }));
vi.mock('../store/auth', () => ({
  usePermissions: permissionsMock,
  useAuth: (select: (state: { user: { mustResetPassword: boolean } }) => unknown) =>
    select({ user: { mustResetPassword: false } }),
}));

import CallProvider, { useCallSession } from './CallProvider';

const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'idle',
  media: 'audio',
  error: '',
  peerId: null,
  incoming: null,
  call: vi.fn(),
  answer: vi.fn(),
  hangUp: vi.fn(),
  localStream: null,
  remoteStream: null,
  ...overrides,
});

describe('CallProvider', () => {
  beforeEach(() => {
    useCallMock.mockReset();
    useQueryMock.mockReset();
    permissionsMock.mockReset();
    permissionsMock.mockReturnValue(['chat:inquire', 'chat:match']);
    useQueryMock.mockReturnValue({ data: [{ withUserId: 'bride-user', displayName: 'Priya' }] });
  });

  it('rings on any page, not only inside the chat thread', () => {
    useCallMock.mockReturnValue(
      session({
        state: 'incoming',
        peerId: 'bride-user',
        incoming: { fromUserId: 'bride-user', sdp: 'v=0', media: 'audio' },
      }),
    );

    const markup = renderToStaticMarkup(
      <CallProvider>
        <h1>Dashboard</h1>
      </CallProvider>,
    );

    expect(markup).toContain('Dashboard');
    expect(markup).toContain('Priya is calling');
    expect(markup).toContain('Answer');
    expect(markup).toContain('Decline');
  });

  it('names an unknown caller rather than showing a blank ring', () => {
    useQueryMock.mockReturnValue({ data: [] });
    useCallMock.mockReturnValue(session({ state: 'incoming', peerId: 'stranger-user' }));

    expect(renderToStaticMarkup(<CallProvider>page</CallProvider>)).toContain('Someone is calling');
  });

  it('opens the call socket only for accounts allowed on the chat socket', () => {
    useCallMock.mockReturnValue(session());

    renderToStaticMarkup(<CallProvider>page</CallProvider>);
    expect(useCallMock).toHaveBeenLastCalledWith(true);

    permissionsMock.mockReturnValue(['vendor:manage']);
    renderToStaticMarkup(<CallProvider>page</CallProvider>);
    expect(useCallMock).toHaveBeenLastCalledWith(false);
  });

  it('shares one call session with the pages beneath it', () => {
    const shared = session();
    useCallMock.mockReturnValue(shared);
    let seen: unknown;
    function Probe() {
      seen = useCallSession();
      return null;
    }

    renderToStaticMarkup(
      <CallProvider>
        <Probe />
      </CallProvider>,
    );

    expect(seen).toBe(shared);
  });
});
