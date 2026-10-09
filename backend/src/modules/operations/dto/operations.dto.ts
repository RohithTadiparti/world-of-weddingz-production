import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  AlertDeliveryErrorCode,
  AlertDeliveryEvent,
  AuditDeliveryStatus,
  EmailDeliveryStatus,
  PortalDeliveryStatus,
} from '../alerts/alert-delivery.types';
import { CapacityMetricKey, CapacityUnit } from '../capacity/capacity.types';
import {
  OperationalAlertSeverity,
  OperationalAlertStatus,
} from '../entities/operational-alert.entity';

/** `active` is open plus acknowledged: everything not yet resolved. */
export const ALERT_STATUS_FILTERS = ['open', 'acknowledged', 'resolved', 'active'] as const;
export type AlertStatusFilter = (typeof ALERT_STATUS_FILTERS)[number];

export class OperationalAlertQueryDto {
  @ApiPropertyOptional({ enum: ALERT_STATUS_FILTERS })
  @IsOptional()
  @IsIn(ALERT_STATUS_FILTERS)
  status?: AlertStatusFilter;
}

// ------------------------------------------------------------- responses

export type MetricFreshness = 'fresh' | 'stale' | 'missing';
export type MetricStatus = 'ok' | 'warning' | 'critical' | 'unknown';

/**
 * Why a metric is `unknown`. Null when the status was derived from a fresh,
 * complete, unit-consistent persisted value.
 */
export type MetricStatusReason =
  | 'no_snapshot'
  | 'metric_not_in_snapshot'
  | 'stale_snapshot'
  | 'invalid_value'
  | 'unit_mismatch'
  | 'not_measured'
  | 'threshold_not_configured';

export interface MetricThresholds {
  warning: number;
  critical: number;
  /** The unit the configured thresholds are expressed in. */
  unit: CapacityUnit;
}

export interface MetricAlertState {
  state: OperationalAlertStatus | 'none';
  alertId: string | null;
  severity: OperationalAlertSeverity | null;
}

export interface CapacityMetricStatus {
  key: CapacityMetricKey;
  /** Exactly as persisted in the latest snapshot; null when missing. */
  value: number | null;
  /** Exactly as persisted in the latest snapshot; null when missing. */
  unit: CapacityUnit | null;
  source: string | null;
  windowMinutes: number | null;
  /**
   * True when the value is a configured estimate, not a measurement. A 0
   * placeholder estimate is reported as unknown/not_measured instead.
   */
  estimate: boolean;
  thresholds: MetricThresholds | null;
  /** The snapshot's hourly collection period (periodStart), ISO-8601. */
  periodStart: string | null;
  /** When the snapshot row was written (createdAt), ISO-8601. */
  collectedAt: string | null;
  freshness: MetricFreshness;
  status: MetricStatus;
  statusReason: MetricStatusReason | null;
  alert: MetricAlertState;
}

export interface StalenessRule {
  /** The collector is scheduled once an hour. */
  collectionIntervalMinutes: number;
  /** A snapshot older than this (two missed intervals) is stale. */
  staleAfterMinutes: number;
  /** Snapshots stamped this far in the future are treated as stale. */
  futureToleranceMinutes: number;
  /** Which timestamp the age is measured from. */
  basis: 'periodStart';
}

export interface OperationsStatusResponse {
  evaluatedAt: string;
  overallStatus: MetricStatus;
  counts: Record<MetricStatus, number>;
  staleness: StalenessRule;
  snapshot: {
    id: string;
    periodStart: string;
    collectedAt: string;
    ageMinutes: number;
    freshness: Exclude<MetricFreshness, 'missing'>;
  } | null;
  metrics: CapacityMetricStatus[];
}

export interface RedactedPortalOutcome {
  status: PortalDeliveryStatus | null;
  at: string | null;
  recipients: number | null;
  error: AlertDeliveryErrorCode | null;
}

export interface RedactedEmailOutcome {
  status: EmailDeliveryStatus | null;
  at: string | null;
  recipients: number | null;
  provider: string | null;
  error: AlertDeliveryErrorCode | null;
}

export interface RedactedAuditOutcome {
  status: AuditDeliveryStatus | null;
  at: string | null;
  error: AlertDeliveryErrorCode | null;
}

export interface RedactedDeliveryAttempt {
  event: AlertDeliveryEvent | null;
  at: string | null;
  correlationId: string | null;
  severity: OperationalAlertSeverity | null;
  portal: RedactedPortalOutcome;
  email: RedactedEmailOutcome;
  audit: RedactedAuditOutcome;
}

export interface RedactedDeliveryState {
  /** False when OPS-003 has not written delivery metadata for this alert. */
  recorded: boolean;
  notifiedSeverity: OperationalAlertSeverity | null;
  lastReminderAt: string | null;
  lastNotifiedAt: string | null;
  lastAttempt: RedactedDeliveryAttempt | null;
  history: RedactedDeliveryAttempt[];
}

export interface OperationalAlertView {
  id: string;
  metric: CapacityMetricKey;
  severity: OperationalAlertSeverity;
  status: OperationalAlertStatus;
  observedValue: number;
  thresholdValue: number;
  unit: CapacityUnit;
  source: string;
  firstObservedAt: string;
  lastObservedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  delivery: RedactedDeliveryState;
}

export interface OperationalAlertsResponse {
  data: OperationalAlertView[];
  total: number;
}

export interface AcknowledgeAlertResponse {
  alert: OperationalAlertView;
  /** False when the alert had already been acknowledged (idempotent replay). */
  changed: boolean;
}

export type PrerequisiteStatus = 'met' | 'unmet' | 'unknown';

export interface MigrationPrerequisite {
  id:
    | 'auth_step_up'
    | 'migration_control_plane'
    | 'migration_enabled'
    | 'real_executor'
    | 'dry_run_disabled'
    | 'executor_gates'
    | 'capacity_telemetry'
    | 'revenue_target';
  label: string;
  status: PrerequisiteStatus;
  detail: string;
  /** Work item or release gate that owns closing it, if any. */
  owner: string | null;
}

export interface MigrationReadinessResponse {
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
    /** Null: no persisted net platform revenue measurement exists. */
    measuredMonthlyNetInr: number | null;
    status: 'unknown' | 'below_minimum' | 'minimum_met' | 'preferred_met';
    source: string | null;
    detail: string;
  };
  capacity: {
    overallStatus: MetricStatus;
    unknownMetrics: number;
  };
  prerequisites: MigrationPrerequisite[];
  unmet: MigrationPrerequisite['id'][];
}
