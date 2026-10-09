import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { errorType } from '../../../common/logging/log-redaction';
import { runWithRequestId } from '../../../common/logging/request-context';
import { ReplicaLockService } from '../../../platform/locks/replica-lock.service';
import { AlertDeliveryService } from '../alerts/alert-delivery.service';
import { OPERATIONAL_ALERT_LOG_EVENTS } from '../alerts/alert-delivery.types';
import { AlertEvaluator } from '../alerts/alert-evaluator';
import { CapacityCollector } from './capacity.collector';

@Injectable()
export class CapacityScheduler {
  private readonly logger = new Logger(CapacityScheduler.name);

  constructor(
    private readonly locks: ReplicaLockService,
    private readonly collector: CapacityCollector,
    private readonly evaluator: AlertEvaluator,
    private readonly delivery: AlertDeliveryService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async collect(): Promise<void> {
    await this.locks.runExclusive('operations:capacity-hourly', async () => {
      const snapshot = await this.collector.collect(new Date());
      const result = await this.evaluator.evaluate(snapshot);
      this.logger.log({ event: 'capacity_evaluated', snapshotId: snapshot.id, ...result });

      // Delivery runs inside the same replica lock, so one replica owns the
      // period's notifications. One correlation id spans the run's portal,
      // email, audit and log entries.
      const correlationId = randomUUID();
      try {
        await runWithRequestId(correlationId, () => this.delivery.deliverEvaluation(result));
      } catch (err) {
        this.logger.error({
          event: OPERATIONAL_ALERT_LOG_EVENTS.deliveryFailed,
          stage: 'evaluation',
          snapshotId: snapshot.id,
          correlationId,
          errorType: errorType(err),
        });
      }
    });
  }
}
