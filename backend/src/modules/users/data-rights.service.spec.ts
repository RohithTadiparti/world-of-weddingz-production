import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataRightsService, OPEN_BOOKING_STATUSES } from './data-rights.service';
import { User } from '../auth/entities/user.entity';
import { BookingStatus, ProviderType, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const REFUSAL =
  'You have bookings still in progress. Settle or cancel them before deleting your account.';

interface BookingRow {
  userId: string;
  bookedByUserId: string;
  providerType: ProviderType;
  providerId: string;
  status: BookingStatus;
}

/** Evaluates the service's `where` (one object or a list of them) against rows. */
function matches(row: BookingRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const value = row[key as keyof BookingRow];
    // `In([...])` arrives as a FindOperator carrying its list in `_value`.
    const op = expected as { _type?: string; _value?: unknown[] };
    if (op && op._type === 'in') return (op._value ?? []).includes(value);
    return value === expected;
  });
}

describe('DataRightsService.erase', () => {
  const actor: AuthUser = {
    userId: 'user-1',
    email: 'someone@gmail.com',
    role: UserRole.BRIDE,
    managedByAgentId: null,
  };

  let bookings: BookingRow[];
  let ownedVendors: { id: string }[];
  let ownedPlanners: { id: string }[];
  let userUpdates: jest.Mock;
  let sessionUpdates: jest.Mock;
  let service: DataRightsService;

  const booking = (over: Partial<BookingRow>): BookingRow => ({
    userId: 'other-customer',
    bookedByUserId: 'other-customer',
    providerType: ProviderType.VENDOR,
    providerId: 'other-vendor',
    status: BookingStatus.REQUESTED,
    ...over,
  });

  beforeEach(async () => {
    bookings = [];
    ownedVendors = [];
    ownedPlanners = [];
    userUpdates = jest.fn();
    sessionUpdates = jest.fn();
    const passwordHash = await bcrypt.hash('Password123', 4);

    const repo = () => ({
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      delete: jest.fn(),
    });
    const users = { findOne: jest.fn(async () => ({ id: 'user-1', passwordHash })) };
    const bookingRepo = {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
        const clauses = Array.isArray(where) ? where : [where];
        return bookings.filter((b) => clauses.some((c) => matches(b, c))).length;
      }),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === User
          ? { update: userUpdates }
          : { update: sessionUpdates, delete: jest.fn() },
      ),
    };
    const dataSource = { transaction: jest.fn(async (work: (m: unknown) => unknown) => work(manager)) };

    service = new DataRightsService(
      repo() as never, // profiles
      users as never,
      repo() as never, // details
      repo() as never, // siblings
      repo() as never, // assets
      repo() as never, // consents
      repo() as never, // shares
      repo() as never, // interests
      bookingRepo as never,
      repo() as never, // invitations
      { find: jest.fn(async () => ownedVendors) } as never,
      { find: jest.fn(async () => ownedPlanners) } as never,
      { record: jest.fn() } as never,
      dataSource as never,
    );
  });

  it('treats every state except completed and cancelled as open', () => {
    expect(OPEN_BOOKING_STATUSES).toEqual(
      expect.arrayContaining([
        BookingStatus.REQUESTED,
        BookingStatus.QUOTATION_SENT,
        BookingStatus.QUOTATION_ACCEPTED,
        BookingStatus.PAYMENT_PENDING,
        BookingStatus.CONFIRMED,
        BookingStatus.IN_PROGRESS,
        BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        BookingStatus.DISPUTED,
      ]),
    );
    expect(OPEN_BOOKING_STATUSES).not.toContain(BookingStatus.COMPLETED);
    expect(OPEN_BOOKING_STATUSES).not.toContain(BookingStatus.CANCELLED);
  });

  it.each([
    BookingStatus.REQUESTED,
    BookingStatus.QUOTATION_SENT,
    BookingStatus.QUOTATION_ACCEPTED,
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DISPUTED,
  ])('refuses while the customer has a booking that is %s', async (status) => {
    bookings.push(booking({ userId: 'user-1', bookedByUserId: 'user-1', status }));
    await expect(service.erase(actor, 'Password123')).rejects.toThrow(
      new BadRequestException(REFUSAL),
    );
    expect(userUpdates).not.toHaveBeenCalled();
  });

  it('refuses while a booking they placed for somebody else is open', async () => {
    bookings.push(booking({ bookedByUserId: 'user-1', status: BookingStatus.QUOTATION_SENT }));
    await expect(service.erase(actor, 'Password123')).rejects.toThrow(REFUSAL);
  });

  it('refuses while their vendor listing has an open booking', async () => {
    ownedVendors = [{ id: 'vendor-1' }];
    bookings.push(booking({ providerId: 'vendor-1', status: BookingStatus.REQUESTED }));
    await expect(service.erase(actor, 'Password123')).rejects.toThrow(REFUSAL);
  });

  it('refuses while their planner listing has an open booking', async () => {
    ownedPlanners = [{ id: 'planner-1' }];
    bookings.push(
      booking({
        providerType: ProviderType.PLANNER,
        providerId: 'planner-1',
        status: BookingStatus.QUOTATION_ACCEPTED,
      }),
    );
    await expect(service.erase(actor, 'Password123')).rejects.toThrow(REFUSAL);
  });

  it('does not confuse a vendor id with a planner id of the same value', async () => {
    ownedPlanners = [{ id: 'shared-id' }];
    bookings.push(booking({ providerType: ProviderType.VENDOR, providerId: 'shared-id' }));
    await expect(service.erase(actor, 'Password123')).resolves.toEqual({ erased: true });
  });

  it('erases when every booking is finished, and signs the account out everywhere', async () => {
    ownedVendors = [{ id: 'vendor-1' }];
    bookings.push(booking({ userId: 'user-1', status: BookingStatus.COMPLETED }));
    bookings.push(booking({ providerId: 'vendor-1', status: BookingStatus.CANCELLED }));

    await expect(service.erase(actor, 'Password123')).resolves.toEqual({ erased: true });

    expect(userUpdates).toHaveBeenCalledWith('user-1', expect.objectContaining({ isActive: false }));
    expect(userUpdates).toHaveBeenCalledWith('user-1', { tokenVersion: expect.any(Function) });
    expect(sessionUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ revokedReason: 'account erased' }),
    );
  });

  it('checks the password before anything else', async () => {
    bookings.push(booking({ userId: 'user-1' }));
    await expect(service.erase(actor, 'wrong')).rejects.toThrow('Password is not correct');
  });
});
