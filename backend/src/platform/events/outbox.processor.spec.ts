import { EventBus } from './event-bus.service';
import { OutboxProcessor } from './outbox.processor';
import { OutboxService } from './outbox.service';
import { KafkaService } from '../messaging/kafka.service';
import { ReplicaLockService } from '../locks/replica-lock.service';

describe('OutboxProcessor replica safety', () => {
  const row = {
    id: '4f5723a7-d4ba-46a7-a761-21ee548dc4c3',
    eventType: 'booking.requested',
    aggregateType: 'booking',
    payload: { bookingId: 'booking-1' },
  };

  it('does not read or publish when another replica owns the dispatcher', async () => {
    const outbox = { findUnprocessed: jest.fn() } as unknown as OutboxService;
    const bus = { publish: jest.fn() } as unknown as EventBus;
    const kafka = { publish: jest.fn() } as unknown as KafkaService;
    const locks = {
      runExclusive: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReplicaLockService;

    await new OutboxProcessor(outbox, bus, kafka, locks).processOnce();

    expect(locks.runExclusive).toHaveBeenCalledWith('outbox:dispatch', expect.any(Function));
    expect(outbox.findUnprocessed).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('publishes under the lock with a retry-stable idempotency key', async () => {
    const outbox = {
      findUnprocessed: jest.fn().mockResolvedValue([row]),
      markProcessed: jest.fn(),
    } as unknown as OutboxService;
    const bus = { publish: jest.fn() } as unknown as EventBus;
    const kafka = { publish: jest.fn() } as unknown as KafkaService;
    const locks = {
      runExclusive: jest.fn(async (_name: string, work: () => Promise<void>) => work()),
    } as unknown as ReplicaLockService;

    await new OutboxProcessor(outbox, bus, kafka, locks).processOnce();

    const delivered = {
      idempotencyKey: row.id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      payload: row.payload,
    };
    expect(bus.publish).toHaveBeenCalledWith(delivered);
    expect(kafka.publish).toHaveBeenCalledWith(delivered);
    expect(outbox.markProcessed).toHaveBeenCalledWith(row.id);
  });
});
