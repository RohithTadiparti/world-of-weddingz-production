import * as Joi from 'joi';

/**
 * Boot-time validation of environment variables. The app FAILS FAST if a
 * required variable is missing or malformed, so misconfiguration is caught at
 * startup rather than at runtime. In production, secrets have no safe default
 * and must be supplied.
 */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  DEPLOYMENT_TIER: Joi.string()
    .valid('local', 'staging', 'public-beta', 'revenue')
    .default('local'),
  PLATFORM_CONFIG_PATH: Joi.string().allow('').optional(),
  LOG_RETENTION_DAYS: Joi.number().integer().min(1).max(365).optional(),
  MIGRATION_ENABLED: Joi.boolean().truthy('true').falsy('false').optional(),
  MIGRATION_EXECUTOR: Joi.string().valid('mock', 'aws').optional(),
  MIGRATION_DRY_RUN: Joi.boolean().truthy('true').falsy('false').optional(),
  MIGRATION_READ_ONLY_MINUTES: Joi.number().integer().min(1).optional(),
  RAILWAY_RETENTION_HOURS: Joi.number().integer().min(1).optional(),
  PORT: Joi.number().default(3000),
  HOST: Joi.string().default('0.0.0.0'),
  API_PREFIX: Joi.string().default('api'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  SERVICE_NAME: Joi.string().pattern(/^[a-z0-9-]+$/).default('backend'),
  RELEASE: Joi.string().max(128).default('unknown'),
  CORS_ORIGINS: Joi.string().optional(),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').optional(),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.string().optional(),
  DB_POOL_SIZE: Joi.number().default(10),
  DB_LOGGING: Joi.string().optional(),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DEFAULT_TTL: Joi.number().default(300),
  TEST_DELIVERY_CAPTURE_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  TEST_DELIVERY_CAPTURE_KEY: Joi.string().allow('').when('TEST_DELIVERY_CAPTURE_ENABLED', {
    is: true,
    then: Joi.string().min(32).required(),
  }),

  // Auth, secrets must not use the insecure defaults in production.
  JWT_SECRET: Joi.string().min(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
  }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  BCRYPT_ROUNDS: Joi.number().min(10).max(15).default(12),
  OTP_TTL_SECONDS: Joi.number().default(300),

  // Security
  RATE_LIMIT_TTL: Joi.number().default(60),
  RATE_LIMIT_MAX: Joi.number().default(120),
  AUTH_RATE_LIMIT_MAX: Joi.number().default(10),

  // Pagination
  PAGINATION_DEFAULT_LIMIT: Joi.number().default(20),
  PAGINATION_MAX_LIMIT: Joi.number().default(100),

  // Matchmaking tunables
  MATCH_WEIGHT_AGE: Joi.number().default(20),
  MATCH_WEIGHT_LOCATION: Joi.number().default(20),
  MATCH_WEIGHT_RELIGION: Joi.number().default(20),
  MATCH_WEIGHT_EDUCATION: Joi.number().default(15),
  MATCH_WEIGHT_LIFESTYLE: Joi.number().default(15),
  MATCH_WEIGHT_PREFERENCES: Joi.number().default(10),
  MATCH_MAX_AGE_GAP: Joi.number().default(8),
  // The spec asks for recommendations above 50%; anything weaker is noise for
  // the person reading the list.
  MATCH_MIN_SCORE: Joi.number().min(0).max(100).default(50),

  // Escrow milestones. Validated as a set below: they must sum to 100.
  ESCROW_ADVANCE_PERCENT: Joi.number().min(0).max(100).default(30),
  ESCROW_SECOND_PERCENT: Joi.number().min(0).max(100).default(30),
  ESCROW_FINAL_PERCENT: Joi.number().min(0).max(100).default(40),
  AGENT_PROFILE_FEE: Joi.number().min(0).default(2000),
  AGENT_SETTLEMENT_FEE: Joi.number().min(0).default(25000),

  // Identity verification. 'mock' returns the OTP on the response for local
  // use; anything else needs a licensed AUA/KUA integration.
  VERIFICATION_SLA_HOURS: Joi.number().min(1).max(720).optional(),

  IMAGE_MODERATION_PROVIDER: Joi.string().valid('heuristic', 'hosted').default('heuristic'),
  IMAGE_MODERATION_URL: Joi.string()
    .uri()
    .allow('')
    .when('IMAGE_MODERATION_PROVIDER', { is: 'hosted', then: Joi.string().uri().required() }),
  IMAGE_MODERATION_KEY: Joi.string().allow('').optional(),
  IMAGE_MODERATION_THRESHOLD: Joi.number().min(0).max(1).optional(),
  IMAGE_MODERATION_TIMEOUT_MS: Joi.number().min(1000).max(30_000).optional(),

  AADHAAR_PROVIDER: Joi.string().valid('mock', 'licensed').default('mock'),
  // Required together once the provider is licensed: two out of three is a
  // deployment that starts cleanly and fails on the first person who tries to
  // verify, which is the worst moment to find out.
  AADHAAR_BASE_URL: Joi.string()
    .uri()
    .allow('')
    .when('AADHAAR_PROVIDER', { is: 'licensed', then: Joi.string().uri().required() }),
  AADHAAR_CLIENT_ID: Joi.string().allow('').optional(),
  AADHAAR_CLIENT_SECRET: Joi.string().allow('').optional(),
  AADHAAR_TIMEOUT_MS: Joi.number().min(1000).max(60_000).optional(),
  /** The former names for CLIENT_ID / CLIENT_SECRET. Still honoured. */
  AADHAAR_API_KEY: Joi.string().allow('').optional(),
  AADHAAR_API_SECRET: Joi.string().allow('').optional(),

  // Feature switches.
  INDIVIDUAL_USER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  CHAT_REDACT_CONTACTS: Joi.boolean().truthy('true').falsy('false').default(true),
  SERVICES_REQUIRE_MATCH_FIXED: Joi.boolean().truthy('true').falsy('false').default(false),
  CATALOG_REVIEW_THRESHOLD_PERCENT: Joi.number().min(0).max(1000).default(0),

  PUSH_PROVIDER: Joi.string().valid('log', 'fcm').default('log'),
  PUSH_URL: Joi.string().uri().optional(),
  PUSH_SERVER_KEY: Joi.string().allow('').optional(),
  PUSH_TIMEOUT_MS: Joi.number().optional(),

  WHATSAPP_PROVIDER: Joi.string().valid('log', 'cloud').default('log'),
  WHATSAPP_BASE_URL: Joi.string().uri().optional(),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow('').optional(),
  WHATSAPP_TOKEN: Joi.string().allow('').optional(),
  WHATSAPP_LANGUAGE: Joi.string().optional(),
  WHATSAPP_COUNTRY_CODE: Joi.string().optional(),
  WHATSAPP_TIMEOUT_MS: Joi.number().optional(),
  MATCH_SUGGESTIONS_CACHE_TTL: Joi.number().default(120),
  MATCH_MAX_SUGGESTIONS: Joi.number().default(50),

  // Media
  CDN_BASE_URL: Joi.string().allow('').optional(),
  S3_BUCKET: Joi.string().allow('').optional(),
  S3_REGION: Joi.string().allow('').optional(),
  MAX_FILE_SIZE: Joi.number().default(10485760),
  MEDIA_STORAGE_PROVIDER: Joi.string().valid('mock', 's3').default('mock'),
  MEDIA_SHARE_BASE_URL: Joi.string().allow('').optional(),
  S3_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  S3_PRESIGN_EXPIRY: Joi.number().min(60).max(604800).default(900),
  S3_GET_EXPIRY: Joi.number().min(120).max(604800).default(3600),
  S3_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
  S3_PUBLIC_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').allow('').optional(),

  // Payments
  PAYMENT_PROVIDER: Joi.string().valid('mock', 'razorpay').default('mock'),
  PAYMENT_CURRENCY: Joi.string().default('INR'),
  PAYMENT_COMMISSION_PERCENT: Joi.number().min(0).max(100).default(10),
  PAYMENT_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  RAZORPAY_KEY_ID: Joi.string().allow('').optional(),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').optional(),
  // Encrypts payout bank account numbers at rest. Without it a production
  // server refuses to store bank details rather than store them weakly.
  PAYOUT_DETAILS_KEY: Joi.string().min(32).allow('').optional(),
  SUPPORTED_PAYOUT_BANKS: Joi.string().allow('').optional(),
  IFSC_LOOKUP_BASE_URL: Joi.string().uri().allow('').optional(),

  // Which methods a buyer may choose. Validated as a set rather than a free
  // string so a typo — "netbank" — fails at boot instead of silently removing
  // a payment method from every checkout on the platform.
  PAYMENT_METHODS: Joi.string()
    .custom((value: string, helpers) => {
      const allowed = ['card', 'upi', 'netbanking', 'cash'];
      const given = value.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = given.filter((m) => !allowed.includes(m));
      if (bad.length) return helpers.error('any.invalid', { bad });
      return value;
    }, 'payment method list')
    .optional(),
  PAYMENT_CASH_ENABLED: Joi.string().optional(),
  PAYMENT_CASH_MAX_AMOUNT: Joi.number().min(0).default(25000),
  PAYMENT_CASH_COMMISSION_OWED: Joi.string().optional(),

  // Customer support. Every one optional: an operator with no WhatsApp desk
  // should leave it blank and have the platform stop offering one, rather than
  // publish a number nobody answers.
  SUPPORT_EMAIL: Joi.string().allow('').optional(),
  SUPPORT_PHONE: Joi.string().allow('').optional(),
  SUPPORT_WHATSAPP: Joi.string().allow('').optional(),
  SUPPORT_HOURS: Joi.string().allow('').optional(),
  SUPPORT_URL: Joi.string().allow('').optional(),
  SUPPORT_RESPONSE_TIME: Joi.string().allow('').optional(),

  // AI
  AI_PROVIDER: Joi.string().valid('mock', 'openai').default('mock'),
  AI_API_KEY: Joi.string().allow('').optional(),
  AI_MODEL: Joi.string().default('gpt-4o-mini'),
  AI_BASE_URL: Joi.string().allow('').optional(),

  // Neo4j (optional)
  NEO4J_ENABLED: Joi.string().optional(),
  NEO4J_URI: Joi.string().allow('').optional(),
  NEO4J_USERNAME: Joi.string().allow('').optional(),
  NEO4J_PASSWORD: Joi.string().allow('').optional(),

  // Auth hardening
  REFRESH_COOKIE_NAME: Joi.string().optional(),
  COOKIE_SECURE: Joi.boolean().truthy('true').falsy('false').optional(),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').optional(),
  COOKIE_DOMAIN: Joi.string().allow('').optional(),
  MAX_FAILED_LOGINS: Joi.number().min(3).max(100).default(8),
  LOCKOUT_MINUTES: Joi.number().min(1).max(1440).default(15),
  REFRESH_REUSE_GRACE_SECONDS: Joi.number().integer().min(0).max(60).default(10),
  INVITATION_TTL_HOURS: Joi.number().min(1).max(2160).default(168),
  EMAIL_VERIFY_TTL_HOURS: Joi.number().min(1).max(720).default(48),
  PASSWORD_RESET_TTL_MINUTES: Joi.number().min(5).max(1440).default(30),
  RSVP_TOKEN_TTL_DAYS: Joi.number().min(1).max(730).default(120),
  MFA_ISSUER: Joi.string().allow('').optional(),
  MFA_REQUIRED_FOR_ADMIN: Joi.boolean().truthy('true').falsy('false').default(false),
  ADMIN_LOGIN_PROVIDER: Joi.string().valid('password', 'zoho').default('password'),
  ZOHO_SSO_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  ZOHO_ACCOUNTS_URL: Joi.string().uri({ scheme: ['https'] }).default('https://accounts.zoho.in'),
  ZOHO_CLIENT_ID: Joi.string().allow('').optional(),
  ZOHO_CLIENT_SECRET: Joi.string().allow('').optional(),
  ZOHO_REDIRECT_URI: Joi.string().uri({ scheme: ['https'] }).allow('').optional(),

  // Mail
  MAIL_PROVIDER: Joi.string().valid('log', 'smtp').default('log'),
  POOL_QUOTA_PER_AGENCY: Joi.number().min(1).max(10000).default(50),
  STUN_URLS: Joi.string().allow('').optional(),
  TURN_URL: Joi.string().allow('').optional(),
  // Static credentials are handed in full to every browser that starts a call.
  // They work, and the first person to open developer tools has your relay.
  TURN_USERNAME: Joi.string().allow('').optional(),
  TURN_CREDENTIAL: Joi.string().allow('').optional(),
  // coturn's REST convention: the browser gets a credential that expires, and
  // the secret behind it never leaves the server. Preferred when both are set.
  TURN_STATIC_AUTH_SECRET: Joi.string().allow('').optional(),
  TURN_REALM: Joi.string().allow('').optional(),
  TURN_CREDENTIAL_TTL_SECONDS: Joi.number().min(300).max(86_400).optional(),
  SMS_PROVIDER: Joi.string().valid('log', 'http').default('log'),
  SMS_URL: Joi.string().allow('').optional(),
  SMS_API_KEY: Joi.string().allow('').optional(),
  SMS_SENDER_ID: Joi.string().allow('').optional(),
  SMS_TEMPLATE_ID: Joi.string().allow('').optional(),
  SMS_TIMEOUT_MS: Joi.number().min(1000).max(30000).default(8000),
  PHONE_VERIFY_TTL_MINUTES: Joi.number().min(1).max(60).default(10),
  MAIL_FROM: Joi.string().allow('').optional(),
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().truthy('true').falsy('false').optional(),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  APP_BASE_URL: Joi.string().uri().default('http://localhost:8080'),

  // Stewardship (agents and family members managing other people's profiles)
  MAX_MANAGED_PROFILES: Joi.number().min(1).max(100000).default(200),
  MAX_MANAGED_PROFILES_FAMILY: Joi.number().min(1).max(100).default(5),
  MAX_INVITATION_RESENDS: Joi.number().min(1).max(50).default(5),
  REQUIRE_AGENT_APPROVAL: Joi.string().optional(),
  CIRCULATION_CONSENT_VALIDITY_DAYS: Joi.number().min(1).max(3650).default(365),
  SHARE_LINK_TTL_DAYS: Joi.number().min(1).max(365).default(30),

  // Admin bootstrap. Read only by src/database/seed-admin.ts, which does its own
  // validation. Kept permissive here so a seeder-only value (including internal
  // hostnames such as admin@wow.local) can never block the API from booting.
  ADMIN_EMAIL: Joi.string().allow('').optional(),
  ADMIN_PASSWORD: Joi.string().allow('').optional(),

  // Kafka (optional)
  KAFKA_ENABLED: Joi.string().optional(),
  KAFKA_BROKERS: Joi.string().allow('').optional(),
  KAFKA_CLIENT_ID: Joi.string().allow('').optional(),
  KAFKA_TOPIC: Joi.string().allow('').optional(),
})
  /**
   * The three escrow milestones must account for the whole booking. Checked at
   * boot rather than per payment: a set that sums to 90 would silently
   * under-charge every booking, and the right moment to find out is now.
   */
  .custom((value, helpers) => {
    const total =
      Number(value.ESCROW_ADVANCE_PERCENT) +
      Number(value.ESCROW_SECOND_PERCENT) +
      Number(value.ESCROW_FINAL_PERCENT);
    if (Math.abs(total - 100) > 0.001) {
      return helpers.message({
        custom:
          `ESCROW_ADVANCE_PERCENT + ESCROW_SECOND_PERCENT + ESCROW_FINAL_PERCENT must be 100, got ${total}`,
      } as never);
    }

    const publicDeployment = ['public-beta', 'revenue'].includes(value.DEPLOYMENT_TIER);
    if (!publicDeployment) return value;

    const violations: string[] = [];
    if (value.NODE_ENV !== 'production') {
      violations.push('NODE_ENV must be production for a public deployment tier');
    }
    if (value.ADMIN_LOGIN_PROVIDER !== 'zoho') {
      violations.push('ADMIN_LOGIN_PROVIDER must be zoho');
    }
    if (value.ZOHO_SSO_ENABLED !== true) {
      violations.push('ZOHO_SSO_ENABLED must be true');
    }
    for (const key of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI']) {
      if (!String(value[key] ?? '').trim()) violations.push(`${key} is required for Zoho SSO`);
    }
    if (value.MAIL_PROVIDER !== 'smtp') {
      violations.push('MAIL_PROVIDER must be smtp');
    }
    for (const key of ['MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) {
      if (!String(value[key] ?? '').trim()) violations.push(`${key} is required for SMTP mail`);
    }
    if (/@wow\.local\b/i.test(String(value.MAIL_FROM ?? ''))) {
      violations.push('MAIL_FROM must use a deliverable domain');
    }
    if (Number(value.SMTP_PORT) === 465 && value.SMTP_SECURE !== true) {
      violations.push('SMTP_SECURE must be true when SMTP_PORT is 465');
    }
    if (Number(value.SMTP_PORT) === 587 && value.SMTP_SECURE === true) {
      violations.push('SMTP_SECURE must be false when SMTP_PORT is 587');
    }
    if (value.COOKIE_SECURE !== true) violations.push('COOKIE_SECURE must be true');
    if (value.SWAGGER_ENABLED !== false) violations.push('SWAGGER_ENABLED must be false');
    if (!String(value.APP_BASE_URL ?? '').startsWith('https://')) {
      violations.push('APP_BASE_URL must use https');
    }
    const corsOrigins = String(value.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (!corsOrigins.length || corsOrigins.some((origin) => origin === '*' || !origin.startsWith('https://'))) {
      violations.push('CORS_ORIGINS must be an explicit HTTPS allow-list');
    }
    if (value.MEDIA_STORAGE_PROVIDER !== 's3') {
      violations.push('MEDIA_STORAGE_PROVIDER must be s3');
    }
    if (!String(value.S3_BUCKET ?? '').trim()) violations.push('S3_BUCKET is required for private media');
    if (!String(value.S3_REGION ?? '').trim()) violations.push('S3_REGION is required for private media');

    if (value.DEPLOYMENT_TIER === 'revenue') {
      if (value.PAYMENT_PROVIDER !== 'razorpay') {
        violations.push('PAYMENT_PROVIDER must be razorpay');
      }
      for (const key of ['PAYMENT_WEBHOOK_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) {
        if (!String(value[key] ?? '').trim()) violations.push(`${key} is required for Razorpay`);
      }
      if (value.AADHAAR_PROVIDER !== 'licensed') {
        violations.push('AADHAAR_PROVIDER must be licensed');
      }
      const identityClient = String(value.AADHAAR_CLIENT_ID || value.AADHAAR_API_KEY || '').trim();
      const identitySecret = String(value.AADHAAR_CLIENT_SECRET || value.AADHAAR_API_SECRET || '').trim();
      if (!identityClient) violations.push('Aadhaar client identifier is required');
      if (!identitySecret) violations.push('Aadhaar client secret is required');
    }

    if (violations.length) {
      return helpers.message({ custom: violations.join('; ') } as never);
    }
    return value;
  });
