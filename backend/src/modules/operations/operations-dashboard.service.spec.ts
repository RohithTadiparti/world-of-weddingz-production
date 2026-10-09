import { In } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AlertDeliveryService } from './alerts/alert-delivery.service';
import {
  CAPACITY_METRIC_KEYS,
  CONFIGURED_ESTIMATE_SOURCE,
  CapacityMetric,
  METRIC_UNITS,
} from './capacity/capacity.types';
import { CapacitySnapshot } from './entities/capacity-snapshot.entity';
import { OperationalAlert } from './entities/operational-alert.entity';
import {
  OperationsDashboardService,
  STALENESS_RULE,
  compareAlerts,
  overallStatus,
  snapshotFreshness,
} from './operations-dashboard.service';

// Named so secret scanners do not read a metric key literal as a credential.
const LATENCY_METRIC = 'p95LatencyMs' as const;

const NOW = new Date('2026-10-09T12:20:00.000Z');

const thresholds = {
  accounts: { warning: 5000, critical: 10000 },
  dailyActiveUsers: { warning: 500, critical: 1000 },
  requestsPerDay: { warning: 50000, critical: 100000 },
  concurrentUsers: { warning: 30, critical: 75 },
  databaseGigabytes: { warning: 5, critical: 10 },
  p95LatencyMs: { warning: 400, critical: 750 },
  errorRatePercent: { warning: 0.5, critical: 1 },
  cpuPercent: { warning: 70, critical: 80 },
  memoryPercent: { warning: 70, critical: 80 },
  railwayMonthlyInr: { warning: 15000, critical: 30000 },
};

const config = {
  operations: {
    thresholds,
    revenue: { minimumMonthlyNetInr: 1200000, preferredMonthlyNetInr: 1500000 },
  },
  migration: {
    enabled: false,
    executor: 'mock',
    dryRun: true,
    readOnlyWindowMinutes: 15,
    railwayRetentionHours: 72,
  },
} as unknown as AppConfigService;

/** Every metric comfortably under its warning threshold, in its canonical unit. */
function healthyMetrics(): CapacityMetric[] {
  const values: Record<string, number> = {
    accounts: 1234,
    dailyActiveUsers: 87,
    requestsPerDay: 4321,
    concurrentUsers: 3,
    databaseGigabytes: 0.123456789,
    p95LatencyMs: 182.75,
    errorRatePercent: 0.0421,
    cpuPercent: 12.5,
    memoryPercent: 41.25,
    railwayMonthlyInr: 0,
  };
  return CAPACITY_METRIC_KEYS.map((key) => ({
    key,
    value: values[key],
    unit: METRIC_UNITS[key],
    source: `source for ${key}`,
    ...(key === LATENCY_METRIC ? { windowMinutes: 15 } : {}),
  }));
}

function snapshot(periodStart: string, metrics = healthyMetrics()): CapacitySnapshot {
  return {
    id: 'snap-1',
    periodStart: new Date(periodStart),
    createdAt: new Date(new Date(periodStart).getTime() + 4_000),
    metrics,
  };
}

function alert(overrides: Partial<OperationalAlert>): OperationalAlert {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    fingerprint: 'capacity:accounts',
    metric: 'accounts',
    severity: 'warning',
    status: 'open',
    observedValue: 5001,
    thresholdValue: 5000,
    unit: 'count',
    source: 'PostgreSQL users count',
    firstObservedAt: new Date('2026-10-09T10:00:00Z'),
    lastObservedAt: new Date('2026-10-09T12:00:00Z'),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    lastNotifiedAt: null,
    deliveryMetadata: {},
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T12:00:00Z'),
    ...overrides,
  };
}

