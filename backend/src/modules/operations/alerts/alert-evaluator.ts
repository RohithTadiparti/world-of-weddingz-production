import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import { AppConfigService } from '../../../config/app-config.service';
import { AlertEvaluationResult, CapacityMetric, CapacityMetricKey } from '../capacity/capacity.types';
import { CapacitySnapshot } from '../entities/capacity-snapshot.entity';
import { OperationalAlert, OperationalAlertSeverity } from '../entities/operational-alert.entity';

const PERFORMANCE = new Set<CapacityMetricKey>([
  'p95LatencyMs',
  'errorRatePercent',
  'cpuPercent',
  'memoryPercent',
]);

@Injectable()
export class AlertEvaluator {
  constructor(
    private readonly config: AppConfigService,
    @InjectRepository(CapacitySnapshot)
    private readonly snapshots: Repository<CapacitySnapshot>,
    @InjectRepository(OperationalAlert)
    private readonly alerts: Repository<OperationalAlert>,
  ) {}

  async evaluate(snapshot: CapacitySnapshot): Promise<AlertEvaluationResult> {
    const result: AlertEvaluationResult = { opened: [], promoted: [], resolved: [], unchanged: [] };
    const previous = await this.snapshots.findOne({
      where: { periodStart: LessThan(snapshot.periodStart), id: Not(snapshot.id) },
      order: { periodStart: 'DESC' },
    });
    for (const current of snapshot.metrics) {
      const fingerprint = `capacity:${current.key}`;
      const existing = await this.alerts.findOne({ where: { fingerprint } });
      const severity = this.confirmedSeverity(current, previous);
      if (!severity) {
        if (existing && existing.status !== 'resolved') {
          existing.status = 'resolved';
          existing.resolvedAt = snapshot.periodStart;
          existing.lastObservedAt = snapshot.periodStart;
          await this.alerts.save(existing);
          result.resolved.push(existing.id);
        } else result.unchanged.push(fingerprint);
        continue;
      }
      const threshold = this.config.operations.thresholds[current.key][severity];
      if (!existing || existing.status === 'resolved') {
        const alert = existing ?? this.alerts.create({ fingerprint });
        Object.assign(alert, {
          metric: current.key,
          severity,
          status: 'open',
          observedValue: current.value,
          thresholdValue: threshold,
          unit: current.unit,
          source: current.source,
          firstObservedAt: snapshot.periodStart,
          lastObservedAt: snapshot.periodStart,
          acknowledgedAt: null,
          acknowledgedBy: null,
          resolvedAt: null,
          lastNotifiedAt: null,
          deliveryMetadata: {},
        });
        result.opened.push((await this.alerts.save(alert)).id);
        continue;
      }
      const promoted = existing.severity === 'warning' && severity === 'critical';
      existing.severity = promoted ? 'critical' : existing.severity;
      existing.observedValue = current.value;
      existing.thresholdValue = this.config.operations.thresholds[current.key][existing.severity];
      existing.unit = current.unit;
      existing.source = current.source;
      existing.lastObservedAt = snapshot.periodStart;
      await this.alerts.save(existing);
      (promoted ? result.promoted : result.unchanged).push(existing.id);
    }
    return result;
  }

  private confirmedSeverity(current: CapacityMetric, previous?: CapacitySnapshot | null): OperationalAlertSeverity | null {
    const threshold = this.config.operations.thresholds[current.key];
    const level = (value: number): OperationalAlertSeverity | null =>
      value >= threshold.critical ? 'critical' : value >= threshold.warning ? 'warning' : null;
    const currentLevel = level(current.value);
    if (!currentLevel) return null;
    if (PERFORMANCE.has(current.key)) {
      return (current.windowMinutes ?? 0) >= this.config.operations.sustainedPerformanceMinutes
        ? currentLevel
        : null;
    }
    const previousMetric = previous?.metrics.find((item) => item.key === current.key);
    if (!previousMetric) return null;
    if (currentLevel === 'critical' && previousMetric.value >= threshold.critical) return 'critical';
    return previousMetric.value >= threshold.warning ? 'warning' : null;
  }
}
