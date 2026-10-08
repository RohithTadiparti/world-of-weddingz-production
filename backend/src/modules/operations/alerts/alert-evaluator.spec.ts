import { AppConfigService } from '../../../config/app-config.service';
import { CapacityMetric, CapacityMetricKey } from '../capacity/capacity.types';
import { CapacitySnapshot } from '../entities/capacity-snapshot.entity';
import { OperationalAlert } from '../entities/operational-alert.entity';
import { AlertEvaluator } from './alert-evaluator';

const thresholds = {
  accounts: { warning: 5000, critical: 10000 },
  p95LatencyMs: { warning: 400, critical: 750 },
} as Record<CapacityMetricKey, { warning: number; critical: number }>;

const snapshot = (id: string, at: string, metric: CapacityMetric): CapacitySnapshot =>
  ({ id, periodStart: new Date(at), metrics: [metric] }) as CapacitySnapshot;

describe('AlertEvaluator', () => {
  const config = {
    operations: { thresholds, sustainedPerformanceMinutes: 15 },
  } as AppConfigService;

  it('opens a stable critical fingerprint after two consecutive hourly breaches', async () => {
    const previous = snapshot('previous', '2026-10-09T11:00:00Z', {
      key: 'accounts', value: 10001, unit: 'count', source: 'db',
    });
    const current = snapshot('current', '2026-10-09T12:00:00Z', {
      key: 'accounts', value: 10002, unit: 'count', source: 'db',
    });
    const snapshots = { findOne: jest.fn().mockResolvedValue(previous) };
    const alerts = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve({ ...value, id: 'alert-1' })),
    };

    const result = await new AlertEvaluator(config, snapshots as never, alerts as never).evaluate(current);

    expect(result.opened).toEqual(['alert-1']);
    expect(alerts.save).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: 'capacity:accounts', severity: 'critical', thresholdValue: 10000,
    }));
  });

  it('does not open a count alert from one sample', async () => {
    const current = snapshot('current', '2026-10-09T12:00:00Z', {
      key: 'accounts', value: 10002, unit: 'count', source: 'db',
    });
    const alerts = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };
    const result = await new AlertEvaluator(
      config,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      alerts as never,
    ).evaluate(current);
    expect(result.opened).toEqual([]);
    expect(alerts.save).not.toHaveBeenCalled();
  });

  it('opens a sustained performance alert and promotes warning to critical', async () => {
    const current = snapshot('current', '2026-10-09T12:00:00Z', {
      key: 'p95LatencyMs', value: 900, unit: 'ms', source: 'redis', windowMinutes: 15,
    });
    const existing = {
      id: 'alert-1', fingerprint: 'capacity:p95LatencyMs', severity: 'warning', status: 'acknowledged',
    } as OperationalAlert;
    const alerts = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    const result = await new AlertEvaluator(
      config,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      alerts as never,
    ).evaluate(current);
    expect(result.promoted).toEqual(['alert-1']);
    expect(existing).toMatchObject({ severity: 'critical', status: 'acknowledged' });
  });

  it('automatically resolves an acknowledged alert when the metric recovers', async () => {
    const current = snapshot('current', '2026-10-09T12:00:00Z', {
      key: 'accounts', value: 4999, unit: 'count', source: 'db',
    });
    const existing = {
      id: 'alert-1', fingerprint: 'capacity:accounts', severity: 'warning', status: 'acknowledged',
    } as OperationalAlert;
    const alerts = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    const result = await new AlertEvaluator(
      config,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      alerts as never,
    ).evaluate(current);
    expect(result.resolved).toEqual(['alert-1']);
    expect(existing.status).toBe('resolved');
    expect(existing.resolvedAt).toEqual(current.periodStart);
  });
});
