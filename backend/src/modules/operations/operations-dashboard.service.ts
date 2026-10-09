import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { currentRequestId } from '../../common/logging/request-context';
import { AppConfigService } from '../../config/app-config.service';
import { redactDeliveryState } from './alerts/alert-delivery.redaction';
import { AlertDeliveryService } from './alerts/alert-delivery.service';
import {
  CAPACITY_METRIC_KEYS,
  CapacityMetric,
  CapacityMetricKey,
  CONFIGURED_ESTIMATE_SOURCE,
  METRIC_UNITS,
} from './capacity/capacity.types';
import {
  AcknowledgeAlertResponse,
  AlertStatusFilter,
  CapacityMetricStatus,
  MetricAlertState,
  MetricFreshness,
  MetricStatus,
  MetricStatusReason,
  MetricThresholds,
  MigrationPrerequisite,
  MigrationReadinessResponse,
  OperationalAlertView,
  OperationalAlertsResponse,
  OperationsStatusResponse,
  StalenessRule,
} from './dto/operations.dto';
import { CapacitySnapshot } from './entities/capacity-snapshot.entity';
import {
  OperationalAlert,
  OperationalAlertStatus,
} from './entities/operational-alert.entity';

/**
 * Staleness rule for capacity telemetry.
 *
 * The collector runs once an hour (CapacityScheduler, EVERY_HOUR) and stamps
 * each snapshot with the hour it describes (`periodStart`). A snapshot whose
 * period began more than two collection intervals ago means at least one run
 * was missed, so its values are stale and every metric in it is `unknown`.
 * Age is measured from `periodStart`, never from `createdAt`, because
 * periodStart is the earlier of the two and so the stricter reading. A
 * snapshot stamped more than five minutes in the future is also stale: a
 * clock that disagrees with this one is not evidence of health.
 */
export const STALENESS_RULE: StalenessRule = {
  collectionIntervalMinutes: 60,
  staleAfterMinutes: 120,
  futureToleranceMinutes: 5,
  basis: 'periodStart',
};

const MINUTE = 60_000;

/** Worst first. Unknown outranks ok, so missing data can never read healthy. */
const STATUS_RANK: Record<MetricStatus, number> = { critical: 3, warning: 2, unknown: 1, ok: 0 };

export function snapshotFreshness(
  periodStart: Date,
  now: Date,
  rule: StalenessRule = STALENESS_RULE,
): Exclude<MetricFreshness, 'missing'> {
  const ageMs = now.getTime() - periodStart.getTime();
  if (ageMs > rule.staleAfterMinutes * MINUTE) return 'stale';
  if (ageMs < -rule.futureToleranceMinutes * MINUTE) return 'stale';
  return 'fresh';
}

/**
 * The status of one metric, from exactly what was persisted.
 *
 * Anything short of a fresh, finite value in the unit the thresholds are
 * written in is `unknown` with the reason; no unit is ever converted. The band
 * is the threshold band of the latest value. Whether that breach has been
 * confirmed (two samples, sustained window) is the alert's job, reported
 * alongside rather than folded in here.
 */
export function deriveMetricStatus(input: {
  metric: CapacityMetric | null;
  freshness: MetricFreshness;
  thresholds: MetricThresholds | null;
  hasSnapshot: boolean;
}): { status: MetricStatus; reason: MetricStatusReason | null } {
  const { metric, freshness, thresholds } = input;
  if (!input.hasSnapshot) return { status: 'unknown', reason: 'no_snapshot' };
  if (!metric) return { status: 'unknown', reason: 'metric_not_in_snapshot' };
  if (freshness !== 'fresh') return { status: 'unknown', reason: 'stale_snapshot' };
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
    return { status: 'unknown', reason: 'invalid_value' };
  }
  // The configured cost estimate defaults to 0, a placeholder until the
  // Railway billing adapter is enabled. A placeholder is not a measurement,
  // so it must not read as ok.
  if (metric.source === CONFIGURED_ESTIMATE_SOURCE && metric.value === 0) {
    return { status: 'unknown', reason: 'not_measured' };
  }
  if (!thresholds) return { status: 'unknown', reason: 'threshold_not_configured' };
  if (metric.unit !== thresholds.unit) return { status: 'unknown', reason: 'unit_mismatch' };
  if (metric.value >= thresholds.critical) return { status: 'critical', reason: null };
  if (metric.value >= thresholds.warning) return { status: 'warning', reason: null };
  return { status: 'ok', reason: null };
}