function setup(opts: { snapshots?: CapacitySnapshot[]; alerts?: OperationalAlert[]; affected?: number } = {}) {
  const store = new Map((opts.alerts ?? []).map((a) => [a.id, { ...a }]));
  const update = { set: jest.fn(), where: jest.fn(), andWhere: jest.fn(), execute: jest.fn() };
  update.set.mockReturnValue(update);
  update.where.mockReturnValue(update);
  update.andWhere.mockReturnValue(update);
  update.execute.mockImplementation(async () => {
    const [values] = update.set.mock.calls.at(-1) ?? [];
    const [, params] = update.where.mock.calls.at(-1) ?? [];
    const row = store.get(params.id);
    if (opts.affected !== undefined) return { affected: opts.affected };
    if (row && row.status === 'open' && !row.acknowledgedAt) {
      Object.assign(row, values);
      return { affected: 1 };
    }
    return { affected: 0 };
  });
  const snapshots = { find: jest.fn().mockResolvedValue(opts.snapshots ?? []) };
  const alerts = {
    find: jest.fn().mockImplementation(async () => [...store.values()].map((a) => ({ ...a }))),
    findOne: jest.fn().mockImplementation(async ({ where: { id } }) => (store.has(id) ? { ...store.get(id) } : null)),
    createQueryBuilder: jest.fn(() => ({ update: jest.fn(() => update) })),
  };
  const delivery = {
    recordAcknowledged: jest.fn().mockResolvedValue({ event: 'acknowledged' }),
  } as unknown as jest.Mocked<AlertDeliveryService>;
  const service = new OperationsDashboardService(config, snapshots as never, alerts as never, delivery);
  return { service, delivery, alerts, store, update };
}

