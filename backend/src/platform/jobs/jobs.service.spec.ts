import { JobsService } from './jobs.service';

class SharedTestLock {
  private readonly active = new Set<string>();

  async runExclusive<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
    if (this.active.has(name)) return undefined;
    this.active.add(name);
    try {
      return await work();
    } finally {
      this.active.delete(name);
    }
  }
}

describe('JobsService replica serialization', () => {
  const deferred = () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  const services = (overrides: { bookings?: object; bookingsService?: object }) => {
    const locks = new SharedTestLock();
    const make = () =>
      new JobsService(
        {} as never,
        {} as never,
        {} as never,
        (overrides.bookings ?? {}) as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        (overrides.bookingsService ?? {}) as never,
        locks as never,
      );
    return [make(), make()];
  };

  it('lets only one replica execute the payout sweep', async () => {
    const gate = deferred();
    const retryPendingPayouts = jest.fn(async () => {
      await gate.promise;
      return { attempted: 0, released: 0 };
    });
    const [first, second] = services({ bookingsService: { retryPendingPayouts } });

    const running = first.settlePendingPayouts();
    await Promise.resolve();
    await second.settlePendingPayouts();
    gate.resolve(undefined);
    await running;

    expect(retryPendingPayouts).toHaveBeenCalledTimes(1);
  });

  it('lets only one replica scan notification reminders', async () => {
    const gate = deferred();
    const find = jest.fn(async () => {
      await gate.promise;
      return [];
    });
    const [first, second] = services({ bookings: { find } });

    const running = first.remindUnpaidMilestones();
    await Promise.resolve();
    await second.remindUnpaidMilestones();
    gate.resolve(undefined);
    await running;

    expect(find).toHaveBeenCalledTimes(1);
  });
});

describe('JobsService audit observability', () => {
  it('records a payout sweep without putting text in the UUID resource id', async () => {
    const record = jest.fn();
    const service = new JobsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { record } as never,
      {} as never,
      { retryPendingPayouts: jest.fn().mockResolvedValue({ attempted: 3, released: 1 }) } as never,
      { runExclusive: async (_name: string, work: () => Promise<unknown>) => work() } as never,
    );

    await service.settlePendingPayouts();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: null,
        metadata: { source: 'payout-sweep', attempted: 3, released: 1, stillOwed: 2 },
      }),
    );
  });
});
