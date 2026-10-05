import { helmetOptions, shouldExposeSwagger } from './http-security';

describe('HTTP production policy', () => {
  it('never exposes Swagger in production even when the flag is enabled', () => {
    expect(shouldExposeSwagger('production', true)).toBe(false);
    expect(shouldExposeSwagger('development', true)).toBe(true);
    expect(shouldExposeSwagger('test', false)).toBe(false);
  });

  it('enables durable browser security headers', () => {
    expect(helmetOptions.hsts).toEqual(
      expect.objectContaining({ maxAge: 31_536_000, includeSubDomains: true, preload: true }),
    );
    expect(helmetOptions.contentSecurityPolicy).toBeTruthy();
    expect(helmetOptions.referrerPolicy).toEqual({ policy: 'no-referrer' });
    expect(helmetOptions.frameguard).toEqual({ action: 'deny' });
  });
});
