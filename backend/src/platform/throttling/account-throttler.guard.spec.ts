import { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AccountThrottlerGuard, TOO_MANY_REQUESTS_MESSAGE } from './account-throttler.guard';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';

describe('AccountThrottlerGuard', () => {
  const headers: Record<string, string | number> = {};
  const res = { header: jest.fn((k: string, v: string | number) => (headers[k] = v)) };
  const req = { ip: '203.0.113.9', headers: {}, method: 'POST', path: '/api/auth/login' };

  const context = {
    getHandler: () => function login() {},
    getClass: () => class AuthController {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getType: () => 'http',
  } as unknown as ExecutionContext;

  const storage = (blocked: boolean): ThrottlerStorage => ({
    increment: jest.fn(async () => ({
      totalHits: blocked ? 13 : 1,
      timeToExpire: 60,
      isBlocked: blocked,
      timeToBlockExpire: blocked ? 60 : 0,
    })),
  });

  const guard = (blocked: boolean) => {
    const g = new AccountThrottlerGuard(
      { throttlers: [{ name: 'default', limit: 10, ttl: 60_000 }] },
      storage(blocked),
      new Reflector(),
    );
    return g;
  };

  beforeEach(() => {
    for (const k of Object.keys(headers)) delete headers[k];
  });

  it('lets a request under the limit through', async () => {
    const g = guard(false);
    await g.onModuleInit();
    await expect(g.canActivate(context)).resolves.toBe(true);
  });

  it('answers 429 in the standard error envelope, keeping Retry-After', async () => {
    const g = guard(true);
    await g.onModuleInit();
    const thrown = await g.canActivate(context).catch((e: unknown) => e);

    expect(headers['Retry-After']).toBe(60);

    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader: jest.fn() }),
        getRequest: () => ({ ...req, id: 'req-1' }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(thrown, host);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        error: {
          message: TOO_MANY_REQUESTS_MESSAGE,
          error: 'Too Many Requests',
          statusCode: 429,
        },
      }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain('ThrottlerException');
  });
});