export function overallStatus(statuses: MetricStatus[]): MetricStatus {
  if (statuses.length === 0) return 'unknown';
  return statuses.reduce<MetricStatus>(
    (worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst),
    'ok',
  );
}

/** A configured estimate that is not the 0 placeholder: banded, but labelled. */
export function isConfiguredEstimate(metric: CapacityMetric | null): boolean {
  return metric?.source === CONFIGURED_ESTIMATE_SOURCE && metric.value !== 0;
}

/** Critical before warning, then most recently observed, then most recently opened. */
export function compareAlerts(a: OperationalAlert, b: OperationalAlert): number {
  const severity = (alert: OperationalAlert) => (alert.severity === 'critical' ? 0 : 1);
  return (
    severity(a) - severity(b) ||
    new Date(b.lastObservedAt).getTime() - new Date(a.lastObservedAt).getTime() ||
    new Date(b.firstObservedAt).getTime() - new Date(a.firstObservedAt).getTime() ||
    a.id.localeCompare(b.id)
  );
}

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/**
 * Prerequisites that no persisted or configured state can satisfy yet,
 * because the work that would satisfy them has not been built. Each one is
 * flipped by the work item that owns it, never by configuration.
 */
const NOT_YET_BUILT: Record<'auth_step_up' | 'migration_control_plane' | 'executor_gates', boolean> = {
  auth_step_up: false,
  migration_control_plane: false,
  executor_gates: false,
};

/** Hard cap; fingerprints are unique per metric, so real counts are tiny. */
const ALERT_LIST_LIMIT = 200;

@Injectable()
export class OperationsDashboardService {
  private readonly logger = new Logger(OperationsDashboardService.name);

  constructor(
    private readonly config: AppConfigService,
    @InjectRepository(CapacitySnapshot)
    private readonly snapshots: Repository<CapacitySnapshot>,
    @InjectRepository(OperationalAlert)
    private readonly alerts: Repository<OperationalAlert>,
    private readonly delivery: AlertDeliveryService,
  ) {}

  async status(now = new Date()): Promise<OperationsStatusResponse> {
    const [latest] = await this.snapshots.find({ order: { periodStart: 'DESC' }, take: 1 });
    const alerts = await this.alerts.find({
      where: { fingerprint: In(CAPACITY_METRIC_KEYS.map((key) => `capacity:${key}`)) },
    });
    const alertByMetric = new Map(alerts.map((alert) => [alert.fingerprint, alert]));
    const snapshotFresh = latest ? snapshotFreshness(new Date(latest.periodStart), now) : null;
    const persisted: CapacityMetric[] = Array.isArray(latest?.metrics) ? latest.metrics : [];

    const metrics = CAPACITY_METRIC_KEYS.map((key): CapacityMetricStatus => {
      const metric = persisted.find((item) => item?.key === key) ?? null;
      const thresholds = this.thresholds(key);
      const metricFreshness: MetricFreshness = metric && snapshotFresh ? snapshotFresh : 'missing';
      const { status, reason } = deriveMetricStatus({
        metric,
        freshness: metricFreshness,
        thresholds,
        hasSnapshot: Boolean(latest),
      });
      return {
        key,
        value: metric && typeof metric.value === 'number' ? metric.value : null,
        unit: metric?.unit ?? null,
        source: metric?.source ?? null,
        windowMinutes: typeof metric?.windowMinutes === 'number' ? metric.windowMinutes : null,
        estimate: isConfiguredEstimate(metric),
        thresholds,
        periodStart: iso(latest?.periodStart),
        collectedAt: iso(latest?.createdAt),
        freshness: metricFreshness,
        status,
        statusReason: reason,
        alert: this.alertState(alertByMetric.get(`capacity:${key}`)),
      };
    });

    const counts: Record<MetricStatus, number> = { ok: 0, warning: 0, critical: 0, unknown: 0 };
    for (const metric of metrics) counts[metric.status] += 1;

    return {
      evaluatedAt: now.toISOString(),
      overallStatus: overallStatus(metrics.map((metric) => metric.status)),
      counts,
      staleness: STALENESS_RULE,
      snapshot: latest
        ? {
            id: latest.id,
            periodStart: new Date(latest.periodStart).toISOString(),
            collectedAt: new Date(latest.createdAt).toISOString(),
            ageMinutes: Math.floor((now.getTime() - new Date(latest.periodStart).getTime()) / MINUTE),
            freshness: snapshotFresh ?? 'stale',
          }
        : null,
      metrics,
    };
  }

