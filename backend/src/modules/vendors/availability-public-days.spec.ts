import { AvailabilityService } from './availability.service';
import { ProviderType, SlotStatus } from '../../common/enums';
import type { VendorAvailabilitySlot } from './entities/vendor-availability-slot.entity';

/**
 * The public calendar a couple reads on a planner's profile: one word per day,
 * and nothing of the owner's private counts or reasons.
 */
describe('AvailabilityService.publicDays', () => {
  const slot = (date: string, over: Partial<VendorAvailabilitySlot> = {}) =>
    ({
      id: `${date}-${Math.random()}`,
      providerId: 'p1',
      providerType: ProviderType.PLANNER,
      vendorServiceId: null,
      date,
      startTime: '09:00',
      endTime: '18:00',
      capacity: 2,
      confirmed: 0,
      pending: 0,
      status: SlotStatus.AVAILABLE,
      note: 'private',
      blockReason: null,
      ...over,
    }) as VendorAvailabilitySlot;

  function serviceWith(rows: VendorAvailabilitySlot[]) {
    const repo = { find: jest.fn().mockResolvedValue(rows) };
    return new AvailabilityService(repo as never, {} as never, {} as never, {} as never);
  }

  it('reads each published day as available, limited, booked or not available', async () => {
    const days = await serviceWith([
      slot('2026-12-01'),
      slot('2026-12-02', { confirmed: 1 }),
      slot('2026-12-03', { pending: 1 }),
      slot('2026-12-04', { confirmed: 2 }),
      slot('2026-12-05', { status: SlotStatus.BLOCKED, blockReason: 'family' }),
      slot('2026-12-06', { status: SlotStatus.CANCELLED }),
    ]).publicDays(ProviderType.PLANNER, 'p1', '2026-12-01', '2026-12-31');

    expect(days).toEqual([
      { date: '2026-12-01', status: 'available', openings: 2 },
      { date: '2026-12-02', status: 'limited', openings: 1 },
      { date: '2026-12-03', status: 'limited', openings: 2 },
      { date: '2026-12-04', status: 'booked', openings: 0 },
      { date: '2026-12-05', status: 'unavailable', openings: 0 },
    ]);
  });

  it('calls a day with one full window and one open window limited', async () => {
    const days = await serviceWith([
      slot('2026-12-10', { confirmed: 2 }),
      slot('2026-12-10', { startTime: '19:00', endTime: '23:00' }),
    ]).publicDays(ProviderType.PLANNER, 'p1');

    expect(days).toEqual([{ date: '2026-12-10', status: 'limited', openings: 2 }]);
  });
});
