import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { CreateSlotDto, UpdateSlotDto } from './dto/availability.dto';
import { MAX_SLOT_CAPACITY, defaultSlotCapacity, slotCapacityProblem } from './slot-rules';
import { ProviderType, SlotStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const owner: AuthUser = {
  userId: 'owner',
  email: 'owner@example.com',
  role: UserRole.VENDOR,
  managedByAgentId: null,
};

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('slot capacity rules', () => {
  it('allows 1 to 20 bookings per window', () => {
    expect(MAX_SLOT_CAPACITY).toBe(20);
    expect(slotCapacityProblem(1)).toBeNull();
    expect(slotCapacityProblem(20)).toBeNull();
    expect(slotCapacityProblem(21)).toBe('A window can take at most 20 bookings');
    expect(slotCapacityProblem(0)).toBe('A window must take at least 1 booking');
    expect(slotCapacityProblem(-3)).toBe('A window must take at least 1 booking');
    expect(slotCapacityProblem(2.5)).toBe('Capacity must be a whole number of bookings');
  });

  it('caps a service default above the ceiling rather than refusing it', () => {
    expect(defaultSlotCapacity(undefined)).toBe(1);
    expect(defaultSlotCapacity(5)).toBe(5);
    expect(defaultSlotCapacity(50)).toBe(20);
    expect(defaultSlotCapacity(0)).toBe(1);
  });

  it.each([
    [CreateSlotDto, { date: '2026-12-01', startTime: '09:00', endTime: '13:00', capacity: 21 }],
    [CreateSlotDto, { date: '2026-12-01', startTime: '09:00', endTime: '13:00', capacity: 0 }],
    [UpdateSlotDto, { capacity: 21 }],
    [UpdateSlotDto, { capacity: 0 }],
  ])('the %p validator refuses %j', (cls, body) => {
    const errors = validateSync(plainToInstance(cls as never, body) as object);
    expect(errors.map((e) => e.property)).toContain('capacity');
  });

  it('the validators accept 20', () => {
    expect(validateSync(plainToInstance(UpdateSlotDto, { capacity: 20 }))).toEqual([]);
  });
});

describe('publishing a vendor window', () => {
  let saved: Record<string, unknown> | null;
  let services: Record<string, { id: string; vendorId: string; active: boolean; concurrentCapacity: number }>;
  let activeCount: number;
  let existing: Record<string, unknown> | null;
  let service: AvailabilityService;

  beforeEach(() => {
    saved = null;
    existing = null;
    activeCount = 2;
    services = {
      s1: { id: 's1', vendorId: 'v1', active: true, concurrentCapacity: 3 },
      big: { id: 'big', vendorId: 'v1', active: true, concurrentCapacity: 50 },
      off: { id: 'off', vendorId: 'v1', active: false, concurrentCapacity: 1 },
      other: { id: 'other', vendorId: 'v2', active: true, concurrentCapacity: 1 },
    };
    const slots = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => existing),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => {
        saved = { id: 'slot-1', ...row };
        return saved;
      }),
    };
    const vendors = {
      findOne: jest.fn(async () => ({ id: 'v1', ownerUserId: 'owner', isApproved: true })),
    };
    const catalog = {
      findService: jest.fn(async (id: string) => services[id] ?? null),
      countActiveServices: jest.fn(async () => activeCount),
    };
    service = new AvailabilityService(slots as never, vendors as never, {} as never, catalog as never);
  });

  const publish = (body: Partial<CreateSlotDto>) =>
    service.create(owner, ProviderType.VENDOR, 'v1', {
      date: tomorrow(),
      startTime: '09:00',
      endTime: '13:00',
      ...body,
    } as CreateSlotDto);

  it('requires a service when the business has services', async () => {
    await expect(publish({})).rejects.toThrow('Choose the service this window is for');
    expect(saved).toBeNull();
  });

  it('allows no service for a business that has none on sale', async () => {
    activeCount = 0;
    const view = await publish({});
    expect(view.vendorServiceId).toBeNull();
  });

  it('records the chosen service', async () => {
    const view = await publish({ vendorServiceId: 's1' });
    expect(view.vendorServiceId).toBe('s1');
    expect(view.capacity).toBe(3);
  });

  it('refuses a service of another business, or one switched off', async () => {
    await expect(publish({ vendorServiceId: 'other' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(publish({ vendorServiceId: 'off' })).rejects.toThrow('switched off');
  });

  it('refuses more than 20 bookings, and fewer than 1', async () => {
    await expect(publish({ vendorServiceId: 's1', capacity: 21 })).rejects.toThrow(
      'A window can take at most 20 bookings',
    );
    await expect(publish({ vendorServiceId: 's1', capacity: 0 })).rejects.toThrow(
      'A window must take at least 1 booking',
    );
    expect((await publish({ vendorServiceId: 's1', capacity: 20 })).capacity).toBe(20);
  });

  it('caps a service default above 20 at 20', async () => {
    expect((await publish({ vendorServiceId: 'big' })).capacity).toBe(20);
  });

  it('refuses raising an existing window above 20', async () => {
    existing = {
      id: 'slot-9',
      providerId: 'v1',
      vendorServiceId: 's1',
      date: tomorrow(),
      startTime: '09:00:00',
      endTime: '13:00:00',
      capacity: 5,
      confirmed: 0,
      pending: 0,
      status: SlotStatus.AVAILABLE,
    };
    await expect(
      service.update(owner, ProviderType.VENDOR, 'v1', 'slot-9', { capacity: 25 }),
    ).rejects.toThrow('A window can take at most 20 bookings');
  });

  it('leaves an older window above 20 editable when its capacity is not touched', async () => {
    existing = {
      id: 'slot-9',
      providerId: 'v1',
      vendorServiceId: 's1',
      date: tomorrow(),
      startTime: '09:00:00',
      endTime: '13:00:00',
      capacity: 40,
      confirmed: 0,
      pending: 0,
      status: SlotStatus.AVAILABLE,
    };
    const view = await service.update(owner, ProviderType.VENDOR, 'v1', 'slot-9', {
      note: 'Morning sitting',
    });
    expect(view.capacity).toBe(40);
  });
});
