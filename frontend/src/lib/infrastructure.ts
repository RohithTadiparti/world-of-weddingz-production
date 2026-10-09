import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * The administrator Infrastructure API (UI-001), as the browser reads it.
 *
 * Mirrors backend/src/modules/operations/dto/operations.dto.ts. Values arrive
 * exactly as persisted; nothing here converts a unit or recomputes a status.
 * Formatting adds digit grouping and a unit label, never arithmetic.
 */

export type CapacityMetricKey =
  | 'accounts'
  | 'dailyActiveUsers'
  | 'requestsPerDay'
  | 'concurrentUsers'
  | 'databaseGigabytes'
  | 'p95LatencyMs'
  | 'errorRatePercent'
  | 'cpuPercent'
  | 'memoryPercent'
  | 'railwayMonthlyInr';

export type CapacityUnit = 'count' | 'GB' | 'ms' | 'percent' | 'INR/month';
export type MetricFreshness = 'fresh' | 'stale' | 'missing';
export type MetricStatus = 'ok' | 'warning' | 'critical' | 'unknown';
export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type MetricStatusReason =
  | 'no_snapshot'
  | 'metric_not_in_snapshot'
  | 'stale_snapshot'
  | 'invalid_value'
  | 'unit_mismatch'
  | 'not_measured'
  | 'threshold_not_configured';

export interface CapacityMetricStatus {
  key: CapacityMetricKey;
  value: number | null;
  unit: CapacityUnit | null;
  source: string | null;
  windowMinutes: number | null;
  /** A configured estimate, not a measurement. Never present it as measured. */
  estimate: boolean;
  thresholds: { warning: number; critical: number; unit: CapacityUnit } | null;
  periodStart: string | null;
  collectedAt: string | null;
  freshness: MetricFreshness;
  status: MetricStatus;
  statusReason: MetricStatusReason | null;
  alert: { state: AlertStatus | 'none'; alertId: string | null; severity: AlertSeverity | null };
}

export interface OperationsStatus {
  evaluatedAt: string;
  overallStatus: MetricStatus;
  counts: Record<MetricStatus, number>;
  staleness: {
    collectionIntervalMinutes: number;
    staleAfterMinutes: number;
    futureToleranceMinutes: number;
    basis: 'periodStart';
  };
  snapshot: {
    id: string;
    periodStart: string;
    collectedAt: string;
    ageMinutes: number;
    freshness: 'fresh' | 'stale';
  } | null;
  metrics: CapacityMetricStatus[];
}

export interface DeliveryAttempt {
  event: 'opened' | 'promoted' | 'reminder' | 'acknowledged' | 'resolved' | null;
  at: string | null;
  correlationId: string | null;
  severity: AlertSeverity | null;
  portal: { status: 'delivered' | 'failed' | 'skipped' | null; at: string | null; recipients: number | null; error: string | null };
  email: {
    status: 'sent' | 'simulated' | 'failed' | 'skipped' | 'not_configured' | null;
    at: string | null;
    recipients: number | null;
    provider: string | null;
    error: string | null;
  };
  audit: { status: 'recorded' | 'failed' | null; at: string | null; error: string | null };
}

export interface DeliveryState {
  recorded: boolean;
  notifiedSeverity: AlertSeverity | null;
  lastReminderAt: string | null;
  lastNotifiedAt: string | null;
  lastAttempt: DeliveryAttempt | null;
  history: DeliveryAttempt[];
}

export interface OperationalAlert {
  id: string;
  metric: CapacityMetricKey;
  severity: AlertSeverity;
  status: AlertStatus;
  observedValue: number;
  thresholdValue: number;
  unit: CapacityUnit;
  source: string;
  firstObservedAt: string;
  lastObservedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  delivery: DeliveryState;
}

export interface OperationalAlerts {
  data: OperationalAlert[];
  total: number;
}

export interface MigrationPrerequisite {
  id: string;
  label: string;
  status: 'met' | 'unmet' | 'unknown';
  detail: string;
  owner: string | null;
}

export interface MigrationReadiness {
  evaluatedAt: string;
  available: boolean;
  migration: {
    enabled: boolean;
    executor: string;
    dryRun: boolean;
    readOnlyWindowMinutes: number;
    railwayRetentionHours: number;
  };
  revenue: {
    currency: 'INR';
    minimumMonthlyNetInr: number;
    preferredMonthlyNetInr: number;
    measuredMonthlyNetInr: number | null;
    status: 'unknown' | 'below_minimum' | 'minimum_met' | 'preferred_met';
    source: string | null;
    detail: string;
  };
  capacity: { overallStatus: MetricStatus; unknownMetrics: number };
  prerequisites: MigrationPrerequisite[];
  unmet: string[];
}

export const INFRASTRUCTURE_QUERY_KEYS = {
  status: ['admin-operations-status'],
  alerts: ['admin-operations-alerts'],
  readiness: ['admin-operations-readiness'],
} as const;

export const fetchOperationsStatus = async (): Promise<OperationsStatus> =>
  (await api.get('/admin/operations/status')).data;

export const fetchOperationalAlerts = async (): Promise<OperationalAlerts> =>
  (await api.get('/admin/operations/alerts')).data;

