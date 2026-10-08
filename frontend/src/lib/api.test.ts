import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSession } from './api';
import { useAuth } from '../store/auth';

const user = { id: 'u1', email: 'a@gmail.com', role: 'bride' };

function refused(status: number, code?: string) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data: { statusCode: status, error: { message: 'no', code } } },
  });
}

describe('session refresh', () => {
  let post: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAuth.setState({ user: null, accessToken: null, ready: false });
    post = vi.spyOn(axios, 'post');
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    post.mockRestore();
    vi.unstubAllGlobals();
  });

  it('restores the session from the refresh cookie', async () => {
    post.mockResolvedValueOnce({ data: { user, accessToken: 'access-1' } });
    await bootstrapSession();
    expect(useAuth.getState().accessToken).toBe('access-1');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('signs out cleanly when the server refuses the refresh', async () => {
    useAuth.setState({ user: user as never, accessToken: 'stale', ready: true });
    post.mockRejectedValueOnce(refused(401));
    await bootstrapSession();
    expect(useAuth.getState()).toMatchObject({ user: null, accessToken: null, ready: true });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries once after losing a refresh race to another tab', async () => {
    post
      .mockRejectedValueOnce(refused(401, 'REFRESH_SUPERSEDED'))
      .mockResolvedValueOnce({ data: { user, accessToken: 'access-2' } });
    await bootstrapSession();
    expect(useAuth.getState().accessToken).toBe('access-2');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second refusal rather than looping', async () => {
    post
      .mockRejectedValueOnce(refused(401, 'REFRESH_SUPERSEDED'))
      .mockRejectedValueOnce(refused(401, 'REFRESH_SUPERSEDED'));
    await bootstrapSession();
    expect(useAuth.getState().accessToken).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('serialises refreshes across tabs through a Web Lock when one is available', async () => {
    const request = vi.fn((_name: string, work: () => Promise<unknown>) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    post.mockResolvedValueOnce({ data: { user, accessToken: 'access-3' } });
    await bootstrapSession();
    expect(request).toHaveBeenCalledWith('wow-auth-refresh', expect.any(Function));
    expect(useAuth.getState().accessToken).toBe('access-3');
  });
});
