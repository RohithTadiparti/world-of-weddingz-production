import { configValidationSchema } from './config.schema';

const productionBase = {
  NODE_ENV: 'production',
  DB_HOST: 'postgres',
  DB_USER: 'wow_user',
  DB_PASSWORD: 'database-secret',
  DB_NAME: 'wow_db',
  REDIS_HOST: 'redis',
  JWT_SECRET: 'jwt-secret-at-least-thirty-two-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-at-least-thirty-two-chars',
};

const publicBeta = {
  ...productionBase,
  DEPLOYMENT_TIER: 'public-beta',
  CORS_ORIGINS: 'https://app.example.com',
  SWAGGER_ENABLED: 'false',
  COOKIE_SECURE: 'true',
  MFA_REQUIRED_FOR_ADMIN: 'true',
  MAIL_PROVIDER: 'smtp',
  MAIL_FROM: 'WOW <security@example.com>',
  SMTP_HOST: 'smtp.zoho.in',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'security@example.com',
  SMTP_PASSWORD: 'zoho-app-password',
  APP_BASE_URL: 'https://app.example.com',
  MEDIA_STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'wow-private-media',
  S3_REGION: 'ap-south-1',
};

describe('production deployment provider policy', () => {
  it('keeps a local Docker production-runtime stack available for mock-backed QA', () => {
    const result = configValidationSchema.validate({
      ...productionBase,
      DEPLOYMENT_TIER: 'local',
      MAIL_PROVIDER: 'log',
      PAYMENT_PROVIDER: 'mock',
      AADHAAR_PROVIDER: 'mock',
      MEDIA_STORAGE_PROVIDER: 'mock',
    }, { abortEarly: false });

    expect(result.error).toBeUndefined();
  });

  it('rejects every security-critical public-beta misconfiguration at boot', () => {
    const result = configValidationSchema.validate({
      ...productionBase,
      DEPLOYMENT_TIER: 'public-beta',
      CORS_ORIGINS: '*',
      SWAGGER_ENABLED: 'true',
      COOKIE_SECURE: 'false',
      MFA_REQUIRED_FOR_ADMIN: 'false',
      MAIL_PROVIDER: 'log',
      APP_BASE_URL: 'http://app.example.com',
      MEDIA_STORAGE_PROVIDER: 'mock',
    }, { abortEarly: false });

    expect(result.error?.message).toContain('MFA_REQUIRED_FOR_ADMIN must be true');
    expect(result.error?.message).toContain('MAIL_PROVIDER must be smtp');
    expect(result.error?.message).toContain('COOKIE_SECURE must be true');
    expect(result.error?.message).toContain('SWAGGER_ENABLED must be false');
    expect(result.error?.message).toContain('APP_BASE_URL must use https');
    expect(result.error?.message).toContain('CORS_ORIGINS must be an explicit HTTPS allow-list');
    expect(result.error?.message).toContain('MEDIA_STORAGE_PROVIDER must be s3');
  });

  it('accepts Zoho Mail SMTP with port 465 secure transport for public beta', () => {
    const result = configValidationSchema.validate(publicBeta, { abortEarly: false });

    expect(result.error).toBeUndefined();
    expect(result.value.DEPLOYMENT_TIER).toBe('public-beta');
    expect(result.value.SMTP_PORT).toBe(465);
    expect(result.value.SMTP_SECURE).toBe(true);
  });

  it('rejects Zoho port 465 without secure transport', () => {
    const result = configValidationSchema.validate({ ...publicBeta, SMTP_SECURE: 'false' }, { abortEarly: false });

    expect(result.error?.message).toContain('SMTP_SECURE must be true when SMTP_PORT is 465');
  });

  it('rejects mock money and identity providers in a revenue deployment', () => {
    const result = configValidationSchema.validate({
      ...publicBeta,
      DEPLOYMENT_TIER: 'revenue',
      PAYMENT_PROVIDER: 'mock',
      AADHAAR_PROVIDER: 'mock',
    }, { abortEarly: false });

    expect(result.error?.message).toContain('PAYMENT_PROVIDER must be razorpay');
    expect(result.error?.message).toContain('AADHAAR_PROVIDER must be licensed');
  });

  it('accepts complete live payment and identity providers in revenue mode', () => {
    const result = configValidationSchema.validate({
      ...publicBeta,
      DEPLOYMENT_TIER: 'revenue',
      PAYMENT_PROVIDER: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'webhook-secret',
      RAZORPAY_KEY_ID: 'rzp_live_key',
      RAZORPAY_KEY_SECRET: 'razorpay-secret',
      AADHAAR_PROVIDER: 'licensed',
      AADHAAR_BASE_URL: 'https://identity.example.com',
      AADHAAR_CLIENT_ID: 'identity-client',
      AADHAAR_CLIENT_SECRET: 'identity-secret',
    }, { abortEarly: false });

    expect(result.error).toBeUndefined();
  });
});
