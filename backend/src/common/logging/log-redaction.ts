export const REDACTION_CENSOR = '[REDACTED]';

export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'res.headers.set-cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.resetToken',
  'req.body.invitationToken',
  'req.body.otp',
  'req.body.mfaSecret',
  'req.body.recoveryCode',
  'req.body.apiKey',
  'req.body.bankAccount.accountNumber',
  'req.body.bankAccount.ifsc',
  'password',
  'token',
  'apiKey',
] as const;

export const maskEmail = (value: string): string => {
  const [local, domain] = value.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
};

export const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***';
};

export const sanitizeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
};

export const errorType = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;
