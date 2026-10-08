export type DeploymentTier = 'local' | 'staging' | 'public-beta' | 'revenue';

export interface Threshold {
  warning: number;
  critical: number;
}

export interface PlatformConfig {
  version: 1;
  deployment: { tier: DeploymentTier; liveMediaProvider: 's3' };
  providers: {
    mail: 'log' | 'smtp';
    sms: 'log' | 'http';
    whatsapp: 'log' | 'cloud';
    push: 'log' | 'fcm';
    payment: 'mock' | 'razorpay';
    identity: 'mock' | 'licensed';
    media: 'mock' | 's3';
    ai: 'mock' | 'openai';
  };
  operations: {
    logRetentionDays: number;
    alertReminderHours: number;
    /** Operational alert email recipients; empty means email is not configured. */
    alertRecipients: string[];
    consecutiveCountSamples: number;
    sustainedPerformanceMinutes: number;
    measurements: { railwayMonthlyInr: number };
    thresholds: Record<string, Threshold>;
    revenue: { minimumMonthlyNetInr: number; preferredMonthlyNetInr: number };
  };
  features: {
    individualUserEnabled: boolean;
    chatRedactContacts: boolean;
    servicesRequireMatchFixed: boolean;
    matchmakingRequiresIdentity: boolean;
    catalogReviewThresholdPercent: number;
  };
  migration: {
    enabled: boolean;
    executor: 'mock' | 'aws';
    dryRun: boolean;
    readOnlyWindowMinutes: number;
    railwayRetentionHours: number;
  };
}
