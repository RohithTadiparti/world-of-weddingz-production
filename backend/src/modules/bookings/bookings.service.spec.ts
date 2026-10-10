import { Test } from '@nestjs/testing';
import { WeddingEvent } from '../events/entities/event.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Quotation } from './entities/quotation.entity';
import { QuotationEvent } from './entities/quotation-event.entity';
import { VendorReview } from '../vendors/entities/vendor-review.entity';
import { PlannerReview } from '../wedding-planners/entities/planner-review.entity';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AuditService } from '../../platform/audit/audit.service';
import { SupportCasesService } from '../verification/support-cases.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { AvailabilityService } from '../vendors/availability.service';
import { VendorServicesService } from '../catalog/vendor-services.service';
import { PAYMENT_PROVIDER } from './payment.provider';
import { BookingStatus, ProviderType, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const asUser = (userId: string, role: UserRole): AuthUser => ({
  userId,
  email: `${userId}@example.com`,
  role,
  managedByAgentId: null,
});

describe('BookingsService', () => {
  let service: BookingsService;
  let current: Booking;

  // The vendor listing on every booking below is owned by 'vendor-owner'.
  const vendorsRepo = {
    findOne: jest.fn(async () => ({
      id: 'v1',
      ownerUserId: 'vendor-owner',
      isApproved: true,
    })),
    find: jest.fn(async () => [{ id: 'v1' }]),
  };
  const plannersRepo = { findOne: jest.fn(async () => null), find: jest.fn(async () => []) };
  const bookingsRepo = {
    findOne: jest.fn(async () => current),
    // The duplicate-request check reads the buyer's live requests.
    find: jest.fn(async () => []),
    save: jest.fn(async (b) => {
      current = b as Booking;
      return current;
    }),
    create: jest.fn((x) => x),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
  };
  const paymentsRepo = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    // The work gates ask "is this instalment held?"; each test says yes or no.
    count: jest.fn(async () => 1),
    update: jest.fn(),
  };

  // The buyer on these bookings is a matched individual with a completed
  // profile, so these tests stay about the state machine and the ownership
  // rules whichever way the services gate is set.
  // Nullable on purpose: one test hands back no profile at all, which is what a
  // buyer who never touched matchmaking looks like.
  type StubProfile = { id: string; userId: string; profileCompleted: boolean };
  const profilesRepo = {
    findOne: jest.fn(
      async (): Promise<StubProfile | null> => ({ id: 'p1', userId: 'u1', profileCompleted: true }),
    ),
  };
  const usersRepo = { findOne: jest.fn(async () => ({ id: 'u1', role: UserRole.BRIDE })) };
  const cases = { hasOpenCaseFor: jest.fn(async () => false) } as unknown as SupportCasesService;
  // `fixedPartnerUserId` is how a booking finds the other half of a fixed match
  // so it does not create a duplicate from both sides. Null is the "nobody is
  // in a fixed match" answer, which is what these tests set up.
  const matchmaking = {
    isMatchFixed: jest.fn(async () => true),
    fixedPartnerUserId: jest.fn(async () => null),
  } as unknown as MatchmakingService;
  const availability = {
    isBookable: jest.fn(async () => true),
    findSlot: jest.fn(async () => null),
    reserve: jest.fn(),
    confirm: jest.fn(),
    release: jest.fn(),
  } as unknown as AvailabilityService;
  // The catalog is what validates a buyer's answers against the form they were
  // generated from. These tests never send answers, so it is only here to
  // satisfy the constructor.
  const vendorServices = {
    validateBookingAnswers: jest.fn(async () => ({ service: { vendorId: 'v1' }, answers: {} })),
    findOffering: jest.fn(async () => null),
    findService: jest.fn(async () => null),
  } as unknown as VendorServicesService;
  const cfg = {
    payments: {
      currency: 'INR',
      provider: 'mock',
      commissionPercent: 10,
      milestonePercents: { advance: 30, second: 30, final: 40 },
    },
    // Mutable on purpose: the gate is a switch, and both of its positions are
    // worth a test.
    features: { servicesRequireMatchFixed: false },
  } as unknown as AppConfigService;
  const gate = (on: boolean) => {
    (cfg as unknown as { features: { servicesRequireMatchFixed: boolean } }).features
      .servicesRequireMatchFixed = on;
  };
  const outbox = { record: jest.fn() } as unknown as OutboxService;
  // confirm() takes the vendor's date inside a transaction, so the stub has to
  // hand back a manager that behaves like the booking repository.
  // Negotiation steps are written through the same manager; they go to their
  // own double so they never overwrite the booking under test.
  const eventsRepo = {
    save: jest.fn(async (e) => e),
    create: jest.fn((x) => x),
  };
  const offeringsRepo = { find: jest.fn(async () => []) };
  const quotationsRepo = {
    find: jest.fn(async (): Promise<Partial<Quotation>[]> => []),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const eventsTable = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async (): Promise<Partial<WeddingEvent> | null> => null),
  };
  const repoFor = (entity: unknown) => (entity === QuotationEvent ? eventsRepo : bookingsRepo);
  const dataSource = {
    transaction: jest.fn(async (fn: (m: unknown) => unknown) =>
      fn({ getRepository: repoFor }),
    ),
    getRepository: jest.fn(() => offeringsRepo),
  } as unknown as DataSource;
  const gateway = { createEscrowHold: jest.fn(), release: jest.fn(), refund: jest.fn() };
  const baseBooking = (over: Partial<Booking> = {}): Booking =>
    ({
      id: 'b1',
      userId: 'u1',
      bookedByUserId: 'u1',
      providerType: ProviderType.VENDOR,
      providerId: 'v1',
      amount: '5000.00',
      slotId: null,
      status: BookingStatus.CONFIRMED,
      ...over,
    }) as Booking;

  const countsBuilder = (rows: { status: string; count: string }[]) => {
    const builder = {} as Record<string, jest.Mock>;
    for (const method of ['select', 'addSelect', 'where', 'groupBy', 'leftJoin', 'andWhere']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn(async () => rows);
    builder.getCount = jest.fn(async () => 0);
    return builder;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    current = baseBooking();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingsRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        // Quotations joined the service after this suite was written; nothing
        // here goes down a quotation path, so an inert double is enough.
        { provide: getRepositoryToken(Quotation), useValue: quotationsRepo },
        { provide: getRepositoryToken(Vendor), useValue: vendorsRepo },
        // Both joined the service after this suite was written, and neither is
        // reached by anything here: reviews are written on completion paths the
        // tests stop short of, and the wedding plan is read for context only.
        {
          provide: getRepositoryToken(VendorReview),
          useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), save: jest.fn(), create: jest.fn() },
        },
        // The buyer's own review of a booking now comes from both tables
        // (EZ1-I244), and the planner one is read on the same paths.
        {
          provide: getRepositoryToken(PlannerReview),
          useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), save: jest.fn(), create: jest.fn() },
        },
        {
          provide: getRepositoryToken(WeddingPlan),
          useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), save: jest.fn(), create: jest.fn() },
        },
        { provide: getRepositoryToken(PlannerProfile), useValue: plannersRepo },
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        // Read-only in the service: they put a client and a venue on a
        // provider's booking row, and nothing in these tests reads them.
        { provide: getRepositoryToken(WeddingEvent), useValue: eventsTable },
        { provide: getRepositoryToken(VendorService), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: AppConfigService, useValue: cfg },
        { provide: OutboxService, useValue: outbox },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: SupportCasesService, useValue: cases },
        { provide: MatchmakingService, useValue: matchmaking },
        { provide: AvailabilityService, useValue: availability },
        { provide: VendorServicesService, useValue: vendorServices },
        { provide: PAYMENT_PROVIDER, useValue: gateway },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  describe('placing a request (rows 13 and 14)', () => {
    const bride = () => asUser('u1', UserRole.BRIDE);
    const request = (over: Record<string, unknown> = {}) =>
      ({ providerType: ProviderType.VENDOR, providerId: 'v1', ...over }) as never;

    it('refuses a date that does not match the chosen event', async () => {
      eventsTable.findOne.mockResolvedValueOnce({ id: 'e1', name: 'Mehendi', eventDate: '2026-12-10' });
      await expect(
        service.create(bride(), request({ eventId: 'e1', eventDate: '2026-12-11' })),
      ).rejects.toThrow('Mehendi is on 2026-12-10, but the date you chose is 2026-12-11');
      expect(bookingsRepo.save).not.toHaveBeenCalled();
    });

    it('accepts a requested date with a time on the event day, and keeps the time', async () => {
      eventsTable.findOne.mockResolvedValueOnce({ id: 'e1', name: 'Mehendi', eventDate: '2026-12-10' });
      const booking = await service.create(
        bride(),
        request({ eventId: 'e1', eventDate: '2026-12-10', requestedTime: '18:30', expectedBudget: 20000 }),
      );
      expect(booking).toMatchObject({ eventDate: '2026-12-10', requestedTime: '18:30', slotId: null });
      expect(eventsRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ kind: 'budget', amount: '20000.00', actorRole: 'customer' }),
      ]);
    });

    it('refuses a requested time with no date', async () => {
      await expect(service.create(bride(), request({ requestedTime: '18:30' }))).rejects.toThrow(
        'Choose the date you need before the time.',
      );
    });

    it('needs only one of the two options: a requested date alone is a whole request', async () => {
      const booking = await service.create(bride(), request({ eventDate: '2026-12-12' }));
      expect(booking).toMatchObject({ eventDate: '2026-12-12', slotId: null, requestedTime: null });
    });
  });

  describe('state machine', () => {
    it('lets the provider mark work delivered once the second instalment is in', async () => {
      current = baseBooking({ status: BookingStatus.IN_PROGRESS });
      paymentsRepo.count.mockResolvedValueOnce(1);
      const result = await service.completeWork(asUser('vendor-owner', UserRole.VENDOR), 'b1');
      expect(result.status).toBe(BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT);
    });

    it('refuses to mark work delivered before the second instalment', async () => {
      current = baseBooking({ status: BookingStatus.IN_PROGRESS });
      paymentsRepo.count.mockResolvedValueOnce(0);
      await expect(
        service.completeWork(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets the provider complete a delivered booking once the balance is in and accepted', async () => {
      current = baseBooking({
        status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        deliveredAt: new Date(),
        deliveryAcceptedAt: new Date(),
      });
      paymentsRepo.find.mockResolvedValueOnce([{ milestone: 'final', status: 'held_in_escrow' }] as never);
      const result = await service.markCompleted(asUser('vendor-owner', UserRole.VENDOR), 'b1');
      expect(result.status).toBe(BookingStatus.COMPLETED);
    });

    it('refuses to complete a booking before the balance is paid', async () => {
      current = baseBooking({
        status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        deliveredAt: new Date(),
        deliveryAcceptedAt: new Date(),
      });
      await expect(
        service.markCompleted(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to complete a booking the customer has not accepted', async () => {
      current = baseBooking({
        status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        deliveredAt: new Date(),
        deliveryAcceptedAt: null,
      });
      paymentsRepo.find.mockResolvedValueOnce([{ milestone: 'final', status: 'held_in_escrow' }] as never);
      await expect(
        service.markCompleted(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to start work before the advance is held', async () => {
      current = baseBooking({ status: BookingStatus.CONFIRMED });
      paymentsRepo.count.mockResolvedValueOnce(0);
      await expect(
        service.startWork(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a customer budget once and makes the advance payable', async () => {
      current = baseBooking({
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        expectedBudget: '12500.00',
        estimatedAmount: null,
      });

      const result = await service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1', {
        amount: 12500,
      });

      expect(result).toMatchObject({ status: BookingStatus.PAYMENT_PENDING, amount: '12500.00' });
      expect(eventsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'request_accepted', amount: '12500.00' }),
      );
      expect(outbox.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'booking.confirmed', payload: expect.objectContaining({ amount: '12500.00' }) }),
        expect.anything(),
      );
      await expect(
        service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1', { amount: 12500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts the customer's budget over the listed price, never the listing silently", async () => {
      current = baseBooking({
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        estimatedAmount: '25000.00',
        expectedBudget: '20000.00',
      });
      await expect(
        service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1', { amount: 25000 }),
      ).rejects.toThrow(/asked for .*20,000/);
      const result = await service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1', {
        amount: 20000,
      });
      expect(result.amount).toBe('20000.00');
    });

    it('accepts the listed total when the customer gave no budget', async () => {
      current = baseBooking({
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        estimatedAmount: '10000.00',
        expectedBudget: null,
      });
      const result = await service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1', {
        amount: 10000,
      });
      expect(result.amount).toBe('10000.00');
    });

    it('refuses an accept that does not say the amount', async () => {
      current = baseBooking({ status: BookingStatus.REQUESTED, amount: '0.00', expectedBudget: '5000.00' });
      await expect(
        service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toThrow('Confirm the amount you are accepting');
    });

    it('refuses Accept after the customer rejected a quotation: only a requote or cancel remain', async () => {
      current = baseBooking({
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        estimatedAmount: '25000.00',
        expectedBudget: '20000.00',
      });
      quotationsRepo.find.mockResolvedValueOnce([
        { status: 'rejected' as never, createdAt: new Date('2026-10-01') },
      ]);
      await expect(
        service.acceptRequest(asUser('vendor-owner', UserRole.VENDOR), 'b1', { amount: 20000 }),
      ).rejects.toThrow(/asked for a requote/);
      expect(current.status).toBe(BookingStatus.REQUESTED);
      expect(current.amount).toBe('0.00');
    });

    it('refuses the listed-price accept once a quotation is on the booking', async () => {
      current = baseBooking({
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        offeringId: 'o1',
        estimatedAmount: '25000.00',
      });
      quotationsRepo.find.mockResolvedValueOnce([
        { status: 'rejected' as never, createdAt: new Date('2026-10-01') },
      ]);
      await expect(
        service.acceptListedPrice(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses the listed price over a lower customer budget', async () => {
      current = baseBooking({
        status: BookingStatus.REQUESTED,
        amount: '0.00',
        offeringId: 'o1',
        estimatedAmount: '25000.00',
        expectedBudget: '20000.00',
      });
      await expect(
        service.acceptListedPrice(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toThrow(/Accept their budget/);
    });

    it('opens chat on a collected advance, including one awaiting its payout', async () => {
      paymentsRepo.find.mockResolvedValueOnce([{ milestone: 'advance', status: 'pending_payout' }] as never);
      await expect(service.advanceHeld('b1')).resolves.toBe(true);
      paymentsRepo.find.mockResolvedValueOnce([{ milestone: 'advance', status: 'released' }] as never);
      await expect(service.advanceHeld('b1')).resolves.toBe(true);
      paymentsRepo.find.mockResolvedValueOnce([{ milestone: 'advance', status: 'failed' }] as never);
      await expect(service.advanceHeld('b1')).resolves.toBe(false);
      paymentsRepo.find.mockResolvedValueOnce([] as never);
      await expect(service.advanceHeld('b1')).resolves.toBe(false);
    });

    it('refuses to accept delivery while an issue is open', async () => {
      current = baseBooking({
        status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        deliveredAt: new Date(),
        deliveryAcceptedAt: null,
      });
      (cases.hasOpenCaseFor as jest.Mock).mockResolvedValueOnce(true);
      await expect(
        service.confirmDelivery(asUser('u1', UserRole.BRIDE), 'b1'),
      ).rejects.toThrow(/open case/);
      expect(current.deliveryAcceptedAt).toBeNull();
    });

    it('accepts delivery when no issue is open', async () => {
      current = baseBooking({
        status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        deliveredAt: new Date(),
        deliveryAcceptedAt: null,
      });
      const result = await service.confirmDelivery(asUser('u1', UserRole.BRIDE), 'b1');
      expect(result.deliveryAcceptedAt).toBeInstanceOf(Date);
    });

    it('keeps Mark as completed refused while the balance is paid but delivery is not accepted', async () => {
      current = baseBooking({
        status: BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
        deliveredAt: new Date(),
        deliveryAcceptedAt: null,
      });
      paymentsRepo.find.mockResolvedValueOnce([{ milestone: 'final', status: 'held_in_escrow' }] as never);
      await expect(
        service.markCompleted(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toThrow(/not confirmed the delivery/);
    });

    it('rejects an illegal transition COMPLETED to CONFIRMED', async () => {
      current = baseBooking({ status: BookingStatus.COMPLETED });
      await expect(
        service.confirm(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects confirming an already-cancelled booking', async () => {
      current = baseBooking({ status: BookingStatus.CANCELLED });
      await expect(
        service.confirm(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('authorization', () => {
    // Previously complete() took only a booking id, so any authenticated user
    // could release another party's escrow by guessing a UUID.
    it('refuses to mark work delivered on someone else’s listing', async () => {
      current = baseBooking({ status: BookingStatus.IN_PROGRESS });
      await expect(
        service.completeWork(asUser('random-user', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to confirm a booking the caller does not own', async () => {
      current = baseBooking({ status: BookingStatus.PENDING });
      await expect(
        service.confirm(asUser('other-vendor', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to cancel a booking the caller is not party to', async () => {
      await expect(
        service.cancel(asUser('stranger', UserRole.BRIDE), 'b1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the buyer cancel their own booking', async () => {
      const result = await service.cancel(asUser('u1', UserRole.BRIDE), 'b1', 'changed plans');
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });

    it('lets the provider cancel a booking on their listing', async () => {
      const result = await service.cancel(asUser('vendor-owner', UserRole.VENDOR), 'b1');
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });
  });

  describe('commission split', () => {
    // PAYMENT_COMMISSION_PERCENT used to be read into config and never applied,
    // so providers were paid the gross amount and the platform earned nothing.
    it('withholds the configured percentage from the payout', () => {
      const { commission, payout } = service.splitAmount('1000.00');
      expect(commission).toBe('100.00');
      expect(payout).toBe('900.00');
    });

    it('always sums back to exactly the amount held', () => {
      for (const amount of ['0.01', '33.33', '999.99', '12345.67']) {
        const { commission, payout } = service.splitAmount(amount);
        const total = (parseFloat(commission) + parseFloat(payout)).toFixed(2);
        expect(total).toBe(parseFloat(amount).toFixed(2));
      }
    });

    it('rounds in the seller favour, never overcharging commission', () => {
      const { commission } = service.splitAmount('0.05'); // 10% of 5 paise
      expect(parseFloat(commission)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('who may place a booking', () => {
    it('refuses a booking from an agent account', async () => {
      // Narrowed deliberately: an agency introduces two families and is paid
      // for that. The couple hires their own vendors and holds their own
      // escrow, so there is no on-behalf path left to test.
      await expect(
        service.create(asUser('agent-1', UserRole.AGENT), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a booking from a provider account', async () => {
      await expect(
        service.create(asUser('vendor-owner', UserRole.VENDOR), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a booking against an unapproved listing', async () => {
      vendorsRepo.findOne.mockResolvedValueOnce({
        id: 'v1',
        ownerUserId: 'vendor-owner',
        isApproved: false,
      });
      await expect(
        service.create(asUser('u1', UserRole.BRIDE), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a self-booking', async () => {
      await expect(
        service.create(asUser('vendor-owner', UserRole.ADMIN), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  // The marketplace is open by default. Most matches are fixed at home, and one
  // of those is still a wedding that needs a caterer — the booking is where the
  // platform earns, so it is not held behind a funnel the buyer was never in.
  describe('the services gate', () => {
    afterEach(() => gate(false));

    it('takes a booking from a buyer whose match nobody has asked about', async () => {
      const booking = await service.create(asUser('u1', UserRole.BRIDE), {
        providerType: ProviderType.VENDOR,
        providerId: 'v1',
        amount: 1000,
      });

      expect(booking.status).toBe(BookingStatus.REQUESTED);
      // Asserted rather than stubbed: with the gate off nothing should go
      // looking for a profile or a match at all, so a buyer who has neither is
      // served for the same reason a buyer who has both is.
      expect(profilesRepo.findOne).not.toHaveBeenCalled();
      expect(matchmaking.isMatchFixed).not.toHaveBeenCalled();
    });

    it('still holds the door when an operator switches the gate back on', async () => {
      gate(true);
      (matchmaking.isMatchFixed as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.create(asUser('u1', UserRole.BRIDE), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never applies to an account with no matchmaking profile, gate or no gate', async () => {
      gate(true);
      usersRepo.findOne.mockResolvedValueOnce({ id: 'u1', role: UserRole.VENDOR });

      // A vendor account is refused for being a vendor, not for being unmatched:
      // the gate has nothing to say about accounts that never had a profile.
      await expect(
        service.create(asUser('u1', UserRole.VENDOR), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(matchmaking.isMatchFixed).not.toHaveBeenCalled();
    });
  });
  // The request form (EZ1 booking-form fixes): the total the buyer saw is the
  // one stored, the slot answers "Date of the function", and only the trades
  // that quote from a brief insist on one.
  // The request form: the total the buyer saw is the one stored, the slot
  // answers the form's date, and only trades that quote from a brief demand one.
  describe('a booking request', () => {
    const request = { providerType: ProviderType.VENDOR, providerId: 'v1' };
    const slotId = '11111111-1111-4111-8111-111111111111';
    const validate = vendorServices.validateBookingAnswers as jest.Mock;
    const serviceFound = (extra = {}) =>
      validate.mockResolvedValueOnce({ service: { id: 's1', vendorId: 'v1' }, answers: {}, ...extra });
    const vendorIn = (categories: string[]) =>
      vendorsRepo.findOne.mockResolvedValueOnce({
        id: 'v1', ownerUserId: 'vendor-owner', isApproved: true, categories,
      } as never);
    const perDay = { id: 'o1', vendorServiceId: 's1', name: 'Guest mehendi', pricingModel: 'per_day',
      price: '12000.00', active: true, minQuantity: null, maxQuantity: null, unitLabel: null };
    const bride = asUser('u1', UserRole.BRIDE);

    it('stores price times quantity as the estimate, and refuses a missing quantity', async () => {
      serviceFound();
      (vendorServices.findOffering as jest.Mock).mockResolvedValueOnce(perDay);
      const booking = await service.create(bride, {
        ...request, vendorServiceId: 's1', offeringId: 'o1', quantity: 10,
      });
      expect(booking.estimatedAmount).toBe('120000.00');

      serviceFound();
      (vendorServices.findOffering as jest.Mock).mockResolvedValueOnce(perDay);
      await expect(
        service.create(bride, { ...request, vendorServiceId: 's1', offeringId: 'o1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('answers "Date of the function" from the slot and dates the booking by it', async () => {
      (availability.findSlot as jest.Mock).mockResolvedValueOnce({
        id: slotId, providerId: 'v1', providerType: ProviderType.VENDOR, date: '2026-12-01',
      });
      serviceFound();
      const booking = await service.create(bride, {
        ...request, slotId, vendorServiceId: 's1', serviceAnswers: { guest_count: 40 },
        referenceImages: ['http://localhost:3000/mock-storage/u1/design.jpg'],
      });
      expect(validate).toHaveBeenCalledWith('s1', { guest_count: 40, event_date: '2026-12-01' });
      expect(booking.eventDate).toBe('2026-12-01');
      expect(booking.referenceImages).toEqual(['http://localhost:3000/mock-storage/u1/design.jpg']);
    });

    it('insists on a brief only where the trade quotes from one', async () => {
      vendorIn(['catering']);
      await expect(service.create(bride, request)).rejects.toThrow(/what you need/);

      vendorIn(['mehendi-artist']);
      expect((await service.create(bride, request)).requirements).toBeNull();

      // The service's own rule wins over whatever the vendor lists.
      vendorIn(['mehendi-artist']);
      serviceFound({ requirementsRequired: true });
      await expect(
        service.create(bride, { ...request, vendorServiceId: 's1' }),
      ).rejects.toThrow(/what you need/);
    });
  });

  describe('booking counts', () => {
    const threeEach = [
      { status: BookingStatus.CONFIRMED, count: '3' },
      { status: BookingStatus.IN_PROGRESS, count: '3' },
      { status: BookingStatus.COMPLETED, count: '3' },
      { status: BookingStatus.CANCELLED, count: '3' },
    ];

    it('counts each provider status once and preserves the total', async () => {
      bookingsRepo.createQueryBuilder.mockReturnValue(countsBuilder(threeEach));
      const counts = await service.incomingCounts(asUser('vendor-owner', UserRole.VENDOR));
      expect(counts).toMatchObject({ all: 12, confirmed: 3, in_progress: 3, completed: 3, cancelled: 3 });
    });

    it('counts each buyer status once and preserves the total', async () => {
      bookingsRepo.createQueryBuilder.mockReturnValue(countsBuilder(threeEach));
      const counts = await service.buyerCounts(asUser('buyer', UserRole.BRIDE));
      expect(counts).toMatchObject({ all: 12, confirmed: 3, in_progress: 3, completed: 3, cancelled: 3 });
    });

    it('keeps one key per status, so adding up a tab counts each booking once', async () => {
      bookingsRepo.createQueryBuilder.mockReturnValue(
        countsBuilder([
          { status: BookingStatus.PAYMENT_PENDING, count: '1' },
          { status: BookingStatus.DISPUTED, count: '1' },
          { status: BookingStatus.REQUESTED, count: '2' },
        ]),
      );
      const provider = await service.incomingCounts(asUser('vendor-owner', UserRole.VENDOR));
      expect(provider).toMatchObject({ all: 4, payment_pending: 1, disputed: 1, requested: 2, requests: 2 });
      expect(provider.confirmed).toBeUndefined();
      expect(provider.cancelled).toBeUndefined();

      bookingsRepo.createQueryBuilder.mockReturnValue(
        countsBuilder([
          { status: BookingStatus.DISPUTED, count: '1' },
          { status: BookingStatus.CANCELLED, count: '1' },
        ]),
      );
      const buyer = await service.buyerCounts(asUser('buyer', UserRole.BRIDE));
      // A dispute is still in flight on the dashboard tiles.
      expect(buyer).toMatchObject({ all: 2, active: 1, cancelled: 1, completed: 0, disputed: 1 });
    });
  });

  describe('releasing an owed payout', () => {
    const owed = {
      id: 'pay1',
      bookingId: 'b1',
      providerRef: 'pay_ref',
      payoutAmount: '900.00',
      commissionAmount: '100.00',
      amount: '1000.00',
      currency: 'INR',
      milestone: 'final',
      status: 'pending_payout',
    };
    const provider = asUser('vendor-owner', UserRole.VENDOR);
    const audit = () => (service as unknown as { audit: { record: jest.Mock } }).audit.record;
    const listing = (payoutAccountId: string | null) => {
      vendorsRepo.findOne.mockResolvedValueOnce({ id: 'v1', ownerUserId: 'vendor-owner', isApproved: true });
      vendorsRepo.findOne.mockResolvedValueOnce({
        id: 'v1',
        ownerUserId: 'vendor-owner',
        isApproved: true,
        name: 'Shop',
        payoutAccountId,
      } as never);
    };

    // The claim runs inside a transaction; the manager hands back a payments
    // repository whose locked read says whether this call won the row.
    const claim = (row: typeof owed | null) => {
      const update = jest.fn();
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (fn: (m: unknown) => unknown) =>
          fn({ getRepository: () => ({ findOne: jest.fn(async () => row), update }) }),
      );
      return update;
    };

    beforeEach(() => {
      current = baseBooking({ status: BookingStatus.COMPLETED });
      paymentsRepo.find.mockResolvedValueOnce([owed] as never);
    });

    it('refuses with a 400 when there is no payout account, and records nothing', async () => {
      listing(null);
      await expect(service.releasePayout(provider, 'b1')).rejects.toBeInstanceOf(BadRequestException);
      expect(gateway.release).not.toHaveBeenCalled();
      expect(audit()).not.toHaveBeenCalled();
    });

    it('transfers once, writes back only a still-owed row, and audits the transfer', async () => {
      listing('acc_1');
      gateway.release.mockResolvedValueOnce({ transferred: true, transferRef: 'trf_1', reason: null });
      const update = claim(owed);

      const result = await service.releasePayout(provider, 'b1');

      expect(result).toEqual({ bookingId: 'b1', released: 1, notReleased: [] });
      expect(gateway.release).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        { id: 'pay1', status: 'pending_payout' },
        { status: 'released', payoutRef: 'trf_1', payoutNote: null },
      );
      expect(audit()).toHaveBeenCalledTimes(1);
    });

    it('does nothing when a concurrent release already claimed the payment', async () => {
      listing('acc_1');
      const update = claim(null);

      const result = await service.releasePayout(provider, 'b1');

      expect(result.released).toBe(0);
      expect(gateway.release).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(audit()).not.toHaveBeenCalled();
    });

    it('keeps a refused transfer owed without touching its status', async () => {
      listing('acc_1');
      gateway.release.mockResolvedValueOnce({
        transferred: false,
        transferRef: null,
        reason: 'Gateway refused: 400',
      });
      const update = claim(owed);

      const result = await service.releasePayout(provider, 'b1');

      expect(result).toEqual({ bookingId: 'b1', released: 0, notReleased: ['Gateway refused: 400'] });
      expect(update).toHaveBeenCalledWith(
        { id: 'pay1', status: 'pending_payout' },
        { payoutNote: 'Gateway refused: 400' },
      );
      expect(audit()).not.toHaveBeenCalled();
    });
  });
});
