import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReplicaLockService } from '../../../platform/locks/replica-lock.service';
import { AlertEvaluator } from '../alerts/alert-evaluator';
import { CapacityCollector } from './capacity.collector';

@Injectable()
export class CapacityScheduler {
  private readonly logger = new Logger(CapacityScheduler.name);

  constructor(
    private readonly locks: ReplicaLockService,
    private readonly collector: CapacityCollector,
    private readonly evaluator: AlertEvaluator,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async collect(): Promise<void> {
    await this.locks.runExclusive('operations:capacity-hourly', async () => {
      const snapshot = await this.collector.collect(new Date());
      const result = await this.evaluator.evaluate(snapshot);
      this.logger.log({ event: 'capacity_evaluated', snapshotId: snapshot.id, ...result });
    });
  }
}
