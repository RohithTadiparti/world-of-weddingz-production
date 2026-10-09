import { CapacityScheduler } from './capacity.scheduler';

describe('CapacityScheduler', () => {
  it('lets one replica own an hourly period', async () => {
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
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({ opened: [], promoted: [], resolved: [], unchanged: [] }),
    };
    const first = new CapacityScheduler(locks as never, collector as never, evaluator as never);
    const second = new CapacityScheduler(locks as never, collector as never, evaluator as never);

    await Promise.all([first.collect(), second.collect()]);

    expect(locks.runExclusive).toHaveBeenCalledTimes(2);
    expect(locks.runExclusive).toHaveBeenCalledWith('operations:capacity-hourly', expect.any(Function));
    expect(collector.collect).toHaveBeenCalledTimes(1);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
  });
});