export const fetchMigrationReadiness = async (): Promise<MigrationReadiness> =>
  (await api.get('/admin/operations/migration-readiness')).data;

/**
 * Acknowledge, then refetch what the acknowledgement changes.
 *
 * Not optimistic: the server decides the actor and the time, and a replay
 * returns somebody else's earlier acknowledgement, so the page shows only what
 * was persisted.
 */
export async function acknowledgeAlert(client: QueryClient, id: string) {
  const { data } = await api.post(`/admin/operations/alerts/${encodeURIComponent(id)}/acknowledge`);
  await Promise.all([
    client.invalidateQueries({ queryKey: INFRASTRUCTURE_QUERY_KEYS.alerts }),
    client.invalidateQueries({ queryKey: INFRASTRUCTURE_QUERY_KEYS.status }),
  ]);
  return data as { alert: OperationalAlert; changed: boolean };
}

export const METRIC_LABEL: Record<CapacityMetricKey, string> = {
  accounts: 'Registered accounts',
  dailyActiveUsers: 'Daily active users',
  requestsPerDay: 'API requests per day',
  concurrentUsers: 'Concurrent active users',
  databaseGigabytes: 'PostgreSQL data size',
  p95LatencyMs: 'P95 API latency',
  errorRatePercent: 'API error rate',
  cpuPercent: 'CPU utilisation',
  memoryPercent: 'Memory utilisation',
  railwayMonthlyInr: 'Projected Railway monthly cost',
};

export const metricLabel = (key: string): string =>
  METRIC_LABEL[key as CapacityMetricKey] ?? key;

/** Digit grouping only. No rounding: every digit in the parsed API number is shown. */
export function formatNumber(value: number): string {
  const raw = String(value);
  // Expanding scientific notation with floating-point arithmetic could change
  // the value, so preserve it byte-for-byte as represented by JavaScript.
  if (/e/i.test(raw)) return raw;
  const sign = raw.startsWith('-') ? '-' : '';
  const [integer, fraction] = (sign ? raw.slice(1) : raw).split('.');
  const grouped = integer.length <= 3
    ? integer
    : `${integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${integer.slice(-3)}`;
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** The persisted value with its persisted unit, unchanged. */
export function formatMeasurement(value: number | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No value';
  const n = formatNumber(value);
  switch (unit) {
    case 'count':
      return n;
    case 'GB':
      return `${n} GB`;
    case 'ms':
      return `${n} ms`;
    case 'percent':
      return `${n}%`;
    case 'INR/month':
      return `₹${n} per month`;
    default:
      return unit ? `${n} ${unit}` : n;
  }
}

export const STATUS_LABEL: Record<MetricStatus, string> = {
  ok: 'OK',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Unknown',
};

/** Unknown is neutral grey, never the positive colour. */
export const STATUS_PILL: Record<MetricStatus, string> = {
  ok: 'pill-positive',
  warning: 'pill-caution',
  critical: 'pill-critical',
  unknown: 'pill-neutral',
};

export const FRESHNESS_LABEL: Record<MetricFreshness, string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  missing: 'Missing',
};

export const FRESHNESS_PILL: Record<MetricFreshness, string> = {
  fresh: 'pill-neutral',
  stale: 'pill-caution',
  missing: 'pill-neutral',
};

export const STATUS_REASON_LABEL: Record<MetricStatusReason, string> = {
  no_snapshot: 'No capacity snapshot has been collected.',
  metric_not_in_snapshot: 'The latest snapshot has no value for this metric.',
  stale_snapshot: 'The latest snapshot is stale, so its value is not evaluated.',
  invalid_value: 'The stored value is not a number.',
  unit_mismatch: 'The stored unit differs from the threshold unit; it is not converted.',
  threshold_not_configured: 'No threshold is configured for this metric.',
  not_measured: 'Not measured: configured placeholder, Railway billing adapter not enabled.',
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

export const ALERT_STATUS_PILL: Record<AlertStatus, string> = {
  open: 'pill-brand',
  acknowledged: 'pill-neutral',
  resolved: 'pill-positive',
};

export const SEVERITY_PILL: Record<AlertSeverity, string> = {
  warning: 'pill-caution',
  critical: 'pill-critical',
};

export const PORTAL_DELIVERY_LABEL: Record<string, string> = {
  delivered: 'Delivered in portal',
  failed: 'Portal delivery failed',
  skipped: 'Portal not sent',
};

export const EMAIL_DELIVERY_LABEL: Record<string, string> = {
  sent: 'Email sent',
  simulated: 'Email simulated (log provider, not delivered to any inbox)',
  failed: 'Email failed',
  skipped: 'Email not sent',
  not_configured: 'No operational email recipients configured',
};

export const AUDIT_DELIVERY_LABEL: Record<string, string> = {
  recorded: 'Audit recorded',
  failed: 'Audit write failed',
};

export const DELIVERY_EVENT_LABEL: Record<string, string> = {
  opened: 'Opened',
  promoted: 'Promoted to critical',
  reminder: 'Reminder',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

/** HTTP status of a failed request, when the server answered. */
export function httpStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}
