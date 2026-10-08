import { readFileSync } from 'node:fs';
import * as Joi from 'joi';
import { parse } from 'yaml';
import { PlatformConfig } from './platform-config.types';

const threshold = Joi.object({
  warning: Joi.number().positive().required(),
  critical: Joi.number().greater(Joi.ref('warning')).required(),
}).unknown(false);

/** Bounded so a mistyped variable cannot fan one alert out to a mailing list. */
export const MAX_ALERT_RECIPIENTS = 20;

const alertRecipients = Joi.array()
  .items(Joi.string().max(254).email({ tlds: { allow: false }, minDomainSegments: 2 }))
  .max(MAX_ALERT_RECIPIENTS)
  .unique((a: string, b: string) => a.toLowerCase() === b.toLowerCase());

const schema = Joi.object<PlatformConfig>({
  version: Joi.number().valid(1).required(),
  deployment: Joi.object({
    tier: Joi.string().valid('local', 'staging', 'public-beta', 'revenue').required(),
    liveMediaProvider: Joi.string().valid('s3').required(),
  })
    .unknown(false)
    .required(),
  providers: Joi.object({
    mail: Joi.string().valid('log', 'smtp').required(),
    sms: Joi.string().valid('log', 'http').required(),
    whatsapp: Joi.string().valid('log', 'cloud').required(),
    push: Joi.string().valid('log', 'fcm').required(),
    payment: Joi.string().valid('mock', 'razorpay').required(),
    identity: Joi.string().valid('mock', 'licensed').required(),
    media: Joi.string().valid('mock', 's3').required(),
    ai: Joi.string().valid('mock', 'openai').required(),
  })
    .unknown(false)
    .required(),
  operations: Joi.object({
    logRetentionDays: Joi.number().integer().min(1).max(365).required(),
    alertReminderHours: Joi.number().integer().min(1).required(),
    alertRecipients: alertRecipients.required(),
    consecutiveCountSamples: Joi.number().integer().min(1).required(),
    sustainedPerformanceMinutes: Joi.number().integer().min(1).required(),
    measurements: Joi.object({
      railwayMonthlyInr: Joi.number().min(0).required(),
    }).unknown(false).required(),
    thresholds: Joi.object({
      accounts: threshold.required(),
      dailyActiveUsers: threshold.required(),
      requestsPerDay: threshold.required(),
      concurrentUsers: threshold.required(),
      databaseGigabytes: threshold.required(),
      p95LatencyMs: threshold.required(),
      errorRatePercent: threshold.required(),
      cpuPercent: threshold.required(),
      memoryPercent: threshold.required(),
      railwayMonthlyInr: threshold.required(),
    })
      .unknown(false)
      .required(),
    revenue: Joi.object({
      minimumMonthlyNetInr: Joi.number().positive().required(),
      preferredMonthlyNetInr: Joi.number().greater(Joi.ref('minimumMonthlyNetInr')).required(),
    })
      .unknown(false)
      .required(),
  })
    .unknown(false)
    .required(),
  features: Joi.object({
    individualUserEnabled: Joi.boolean().required(),
    chatRedactContacts: Joi.boolean().required(),
    servicesRequireMatchFixed: Joi.boolean().required(),
    matchmakingRequiresIdentity: Joi.boolean().required(),
    catalogReviewThresholdPercent: Joi.number().min(0).max(1000).required(),
  })
    .unknown(false)
    .required(),
  migration: Joi.object({
    enabled: Joi.boolean().required(),
    executor: Joi.string().valid('mock', 'aws').required(),
    dryRun: Joi.boolean().required(),
    readOnlyWindowMinutes: Joi.number().integer().min(1).required(),
    railwayRetentionHours: Joi.number().integer().min(1).required(),
  })
    .unknown(false)
    .required(),
}).unknown(false);

