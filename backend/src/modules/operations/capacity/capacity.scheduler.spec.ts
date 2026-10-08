import { Logger } from '@nestjs/common';
import { currentRequestId } from '../../../common/logging/request-context';
import { CapacityScheduler } from './capacity.scheduler';

describe('CapacityScheduler', () => {
  const evaluation = { opened: ['a-1'], promoted: [], resolved: [], unchanged: [] };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('lets one replica own an hourly period, including alert delivery', async () => {
    let owned = false;
    const locks = {
      runExclusive: jest.fn(async (_name: string, work: () => Promise<void>) => {
        if (owned) return undefined;
        owned = true;
        return work();
      }),
    };
    const collector = {
      collect: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
    };
    const evaluator = { evaluate: jest.fn().mockResolvedValue(evaluation) };
    const delivery = { deliverEvaluation: jest.fn().mockResolvedValue([]) };
    const first = new CapacityScheduler(
      locks as never,
      collector as never,
      evaluator as never,
      delivery as never,
    );
    const second = new CapacityScheduler(
      locks as never,
      collector as never,
      evaluator as never,
      delivery as never,
    );

    await Promise.all([first.collect(), second.collect()]);

    expect(locks.runExclusive).toHaveBeenCalledTimes(2);
    expect(locks.runExclusive).toHaveBeenCalledWith('operations:capacity-hourly', expect.any(Function));
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(delivery.deliverEvaluation).toHaveBeenCalledTimes(1);
    expect(delivery.deliverEvaluation).toHaveBeenCalledWith(evaluation);
  });

  it('delivers after evaluation under one generated correlation id', async () => {
    const order: string[] = [];
    let correlation: string | undefined;
    const locks = { runExclusive: jest.fn(async (_n: string, work: () => Promise<void>) => work()) };
    const evaluator = {
      evaluate: jest.fn(async () => {
        order.push('evaluate');
        return evaluation;
      }),
    };
    const delivery = {
      deliverEvaluation: jest.fn(async () => {
        order.push('deliver');
        correlation = currentRequestId();
        return [];
      }),
    };
    await new CapacityScheduler(
      locks as never,
      { collect: jest.fn().mockResolvedValue({ id: 's' }) } as never,
      evaluator as never,
      delivery as never,
    ).collect();

    expect(order).toEqual(['evaluate', 'deliver']);
    expect(correlation).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not let a delivery failure escape the scheduled job', async () => {
    const locks = { runExclusive: jest.fn(async (_n: string, work: () => Promise<void>) => work()) };
    const delivery = { deliverEvaluation: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(
      new CapacityScheduler(
        locks as never,
        { collect: jest.fn().mockResolvedValue({ id: 's' }) } as never,
        { evaluate: jest.fn().mockResolvedValue(evaluation) } as never,
        delivery as never,
      ).collect(),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'operational_alert.delivery_failed', errorType: 'Error' }),
    );
  });
});