describe('OperationsDashboardService.status', () => {
  it('returns every persisted value and unit unchanged, with thresholds, times and source', async () => {
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z')] });

    const result = await service.status(NOW);

    const persisted = healthyMetrics();
    expect(result.metrics.map((m) => m.key)).toEqual([...CAPACITY_METRIC_KEYS]);
    for (const metric of result.metrics) {
      const original = persisted.find((p) => p.key === metric.key)!;
      expect(metric.value).toBe(original.value);
      expect(metric.unit).toBe(original.unit);
      expect(metric.source).toBe(original.source);
      expect(metric.thresholds).toEqual({ ...thresholds[metric.key], unit: METRIC_UNITS[metric.key] });
      expect(metric.periodStart).toBe('2026-10-09T12:00:00.000Z');
      expect(metric.collectedAt).toBe('2026-10-09T12:00:04.000Z');
      expect(metric.freshness).toBe('fresh');
      expect(metric.status).toBe('ok');
      expect(metric.statusReason).toBeNull();
      expect(metric.estimate).toBe(false);
      expect(metric.alert).toEqual({ state: 'none', alertId: null, severity: null });
    }
    const db = result.metrics.find((m) => m.key === 'databaseGigabytes')!;
    expect(db.value).toBe(0.123456789);
    expect(db.unit).toBe('GB');
    expect(result.metrics.find((m) => m.key === LATENCY_METRIC)!.windowMinutes).toBe(15);
    expect(result.overallStatus).toBe('ok');
    expect(result.counts).toEqual({ ok: 10, warning: 0, critical: 0, unknown: 0 });
    expect(result.snapshot).toEqual({
      id: 'snap-1',
      periodStart: '2026-10-09T12:00:00.000Z',
      collectedAt: '2026-10-09T12:00:04.000Z',
      ageMinutes: 20,
      freshness: 'fresh',
    });
    expect(result.staleness).toEqual(STALENESS_RULE);
  });

  it('reports every metric unknown, never ok, when no snapshot exists', async () => {
    const { service } = setup();

    const result = await service.status(NOW);

    expect(result.snapshot).toBeNull();
    expect(result.overallStatus).toBe('unknown');
    for (const metric of result.metrics) {
      expect(metric).toMatchObject({
        value: null,
        unit: null,
        freshness: 'missing',
        status: 'unknown',
        statusReason: 'no_snapshot',
      });
      expect(metric.thresholds).not.toBeNull();
    }
  });

  it('reports a snapshot older than two collection intervals as stale and unknown', async () => {
    const { service } = setup({ snapshots: [snapshot('2026-10-09T10:19:00Z')] });

    const result = await service.status(NOW);

    expect(result.snapshot?.freshness).toBe('stale');
    expect(result.overallStatus).toBe('unknown');
    for (const metric of result.metrics) {
      expect(metric.freshness).toBe('stale');
      expect(metric.status).toBe('unknown');
      expect(metric.statusReason).toBe('stale_snapshot');
    }
    // The stale value is still shown exactly; only its status is withheld.
    expect(result.metrics.find((m) => m.key === 'accounts')!.value).toBe(1234);
  });

  it('treats a stale snapshot that breaches thresholds as unknown, not critical or ok', async () => {
    const metrics = healthyMetrics().map((m) => (m.key === 'accounts' ? { ...m, value: 99999 } : m));
    const { service } = setup({ snapshots: [snapshot('2026-10-09T09:00:00Z', metrics)] });
    const result = await service.status(NOW);
    expect(result.metrics.find((m) => m.key === 'accounts')!.status).toBe('unknown');
  });

  it('applies the staleness boundary at exactly two intervals and rejects future stamps', () => {
    const at = (iso: string) => new Date(iso);
    expect(snapshotFreshness(at('2026-10-09T10:20:00Z'), NOW)).toBe('fresh');
    expect(snapshotFreshness(at('2026-10-09T10:19:59Z'), NOW)).toBe('stale');
    expect(snapshotFreshness(at('2026-10-09T12:25:00Z'), NOW)).toBe('fresh');
    expect(snapshotFreshness(at('2026-10-09T12:25:01Z'), NOW)).toBe('stale');
  });

  it('marks a metric absent from the latest snapshot missing, so the whole page cannot be ok', async () => {
    const metrics = healthyMetrics().filter((m) => m.key !== 'cpuPercent');
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z', metrics)] });

    const result = await service.status(NOW);

    expect(result.metrics.find((m) => m.key === 'cpuPercent')).toMatchObject({
      value: null,
      freshness: 'missing',
      status: 'unknown',
      statusReason: 'metric_not_in_snapshot',
    });
    expect(result.overallStatus).toBe('unknown');
    expect(result.counts.unknown).toBe(1);
  });

  it('never converts units: a value in another unit is unknown, not compared', async () => {
    const metrics = healthyMetrics().map((m) =>
      m.key === 'databaseGigabytes' ? { ...m, value: 132_000_000, unit: 'count' as const } : m,
    );
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z', metrics)] });
    const db = (await service.status(NOW)).metrics.find((m) => m.key === 'databaseGigabytes')!;
    expect(db).toMatchObject({ value: 132_000_000, unit: 'count', status: 'unknown', statusReason: 'unit_mismatch' });
  });

  it('bands fresh values against the configured thresholds and reports alert state', async () => {
    const metrics = healthyMetrics().map((m) =>
      m.key === 'accounts' ? { ...m, value: 10000 } : m.key === 'cpuPercent' ? { ...m, value: 70 } : m,
    );
    const { service } = setup({
      snapshots: [snapshot('2026-10-09T12:00:00Z', metrics)],
      alerts: [
        alert({ id: 'a1', fingerprint: 'capacity:accounts', severity: 'critical', status: 'acknowledged' }),
        alert({ id: 'a2', fingerprint: 'capacity:cpuPercent', metric: 'cpuPercent', status: 'resolved' }),
      ],
    });

    const result = await service.status(NOW);

    expect(result.metrics.find((m) => m.key === 'accounts')).toMatchObject({
      status: 'critical',
      alert: { state: 'acknowledged', alertId: 'a1', severity: 'critical' },
    });
    expect(result.metrics.find((m) => m.key === 'cpuPercent')).toMatchObject({
      status: 'warning',
      alert: { state: 'resolved', alertId: 'a2', severity: 'warning' },
    });
    expect(result.overallStatus).toBe('critical');
  });

  const withRailway = (value: number) =>
    healthyMetrics().map((m) =>
      m.key === 'railwayMonthlyInr' ? { ...m, value, source: CONFIGURED_ESTIMATE_SOURCE } : m,
    );

  it('reports the 0 configured Railway placeholder as not measured, so nothing reads ok', async () => {
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z', withRailway(0))] });

    const result = await service.status(NOW);

    expect(result.metrics.find((m) => m.key === 'railwayMonthlyInr')).toMatchObject({
      value: 0,
      unit: 'INR/month',
      source: 'Canonical configured Railway estimate',
      freshness: 'fresh',
      status: 'unknown',
      statusReason: 'not_measured',
      estimate: false,
    });
    expect(result.overallStatus).toBe('unknown');
    expect(result.counts).toEqual({ ok: 9, warning: 0, critical: 0, unknown: 1 });
  });

  it('bands a non-zero configured estimate but flags it as an estimate', async () => {
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z', withRailway(16000))] });

    const result = await service.status(NOW);

    expect(result.metrics.find((m) => m.key === 'railwayMonthlyInr')).toMatchObject({
      value: 16000,
      status: 'warning',
      statusReason: null,
      estimate: true,
    });
    expect(result.metrics.filter((m) => m.estimate).map((m) => m.key)).toEqual(['railwayMonthlyInr']);
    expect(result.overallStatus).toBe('warning');
  });

  it('matches the source string the collector actually writes', () => {
    expect(CONFIGURED_ESTIMATE_SOURCE).toBe('Canonical configured Railway estimate');
  });

  it('ranks overall status critical, warning, unknown, ok', () => {
    expect(overallStatus(['ok', 'ok'])).toBe('ok');
    expect(overallStatus(['ok', 'unknown'])).toBe('unknown');
    expect(overallStatus(['unknown', 'warning'])).toBe('warning');
    expect(overallStatus(['warning', 'critical', 'unknown'])).toBe('critical');
    expect(overallStatus([])).toBe('unknown');
  });
});