  async list(filter?: AlertStatusFilter): Promise<OperationalAlertsResponse> {
    const statuses: OperationalAlertStatus[] | null =
      filter === 'active' ? ['open', 'acknowledged'] : filter ? [filter] : null;
    const rows = await this.alerts.find({
      where: statuses ? { status: In(statuses) } : {},
      order: { lastObservedAt: 'DESC' },
      take: ALERT_LIST_LIMIT,
    });
    const data = [...rows].sort(compareAlerts).map((alert) => this.view(alert));
    return { data, total: data.length };
  }

  /**
   * Acknowledge an alert, exactly once.
   *
   * The conditional UPDATE is the idempotency: only the request that moves
   * the row from open/unacknowledged writes the actor and time and records
   * the audit. A replay, or the loser of a race, reads back the persisted
   * acknowledgement unchanged. A resolved alert that nobody acknowledged is a
   * conflict: there is nothing left to take ownership of.
   */
  async acknowledge(id: string, actorUserId: string, now = new Date()): Promise<AcknowledgeAlertResponse> {
    const result = await this.alerts
      .createQueryBuilder()
      .update(OperationalAlert)
      .set({ status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: actorUserId })
      .where('id = :id', { id })
      .andWhere('status = :open', { open: 'open' })
      .andWhere('"acknowledgedAt" IS NULL')
      .execute();

    const alert = await this.alerts.findOne({ where: { id } });
    if (!alert) throw new NotFoundException('Operational alert not found');

    if (result.affected === 1) {
      const correlationId = currentRequestId() ?? randomUUID();
      try {
        await this.delivery.recordAcknowledged(alert, actorUserId, correlationId);
      } catch (error) {
        // The acknowledgement is committed; losing its audit/history entry
        // must be loud, but must not pretend the acknowledgement failed.
        this.logger.error({
          event: 'operational_alert.acknowledge_record_failed',
          alertId: alert.id,
          correlationId,
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
      const persisted = await this.alerts.findOne({ where: { id } });
      return { alert: this.view(persisted ?? alert), changed: true };
    }

    if (alert.acknowledgedAt || alert.status !== 'resolved') {
      return { alert: this.view(alert), changed: false };
    }
    throw new ConflictException('A resolved alert cannot be acknowledged');
  }

  async readiness(now = new Date()): Promise<MigrationReadinessResponse> {
    const capacity = await this.status(now);
    const migration = this.config.migration;
    const revenueConfig = this.config.operations.revenue;
    const unknownMetrics = capacity.counts.unknown;

    const revenue: MigrationReadinessResponse['revenue'] = {
      currency: 'INR',
      minimumMonthlyNetInr: revenueConfig.minimumMonthlyNetInr,
      preferredMonthlyNetInr: revenueConfig.preferredMonthlyNetInr,
      measuredMonthlyNetInr: null,
      status: 'unknown',
      source: null,
      detail:
        'No persisted monthly net platform revenue measurement exists. Commission recorded on ' +
        'payments is gross and is taken through the configured payment provider, so it is not ' +
        'reported as net revenue.',
    };

    const prerequisite = (
      id: MigrationPrerequisite['id'],
      label: string,
      met: boolean | null,
      detail: string,
      owner: string | null,
    ): MigrationPrerequisite => ({
      id,
      label,
      status: met === null ? 'unknown' : met ? 'met' : 'unmet',
      detail,
      owner,
    });

    const prerequisites: MigrationPrerequisite[] = [
      prerequisite(
        'auth_step_up',
        'Administrator step-up authentication',
        NOT_YET_BUILT.auth_step_up,
        'Fresh re-authentication with a single-use, action-scoped token is not implemented.',
        'AUTH-001',
      ),
      prerequisite(
        'migration_control_plane',
        'Migration state machine and executor',
        NOT_YET_BUILT.migration_control_plane,
        'The migration run state machine, executor and start endpoint are not implemented.',
        'MIG-001',
      ),
      prerequisite(
        'migration_enabled',
        'Migration enabled in configuration',
        migration.enabled,
        `migration.enabled is ${String(migration.enabled)}.`,
        null,
      ),
      prerequisite(
        'real_executor',
        'Real AWS executor selected',
        migration.executor === 'aws',
        `migration.executor is ${migration.executor}.`,
        null,
      ),
      prerequisite(
        'dry_run_disabled',
        'Dry run disabled',
        !migration.dryRun,
        `migration.dryRun is ${String(migration.dryRun)}.`,
        null,
      ),
      prerequisite(
        'executor_gates',
        'Real executor release gates approved',
        NOT_YET_BUILT.executor_gates,
        'GATE-009 (migration rehearsal), GATE-010 (rollback rehearsal) and GATE-011 (real executor enablement) are not approved.',
        'GATE-009, GATE-010, GATE-011',
      ),
      prerequisite(
        'capacity_telemetry',
        'Capacity telemetry fresh and complete',
        unknownMetrics === 0,
        unknownMetrics === 0
          ? 'Every capacity metric has a fresh persisted value.'
          : `${unknownMetrics} of ${capacity.metrics.length} capacity metrics are unknown (missing, stale or not measured).`,
        null,
      ),
      prerequisite(
        'revenue_target',
        'Monthly net revenue target measured and met',
        null,
        `Monthly net platform revenue is not measured, so the INR ${revenueConfig.minimumMonthlyNetInr.toLocaleString('en-IN')} minimum cannot be confirmed.`,
        null,
      ),
    ];

    const unmet = prerequisites.filter((item) => item.status !== 'met').map((item) => item.id);
    return {
      evaluatedAt: now.toISOString(),
      available: unmet.length === 0,
      migration: {
        enabled: migration.enabled,
        executor: migration.executor,
        dryRun: migration.dryRun,
        readOnlyWindowMinutes: migration.readOnlyWindowMinutes,
        railwayRetentionHours: migration.railwayRetentionHours,
      },
      revenue,
      capacity: { overallStatus: capacity.overallStatus, unknownMetrics },
      prerequisites,
      unmet,
    };
  }

  private thresholds(key: CapacityMetricKey): MetricThresholds | null {
    const configured = this.config.operations.thresholds?.[key];
    if (
      !configured ||
      typeof configured.warning !== 'number' ||
      typeof configured.critical !== 'number'
    ) {
      return null;
    }
    return { warning: configured.warning, critical: configured.critical, unit: METRIC_UNITS[key] };
  }

  private alertState(alert?: OperationalAlert): MetricAlertState {
    if (!alert) return { state: 'none', alertId: null, severity: null };
    return { state: alert.status, alertId: alert.id, severity: alert.severity };
  }

  private view(alert: OperationalAlert): OperationalAlertView {
    return {
      id: alert.id,
      metric: alert.metric,
      severity: alert.severity,
      status: alert.status,
      observedValue: alert.observedValue,
      thresholdValue: alert.thresholdValue,
      unit: alert.unit,
      source: alert.source,
      firstObservedAt: new Date(alert.firstObservedAt).toISOString(),
      lastObservedAt: new Date(alert.lastObservedAt).toISOString(),
      acknowledgedAt: iso(alert.acknowledgedAt),
      acknowledgedBy: alert.acknowledgedBy ?? null,
      resolvedAt: iso(alert.resolvedAt),
      delivery: redactDeliveryState(alert.deliveryMetadata, alert.lastNotifiedAt),
    };
  }
}
