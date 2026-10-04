import {
  hashSecretToken,
  sealTokenForCookie,
  unsealTokenFromCookie,
} from './tokens';

describe('secret token protection', () => {
  const secret = 'test-refresh-secret-with-enough-entropy';

  it('uses a keyed deterministic lookup hash', () => {
    expect(hashSecretToken('token', secret)).toBe(hashSecretToken('token', secret));
    expect(hashSecretToken('token', secret)).not.toBe(hashSecretToken('token', `${secret}-other`));
  });

  it('encrypts and authenticates browser cookie values', () => {
    const sealed = sealTokenForCookie('refresh-token', secret);
    expect(sealed).not.toContain('refresh-token');
    expect(unsealTokenFromCookie(sealed, secret)).toBe('refresh-token');
    expect(unsealTokenFromCookie(`${sealed}tampered`, secret)).toBeUndefined();
  });
});