describe('OperationsDashboardService.list', () => {
  it('orders critical before warning, then by most recent observation', async () => {
    const { service } = setup({
      alerts: [
        alert({ id: 'w-new', severity: 'warning', lastObservedAt: new Date('2026-10-09T12:00:00Z') }),
        alert({ id: 'c-old', severity: 'critical', lastObservedAt: new Date('2026-10-09T08:00:00Z') }),
        alert({ id: 'w-old', severity: 'warning', lastObservedAt: new Date('2026-10-09T09:00:00Z') }),
        alert({ id: 'c-new', severity: 'critical', lastObservedAt: new Date('2026-10-09T11:00:00Z') }),
        alert({
          id: 'c-new-later-open',
          severity: 'critical',
          lastObservedAt: new Date('2026-10-09T11:00:00Z'),
          firstObservedAt: new Date('2026-10-09T11:00:00Z'),
        }),
      ],
    });

    const result = await service.list();

    expect(result.data.map((a) => a.id)).toEqual(['c-new-later-open', 'c-new', 'c-old', 'w-new', 'w-old']);
    expect(result.total).toBe(5);
  });

  it('filters active alerts to open and acknowledged', async () => {
    const { service, alerts } = setup();
    await service.list('active');
    expect(alerts.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: In(['open', 'acknowledged']) } }),
    );
  });

  it('returns delivery state redacted to contract fields, never addresses or secrets', async () => {
    const canaryEmail = 'canary.ops+leak@example-secret.test';
    const canaryBearer = 'tok_CANARY_8f3a91c2d7';
    const stored = {
      version: 1,
      notifiedSeverity: 'critical',
      lastReminderAt: '2026-10-09T11:00:00.000Z',
      recipients: [canaryEmail],
      smtpPassword: canaryBearer,
      lastAttempt: {
        event: 'opened',
        at: '2026-10-09T10:00:05.000Z',
        correlationId: canaryEmail,
        severity: 'critical',
        to: canaryEmail,
        portal: { status: 'delivered', at: '2026-10-09T10:00:05.000Z', recipients: 2, error: null, userIds: [canaryBearer] },
        email: {
          status: 'simulated',
          at: '2026-10-09T10:00:06.000Z',
          recipients: 1,
          provider: `smtp://${canaryEmail}:${canaryBearer}@mail`,
          error: `auth failed for ${canaryEmail} ${canaryBearer}`,
          address: canaryEmail,
        },
        audit: { status: 'recorded', at: '2026-10-09T10:00:06.000Z', error: null, token: canaryBearer },
      },
      history: [
        {
          event: 'opened',
          at: '2026-10-09T10:00:05.000Z',
          correlationId: 'req-123',
          severity: 'critical',
          portal: { status: 'delivered', at: '2026-10-09T10:00:05.000Z', recipients: 2, error: null },
          email: { status: 'failed', at: null, recipients: 1, provider: 'log', error: 'mail_delivery_failed' },
          audit: { status: 'recorded', at: '2026-10-09T10:00:06.000Z', error: null },
          secret: canaryBearer,
        },
      ],
    };
    const { service } = setup({
      alerts: [alert({ deliveryMetadata: stored, lastNotifiedAt: new Date('2026-10-09T10:00:06Z') })],
    });

    const result = await service.list();
    const body = JSON.stringify(result);

    expect(body).not.toContain(canaryEmail);
    expect(body).not.toContain(canaryBearer);
    expect(body).not.toContain('example-secret');
    expect(result.data[0].delivery).toEqual({
      recorded: true,
      notifiedSeverity: 'critical',
      lastReminderAt: '2026-10-09T11:00:00.000Z',
      lastNotifiedAt: '2026-10-09T10:00:06.000Z',
      lastAttempt: {
        event: 'opened',
        at: '2026-10-09T10:00:05.000Z',
        correlationId: null,
        severity: 'critical',
        portal: { status: 'delivered', at: '2026-10-09T10:00:05.000Z', recipients: 2, error: null },
        email: { status: 'simulated', at: '2026-10-09T10:00:06.000Z', recipients: 1, provider: null, error: null },
        audit: { status: 'recorded', at: '2026-10-09T10:00:06.000Z', error: null },
      },
      history: [
        {
          event: 'opened',
          at: '2026-10-09T10:00:05.000Z',
          correlationId: 'req-123',
          severity: 'critical',
          portal: { status: 'delivered', at: '2026-10-09T10:00:05.000Z', recipients: 2, error: null },
          email: { status: 'failed', at: null, recipients: 1, provider: 'log', error: 'mail_delivery_failed' },
          audit: { status: 'recorded', at: '2026-10-09T10:00:06.000Z', error: null },
        },
      ],
    });
  });

  it('tolerates the empty delivery metadata OPS-002 rows hold', async () => {
    const { service } = setup({ alerts: [alert({ deliveryMetadata: {} })] });
    const [row] = (await service.list()).data;
    expect(row.delivery).toEqual({
      recorded: false,
      notifiedSeverity: null,
      lastReminderAt: null,
      lastNotifiedAt: null,
      lastAttempt: null,
      history: [],
    });
  });
});

