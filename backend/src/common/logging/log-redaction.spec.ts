import { maskEmail, maskPhone, PINO_REDACT_PATHS, sanitizeUrl } from './log-redaction';

describe('log redaction', () => {
  it('covers credential, session, OTP, MFA and banking paths', () => {
    expect(PINO_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.resetToken',
        'req.body.invitationToken',
        'req.body.otp',
        'req.body.mfaSecret',
        'req.body.recoveryCode',
        'req.body.bankAccount.accountNumber',
        'req.body.apiKey',
      ]),
    );
  });

  it('removes query strings and fragments from URLs', () => {
    expect(sanitizeUrl('https://wow.test/reset?token=secret#step')).toBe('https://wow.test/reset');
    expect(sanitizeUrl('/reset?token=secret')).toBe('/reset');
  });

  it('masks delivery destinations', () => {
    expect(maskEmail('person@example.com')).toBe('p***@example.com');
    expect(maskPhone('+91 98765 43210')).toBe('***3210');
  });
});
