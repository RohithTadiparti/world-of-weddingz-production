export const CAPACITY_METRIC_KEYS = [
  'accounts',
  'dailyActiveUsers',
  'requestsPerDay',
  'concurrentUsers',
  'databaseGigabytes',
  'p95LatencyMs',
  'errorRatePercent',
  'cpuPercent',
  'memoryPercent',
  'railwayMonthlyInr',
] as const;

/**
 * Source recorded for a metric whose value is the canonical configuration
 * estimate rather than a measurement (operations.measurements.*). The
 * dashboard reads it to label the value an estimate, or "not measured" when
 * the estimate is the 0 placeholder.
 */
export const CONFIGURED_ESTIMATE_SOURCE = 'Canonical configured Railway estimate';

export type CapacityMetricKey = (typeof CAPACITY_METRIC_KEYS)[number];
export type CapacityUnit = 'count' | 'GB' | 'ms' | 'percent' | 'INR/month';

export interface CapacityMetric {
  key: CapacityMetricKey;
  value: number;
  unit: CapacityUnit;
  source: string;
  windowMinutes?: number;
}

export interface RuntimeCapacityMetrics {
  dailyActiveUsers: number;
  requestsPerDay: number;
  concurrentUsers: number;
  p95LatencyMs: number;
  errorRatePercent: number;
  cpuPercent: number;
  memoryPercent: number;
  requestWindowMinutes: number;
  resourceWindowMinutes: number;
}

export const RUNTIME_CAPACITY_PROVIDER = Symbol('RUNTIME_CAPACITY_PROVIDER');

export interface RuntimeCapacityProvider {
  read(at: Date): Promise<RuntimeCapacityMetrics>;
}

export interface AlertEvaluationResult {
  opened: string[];
  promoted: string[];
  resolved: string[];
  unchanged: string[];
}

export const METRIC_UNITS: Record<CapacityMetricKey, CapacityUnit> = {
  accounts: 'count',
  dailyActiveUsers: 'count',
  requestsPerDay: 'count',
  concurrentUsers: 'count',
  databaseGigabytes: 'GB',
  p95LatencyMs: 'ms',
  errorRatePercent: 'percent',
  cpuPercent: 'percent',
  memoryPercent: 'percent',
  railwayMonthlyInr: 'INR/month',
};
