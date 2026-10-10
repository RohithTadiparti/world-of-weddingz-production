import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QuotationsService } from './quotations.service';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { Quotation } from './entities/quotation.entity';
import { QuotationEvent } from './entities/quotation-event.entity';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AvailabilityService } from '../vendors/availability.service';
import { BookingStatus, QuotationStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const as = (userId: string, role: UserRole): AuthUser => ({
  userId,
  email: `${userId}@example.com`,
  role,
  managedByAgentId: null,
});
const vendor = as('vendor', UserRole.VENDOR);
const bride = as('bride', UserRole.BRIDE);

/**
 * Row 16/17: every step of the price negotiation is recorded as it happens,
 * and a rejected quotation hands the booking back for a requote.
 */
describe('QuotationsService negotiation steps', () => {
  let booking: Booking;
  let quotation: Quotation | null;
  const recorded: Partial<QuotationEvent>[] = [];

  const events = {
    create: jest.fn((x) => x),
    save: jest.fn(async (e: Partial<QuotationEvent>) => {
      recorded.push(e);
      return e;
    }),
  };
  const quotations = {
    update: jest.fn(),
    create: jest.fn((x) => ({ id: 'q-new', createdAt: new Date(), ...x })),
    save: jest.fn(async (q) => q),
    findOne: jest.fn(async () => quotation),
    find: jest.fn(async () => (quotation ? [quotation] : [])),
  };
  const bookings = {
    findOne: jest.fn(async () => booking),
    save: jest.fn(async (b: Booking) => (booking = b)),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === QuotationEvent ? events : entity === Quotation ? quotations : bookings,
  };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)),
  } as unknown as DataSource;
  const bookingsService = {
    assertSeller: jest.fn(async () => undefined),
    assertBuyer: jest.fn(async () => undefined),
  } as unknown as BookingsService;

  const service = new QuotationsService(
    quotations as never,
    bookings as never,
    events as never,
    bookingsService,
    { payments: { currency: 'INR' } } as unknown as AppConfigService,
    { record: jest.fn() } as unknown as OutboxService,
    dataSource,
    { confirm: jest.fn() } as unknown as AvailabilityService,
  );

  beforeEach(() => {
    recorded.length = 0;
    booking = {
      id: 'b1',
      status: BookingStatus.REQUESTED,
      amount: '0.00',
      currency: 'INR',
      slotId: null,
    } as Booking;
    quotation = null;
  });

  const live = (amount: string): Quotation =>
    ({
      id: 'q1',
      bookingId: 'b1',
      amount,
      currency: 'INR',
      status: QuotationStatus.SENT,
      validUntil: new Date(Date.now() + 86_400_000),
      responseNote: null,
      createdAt: new Date(),
    }) as Quotation;

  it('records the vendor quotation as sent', async () => {
    await service.send(vendor, 'b1', { amount: 22000 } as never);
    expect(booking.status).toBe(BookingStatus.QUOTATION_SENT);
    expect(recorded).toEqual([
      expect.objectContaining({ kind: 'quotation_sent', amount: '22000.00', actorRole: 'provider' }),
    ]);
  });

  it('records a rejection and returns the booking to the vendor for a requote', async () => {
    booking.status = BookingStatus.QUOTATION_SENT;
    quotation = live('22000.00');
    await service.reject(bride, 'q1', { note: 'Too high' });
    expect(booking.status).toBe(BookingStatus.REQUESTED);
    expect(recorded).toEqual([
      expect.objectContaining({ kind: 'quotation_rejected', amount: '22000.00', note: 'Too high' }),
    ]);
  });

  it('records the accepted quotation as the final price and sets the booking amount from it', async () => {
    booking.status = BookingStatus.QUOTATION_SENT;
    quotation = live('22000.00');
    const result = await service.accept(bride, 'q1', {});
    expect(result).toMatchObject({ amount: '22000.00', status: BookingStatus.PAYMENT_PENDING, acceptedQuotationId: 'q1' });
    expect(recorded).toEqual([
      expect.objectContaining({ kind: 'quotation_accepted', amount: '22000.00', actorRole: 'customer' }),
    ]);
  });

  it('refuses to accept a quotation the booking is no longer waiting on', async () => {
    booking.status = BookingStatus.REQUESTED;
    quotation = live('22000.00');
    await expect(service.accept(bride, 'q1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(recorded).toEqual([]);
  });

  it('records a withdrawal', async () => {
    booking.status = BookingStatus.QUOTATION_SENT;
    quotation = live('22000.00');
    await service.withdraw(vendor, 'b1');
    expect(booking.status).toBe(BookingStatus.REQUESTED);
    expect(recorded).toEqual([expect.objectContaining({ kind: 'quotation_withdrawn' })]);
  });
});
