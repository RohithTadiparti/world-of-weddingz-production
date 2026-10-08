import { AppConfigService } from '../../../config/app-config.service';
import { CapacitySnapshot } from '../entities/capacity-snapshot.entity';
import { CapacityCollector } from './capacity.collector';
import { RuntimeCapacityProvider } from './capacity.types';

describe('CapacityCollector', () => {
  it('persists exact account, runtime, database-byte and projected-cost measurements', async () => {
    const dataSource = {
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('COUNT') ? [{ value: 4321 }] : [{ value: '5368709120' }]),
      ),
    };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve({ ...value, id: 'snapshot-1' })),
    };
    const runtime: RuntimeCapacityProvider = {
      read: jest.fn().mockResolvedValue({
        dailyActiveUsers: 321,
        requestsPerDay: 12345,
        concurrentUsers: 17,
        p95LatencyMs: 222,
        errorRatePercent: 0.25,
        cpuPercent: 44,
        memoryPercent: 55,
        windowMinutes: 15,
      }),
    };
    const config = {
      operations: { measurements: { railwayMonthlyInr: 9876 } },
    } as AppConfigService;
    const collector = new CapacityCollector(
      dataSource as never,
      config,
      snapshots as never,
      runtime,
    );

    const result = await collector.collect(new Date('2026-10-09T12:34:56Z'));

    expect(result.periodStart).toEqual(new Date('2026-10-09T12:00:00Z'));
    expect(Object.fromEntries(result.metrics.map((metric) => [metric.key, metric.value]))).toEqual({
      accounts: 4321,
      dailyActiveUsers: 321,
      requestsPerDay: 12345,
      concurrentUsers: 17,
      databaseGigabytes: 5,
      p95LatencyMs: 222,
      errorRatePercent: 0.25,
      cpuPercent: 44,
      memoryPercent: 55,
      railwayMonthlyInr: 9876,
    });
    expect(snapshots.save).toHaveBeenCalledTimes(1);
  });

  it('returns the existing hourly snapshot so two replicas cannot duplicate it', async () => {
    const existing = { id: 'winner' } as CapacitySnapshot;
    const snapshots = { findOne: jest.fn().mockResolvedValue(existing) };
    const collector = new CapacityCollector(
      { query: jest.fn() } as never,
      { operations: {} } as AppConfigService,
      snapshots as never,
      { read: jest.fn() } as never,
    );

    await expect(collector.collect(new Date('2026-10-09T12:10:00Z'))).resolves.toBe(existing);
  });
});
