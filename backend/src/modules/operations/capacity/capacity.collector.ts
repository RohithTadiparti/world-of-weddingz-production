import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { AppConfigService } from '../../../config/app-config.service';
import { CapacitySnapshot } from '../entities/capacity-snapshot.entity';
import {
  CapacityMetric,
  METRIC_UNITS,
  RUNTIME_CAPACITY_PROVIDER,
  RuntimeCapacityProvider,
} from './capacity.types';

@Injectable()
export class CapacityCollector {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    @InjectRepository(CapacitySnapshot)
    private readonly snapshots: Repository<CapacitySnapshot>,
    @Inject(RUNTIME_CAPACITY_PROVIDER)
    private readonly runtime: RuntimeCapacityProvider,
  ) {}

  async collect(at: Date): Promise<CapacitySnapshot> {
    const periodStart = new Date(at);
    periodStart.setUTCMinutes(0, 0, 0);
    const existing = await this.snapshots.findOne({ where: { periodStart } });
    if (existing) return existing;

    const [[accountRow], [databaseRow], runtime] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*)::int AS value FROM users') as Promise<Array<{ value: number }>>,
      this.dataSource.query(
        'SELECT pg_database_size(current_database())::bigint AS value',
      ) as Promise<Array<{ value: string }>>,
      this.runtime.read(at),
    ]);
    const metric = (
      key: CapacityMetric['key'],
      value: number,
      source: string,
      windowMinutes?: number,
    ): CapacityMetric => ({ key, value, unit: METRIC_UNITS[key], source, ...(windowMinutes ? { windowMinutes } : {}) });
    const runtimeSource = 'Redis request telemetry';
    const metrics: CapacityMetric[] = [
      metric('accounts', Number(accountRow?.value ?? 0), 'PostgreSQL users count'),
      metric('dailyActiveUsers', runtime.dailyActiveUsers, runtimeSource, 24 * 60),
      metric('requestsPerDay', runtime.requestsPerDay, runtimeSource, 24 * 60),
      metric('concurrentUsers', runtime.concurrentUsers, 'Redis active request actors'),
      metric('databaseGigabytes', Number(databaseRow?.value ?? 0) / 1024 ** 3, 'PostgreSQL pg_database_size'),
      metric('p95LatencyMs', runtime.p95LatencyMs, runtimeSource, runtime.windowMinutes),
      metric('errorRatePercent', runtime.errorRatePercent, runtimeSource, runtime.windowMinutes),
      metric('cpuPercent', runtime.cpuPercent, 'Node.js process usage', runtime.windowMinutes),
      metric('memoryPercent', runtime.memoryPercent, 'Node.js RSS / host memory', runtime.windowMinutes),
      metric(
        'railwayMonthlyInr',
        this.config.operations.measurements.railwayMonthlyInr,
        'Canonical configured Railway estimate',
      ),
    ];
    try {
      return await this.snapshots.save(this.snapshots.create({ periodStart, metrics }));
    } catch (error) {
      const winner = await this.snapshots.findOne({ where: { periodStart: LessThan(new Date(periodStart.getTime() + 1)) } });
      if (winner?.periodStart.getTime() === periodStart.getTime()) return winner;
      throw error;
    }
  }
}
