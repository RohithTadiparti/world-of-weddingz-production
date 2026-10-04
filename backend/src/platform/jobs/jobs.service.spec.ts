import { JobsService } from './jobs.service';

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