type Override = [path: string, kind: 'string' | 'number' | 'boolean' | 'list'];
const overrides: Record<string, Override> = {
  DEPLOYMENT_TIER: ['deployment.tier', 'string'],
  MAIL_PROVIDER: ['providers.mail', 'string'],
  SMS_PROVIDER: ['providers.sms', 'string'],
  WHATSAPP_PROVIDER: ['providers.whatsapp', 'string'],
  PUSH_PROVIDER: ['providers.push', 'string'],
  PAYMENT_PROVIDER: ['providers.payment', 'string'],
  AADHAAR_PROVIDER: ['providers.identity', 'string'],
  MEDIA_STORAGE_PROVIDER: ['providers.media', 'string'],
  AI_PROVIDER: ['providers.ai', 'string'],
  LOG_RETENTION_DAYS: ['operations.logRetentionDays', 'number'],
  // Comma-separated. The addresses are per-environment personal data, so they
  // come from the platform's variables rather than the versioned YAML.
  OPERATIONS_ALERT_RECIPIENTS: ['operations.alertRecipients', 'list'],
  MIGRATION_ENABLED: ['migration.enabled', 'boolean'],
  MIGRATION_EXECUTOR: ['migration.executor', 'string'],
  MIGRATION_DRY_RUN: ['migration.dryRun', 'boolean'],
  MIGRATION_READ_ONLY_MINUTES: ['migration.readOnlyWindowMinutes', 'number'],
  RAILWAY_RETENTION_HOURS: ['migration.railwayRetentionHours', 'number'],
};

export function loadPlatformConfig(path: string, env: NodeJS.ProcessEnv): PlatformConfig {
  try {
    const document = parse(readFileSync(path, 'utf8'), { uniqueKeys: true }) as unknown;
    const candidate = structuredClone(document) as Record<string, unknown>;
    applyOverrides(candidate, env);

    const tier = get(candidate, 'deployment.tier');
    if (
      ['staging', 'public-beta', 'revenue'].includes(String(tier)) &&
      env.MEDIA_STORAGE_PROVIDER === undefined
    ) {
      set(candidate, 'providers.media', get(candidate, 'deployment.liveMediaProvider'));
    }

    const { value, error } = schema.validate(candidate, {
      abortEarly: false,
      allowUnknown: false,
      convert: false,
    });
    if (error) throw error;
    assertSafeDeployment(value, env);
    return deepFreeze(value);
  } catch (error) {
    throw new Error(`Invalid platform configuration: ${redact(String(error))}`);
  }
}

function applyOverrides(target: Record<string, unknown>, env: NodeJS.ProcessEnv): void {
  for (const [name, [path, kind]] of Object.entries(overrides)) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    let value: string | number | boolean | string[] = raw;
    if (kind === 'list') {
      value = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    if (kind === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} must be a number; received ${raw}`);
    }
    if (kind === 'boolean') {
      if (!['true', 'false'].includes(raw.toLowerCase())) {
        throw new Error(`${name} must be true or false; received ${raw}`);
      }
      value = raw.toLowerCase() === 'true';
    }
    set(target, path, value);
  }
}

function assertSafeDeployment(config: PlatformConfig, env: NodeJS.ProcessEnv): void {
  const publicTier =
    config.deployment.tier === 'public-beta' || config.deployment.tier === 'revenue';
  if (publicTier && config.providers.media !== 's3') {
    throw new Error('providers.media must be s3 for a public deployment');
  }
  if (config.deployment.tier === 'revenue' && config.providers.payment === 'mock') {
    throw new Error('providers.payment must not be mock for the revenue tier');
  }
  if (config.deployment.tier === 'revenue' && config.providers.identity === 'mock') {
    throw new Error('providers.identity must not be mock for the revenue tier');
  }
  if (
    config.migration.enabled &&
    (config.migration.executor === 'mock' || config.migration.dryRun)
  ) {
    throw new Error('migration.enabled requires executor=aws and dryRun=false');
  }
  if (publicTier && !env.S3_BUCKET?.trim())
    throw new Error('S3_BUCKET is required for providers.media=s3');
  if (publicTier && env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE=true is required');
  if (publicTier && env.SWAGGER_ENABLED !== 'false')
    throw new Error('SWAGGER_ENABLED=false is required');
}

function get(target: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, target);
}

function set(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const key = parts.pop()!;
  const parent = parts.reduce<Record<string, unknown>>(
    (object, part) => object[part] as Record<string, unknown>,
    target,
  );
  parent[key] = value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function redact(message: string): string {
  return message
    .replace(/(received\s+).*/gi, '$1[REDACTED]')
    .replace(
      /(password|secret|token|api[_-]?key|credential)(\s*[=:]\s*)[^\s,;]+/gi,
      '$1$2[REDACTED]',
    );
}
