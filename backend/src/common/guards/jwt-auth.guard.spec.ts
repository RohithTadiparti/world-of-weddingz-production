import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';

function context(headers: Record<string, string> = {}): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function guardWith(meta: Record<string, boolean>) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

describe('JwtAuthGuard', () => {
  const parent = (AuthGuard('jwt') as unknown as { prototype: { canActivate: unknown } }).prototype;
  let passport: jest.SpyInstance;

  beforeEach(() => {
    passport = jest.spyOn(parent as never, 'canActivate' as never);
  });
  afterEach(() => passport.mockRestore());

  it('authenticates a route that is not public', async () => {
    passport.mockResolvedValue(true as never);
    await expect(guardWith({}).canActivate(context())).resolves.toBe(true);
    expect(passport).toHaveBeenCalledTimes(1);
  });

  it('lets a public route through without touching the token', async () => {
    await expect(
      guardWith({ [IS_PUBLIC_KEY]: true }).canActivate(context({ authorization: 'Bearer abc' })),
    ).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });

  it('identifies the caller on an optional-auth public route when a token is sent', async () => {
    passport.mockResolvedValue(true as never);
    const guard = guardWith({ [IS_PUBLIC_KEY]: true, [IS_OPTIONAL_AUTH_KEY]: true });
    await expect(guard.canActivate(context({ authorization: 'Bearer abc' }))).resolves.toBe(true);
    expect(passport).toHaveBeenCalledTimes(1);
  });

  it('falls back to anonymous when that token is unusable', async () => {
    passport.mockRejectedValue(new UnauthorizedException() as never);
    const guard = guardWith({ [IS_PUBLIC_KEY]: true, [IS_OPTIONAL_AUTH_KEY]: true });
    await expect(guard.canActivate(context({ authorization: 'Bearer expired' }))).resolves.toBe(true);
  });

  it('does not attempt authentication without a bearer token', async () => {
    const guard = guardWith({ [IS_PUBLIC_KEY]: true, [IS_OPTIONAL_AUTH_KEY]: true });
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });
});