describe('OperationsDashboardService.acknowledge', () => {
  const ID = 'a0000000-0000-4000-8000-000000000001';
  const ACTOR = 'b0000000-0000-4000-8000-000000000002';
  const OTHER = 'c0000000-0000-4000-8000-000000000003';

  it('stores the exact actor and time once, and audits only the first acknowledgement', async () => {
    const { service, delivery } = setup({ alerts: [alert({ id: ID })] });
    const first = new Date('2026-10-09T12:05:00.000Z');

    const one = await service.acknowledge(ID, ACTOR, first);
    expect(one.changed).toBe(true);
    expect(one.alert).toMatchObject({
      status: 'acknowledged',
      acknowledgedAt: '2026-10-09T12:05:00.000Z',
      acknowledgedBy: ACTOR,
    });
    expect(delivery.recordAcknowledged).toHaveBeenCalledTimes(1);
    expect(delivery.recordAcknowledged).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID, acknowledgedBy: ACTOR, acknowledgedAt: first }),
      ACTOR,
      expect.any(String),
    );

    const two = await service.acknowledge(ID, OTHER, new Date('2026-10-09T12:09:00.000Z'));
    expect(two.changed).toBe(false);
    expect(two.alert).toMatchObject({ acknowledgedAt: '2026-10-09T12:05:00.000Z', acknowledgedBy: ACTOR });
    expect(delivery.recordAcknowledged).toHaveBeenCalledTimes(1);
  });

  it('only updates an open, unacknowledged row', async () => {
    const { service, update } = setup({ alerts: [alert({ id: ID })] });
    await service.acknowledge(ID, ACTOR, NOW);
    expect(update.where).toHaveBeenCalledWith('id = :id', { id: ID });
    expect(update.andWhere).toHaveBeenCalledWith('status = :open', { open: 'open' });
    expect(update.andWhere).toHaveBeenCalledWith('"acknowledgedAt" IS NULL');
  });

  it('returns 404 for an unknown alert', async () => {
    const { service, delivery } = setup();
    await expect(service.acknowledge(ID, ACTOR, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(delivery.recordAcknowledged).not.toHaveBeenCalled();
  });

  it('refuses a resolved alert nobody acknowledged with a conflict', async () => {
    const { service, delivery } = setup({
      alerts: [alert({ id: ID, status: 'resolved', resolvedAt: new Date('2026-10-09T12:00:00Z') })],
    });
    await expect(service.acknowledge(ID, ACTOR, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(delivery.recordAcknowledged).not.toHaveBeenCalled();
  });

  it('returns the stored acknowledgement of an alert that has since resolved', async () => {
    const ackAt = new Date('2026-10-09T11:00:00Z');
    const { service, delivery } = setup({
      alerts: [alert({ id: ID, status: 'resolved', acknowledgedAt: ackAt, acknowledgedBy: ACTOR })],
    });
    const result = await service.acknowledge(ID, OTHER, NOW);
    expect(result).toMatchObject({ changed: false, alert: { acknowledgedBy: ACTOR, acknowledgedAt: ackAt.toISOString() } });
    expect(delivery.recordAcknowledged).not.toHaveBeenCalled();
  });

  it('keeps a committed acknowledgement when recording it fails', async () => {
    const { service, delivery } = setup({ alerts: [alert({ id: ID })] });
    delivery.recordAcknowledged.mockRejectedValueOnce(new Error('audit down'));
    const result = await service.acknowledge(ID, ACTOR, NOW);
    expect(result).toMatchObject({ changed: true, alert: { acknowledgedBy: ACTOR } });
  });
});

describe('OperationsDashboardService.readiness', () => {
  it('reports configured gates, unknown revenue and every unmet prerequisite', async () => {
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z')] });

    const result = await service.readiness(NOW);

    expect(result.available).toBe(false);
    expect(result.migration).toEqual({
      enabled: false,
      executor: 'mock',
      dryRun: true,
      readOnlyWindowMinutes: 15,
      railwayRetentionHours: 72,
    });
    expect(result.revenue).toMatchObject({
      currency: 'INR',
      minimumMonthlyNetInr: 1200000,
      preferredMonthlyNetInr: 1500000,
      measuredMonthlyNetInr: null,
      status: 'unknown',
      source: null,
    });
    expect(result.unmet).toEqual([
      'auth_step_up',
      'migration_control_plane',
      'migration_enabled',
      'real_executor',
      'dry_run_disabled',
      'executor_gates',
      'revenue_target',
    ]);
    expect(result.prerequisites.find((p) => p.id === 'capacity_telemetry')!.status).toBe('met');
    expect(result.prerequisites.find((p) => p.id === 'revenue_target')!.status).toBe('unknown');
    expect(result.prerequisites.find((p) => p.id === 'auth_step_up')!.owner).toBe('AUTH-001');
    expect(result.prerequisites.find((p) => p.id === 'migration_control_plane')!.owner).toBe('MIG-001');
  });

  it('counts an unmeasured cost placeholder as unmet capacity telemetry', async () => {
    const metrics = healthyMetrics().map((m) =>
      m.key === 'railwayMonthlyInr' ? { ...m, value: 0, source: CONFIGURED_ESTIMATE_SOURCE } : m,
    );
    const { service } = setup({ snapshots: [snapshot('2026-10-09T12:00:00Z', metrics)] });
    const result = await service.readiness(NOW);
    expect(result.capacity).toEqual({ overallStatus: 'unknown', unknownMetrics: 1 });
    expect(result.prerequisites.find((p) => p.id === 'capacity_telemetry')).toMatchObject({
      status: 'unmet',
      detail: '1 of 10 capacity metrics are unknown (missing, stale or not measured).',
    });
    expect(result.unmet).toContain('capacity_telemetry');
  });

  it('lists capacity telemetry as unmet while any metric is unknown', async () => {
    const { service } = setup();
    const result = await service.readiness(NOW);
    expect(result.capacity).toEqual({ overallStatus: 'unknown', unknownMetrics: 10 });
    expect(result.unmet).toContain('capacity_telemetry');
    expect(result.available).toBe(false);
  });
});

describe('compareAlerts', () => {
  it('is a total order', () => {
    const a = alert({ id: 'a' });
    const b = alert({ id: 'b' });
    expect(compareAlerts(a, b)).toBeLessThan(0);
    expect(compareAlerts(b, a)).toBeGreaterThan(0);
    expect(compareAlerts(a, a)).toBe(0);
  });
});
