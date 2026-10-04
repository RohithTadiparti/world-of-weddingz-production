import { resolveAdminSeedConfig } from './seed-admin-config';

describe('resolveAdminSeedConfig', () => {
  it('fails closed when either required credential is absent', () => {
    expect(() => resolveAdminSeedConfig({})).toThrow(
      'ADMIN_EMAIL and ADMIN_PASSWORD are required.',
    );
    expect(() =>
      resolveAdminSeedConfig({ ADMIN_EMAIL: 'owner@example.com' }),
    ).toThrow('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  });

  it('normalizes a valid explicit administrator credential', () => {
    expect(
      resolveAdminSeedConfig({
        ADMIN_EMAIL: ' Owner@Example.com ',
        ADMIN_PASSWORD: 'LongLocalPassword1!',
      }),
    ).toEqual({ email: 'owner@example.com', password: 'LongLocalPassword1!' });
  });

  it('rejects weak passwords unless the test-only override is explicit', () => {
    const environment = {
      ADMIN_EMAIL: 'owner@example.com',
      ADMIN_PASSWORD: 'short',
    };
    expect(() => resolveAdminSeedConfig(environment)).toThrow(
      'ADMIN_PASSWORD must be at least 12 characters.',
    );
    expect(
      resolveAdminSeedConfig({ ...environment, SEED_ADMIN_ALLOW_WEAK_PASSWORD: 'true' }),
    ).toEqual({ email: 'owner@example.com', password: 'short' });
  });
});
