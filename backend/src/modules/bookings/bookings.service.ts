import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Booking, PlannerBrief } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Quotation } from './entities/quotation.entity';
import { MarkDeliveredDto } from './dto/booking-addon.dto';
import { Permission, roleHasPermission } from '../../common/authz/permissions';
import { WeddingEvent } from '../events/entities/event.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorReview } from '../vendors/entities/vendor-review.entity';
import { PlannerReview } from '../wedding-planners/entities/planner-review.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { BookingSearchDto, CreateBookingDto } from './dto/booking.dto';
import {
  BookingStatus,
  PaymentMilestone,
  PaymentMethod,
  PaymentStatus,
  ProviderType,
  QuotationStatus,
  UserRole,
  isIndividual,
} from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  PayoutDestination,
  PayoutResult,
} from './payment.provider';
import { PAYMENT_STATUS_RANK, collectedByBooking, isCollected } from './payment-totals';
import { escrowSummary, summariseQuotations } from './booking-summary';
import { QuotationEvent } from './entities/quotation-event.entity';
import { awaitingRequote, customerAsk, requestEvents } from './negotiation';
import { eventDateMismatch } from './request-schedule';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import {
  PlannerRequestCard,
  PlannerRequestDetail,
  dateAvailability,
  toRequestCard,
  toRequestDetail,
} from './planner-requests';
import { WeddingFacts, bookingContextOf } from './booking-venue';
import { loadWeddingFacts } from './wedding-facts';
import { serviceNamesByIds } from '../catalog/service-names';
import { displayNamesByUserIds } from '../users/display-names';
import { profilePhotoOf } from '../users/dto/public-profile.dto';
import { SupportCasesService } from '../verification/support-cases.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { AvailabilityService } from '../vendors/availability.service';
import { VendorServicesService } from '../catalog/vendor-services.service';
import {
  QUANTITY_MODELS,
  estimateAmount,
  requirementsRequired,
} from '../catalog/booking-request-rules';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/**
 * The client branches on this to open the request the buyer already has rather
 * than showing them a bare error.
 */
export const DUPLICATE_BOOKING_REQUEST = 'DUPLICATE_BOOKING_REQUEST';

/**
 * The client branches on this to explain that the couple's other half already
 * booked the service, and to open that shared booking (EZ1-I160).
 */
export const PARTNER_ALREADY_BOOKED = 'PARTNER_ALREADY_BOOKED';

/** Money is added in minor units; summing decimal strings drifts a paisa at a time. */
const toMinor = (amount: string): number => Math.round(parseFloat(amount || '0') * 100);
const toMajor = (minor: number): string => (minor / 100).toFixed(2);

/**
 * Booking lifecycle + escrow, as an explicit state machine.
 *
 * The spine of it is that **money and work alternate**, and neither side can
 * get ahead of the other:
 *
 *   REQUESTED ─quote→ QUOTATION_SENT ─buyer accepts→ QUOTATION_ACCEPTED
 *     └─ provider agrees → PAYMENT_PENDING
 *          └─ advance held → CONFIRMED
 *               └─ provider starts → IN_PROGRESS
 *                    └─ second instalment → provider may finish
 *                         └─ provider marks delivered → COMPLETED_PENDING_FINAL_PAYMENT
 *                              └─ balance paid, delivery accepted by the buyer
 *                                   └─ provider marks completed → COMPLETED [escrow released]
 *
 * A provider cannot start before being paid something, and a buyer cannot be
 * asked for the balance before the work is done. Every one of those gates is
 * enforced here rather than by hiding a button, because the button is not what
 * an attacker uses.
 *
 * Raising a case moves the booking to DISPUTED and freezes the money until an
 * officer settles it; most states can still be cancelled, which refunds.
 */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.REQUESTED]: [
    BookingStatus.QUOTATION_SENT,
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.CANCELLED,
  ],
  // Re-quoting returns the booking to REQUESTED, so the buyer is never looking
  // at a stale price while the provider prepares a new one.
  [BookingStatus.QUOTATION_SENT]: [
    BookingStatus.QUOTATION_ACCEPTED,
    BookingStatus.REQUESTED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.QUOTATION_ACCEPTED]: [BookingStatus.PAYMENT_PENDING, BookingStatus.CANCELLED],
  [BookingStatus.PAYMENT_PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  // Historic state; nothing enters it any more.
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED],
  [BookingStatus.IN_PROGRESS]: [
    BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
    BookingStatus.DISPUTED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT]: [
    BookingStatus.COMPLETED,
    BookingStatus.DISPUTED,
    BookingStatus.CANCELLED,
  ],
  // A dispute can surface after delivery — that is when most of them do.
  [BookingStatus.COMPLETED]: [BookingStatus.DISPUTED],
  [BookingStatus.DISPUTED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.CANCELLED]: [],
};

/** States in which a slot is still being held for this booking. */
const HOLDS_SLOT: BookingStatus[] = [
  BookingStatus.REQUESTED,
  BookingStatus.QUOTATION_SENT,
  BookingStatus.QUOTATION_ACCEPTED,
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
];

/**
 * A request that is still live, for the "one at a time" rule. A rejected
 * quotation does **not** end a request — the provider can re-quote inside it —
 * so only cancellation and completion free the buyer to ask again.
 */
const ACTIVE_REQUEST: BookingStatus[] = HOLDS_SLOT;

/** A job the provider has agreed to: the day is theirs to keep free. */
const COMMITTED: BookingStatus[] = [
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
];

/** Still being asked and priced: what the Requests and Request on Date tabs gather. */
const REQUEST_STATUSES: BookingStatus[] = [
  BookingStatus.REQUESTED,
  BookingStatus.QUOTATION_SENT,
  BookingStatus.QUOTATION_ACCEPTED,
];

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Quotation) private readonly quotations: Repository<Quotation>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    // Read-only, to tell a buyer which completed bookings they have already
    // reviewed and show what they wrote (EZ1-I114).
    @InjectRepository(VendorReview) private readonly vendorReviews: Repository<VendorReview>,
    @InjectRepository(PlannerReview) private readonly plannerReviews: Repository<PlannerReview>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    // Read/write, to auto-engage a planner on their client's plan on confirmation
    // (EZ1-I116).
    @InjectRepository(WeddingPlan) private readonly weddingPlans: Repository<WeddingPlan>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    // Read-only, so a provider's booking row can say who and where it is for.
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(VendorService) private readonly serviceRows: Repository<VendorService>,
    private readonly cfg: AppConfigService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => SupportCasesService))
    private readonly cases: SupportCasesService,
    private readonly matchmaking: MatchmakingService,
    // Bookings and the vendor calendar need each other; the cycle is broken
    // here rather than by duplicating the capacity rule in two places.
    @Inject(forwardRef(() => AvailabilityService))
    private readonly availability: AvailabilityService,
    // The catalog validates a buyer's answers against the same rows the form
    // they filled in was generated from. Keeping that in one place is what
    // stops the form and its submission drifting apart.
    @Inject(forwardRef(() => VendorServicesService))
    private readonly vendorServices: VendorServicesService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}

  /**
   * Splits an escrow amount into the platform's commission and the provider's
   * payout. PAYMENT_COMMISSION_PERCENT was previously read into config and
   * never applied, so providers received the gross amount and the marketplace
   * earned nothing.
   *
   * Rounding favours the provider: the commission is floored to whole paise so
   * the two parts always sum back to exactly the amount held.
   */
  splitAmount(amount: string): { commission: string; payout: string } {
    const gross = Math.round(parseFloat(amount) * 100); // work in minor units
    const percent = this.cfg.payments.commissionPercent;
    const commission = Math.floor((gross * percent) / 100);
    const payout = gross - commission;
    return {
      commission: (commission / 100).toFixed(2),
      payout: (payout / 100).toFixed(2),
    };
  }

  /**
   * What a given milestone costs on this booking.
   *
   * The final instalment is the remainder rather than its own percentage, so
   * rounding can never leave a rupee uncollected or collect one too many:
   * advance + second + final always equals the booking total exactly.
   *
   * `alreadyCharged` is what earlier instalments were actually billed at, and
   * it matters because the total can grow after some of them are paid. An
   * add-on is only requestable once the booking is CONFIRMED -- which is to
   * say once the advance is held -- so accepting one raises the total against
   * instalments that have already been taken at the old figure. Recomputing
   * every milestone as a fresh percentage of the new total then quietly loses
   * the advance's share of the increase: a 20,000 add-on on a 100,000 booking
   * billed 30,000 + 36,000 + 48,000 = 114,000 against an agreed 120,000, and
   * the provider was short-paid the missing 6,000 (council review,
   * 2026-09-10).
   *
   * Passing what was really charged makes the final instalment absorb the
   * difference, so the three instalments still sum to the agreed total however
   * many times it changed on the way.
   */
  milestoneAmount(
    total: string,
    milestone: PaymentMilestone,
    alreadyCharged?: Partial<Record<PaymentMilestone, string>>,
  ): string {
    const gross = Math.round(parseFloat(total) * 100);
    const pct = this.cfg.payments.milestonePercents;
    const minorOf = (value: string) => Math.round(parseFloat(value) * 100);

    // What each earlier instalment was billed at: the real figure when one
    // exists, the percentage otherwise.
    const advance =
      alreadyCharged?.[PaymentMilestone.ADVANCE] !== undefined
        ? minorOf(alreadyCharged[PaymentMilestone.ADVANCE] as string)
        : Math.floor((gross * pct.advance) / 100);
    const second =
      alreadyCharged?.[PaymentMilestone.SECOND] !== undefined
        ? minorOf(alreadyCharged[PaymentMilestone.SECOND] as string)
        : Math.floor((gross * pct.second) / 100);

    const minor =
      milestone === PaymentMilestone.ADVANCE
        ? advance
        : milestone === PaymentMilestone.SECOND
          ? second
          : gross - advance - second;
    // A total that shrank below what has already been taken owes nothing more.
    return (Math.max(0, minor) / 100).toFixed(2);
  }

  /**
   * What each instalment on a booking was actually billed at.
   *
   * Read from the live payment rows -- anything not refunded or failed -- so a
   * later instalment is priced against what really happened rather than
   * against a percentage of a total that has since moved.
   */
  async chargedSoFar(
    bookingId: string,
  ): Promise<Partial<Record<PaymentMilestone, string>>> {
    const rows = await this.payments.find({ where: { bookingId } });
    const dead = [PaymentStatus.REFUNDED, PaymentStatus.FAILED];
    const charged: Partial<Record<PaymentMilestone, string>> = {};
    for (const row of rows) {
      if (dead.includes(row.status)) continue;
      charged[row.milestone] = row.amount;
    }
    return charged;
  }

  /** Every milestone on a booking, with what has been paid against each. */
  async milestones(actor: AuthUser, bookingId: string) {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);

    const payments = await this.payments.find({ where: { bookingId } });
    // Priced against what earlier instalments really cost, not against a fresh
    // percentage of a total that may have moved since (council review).
    const charged: Partial<Record<PaymentMilestone, string>> = {};
    for (const row of payments) {
      if (!this.isDead(row.status)) charged[row.milestone] = row.amount;
    }
    const order = [PaymentMilestone.ADVANCE, PaymentMilestone.SECOND, PaymentMilestone.FINAL];
    return {
      bookingId,
      total: booking.amount,
      currency: booking.currency,
      milestones: order.map((milestone) => {
        const payment = payments.find((p) => p.milestone === milestone && !this.isDead(p.status));
        return {
          milestone,
          amount: this.milestoneAmount(booking.amount, milestone, charged),
          status: payment?.status ?? null,
          paymentId: payment?.id ?? null,
        };
      }),
    };
  }

  /** A payment in one of these states does not occupy its milestone slot. */
  private isDead(status: PaymentStatus): boolean {
    return status === PaymentStatus.FAILED || status === PaymentStatus.REFUNDED;
  }

  /** Resolves the user account that owns the provider listing on a booking. */
  private async providerOwner(
    providerType: ProviderType,
    providerId: string,
    manager?: EntityManager,
  ): Promise<{ ownerUserId: string; isApproved: boolean; categories?: string[] }> {
    if (providerType === ProviderType.VENDOR) {
      const repo = manager ? manager.getRepository(Vendor) : this.vendors;
      const vendor = await repo.findOne({ where: { id: providerId } });
      if (!vendor) throw new NotFoundException('Vendor not found');
      return {
        ownerUserId: vendor.ownerUserId,
        isApproved: vendor.isApproved,
        categories: vendor.categories?.length ? vendor.categories : [vendor.category ?? ''],
      };
    }
    const repo = manager ? manager.getRepository(PlannerProfile) : this.planners;
    const planner = await repo.findOne({ where: { id: providerId } });
    if (!planner) throw new NotFoundException('Planner not found');
    return { ownerUserId: planner.ownerUserId, isApproved: planner.isApproved };
  }

  /**
   * Places a booking request.
   *
   * For a vendor this means holding one of their published windows: the slot is
   * reserved inside the same transaction that writes the booking, so two buyers
   * racing for the last Saturday afternoon cannot both succeed.
   */
  async create(actor: AuthUser, dto: CreateBookingDto): Promise<Booking> {
    // The wedding marketplace belongs to the couple. An agency introduces two
    // families and is paid for that; it does not hire their photographer, and
    // it certainly does not hold their escrow. Booking on somebody else's
    // behalf was removed with that scope, not merely hidden.
    /*
     * Who this booking is for.
     *
     * Ordinarily the caller: a couple books for themselves. A planner engaged
     * on a wedding may also raise the request, naming the couple -- the
     * booking is still theirs, still paid by them, and still appears in their
     * bookings; the planner is recorded in `bookedByUserId` as who placed it
     * (EZ1-I235). That keeps EZ1-I29's rule that the agency does not own the
     * booking while giving the planner the way to ask that they had none of.
     */
    const forClient = dto.forClientUserId;
    if (forClient && forClient !== actor.userId) {
      if (!roleHasPermission(actor.role, Permission.BOOKING_REQUEST_FOR_CLIENT)) {
        throw new ForbiddenException('You cannot place a booking for somebody else');
      }
      // Engaged on that wedding, or not at all. Same check the planner's own
      // events and brief go through.
      const engaged = await this.weddingPlans.findOne({
        where: { userId: forClient, plannerUserId: actor.userId },
      });
      if (!engaged) {
        throw new ForbiddenException('You are not engaged on that wedding');
      }
    } else if (!isIndividual(actor.role)) {
      throw new ForbiddenException('Only the couple and their family can place bookings');
    }

    const clientUserId = forClient && forClient !== actor.userId ? forClient : actor.userId;
    await this.assertServicesUnlocked(clientUserId);

    const provider = await this.providerOwner(dto.providerType, dto.providerId);
    if (!provider.isApproved) {
      throw new BadRequestException('That provider is not yet approved for bookings');
    }
    if (provider.ownerUserId === clientUserId || provider.ownerUserId === actor.userId) {
      throw new BadRequestException('You cannot book your own listing');
    }

    // One live request per buyer, provider, event and slot. Sending the same
    // request twice is almost always a double-click or an impatient refresh,
    // and answering it with a second request would have the provider quoting
    // the same job twice.
    const existing = await this.findActiveRequest(clientUserId, dto);
    if (existing) {
      throw new ConflictException({
        message:
          'You already have an active booking request with this provider for that event and slot.',
        code: DUPLICATE_BOOKING_REQUEST,
        bookingId: existing.id,
      });
    }

    // A match-fixed couple share one wedding (EZ1-I160): if the partner already
    // holds a live booking for this provider and service, that booking is the
    // couple's, and a second one from this side would duplicate it. Nothing
    // happens for anyone not in a fixed match — fixedPartnerUserId returns null.
    const partnerUserId = await this.matchmaking.fixedPartnerUserId(clientUserId);
    if (partnerUserId) {
      const partnerBooking = await this.partnerActiveBooking(partnerUserId, dto);
      if (partnerBooking) {
        throw new ConflictException({
          message: 'Your partner has already booked this service.',
          code: PARTNER_ALREADY_BOOKED,
          bookingId: partnerBooking.id,
        });
      }
    }

    let slotServiceId: string | null = null;
    let slotDate: string | null = null;
    if (dto.slotId) {
      const slot = await this.availability.findSlot(dto.slotId);
      // Both halves. A slot is identified by the provider it belongs to and
      // the kind of provider that is, so a planner's slot id can never be
      // presented against a vendor booking.
      if (!slot || slot.providerId !== dto.providerId || slot.providerType !== dto.providerType) {
        throw new BadRequestException('That time slot does not belong to this provider');
      }
      if (dto.eventDate && dto.eventDate !== slot.date) {
        throw new BadRequestException('The event date does not match the slot you chose');
      }
      // The window is re-checked here as well as under the lock below, so a
      // buyer working from a page that went stale while they filled the form
      // in is told now rather than after their answers are thrown away.
      if (!(await this.availability.isBookable(dto.providerId, dto.slotId))) {
        throw new BadRequestException('That time slot is no longer open. Pick another.');
      }
      // A window published for one service books that service, so both sides
      // see which job it is even when the customer did not pick it again
      // (EZ1-I264).
      slotServiceId = slot.vendorServiceId ?? null;
      slotDate = slot.date;
    }

    // The day of the function is the day of the window, or the date asked for
    // when there is no window. A form that also asks "Date of the function" is
    // answered from that rather than asking the buyer twice, and cannot then
    // disagree with the slot they held.
    const functionDate = slotDate ?? dto.eventDate ?? null;

    // A time of day only travels with a requested date: a published window
    // already says when it runs, and a time with no day means nothing.
    if (dto.requestedTime && (dto.slotId || !dto.eventDate)) {
      throw new BadRequestException(
        dto.slotId
          ? 'A published slot already has its time. Leave the requested time out.'
          : 'Choose the date you need before the time.',
      );
    }

    // The request is for one of the couple's functions, so its day has to be
    // that function's day. A slot or requested date on another day would book
    // the vendor for a date nobody is celebrating.
    if (dto.eventId) {
      const event = await this.events.findOne({ where: { id: dto.eventId } });
      if (!event) throw new BadRequestException('That event could not be found');
      const mismatch = eventDateMismatch(event, functionDate);
      if (mismatch) throw new BadRequestException(mismatch);
    }

    // What the catalog contributes: the buyer's answers are validated against
    // the same rows the form they filled in was generated from, and the chosen
    // price is proved to belong to the service they chose.
    let serviceAnswers: Record<string, unknown> = {};
    let estimatedAmount: number | null = null;
    let briefRequired = requirementsRequired(provider.categories ?? [], false);
    if (dto.vendorServiceId) {
      const validated = await this.vendorServices.validateBookingAnswers(dto.vendorServiceId, {
        ...(dto.serviceAnswers ?? {}),
        ...(functionDate ? { event_date: functionDate } : {}),
      });
      const { service, answers } = validated;
      briefRequired = validated.requirementsRequired;
      if (service.vendorId !== dto.providerId) {
        throw new BadRequestException('That service does not belong to this provider');
      }
      serviceAnswers = answers;

      if (dto.offeringId) {
        const offering = await this.vendorServices.findOffering(dto.offeringId);
        if (!offering || offering.vendorServiceId !== service.id) {
          throw new BadRequestException('That price is not on the service you chose');
        }
        if (!offering.active) {
          throw new BadRequestException('That price is no longer offered');
        }
        if (offering.minQuantity && (dto.quantity ?? 0) < offering.minQuantity) {
          throw new BadRequestException(
            `${offering.name} starts at ${offering.minQuantity}${offering.unitLabel ? ' ' + offering.unitLabel : ''}`,
          );
        }
        if (offering.maxQuantity && (dto.quantity ?? 0) > offering.maxQuantity) {
          throw new BadRequestException(
            `${offering.name} tops out at ${offering.maxQuantity}${offering.unitLabel ? ' ' + offering.unitLabel : ''}`,
          );
        }
        // A per-day price with no number of days is not a price anybody saw.
        if (QUANTITY_MODELS.includes(offering.pricingModel) && !dto.quantity) {
          throw new BadRequestException(`Say how many for ${offering.name}`);
        }
        estimatedAmount = estimateAmount(offering, dto.quantity);
      }
    } else if (dto.serviceAnswers && Object.keys(dto.serviceAnswers).length > 0) {
      // Answers with nothing to validate them against would be stored
      // unchecked, which is the one thing the catalog exists to prevent.
      throw new BadRequestException('Choose a service before answering its questions');
    }

    // Services ticked on a planner's profile mean nothing to a vendor, whose
    // request names its service through the catalog instead.
    if (dto.requestedServices?.length && dto.providerType !== ProviderType.PLANNER) {
      throw new BadRequestException('Services can only be chosen on a planner request');
    }

    // Venue, catering and florist cannot quote without a brief; everybody else
    // quotes from the price the buyer picked (booking-request-rules.ts).
    if (briefRequired && !dto.requirements?.trim()) {
      throw new BadRequestException('Tell the provider what you need — at least a sentence');
    }

    const plannerBrief = await this.plannerBriefFor(dto);

    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const booking = await bookingRepo.save(
        bookingRepo.create({
          userId: clientUserId,
          bookedByUserId: actor.userId,
          providerType: dto.providerType,
          providerId: dto.providerId,
          slotId: dto.slotId ?? null,
          eventId: dto.eventId ?? null,
          // A request carries no committed price: the provider quotes against
          // the requirements. `amount` stays zero until a quotation is accepted.
          amount: (dto.amount ?? 0).toFixed(2),
          currency: this.cfg.payments.currency,
          eventDate: functionDate,
          requestedTime: !dto.slotId && dto.requestedTime ? dto.requestedTime : null,
          requirements: dto.requirements ?? null,
          vendorServiceId: dto.vendorServiceId ?? slotServiceId,
          offeringId: dto.offeringId ?? null,
          serviceAnswers,
          quantity: dto.quantity ?? null,
          estimatedAmount: estimatedAmount !== null ? estimatedAmount.toFixed(2) : null,
          referenceImages: dto.referenceImages ?? [],
          requestedServices: dto.requestedServices ?? [],
          // A planner request's budget is a range; the top of it is what the
          // couple is prepared to spend, which is what `expectedBudget` means.
          expectedBudget:
            dto.expectedBudget !== undefined
              ? dto.expectedBudget.toFixed(2)
              : plannerBrief?.budgetMax != null
                ? plannerBrief.budgetMax.toFixed(2)
                : null,
          plannerBrief,
          notes: dto.notes,
          status: BookingStatus.REQUESTED,
        }),
      );

      if (dto.slotId) await this.availability.reserve(manager, dto.slotId);

      // Where the negotiation starts: the price the customer picked off the
      // listing and the budget they named, kept as history from the outset.
      const opening = requestEvents(booking);
      if (opening.length > 0) {
        const events = manager.getRepository(QuotationEvent);
        await events.save(
          opening.map((e) =>
            events.create({
              ...e,
              bookingId: booking.id,
              actorUserId: e.actorRole === 'customer' ? clientUserId : null,
            }),
          ),
        );
      }

      await this.outbox.record(
        {
          eventType: 'booking.requested',
          aggregateType: 'booking',
          payload: {
            bookingId: booking.id,
            userId: clientUserId,
            providerId: dto.providerId,
            slotId: dto.slotId ?? null,
          },
        },
        manager,
      );
      return booking;
    });
  }

  /**
   * The planner brief, checked and tidied, or null.
   *
   * Only a planner request carries one, and ranges must run low to high. The
   * services travel separately as `requestedServices`; each must be one this
   * planner lists, when they list any — the planner is shown "the services
   * the couple asked for", and a key sent past the form would be one they
   * never offered.
   */
  private async plannerBriefFor(dto: CreateBookingDto): Promise<PlannerBrief | null> {
    if (dto.providerType === ProviderType.PLANNER && dto.requestedServices?.length) {
      const planner = await this.planners.findOne({
        where: { id: dto.providerId },
        select: ['id', 'services'],
      });
      const offered = planner?.services ?? [];
      const unknown = dto.requestedServices.filter((s) => !offered.includes(s));
      if (offered.length > 0 && unknown.length > 0) {
        throw new BadRequestException('Choose only services this planner offers');
      }
    }

    const brief = dto.plannerBrief;
    if (!brief) return null;
    if (dto.providerType !== ProviderType.PLANNER) {
      throw new BadRequestException('A planner brief only goes with a wedding planner request');
    }
    if (
      brief.guestCountMin != null &&
      brief.guestCountMax != null &&
      brief.guestCountMin > brief.guestCountMax
    ) {
      throw new BadRequestException('The smallest guest count is larger than the largest');
    }
    if (brief.budgetMin != null && brief.budgetMax != null && brief.budgetMin > brief.budgetMax) {
      throw new BadRequestException('The lower budget is larger than the upper one');
    }

    return {
      location: brief.location?.trim() || null,
      guestCountMin: brief.guestCountMin ?? null,
      guestCountMax: brief.guestCountMax ?? null,
      weddingType: brief.weddingType ?? null,
      budgetMin: brief.budgetMin ?? null,
      budgetMax: brief.budgetMax ?? null,
    };
  }

  /** The live request for this buyer/provider/event/slot, if there is one. */
  private async findActiveRequest(
    clientUserId: string,
    dto: CreateBookingDto,
  ): Promise<Booking | null> {
    const candidates = await this.bookings.find({
      where: {
        userId: clientUserId,
        providerType: dto.providerType,
        providerId: dto.providerId,
        status: In(ACTIVE_REQUEST),
      },
    });

    return (
      candidates.find(
        (b) =>
          (dto.slotId ? b.slotId === dto.slotId : true) &&
          (dto.eventId ? b.eventId === dto.eventId : true) &&
          (!dto.slotId && !dto.eventId ? b.eventDate === (dto.eventDate ?? null) : true),
      ) ?? null
    );
  }

  /**
   * A live booking the match-fixed partner already holds for this provider and
   * service (EZ1-I160). Keyed on provider + service rather than the slot, so the
   * couple cannot both book the same service from two accounts however each
   * side reached it. A booking with no catalog service matches another with no
   * service against the same provider.
   */
  private async partnerActiveBooking(
    partnerUserId: string,
    dto: CreateBookingDto,
  ): Promise<Booking | null> {
    const rows = await this.bookings.find({
      where: {
        userId: partnerUserId,
        providerType: dto.providerType,
        providerId: dto.providerId,
        status: In(ACTIVE_REQUEST),
      },
    });
    return (
      rows.find((b) => (b.vendorServiceId ?? null) === (dto.vendorServiceId ?? null)) ?? null
    );
  }

  /**
   * The wedding marketplace, and who may buy from it.
   *
   * Open to everybody by default. The platform earns on vendor bookings, and a
   * match fixed at home — which is how most of them are fixed — is still a
   * wedding that needs a caterer. Making matchmaking a toll gate in front of
   * the shop turns paying customers away at the door to protect a funnel they
   * were never in.
   *
   * The gate survives behind `SERVICES_REQUIRE_MATCH_FIXED` for an operator
   * running matchmaking as the front door, and when it is on the check runs
   * against the *client* the booking is for, not the person clicking, so an
   * agent booking a venue for a client is held to the client's status rather
   * than their own. Accounts with no matchmaking profile at all — an agency
   * booking for its own office, say — are never part of it either way.
   */
  private async assertServicesUnlocked(clientUserId: string): Promise<void> {
    if (!this.cfg.features.servicesRequireMatchFixed) return;

    const client = await this.users.findOne({
      where: { id: clientUserId },
      select: ['id', 'role'],
    });
    if (!client || !isIndividual(client.role)) return;

    const profile = await this.profiles.findOne({ where: { userId: clientUserId } });
    if (!profile) {
      throw new BadRequestException('Complete the profile before booking services');
    }
    if (!(await this.matchmaking.isMatchFixed(profile.id))) {
      throw new ForbiddenException(
        'Wedding services unlock once the match is fixed. Confirm the match first.',
      );
    }
  }

  /**
   * Pays one escrow milestone.
   *
   * Each instalment is tied to a point in the work, not just to the one before
   * it: the advance secures the job, the second falls due once the provider has
   * actually started, and the balance only once they say it is finished. The
   * gate is here rather than in the UI, because a disabled button stops nobody
   * who is willing to call the API directly.
   *
   * `idempotencyKey` makes a retried request (flaky network, double-tap) return
   * the original payment instead of holding a second time.
   */
  async pay(
    actor: AuthUser,
    bookingId: string,
    opts: {
      milestone?: PaymentMilestone;
      idempotencyKey?: string;
      method?: PaymentMethod;
    } = {},
  ): Promise<{ booking: Booking; payment: Payment }> {
    const milestone = opts.milestone ?? PaymentMilestone.ADVANCE;
    const idempotencyKey = opts.idempotencyKey;
    const method = opts.method ?? PaymentMethod.CARD;

    /*
     * What the operator is willing to accept.
     *
     * Checked here rather than in the DTO because it is configuration, not
     * shape: a deployment that has not enabled netbanking should refuse it with
     * a sentence about this platform, not a validation error listing an enum.
     */
    if (!this.cfg.payments.methods.includes(method)) {
      throw new BadRequestException(`${method} payments are not accepted here`);
    }

    if (idempotencyKey) {
      const prior = await this.payments.findOne({ where: { idempotencyKey } });
      if (prior) {
        const booking = await this.loadOrFail(prior.bookingId);
        await this.assertBuyerSide(actor, booking);
        return { booking, payment: prior };
      }
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const paymentRepo = manager.getRepository(Payment);

      // Lock the row so two concurrent pay calls cannot both create a hold.
      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      await this.assertBuyerSide(actor, booking);

      if (parseFloat(booking.amount) <= 0) {
        throw new BadRequestException(
          'This booking has no agreed price yet — accept a quotation first',
        );
      }

      const existing = await paymentRepo.find({ where: { bookingId: booking.id } });
      const live = existing.filter((p) => !this.isDead(p.status));
      if (live.some((p) => p.milestone === milestone)) {
        throw new BadRequestException(`The ${milestone} instalment has already been paid`);
      }
      this.assertMilestoneAllowed(booking, milestone, live);

      // Priced against what earlier instalments really cost, so an add-on
      // accepted after the advance is billed in full (council review).
      const charged = await this.chargedSoFar(bookingId);
      const amount = this.milestoneAmount(booking.amount, milestone, charged);
      // The split is fixed at the moment of payment, so what the provider is
      // owed cannot drift if the commission rate changes later.
      const { commission, payout } = this.splitAmount(amount);

      /*
       * Cash never reaches the gateway, and must not pretend to.
       *
       * Nothing moves through the platform, so there is no hold to make and
       * nothing to release or refund later. Writing HELD_IN_ESCROW here would
       * be a lie the dispute machinery then acts on — offering to refund from
       * a balance that does not exist. It is recorded as RELEASED because that
       * is what has happened: the provider has the money. The protection the
       * rest of this file exists to provide is simply not on offer, and the
       * cap is the most the operator is prepared to see somebody lose that way.
       */
      const isCash = method === PaymentMethod.CASH;
      if (isCash) {
        const cap = Number(this.cfg.payments.cash.maxAmount);
        if (Number.isFinite(cap) && cap > 0 && parseFloat(amount) > cap) {
          throw new BadRequestException(
            `Cash is limited to ${booking.currency} ${cap} per instalment because it is not held in escrow. Pay this one online.`,
          );
        }
      }

      const intent = isCash ? null : await this.gateway.createEscrowHold(amount, booking.currency);
      const payment = await paymentRepo.save(
        paymentRepo.create({
          bookingId: booking.id,
          userId: booking.userId,
          amount,
          commissionAmount: commission,
          payoutAmount: payout,
          currency: booking.currency,
          status: isCash ? PaymentStatus.RELEASED : PaymentStatus.HELD_IN_ESCROW,
          milestone,
          method,
          provider: isCash ? 'cash' : this.cfg.payments.provider,
          providerRef: intent?.providerRef ?? null,
          idempotencyKey: idempotencyKey ?? null,
        }),
      );

      // The advance is what turns an agreement into a booking. The later
      // instalments change no state of their own: the balance makes the job
      // completable, and the provider completes it once the buyer has also
      // accepted the delivery (EZ1-I266).
      if (milestone === PaymentMilestone.ADVANCE) {
        this.assertTransition(booking.status, BookingStatus.CONFIRMED);
        booking.status = BookingStatus.CONFIRMED;
        // Capacity was consumed when the provider accepted the job, not here.
        // The window has been theirs since then; the advance only releases
        // them to start work.
      }
      await bookingRepo.save(booking);

      await this.outbox.record(
        {
          eventType: 'booking.payment_held',
          aggregateType: 'booking',
          payload: { bookingId: booking.id, userId: booking.userId, amount, milestone },
        },
        manager,
      );
      await this.audit.record(
        {
          action: AuditAction.BOOKING_ESCROW_HELD,
          actor,
          resourceType: 'booking',
          resourceId: booking.id,
          metadata: { amount, milestone, commission, payout },
        },
        manager,
      );

      return { booking, payment };
    });

    // A planner booking that has just been confirmed by its advance makes the
    // buyer that planner's client — no separate "engage" step (EZ1-I116). Done
    // after the payment transaction so a failure here never rolls the money back.
    if (
      result.booking.providerType === ProviderType.PLANNER &&
      result.booking.status === BookingStatus.CONFIRMED
    ) {
      await this.autoEngagePlanner(result.booking).catch(() => undefined);
    }

    return result;
  }

  /**
   * Links a confirmed planner booking to the client's wedding plan, which is
   * what puts the client on the planner's My Clients list (EZ1-I116). Idempotent
   * and best-effort: a plan already engaged to this planner is left alone, and a
   * client with no plan yet simply has nothing to link.
   */
  private async autoEngagePlanner(booking: Booking): Promise<void> {
    const planner = await this.planners.findOne({ where: { id: booking.providerId } });
    if (!planner) return;
    const plans = await this.weddingPlans.find({ where: { userId: booking.userId } });

    // The couple booked a planner before ever starting a wedding plan of their
    // own, so there was nothing to attach the engagement to and they never
    // appeared as a client (EZ1-I116). Create the plan the paid booking
    // implies — dated to the booking's event when it has one, otherwise left
    // for the couple to set — and engage against it.
    if (plans.length === 0) {
      await this.weddingPlans.save(
        this.weddingPlans.create({
          userId: booking.userId,
          weddingDate: booking.eventDate ?? null,
          plannerUserId: planner.ownerUserId,
          plannerBookingId: booking.id,
        }),
      );
      return;
    }

    for (const plan of plans) {
      // Never override a plan already engaged to a planner — theirs to release.
      if (plan.plannerUserId) continue;
      plan.plannerUserId = planner.ownerUserId;
      plan.plannerBookingId = booking.id;
      await this.weddingPlans.save(plan);
    }
  }

  /**
   * Whether this instalment is due yet.
   *
   * Two conditions, both necessary: the instalments run in order, and each one
   * is unlocked by something the provider has done.
   */
  private assertMilestoneAllowed(
    booking: Booking,
    next: PaymentMilestone,
    paid: Payment[],
  ): void {
    const done = paid.map((p) => p.milestone);
    const required: Record<PaymentMilestone, PaymentMilestone[]> = {
      [PaymentMilestone.ADVANCE]: [],
      [PaymentMilestone.SECOND]: [PaymentMilestone.ADVANCE],
      [PaymentMilestone.FINAL]: [PaymentMilestone.ADVANCE, PaymentMilestone.SECOND],
    };
    const missing = required[next].filter((m) => !done.includes(m));
    if (missing.length > 0) {
      throw new BadRequestException(`Pay the ${missing.join(' and ')} instalment first`);
    }

    const gate: Record<PaymentMilestone, { states: BookingStatus[]; because: string }> = {
      [PaymentMilestone.ADVANCE]: {
        states: [BookingStatus.PAYMENT_PENDING, BookingStatus.PENDING],
        because: 'The provider has to accept the job before the advance is payable',
      },
      [PaymentMilestone.SECOND]: {
        states: [BookingStatus.IN_PROGRESS],
        because: 'The second instalment falls due once the provider has started work',
      },
      [PaymentMilestone.FINAL]: {
        states: [BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT],
        because: 'The balance falls due once the provider has confirmed the work is finished',
      },
    };
    if (!gate[next].states.includes(booking.status)) {
      throw new BadRequestException(gate[next].because);
    }
  }

  /**
   * The provider accepts the job. From here the buyer can pay the advance.
   *
   * On a quotation-driven booking the price is already agreed; on a
   * listed-price one this is where the provider signs up to it.
   */
  async confirm(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (parseFloat(booking.amount) <= 0) {
      throw new BadRequestException('Send a quotation before accepting this job');
    }

    // This is the moment the window is actually spent.
    //
    // Not when the buyer asked, not when the quotation went out, not when the
    // buyer accepted it — a request is a question and this is the answer. And
    // not at the advance either: by then the provider has already promised the
    // day, and discovering a clash at payment time is discovering it too late.
    //
    // The capacity re-check lives under a row lock inside `availability.confirm`,
    // because between the family asking and the provider answering, other
    // people may have been confirmed into the same window.
    return this.dataSource.transaction(async (manager) => {
      if (booking.slotId) await this.availability.confirm(manager, booking.slotId);

      this.assertTransition(booking.status, BookingStatus.PAYMENT_PENDING);
      booking.status = BookingStatus.PAYMENT_PENDING;
      const saved = await manager.getRepository(Booking).save(booking);

      await this.outbox.record(
        {
          eventType: 'booking.confirmed',
          aggregateType: 'booking',
          payload: { bookingId, providerId: booking.providerId, amount: booking.amount },
        },
        manager,
      );
      return saved;
    });
  }

  /**
   * The customer chose a published, fixed price and the provider accepts that
   * request as-is. Unlike a budget, `estimatedAmount` is the immutable total
   * the customer was shown for the selected offering and quantity, so it can
   * become the agreed amount without asking either side to re-enter a quote.
   */
  async acceptListedPrice(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Only a new fixed-price request can be accepted at its listed price');
    }
    if (!booking.offeringId || !booking.estimatedAmount || parseFloat(booking.estimatedAmount) <= 0) {
      throw new BadRequestException('This request has no selected fixed price. Send a quotation instead.');
    }
    await this.assertNotNegotiating(booking);
    // A budget below the listed price is the customer asking for less. Taking
    // the listed price over it would charge them more than they asked to pay.
    if (
      Number(booking.expectedBudget ?? 0) > 0 &&
      toMinor(booking.expectedBudget as string) !== toMinor(booking.estimatedAmount)
    ) {
      throw new BadRequestException(
        `The customer asked for ${booking.currency} ${Number(booking.expectedBudget).toLocaleString('en-IN')}. ` +
          'Accept their budget, or send a quotation.',
      );
    }

    return this.agreeCustomerPrice(actor, booking, booking.estimatedAmount);
  }

  /**
   * The provider accepts the price the customer asked for (ISS-18, row 17).
   *
   * The customer's price is the budget they named, else the listed price they
   * picked -- never the listed price over a lower budget. The provider says
   * back the amount they were shown; a mismatch is refused rather than agreeing
   * some other figure. Once a quotation has been sent the price is agreed
   * through quotations only: a requote request is answered with a revised
   * quotation, not by falling back to the listing.
   */
  async acceptRequest(
    actor: AuthUser,
    bookingId: string,
    dto?: { amount?: number },
  ): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (booking.status !== BookingStatus.REQUESTED) {
      throw new BadRequestException('Only a new customer request can be accepted');
    }
    await this.assertNotNegotiating(booking);

    const ask = customerAsk(booking);
    if (!ask) {
      throw new BadRequestException('This request has no customer price or budget. Send a quotation instead.');
    }
    if (dto?.amount === undefined || dto.amount === null) {
      throw new BadRequestException('Confirm the amount you are accepting');
    }
    if (Math.round(Number(dto.amount) * 100) !== toMinor(ask.amount)) {
      throw new BadRequestException(
        `The customer asked for ${booking.currency} ${Number(ask.amount).toLocaleString('en-IN')}. ` +
          'Accept that amount, or send a quotation.',
      );
    }

    return this.agreeCustomerPrice(actor, booking, ask.amount);
  }

  /**
   * Refuses a direct acceptance once a quotation exists on the booking.
   *
   * After the provider has quoted, the price is whatever the two sides agree
   * through quotations. Accepting "the request" then could only fall back to
   * the listing or the budget -- figures the negotiation has already moved
   * past -- which is how a declined 22,000 counter ended up agreed at the
   * 25,000 listing.
   */
  private async assertNotNegotiating(booking: Booking): Promise<void> {
    const quotations = await this.quotations.find({ where: { bookingId: booking.id } });
    if (quotations.length === 0) return;
    throw new BadRequestException(
      awaitingRequote(booking.status, quotations)
        ? 'The customer rejected your quotation and asked for a requote. Send a revised quotation, or cancel.'
        : 'A quotation is already on this booking. The price is agreed through quotations now.',
    );
  }

  private async agreeCustomerPrice(actor: AuthUser, booking: Booking, amount: string): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      if (booking.slotId) await this.availability.confirm(manager, booking.slotId);

      this.assertTransition(booking.status, BookingStatus.PAYMENT_PENDING);
      booking.amount = Number(amount).toFixed(2);
      booking.status = BookingStatus.PAYMENT_PENDING;
      const saved = await manager.getRepository(Booking).save(booking);

      const events = manager.getRepository(QuotationEvent);
      await events.save(
        events.create({
          bookingId: booking.id,
          kind: 'request_accepted',
          amount: booking.amount,
          currency: booking.currency,
          actorRole: 'provider',
          actorUserId: actor.userId,
          quotationId: null,
          note: null,
          occurredAt: new Date(),
        }),
      );

      await this.outbox.record(
        {
          eventType: 'booking.confirmed',
          aggregateType: 'booking',
          payload: { bookingId: booking.id, providerId: booking.providerId, amount: booking.amount },
        },
        manager,
      );
      return saved;
    });
  }

  /**
   * The provider says they have started. Refused until the advance is actually
   * held — that is the entire purpose of taking one.
   */
  async startWork(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (!(await this.hasHeld(bookingId, PaymentMilestone.ADVANCE))) {
      throw new BadRequestException('The advance payment has not been completed yet');
    }
    booking.startedAt = new Date();
    const saved = await this.transition(booking, BookingStatus.IN_PROGRESS);

    // The advance is released to the provider the moment they start the work
    // (EZ1-I100): it has done its job of committing the buyer, and the provider
    // is now out of pocket on materials and time. Only the advance — the second
    // and final instalments stay in escrow until the work is completed and
    // signed off. An open case freezes everything, so it is checked first.
    if (!(await this.cases.hasOpenCaseFor(bookingId))) {
      await this.releaseHeld(actor, bookingId, PaymentMilestone.ADVANCE);
    }

    await this.outbox.record({
      eventType: 'booking.started',
      aggregateType: 'booking',
      payload: { bookingId, userId: booking.userId },
    });
    return saved;
  }

  /**
   * The provider says the work is delivered. This does not complete the
   * booking — it makes the balance payable, and the provider completes it once
   * the balance is in and the buyer has accepted the delivery.
   */
  async completeWork(
    actor: AuthUser,
    bookingId: string,
    dto: MarkDeliveredDto = {},
  ): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding this booking. It moves on when a settlement is recorded.',
      );
    }
    if (!(await this.hasHeld(bookingId, PaymentMilestone.SECOND))) {
      throw new BadRequestException('The second instalment has not been completed yet');
    }

    booking.completedAt = new Date();
    // What was handed over, kept with the booking (EZ1-I228). Only overwritten
    // when something was actually supplied, so re-marking a delivery does not
    // wipe the evidence attached the first time.
    booking.deliveredAt = new Date();
    if (dto.notes?.trim()) booking.deliveryNotes = dto.notes.trim();
    if (dto.evidence?.length) booking.deliveryEvidence = dto.evidence;
    const saved = await this.transition(booking, BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT);

    await this.outbox.record({
      eventType: 'booking.work_completed',
      aggregateType: 'booking',
      payload: { bookingId, userId: booking.userId },
    });
    return saved;
  }

  /**
   * The provider closes the job (EZ1-I266).
   *
   * Only once nothing is left to wait on: the balance is in and, for delivered
   * work, the buyer has accepted it. Paying the balance used to complete the
   * booking on its own, which completed jobs the buyer had not signed off and
   * left the provider no last step. Completing is also what pays them out.
   */
  async markCompleted(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (booking.status !== BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT) {
      throw new BadRequestException('Only a delivered booking can be marked completed');
    }
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding this booking. It moves on when a settlement is recorded.',
      );
    }
    const balance = await this.payments.find({
      where: { bookingId, milestone: PaymentMilestone.FINAL },
    });
    if (!balance.some((payment) => isCollected(payment.status))) {
      throw new BadRequestException('The customer has not paid the balance yet');
    }
    if (booking.deliveredAt && !booking.deliveryAcceptedAt) {
      throw new BadRequestException(
        'The customer has not confirmed the delivery yet. They accept it, or raise a dispute.',
      );
    }

    const saved = await this.transition(booking, BookingStatus.COMPLETED);
    await this.outbox.record({
      eventType: 'booking.completed',
      aggregateType: 'booking',
      payload: { bookingId, userId: booking.userId },
    });
    // After the state change rather than inside it, so a failed transfer
    // leaves the money held with the booking complete, and settle can move it.
    await this.releaseIfSettled(actor, saved).catch(() => undefined);
    return saved;
  }

  /**
   * Releases every held instalment to the provider.
   *
   * Called once the balance is in and the booking is complete. An open case
   * blocks it outright: escrow a provider can release while the buyer disputes
   * it is not escrow.
   */
  /**
   * The buyer says the work was done as agreed.
   *
   * The half of the escrow flow that was missing: money became releasable when
   * the balance arrived, which records that the buyer *paid* rather than that
   * they were *satisfied* (EZ1-I228). Accepting is what turns held money into
   * money the provider is owed; the alternative is to raise a dispute, which
   * freezes it instead.
   */
  async confirmDelivery(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertBuyerSide(actor, booking);

    if (!booking.deliveredAt) {
      throw new BadRequestException('The provider has not marked this delivered yet');
    }
    if (booking.deliveryAcceptedAt) return booking;
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding this booking. It moves on when a settlement is recorded.',
      );
    }

    booking.deliveryAcceptedAt = new Date();
    const saved = await this.bookings.save(booking);

    await this.outbox.record({
      eventType: 'booking.delivery_accepted',
      aggregateType: 'booking',
      payload: { bookingId, userId: booking.userId },
    });
    await this.releaseIfSettled(actor, saved).catch(() => undefined);
    return saved;
  }

  /**
   * Pays the provider once there is nothing left to wait on (EZ1-I266).
   *
   * The same conditions `settle` checks -- the balance is in, delivered work
   * has been accepted, no case is open -- applied as soon as the last of them
   * becomes true, rather than waiting on a button neither side was shown.
   */
  private async releaseIfSettled(actor: AuthUser, booking: Booking): Promise<void> {
    if (booking.status !== BookingStatus.COMPLETED) return;
    if (booking.deliveredAt && !booking.deliveryAcceptedAt) return;
    if (await this.cases.hasOpenCaseFor(booking.id)) return;
    await this.releaseHeld(actor, booking.id);
  }

  async settle(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('The booking is not complete yet');
    }
    /*
     * Delivered work needs the buyer's word before the money moves.
     *
     * Conditioned on `deliveredAt` rather than on the acceptance being absent,
     * so bookings that completed before this flow existed settle exactly as
     * they did — there is nothing for their buyers to have accepted.
     */
    if (booking.deliveredAt && !booking.deliveryAcceptedAt) {
      throw new BadRequestException(
        'The customer has not confirmed the delivery yet. They accept it, or raise a dispute.',
      );
    }
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding the money on this booking. It is released by a settlement decision.',
      );
    }

    await this.releaseHeld(actor, bookingId);
    return booking;
  }

  /**
   * Transfer every owed payout on one booking in full, at the provider's asking.
   *
   * Refused outright when there is nowhere to send it: attempting a transfer
   * to no account would change nothing and only leave a trail of releases
   * that never happened. Safe to call twice at once; see releaseOnePending.
   */
  async releasePayout(
    actor: AuthUser,
    bookingId: string,
    milestone?: PaymentMilestone,
  ): Promise<{ bookingId: string; released: number; notReleased: string[] }> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException('An open case is holding this booking.');
    }

    const pending = await this.payments.find({
      where: {
        bookingId,
        status: PaymentStatus.PENDING_PAYOUT,
        ...(milestone ? { milestone } : {}),
      },
    });
    if (pending.length === 0) {
      throw new BadRequestException('No eligible payout remains for this booking');
    }

    const destination = await this.payoutDestination(booking);
    if (!destination.accountId) {
      throw new BadRequestException(
        'There is no active payout account to send this to yet. It is released once your ' +
          'payout account is set up and verified.',
      );
    }

    let released = 0;
    const notReleased: string[] = [];
    for (const row of pending) {
      const outcome = await this.releaseOnePending(row.id, destination);
      // Claimed by a concurrent release, or already released: nothing to do.
      if (!outcome) continue;
      const { payment, result } = outcome;
      if (!result.transferred) {
        notReleased.push(result.reason ?? 'The transfer was not made');
        continue;
      }
      released += 1;
      await this.audit.record({
        action: AuditAction.BOOKING_ESCROW_RELEASED,
        actor,
        resourceType: 'booking',
        resourceId: bookingId,
        metadata: {
          gross: payment.amount,
          milestone: payment.milestone,
          payout: payment.payoutAmount,
          commission: payment.commissionAmount,
          transferred: true,
          reason: null,
        },
      });
    }
    return { bookingId, released, notReleased };
  }

  /**
   * Moves every held payment on a booking to the provider.
   *
   * A provider whose payout onboarding is not finished has no account to
   * transfer to. That is a normal state — they can take bookings and complete
   * work while their KYC clears — so the money stays in escrow with the reason
   * recorded, rather than being marked released against a transfer that never
   * happened. `PENDING_PAYOUT` is the difference between "we paid them" and "we
   * owe them", and collapsing those two was the thing worth avoiding.
   */
  private async releaseHeld(
    actor: AuthUser | undefined,
    bookingId: string,
    milestone?: PaymentMilestone,
  ): Promise<number> {
    const held = await this.payments.find({
      where: {
        bookingId,
        status: PaymentStatus.HELD_IN_ESCROW,
        ...(milestone ? { milestone } : {}),
      },
    });
    if (held.length === 0) return 0;

    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    const destination = booking
      ? await this.payoutDestination(booking)
      : { accountId: null, label: 'unknown provider' };

    let moved = 0;
    for (const payment of held) {
      if (!payment.providerRef) continue;
      // Release only the seller share; the commission stays with the platform.
      // Recompute if the row predates the split columns.
      const stored = parseFloat(payment.payoutAmount) > 0;
      const split = stored
        ? { payout: payment.payoutAmount, commission: payment.commissionAmount }
        : this.splitAmount(payment.amount);

      const result = await this.gateway.release(
        payment.providerRef,
        split.payout,
        payment.currency,
        destination,
      );

      await this.payments.update(payment.id, {
        status: result.transferred ? PaymentStatus.RELEASED : PaymentStatus.PENDING_PAYOUT,
        payoutAmount: split.payout,
        commissionAmount: split.commission,
        payoutRef: result.transferRef,
        payoutNote: result.reason,
      });
      if (result.transferred) moved += 1;

      await this.audit.record({
        action: AuditAction.BOOKING_ESCROW_RELEASED,
        actor,
        resourceType: 'booking',
        resourceId: bookingId,
        metadata: {
          gross: payment.amount,
          milestone: payment.milestone,
          payout: split.payout,
          commission: split.commission,
          transferred: result.transferred,
          reason: result.reason,
        },
      });
    }
    return moved;
  }

  /**
   * Transfers one owed payment, if nobody else is already doing so.
   *
   * The row is claimed with a row lock that skips rather than waits, inside a
   * transaction that also covers the write-back. Two releases racing for the
   * same payment (a double click, or a click landing while the nightly retry
   * runs) therefore never both reach the gateway: the loser finds the row
   * locked, or no longer owed, and returns null. The status is only ever
   * written back on a row that is still PENDING_PAYOUT, so a failed attempt
   * cannot overwrite a payment somebody else has already released.
   */
  private async releaseOnePending(
    paymentId: string,
    destination: PayoutDestination,
  ): Promise<{ payment: Payment; result: PayoutResult } | null> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Payment);
      const payment = await repo.findOne({
        where: { id: paymentId, status: PaymentStatus.PENDING_PAYOUT },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (!payment?.providerRef) return null;

      const result = await this.gateway.release(
        payment.providerRef,
        payment.payoutAmount,
        payment.currency,
        destination,
      );
      await repo.update(
        { id: payment.id, status: PaymentStatus.PENDING_PAYOUT },
        result.transferred
          ? { status: PaymentStatus.RELEASED, payoutRef: result.transferRef, payoutNote: null }
          : { payoutNote: result.reason },
      );
      return { payment, result };
    });
  }

  /**
   * Moves the money a dispute settlement decided.
   *
   * The settlement path used to write payment statuses and nothing else: an
   * officer resolved a case, the row flipped to RELEASED or REFUNDED, the
   * buyer's escrow page agreed, the audit log agreed, and the gateway was
   * never called. Nobody was paid and nobody was refunded, and because the row
   * had left DISPUTED no sweep would ever find it again -- the money sat on
   * the platform account with the ledger claiming otherwise (council review,
   * 2026-09-10).
   *
   * So settlement moves money here, in the same service that holds every other
   * escrow transition, and records only what the gateway confirms. A failure
   * leaves the payment DISPUTED with the reason on the row, which is both true
   * and recoverable: the case can be settled again.
   *
   * PARTIAL splits one held instalment two ways -- `settledAmount` to the
   * provider, the remainder back to the buyer. It used to release the whole
   * amount and discard the figure the officer had entered, so a 50,000 dispute
   * settled at 20,000 paid the provider 50,000.
   */
  async settleDisputed(
    bookingId: string,
    outcome: 'release' | 'refund' | 'partial',
    settledAmount?: string | null,
    actor?: AuthUser,
  ): Promise<{ moved: number; failed: number }> {
    const disputed = await this.payments.find({
      where: { bookingId, status: PaymentStatus.DISPUTED },
    });
    if (disputed.length === 0) return { moved: 0, failed: 0 };

    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    const destination = booking
      ? await this.payoutDestination(booking)
      : { accountId: null, label: 'unknown provider' };

    /*
     * A partial settlement names one figure for the whole booking, and escrow
     * can hold several instalments. The figure is applied across them in order
     * -- earliest instalment first -- so the provider is paid exactly the
     * amount decided and the rest goes back, whatever the instalment split
     * happened to be.
     */
    let remainingToProvider = outcome === 'partial' ? Number(settledAmount ?? 0) : 0;
    let moved = 0;
    let failed = 0;

    for (const payment of disputed) {
      if (!payment.providerRef) {
        failed += 1;
        continue;
      }

      const gross = Number(payment.amount);
      const toProvider =
        outcome === 'release' ? gross
        : outcome === 'refund' ? 0
        : Math.max(0, Math.min(gross, remainingToProvider));
      const toBuyer = gross - toProvider;
      if (outcome === 'partial') remainingToProvider -= toProvider;

      // What actually left the platform, so the row can be written truthfully
      // even when only one leg succeeds.
      let releasedOk = toProvider === 0;
      let refundedOk = toBuyer === 0;
      let note: string | null = null;
      let payoutRef: string | null = payment.payoutRef ?? null;
      let split = { payout: '0.00', commission: '0.00' };

      if (toProvider > 0) {
        // Commission is taken on the settled share, not on the original
        // amount: the platform earns on what the provider is actually paid.
        split = this.splitAmount(toProvider.toFixed(2));
        const result = await this.gateway.release(
          payment.providerRef,
          split.payout,
          payment.currency,
          destination,
        );
        releasedOk = result.transferred;
        payoutRef = result.transferRef;
        if (!result.transferred) note = result.reason;
      }

      if (toBuyer > 0) {
        const refund = await this.gateway.refund(payment.providerRef, toBuyer.toFixed(2));
        refundedOk = refund.refunded;
        if (!refund.refunded) note = refund.reason ?? note;
      }

      /*
       * A refund that did not happen is the one failure that must hold.
       *
       * The buyer's money cannot be recorded as returned on the strength of
       * having asked, so the row stays DISPUTED with the reason and the case
       * can be settled again.
       *
       * A release that did not transfer is different, and the rest of this
       * service already models it: the provider is owed rather than paid, and
       * PENDING_PAYOUT is that state -- the usual cause is a provider whose
       * payout onboarding has not cleared, which the nightly sweep retries.
       * Treating it as a failure would leave every settlement against such a
       * provider stuck in dispute.
       */
      if (!refundedOk) {
        failed += 1;
        await this.payments.update(payment.id, {
          payoutNote: note ?? 'The gateway did not confirm the refund',
        });
        continue;
      }

      const status =
        !releasedOk ? PaymentStatus.PENDING_PAYOUT
        : toProvider === 0 ? PaymentStatus.REFUNDED
        : toBuyer === 0 ? PaymentStatus.RELEASED
        : PaymentStatus.PARTIALLY_SETTLED;

      await this.payments.update(payment.id, {
        status,
        payoutAmount: split.payout,
        commissionAmount: split.commission,
        payoutRef,
        // Kept when the provider is owed rather than paid, so the sweep and the
        // operator both know why.
        payoutNote: releasedOk ? null : note,
      });
      moved += 1;

      await this.audit.record({
        action:
          toProvider === 0
            ? AuditAction.BOOKING_ESCROW_REFUNDED
            : AuditAction.BOOKING_ESCROW_RELEASED,
        actor,
        resourceType: 'booking',
        resourceId: bookingId,
        metadata: {
          settlement: outcome,
          milestone: payment.milestone,
          gross: payment.amount,
          toProvider: toProvider.toFixed(2),
          toBuyer: toBuyer.toFixed(2),
          commission: split.commission,
        },
      });
    }

    return { moved, failed };
  }

  /** The seller's linked account on the gateway, and who they are. */
  private async payoutDestination(booking: Booking): Promise<PayoutDestination> {
    if (booking.providerType === ProviderType.VENDOR) {
      const vendor = await this.vendors.findOne({ where: { id: booking.providerId } });
      return { accountId: vendor?.payoutAccountId ?? null, label: vendor?.name ?? 'vendor' };
    }
    const planner = await this.planners.findOne({ where: { id: booking.providerId } });
    return { accountId: planner?.payoutAccountId ?? null, label: planner?.agencyName ?? 'planner' };
  }

  /**
   * Transfers everything owed to the calling provider, across all their bookings.
   *
   * The Payments page's "Release all available": the same per-booking release,
   * applied to every booking with an owed payout, skipping any held by an open
   * case. Refused up front when there is no active payout account, for the
   * same reason a single release is.
   */
  async releaseAllPayouts(actor: AuthUser): Promise<{
    released: number;
    bookings: number;
    skipped: { bookingId: string; reason: string }[];
  }> {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) {
      throw new BadRequestException('There are no listings on this account to pay out');
    }
    const owned = await this.bookings.find({
      where: { providerId: In(providerIds) },
      select: ['id'],
    });
    const pending = owned.length
      ? await this.payments.find({
          where: { bookingId: In(owned.map((b) => b.id)), status: PaymentStatus.PENDING_PAYOUT },
        })
      : [];
    const bookingIds = [...new Set(pending.map((p) => p.bookingId))];
    if (bookingIds.length === 0) {
      throw new BadRequestException('Nothing is waiting to be paid out');
    }

    let released = 0;
    const skipped: { bookingId: string; reason: string }[] = [];
    for (const bookingId of bookingIds) {
      try {
        const result = await this.releasePayout(actor, bookingId);
        released += result.released;
        for (const reason of result.notReleased) skipped.push({ bookingId, reason });
      } catch (err) {
        // No payout account is the same answer for every booking: say it once.
        const reason = err instanceof Error ? err.message : 'The transfer was not made';
        if (/no active payout account/i.test(reason)) throw err;
        skipped.push({ bookingId, reason });
      }
    }
    return { released, bookings: bookingIds.length, skipped };
  }

  /**
   * Retries a payout that could not be made when the work was completed.
   *
   * Run on a schedule rather than left for somebody to notice: the usual reason
   * is a provider finishing their onboarding a week after finishing the job,
   * and there is no event to hang that on.
   */
  async retryPendingPayouts(): Promise<{ attempted: number; released: number }> {
    const pending = await this.payments.find({
      where: { status: PaymentStatus.PENDING_PAYOUT },
    });

    let released = 0;
    for (const payment of pending) {
      if (!payment.providerRef) continue;
      const booking = await this.bookings.findOne({ where: { id: payment.bookingId } });
      if (!booking) continue;

      const destination = await this.payoutDestination(booking);
      if (!destination.accountId) continue;

      // Claimed row by row, so a provider releasing by hand at the same moment
      // cannot be paid twice or have a finished release written back as owed.
      const outcome = await this.releaseOnePending(payment.id, destination);
      if (outcome?.result.transferred) released += 1;
    }
    return { attempted: pending.length, released };
  }

  /** Is this instalment held (or already released) on this booking? */
  private async hasHeld(bookingId: string, milestone: PaymentMilestone): Promise<boolean> {
    const count = await this.payments.count({
      where: [
        { bookingId, milestone, status: PaymentStatus.HELD_IN_ESCROW },
        { bookingId, milestone, status: PaymentStatus.RELEASED },
        { bookingId, milestone, status: PaymentStatus.DISPUTED },
      ],
    });
    return count > 0;
  }

  /**
   * Either side may cancel; every held instalment is refunded and the slot goes
   * back on sale.
   */
  async cancel(actor: AuthUser, bookingId: string, reason?: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding the money on this booking. It is refunded by a settlement decision.',
      );
    }

    // "Confirmed" here means the provider had accepted the job and the window
    // was spent — which now happens at PAYMENT_PENDING, not at the advance.
    // Cancelling from earlier than that gives back a pending request instead.
    const wasConfirmed = [
      BookingStatus.PAYMENT_PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
    ].includes(booking.status);
    const heldSlot = HOLDS_SLOT.includes(booking.status);

    booking.cancellationReason = reason ?? null;
    booking.cancelledByUserId = actor.userId;
    booking.cancelledAt = new Date();
    const saved = await this.transition(booking, BookingStatus.CANCELLED);

    // Give the window back. `wasConfirmed` decides whether a confirmed booking
    // is being un-counted or a mere request is being let go.
    if (heldSlot && booking.slotId) {
      await this.availability.release(booking.slotId, wasConfirmed);
    }

    const held = await this.payments.find({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    for (const payment of held) {
      if (!payment.providerRef) continue;
      // Refunds return the FULL amount to the buyer: the platform earns no
      // commission on a booking that never happened.
      //
      // And only recorded when the gateway confirms it. This wrote REFUNDED
      // unconditionally, so a refund lost to a 5xx or an unfindable capture
      // still showed on the buyer's escrow page as money returned, with the
      // booking cancelled and nothing left to retry it. A failure now stays
      // HELD_IN_ESCROW with the reason on the row, which is true and
      // recoverable (council review, 2026-09-10).
      const outcome = await this.gateway.refund(payment.providerRef, payment.amount);
      if (!outcome.refunded) {
        await this.payments.update(payment.id, {
          payoutNote: outcome.reason ?? 'The gateway did not confirm the refund',
        });
        continue;
      }
      await this.payments.update(payment.id, {
        status: PaymentStatus.REFUNDED,
        commissionAmount: '0.00',
        payoutAmount: '0.00',
        payoutNote: null,
      });
      await this.audit.record({
        action: AuditAction.BOOKING_ESCROW_REFUNDED,
        actor,
        resourceType: 'booking',
        resourceId: bookingId,
        metadata: { amount: payment.amount, milestone: payment.milestone, reason: reason ?? null },
      });
    }

    await this.outbox.record({
      eventType: 'booking.cancelled',
      aggregateType: 'booking',
      // The reason and who cancelled travel with the event so the notification
      // can tell the other side both (EZ1-I77), not just that it happened.
      payload: {
        bookingId,
        cancelledBy: actor.userId,
        cancellationReason: reason ?? null,
        refunded: held.length,
      },
    });
    return saved;
  }

  /**
   * The booking's activity, in order (EZ1-I68).
   *
   * Synthesised rather than stored: the facts already live on the booking's
   * timestamps, its quotations and its payments, so a timeline is a read over
   * those three rather than a fourth log to keep in step with them. Either party
   * to the booking may read it.
   */
  async history(
    actor: AuthUser,
    bookingId: string,
  ): Promise<{ at: Date; label: string; detail: string | null }[]> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);

    const [quotations, payments] = await Promise.all([
      this.quotations.find({ where: { bookingId }, order: { createdAt: 'ASC' } }),
      this.payments.find({ where: { bookingId }, order: { createdAt: 'ASC' } }),
    ]);

    const money = (v: string | number) =>
      `${booking.currency} ${Number(v).toLocaleString('en-IN')}`;
    const events: { at: Date; label: string; detail: string | null }[] = [
      { at: booking.createdAt, label: 'Request placed', detail: null },
    ];
    // Every offer, and what became of each, so a declined price and the
    // revision that followed it stay readable on both sides (EZ1-I264).
    quotations.forEach((q, index) => {
      const amount = money(q.amount);
      events.push({
        at: q.createdAt,
        label: index === 0 ? 'Quotation sent' : 'Revised quotation sent',
        detail: amount,
      });
      const at = q.respondedAt ?? q.updatedAt;
      if (q.status === QuotationStatus.ACCEPTED) {
        events.push({ at, label: 'Quotation accepted', detail: amount });
      } else if (q.status === QuotationStatus.REJECTED) {
        events.push({
          at,
          label: 'Quotation declined — re-quote requested',
          detail: [amount, q.responseNote].filter(Boolean).join(' · '),
        });
      } else if (q.status === QuotationStatus.WITHDRAWN) {
        events.push({ at, label: 'Quotation withdrawn by the provider', detail: amount });
      } else if (q.status === QuotationStatus.EXPIRED) {
        events.push({ at: q.validUntil ?? q.updatedAt, label: 'Quotation expired', detail: amount });
      }
    });
    const PAID_ON = [
      PaymentStatus.RELEASED,
      PaymentStatus.PENDING_PAYOUT,
      PaymentStatus.PARTIALLY_SETTLED,
    ];
    for (const p of payments) {
      const milestone = p.milestone.replace(/_/g, ' ');
      // Cash never passes through escrow; an online instalment that has moved
      // on was received first and paid out later, which are two moments.
      const movedOn = PAID_ON.includes(p.status) && p.provider !== 'cash';
      events.push({
        at: p.createdAt,
        label: movedOn
          ? `Payment ${milestone} — held in escrow`
          : `Payment ${milestone} — ${p.status.replace(/_/g, ' ')}`,
        detail: money(p.amount),
      });
      if (movedOn) {
        events.push({
          at: p.updatedAt,
          label:
            p.status === PaymentStatus.PENDING_PAYOUT
              ? `Payout ${milestone} — owed to the provider`
              : `Payout ${milestone} — released to the provider`,
          detail: money(p.payoutAmount),
        });
      }
    }
    if (booking.startedAt) events.push({ at: booking.startedAt, label: 'Work started', detail: null });
    if (booking.completedAt)
      events.push({
        at: booking.completedAt,
        label: 'Marked delivered',
        // What the provider said they handed over, so the timeline carries it too.
        detail: booking.deliveryNotes ?? null,
      });
    if (booking.deliveryAcceptedAt) {
      events.push({
        at: booking.deliveryAcceptedAt,
        label: 'Delivery confirmed by the customer',
        detail: null,
      });
    }
    if (booking.cancelledAt) {
      events.push({
        at: booking.cancelledAt,
        label: 'Cancelled',
        detail: booking.cancellationReason ?? null,
      });
    }

    return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  /**
   * Moves a booking into DISPUTED. Called by the support-case flow rather than
   * by a controller, so the booking state and the frozen money always change
   * together.
   */
  async markDisputed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) return;
    if (!ALLOWED[booking.status].includes(BookingStatus.DISPUTED)) return;
    booking.status = BookingStatus.DISPUTED;
    await this.bookings.save(booking);
  }

  /**
   * Buyer-side listing: the caller's own bookings.
   *
   * This carried an AGENT branch -- "plus managed clients', for an agent" --
   * left over from the model EZ1-I29 removed. Its only caller is gated on
   * BOOKING_READ_OWN and the agent row holds no BOOKING_* permission at all,
   * so the guard refused before the branch could run; it described a
   * capability agents have not had for some time, and it was the only
   * bookedByUserId-aware read in the file, which made it the thing a future
   * "planner cannot see what they placed" fix would be extended from
   * (council round 2). A planner reads what they placed for a client on that
   * client's own page, which is where the redirect now lands.
   */
  async listForBuyer(actor: AuthUser, q: BookingSearchDto): Promise<PaginatedResult<Booking>> {
    const qb = this.bookings.createQueryBuilder('b');

    // A match-fixed couple share one wedding, so a booking made from either
    // account is visible in the other (EZ1-I160): both sides read the same
    // rows, which is what keeps the shared view inherently in sync. For
    // everyone else this is exactly the caller's own bookings.
    const partnerUserId = await this.matchmaking.fixedPartnerUserId(actor.userId);
    if (partnerUserId) {
      qb.where('b."userId" IN (:...ids)', { ids: [actor.userId, partnerUserId] });
    } else {
      qb.where('b."userId" = :me', { me: actor.userId });
    }

    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    qb.orderBy('b."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    const named = await this.withProviderNames(data);
    const withContext = await this.withClientContext(named);
    if (partnerUserId) {
      for (const b of withContext) b.sharedFromPartner = b.userId === partnerUserId;
    }
    return paginate(await this.withMyReviews(actor.userId, withContext), total, q.page, q.limit);
  }

  /**
   * Attaches the buyer's own review to each booking they have reviewed, so the
   * list can hide the "Write a review" form and show what was written instead
   * (EZ1-I114). Only the caller's own reviews — never anybody else's.
   *
   * Both kinds of provider. Planner reviews live in their own table (EZ1-I244)
   * and reading only the vendor one left a couple who had reviewed their
   * planner still being offered the form, and their own words nowhere.
   */
  private async withMyReviews(userId: string, rows: Booking[]): Promise<Booking[]> {
    const ids = rows.map((b) => b.id);
    if (ids.length === 0) return rows;
    const [vendorReviews, plannerReviews] = await Promise.all([
      this.vendorReviews.find({ where: { userId, bookingId: In(ids) } }),
      this.plannerReviews.find({ where: { userId, bookingId: In(ids) } }),
    ]);
    const byBooking = new Map(
      [...vendorReviews, ...plannerReviews].map((r) => [r.bookingId, r]),
    );
    for (const b of rows) {
      const r = byBooking.get(b.id);
      b.myReview = r ? { rating: r.rating, comment: r.comment } : null;
    }
    return rows;
  }

  /**
   * How many of each status are waiting, for the tabs above the list.
   *
   * Counted rather than derived from the current page: a tab reading
   * "Requests" with no number beside it tells a provider nothing, and one
   * counting only what happens to be on screen is worse than none.
   */
  async incomingCounts(actor: AuthUser): Promise<Record<string, number>> {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) return {};

    const rows = await this.bookings
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('b."providerId" IN (:...ids)', { ids: providerIds })
      .groupBy('b.status')
      .getRawMany<{ status: string; count: string }>();

    /*
     * One key per status, each counted once, so a client adding up the
     * statuses of a tab gets the right number. `requests` gathers the three
     * request statuses for the dashboard tile; it is not a status name, so it
     * cannot be mistaken for one.
     */
    const counts: Record<string, number> = { all: 0, requests: 0 };
    for (const row of rows) {
      const n = Number(row.count) || 0;
      counts[row.status] = (counts[row.status] ?? 0) + n;
      counts.all += n;
      if ((REQUEST_STATUSES as string[]).includes(row.status)) counts.requests += n;
    }

    // Not a status, so not in the tally above. Counted with the same rule as
    // the row's flag, across the whole queue rather than the rows a client
    // happened to load (EZ1-I266).
    counts.request_on_date = await this.bookings
      .createQueryBuilder('b')
      .leftJoin(WeddingEvent, 'e', 'e.id = b."eventId"')
      .where('b."providerId" IN (:...ids)', { ids: providerIds })
      .andWhere('b."slotId" IS NULL')
      .andWhere('(b."eventDate" IS NOT NULL OR e."eventDate" IS NOT NULL)')
      .andWhere('b.status IN (:...statuses)', { statuses: REQUEST_STATUSES })
      .getCount();

    return counts;
  }

  /**
   * Buyer-side counts: the individual dashboard tiles (EZ1-I75), total,
   * active, cancelled and completed, plus one count per status for the tabs.
   * Scoped exactly like listForBuyer so the numbers match the list.
   */
  async buyerCounts(actor: AuthUser): Promise<Record<string, number> & {
    all: number;
    active: number;
    cancelled: number;
    completed: number;
  }> {
    const qb = this.bookings
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count');

    const partnerUserId = await this.matchmaking.fixedPartnerUserId(actor.userId);
    if (partnerUserId) {
      qb.where('b."userId" IN (:...ids)', { ids: [actor.userId, partnerUserId] });
    } else {
      qb.where('b."userId" = :me', { me: actor.userId });
    }
    const rows = await qb.groupBy('b.status').getRawMany<{ status: string; count: string }>();

    // One key per status, counted once, for the status tabs; the tiles' three
    // buckets are the same as before, with active everything still in flight
    // (a disputed booking included), so the buckets add up to the total.
    const counts: Record<string, number> = { all: 0 };
    for (const row of rows) {
      const n = Number(row.count) || 0;
      counts[row.status] = (counts[row.status] ?? 0) + n;
      counts.all += n;
    }
    const cancelled = counts[BookingStatus.CANCELLED] ?? 0;
    const completed = counts[BookingStatus.COMPLETED] ?? 0;
    return {
      ...counts,
      all: counts.all,
      active: counts.all - cancelled - completed,
      cancelled,
      completed,
    };
  }

  /**
   * Who the job is for, what it is, and whether money has moved.
   *
   * All of it existed and none of it was on the row. A provider deciding
   * whether to take a Saturday needs the couple, the date, the venue, the head
   * count and the service in front of them — and the payment state, because
   * "confirmed" and "confirmed and paid for" are different amounts of
   * commitment.
   */
  private async withClientContext(
    rows: Booking[],
    options: {
      /**
       * Whether the customer's email and phone go on the rows. Off for every
       * vendor list (WOW-06, row 15): a vendor reaches the customer through the
       * booking's own chat once the advance is paid, never off-platform before
       * it. Only the planner request screens, which are not this queue, keep
       * them.
       */
      includeContact?: boolean;
    } = {},
  ): Promise<Booking[]> {
    if (rows.length === 0) return rows;

    const userIds = [...new Set(rows.map((b) => b.userId))];
    const eventIds = [...new Set(rows.map((b) => b.eventId).filter(Boolean))] as string[];
    const serviceIds = [...new Set(rows.map((b) => b.vendorServiceId).filter(Boolean))] as string[];
    const offeringIds = [...new Set(rows.map((b) => b.offeringId).filter(Boolean))] as string[];

    const bookingIds = rows.map((b) => b.id);
    const [users, profiles, events, payments, serviceNames, offeringRows, quotationRows] =
      await Promise.all([
        options.includeContact
          ? this.users.find({ where: { id: In(userIds) }, select: ['id', 'email', 'phone'] })
          : Promise.resolve([] as User[]),
        this.profiles.find({ where: { userId: In(userIds) } }),
        eventIds.length ? this.events.find({ where: { id: In(eventIds) } }) : Promise.resolve([]),
        this.payments.find({ where: { bookingId: In(bookingIds) } }),
        serviceNamesByIds(this.serviceRows, serviceIds),
        this.offeringsFor(offeringIds, serviceIds),
        this.quotations.find({ where: { bookingId: In(bookingIds) } }),
      ]);
    const offeringById = new Map(offeringRows.map((o) => [o.id, o]));
    const modelsByService = new Map<string, string[]>();
    for (const offering of offeringRows) {
      if (!offering.active) continue;
      const list = modelsByService.get(offering.vendorServiceId) ?? [];
      if (!list.includes(offering.pricingModel)) list.push(offering.pricingModel);
      modelsByService.set(offering.vendorServiceId, list);
    }

    const byUser = new Map(users.map((u) => [u.id, u]));
    const nameByUser = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const profileByUser = new Map(profiles.map((p) => [p.userId as string, p]));
    const byEvent = new Map(events.map((e) => [e.id, e]));
    // A planner is booked for the whole wedding, not one function, so the
    // when and where of those bookings come from the wedding itself — also
    // when a function is linked but does not say.
    const weddingByClient = await this.weddingFactsFor([
      // Every couple on the page: a vendor booking with no place of its own is
      // read off what the couple has on that same day.
      ...new Set(rows.map((b) => b.userId)),
    ]);
    const cancellers = await this.cancellersOf(rows);

    const quotationsByBooking = new Map<string, Quotation[]>();
    for (const quotation of quotationRows) {
      const list = quotationsByBooking.get(quotation.bookingId) ?? [];
      list.push(quotation);
      quotationsByBooking.set(quotation.bookingId, list);
    }
    const milestonesByBooking = new Map<string, string[]>();
    for (const payment of payments) {
      if (!isCollected(payment.status)) continue;
      const list = milestonesByBooking.get(payment.bookingId) ?? [];
      list.push(payment.milestone);
      milestonesByBooking.set(payment.bookingId, list);
    }

    // The furthest a booking's money has got. Several payments can exist for
    // one booking — an advance and a balance — and what a provider wants is
    // the state of the job, not a list of transactions.
    const RANK = PAYMENT_STATUS_RANK;
    const paymentByBooking = new Map<string, string>();
    for (const payment of payments) {
      const seen = paymentByBooking.get(payment.bookingId);
      if (!seen || (RANK[payment.status] ?? 0) > (RANK[seen] ?? 0)) {
        paymentByBooking.set(payment.bookingId, payment.status);
      }
    }

    /*
     * What has actually been collected on each booking (EZ1-I259).
     *
     * A confirmed job shows "paid so far" and "remaining" on the row, which
     * until now needed the instalment endpoint per booking — forty bookings,
     * forty requests, to answer a question these payments already contain.
     */
    const paidByBooking = collectedByBooking(payments);

    for (const booking of rows) {
      const user = byUser.get(booking.userId);
      const event = booking.eventId ? byEvent.get(booking.eventId) : undefined;
      const clientProfile = profileByUser.get(booking.userId);
      // The customer's own name. Their email used to stand in when they had no
      // profile name, which printed the address the contact rule withholds;
      // the client says "Customer" instead.
      booking.clientName =
        nameByUser.get(booking.userId) ?? (options.includeContact ? (user?.email ?? null) : null);
      booking.clientEmail = options.includeContact ? (user?.email ?? null) : null;
      booking.clientPhone = options.includeContact ? (user?.phone ?? null) : null;
      booking.clientCity = clientProfile?.city ?? null;
      booking.clientPhoto = profilePhotoOf(clientProfile);
      // Judged before the linked function's date replaces the booking's own,
      // with the same rule incomingCounts uses for the tab.
      booking.requestOnDate =
        !booking.slotId &&
        Boolean(booking.eventDate ?? event?.eventDate) &&
        REQUEST_STATUSES.includes(booking.status);
      // When the booking is tied to a wedding function, that function's own date
      // and place are the single source of truth — the same the Events page and
      // the planner's wedding brief show (EZ1-I195). Where the function does not
      // say, the booking's own date, the venue that was booked or the place on
      // the service's form still do, and a planner's booking reads the couple's
      // plan, functions and booked venue, rather than "not set" over all of it.
      const context = bookingContextOf(
        {
          eventDate: booking.eventDate,
          serviceAnswers: booking.serviceAnswers,
          providerName: (booking as { providerName?: string }).providerName,
          providerCity: booking.providerCity,
          providerIsVenue: booking.providerIsVenue,
        },
        event,
        weddingByClient.get(booking.userId),
        { wholeWedding: booking.providerType === ProviderType.PLANNER },
      );
      booking.eventName = context.eventName;
      booking.eventVenue = context.venue;
      booking.eventCity = context.city;
      booking.expectedGuests = context.guests;
      booking.eventDate = context.eventDate;
      booking.serviceName = booking.vendorServiceId
        ? (serviceNames.get(booking.vendorServiceId) ?? null)
        : booking.providerType === ProviderType.PLANNER
          ? 'Wedding planning'
          : null;
      booking.quotation = summariseQuotations(quotationsByBooking.get(booking.id) ?? []);
      booking.requoteRequested = awaitingRequote(
        booking.status,
        quotationsByBooking.get(booking.id) ?? [],
      );
      booking.collectedMilestones = milestonesByBooking.get(booking.id) ?? [];
      const offering = booking.offeringId ? offeringById.get(booking.offeringId) : undefined;
      booking.offeringName = offering?.name ?? null;
      // The chosen package's pricing model; with no package chosen, the
      // service's own models, so the label still says how it is priced.
      booking.pricingModel =
        offering?.pricingModel ??
        (booking.vendorServiceId
          ? (modelsByService.get(booking.vendorServiceId) ?? []).join(',') || null
          : null);
      booking.paymentStatus = paymentByBooking.get(booking.id) ?? null;
      booking.paidAmount = (paidByBooking.get(booking.id) ?? 0).toFixed(2);
      // Who cancelled, for the booking detail (EZ1-I77). withProviderNames has
      // already put the provider's name on the row when this runs.
      if (booking.cancelledByUserId) {
        const by = booking.cancelledByUserId;
        if (by === booking.userId) {
          booking.cancelledByRole = 'customer';
          booking.cancelledByName = booking.clientName;
        } else if (by === cancellers.ownerByProvider.get(booking.providerId)) {
          booking.cancelledByRole = 'provider';
          booking.cancelledByName =
            (booking as { providerName?: string }).providerName ?? null;
        } else if (cancellers.staff.has(by)) {
          // Anybody else used to read as the provider, so a booking an
          // administrator cancelled told the couple their vendor had walked.
          booking.cancelledByRole = 'support';
          booking.cancelledByName = 'Support team';
        } else {
          // Somebody acting for the customer: the planner or agent who placed it.
          booking.cancelledByRole = 'customer';
          booking.cancelledByName = cancellers.names.get(by) ?? null;
        }
      }
    }
    return rows;
  }

  /**
   * The chosen packages and every package on the booked services, in one read,
   * for the package name and the pricing-model label on each row.
   */
  private async offeringsFor(
    offeringIds: string[],
    serviceIds: string[],
  ): Promise<ServiceOffering[]> {
    if (offeringIds.length === 0 && serviceIds.length === 0) return [];
    const where: Record<string, unknown>[] = [];
    if (offeringIds.length) where.push({ id: In(offeringIds) });
    if (serviceIds.length) where.push({ vendorServiceId: In(serviceIds) });
    return this.dataSource.getRepository(ServiceOffering).find({ where });
  }

  /**
   * What is needed to say who cancelled a set of bookings, beyond the customer:
   * each provider's owning account, which platform staff did it, and the name of
   * anyone else. Nothing is read when no row was cancelled by somebody else.
   */
  private async cancellersOf(rows: Booking[]): Promise<{
    ownerByProvider: Map<string, string>;
    staff: Set<string>;
    names: Map<string, string>;
  }> {
    const cancelled = rows.filter((b) => b.cancelledByUserId && b.cancelledByUserId !== b.userId);
    const ownerByProvider = new Map<string, string>();
    if (cancelled.length === 0) return { ownerByProvider, staff: new Set(), names: new Map() };

    const idsOf = (type: ProviderType) =>
      [...new Set(cancelled.filter((b) => b.providerType === type).map((b) => b.providerId))];
    const cancellerIds = [...new Set(cancelled.map((b) => b.cancelledByUserId as string))];
    const [vendors, planners, accounts, names] = await Promise.all([
      idsOf(ProviderType.VENDOR).length
        ? this.vendors.find({ where: { id: In(idsOf(ProviderType.VENDOR)) } })
        : Promise.resolve([]),
      idsOf(ProviderType.PLANNER).length
        ? this.planners.find({ where: { id: In(idsOf(ProviderType.PLANNER)) } })
        : Promise.resolve([]),
      this.users.find({ where: { id: In(cancellerIds) }, select: ['id', 'role'] }),
      displayNamesByUserIds(
        { users: this.users, profiles: this.profiles, vendors: this.vendors, planners: this.planners },
        cancellerIds,
      ),
    ]);
    for (const listing of [...vendors, ...planners]) {
      ownerByProvider.set(listing.id, listing.ownerUserId);
    }
    const staff = new Set(
      accounts
        .filter((u) => u.role === UserRole.ADMIN || u.role === UserRole.IN_PERSON)
        .map((u) => u.id),
    );
    return { ownerByProvider, staff, names };
  }

  /**
   * What each couple's wedding already says about when and where it is: their
   * plan's date, their functions, and the vendors they have booked with the
   * place each is held — the match-fixed partner's included, because the two
   * share one wedding (EZ1-I160). A handful of queries for every couple on the
   * page, and none when no planner booking needs them.
   */
  private async weddingFactsFor(userIds: string[]): Promise<Map<string, WeddingFacts>> {
    if (userIds.length === 0) return new Map();
    const partners = await Promise.all(
      userIds.map(async (id) => [id, await this.matchmaking.fixedPartnerUserId(id)] as const),
    );
    const partnerOf = new Map(
      partners.filter((pair): pair is readonly [string, string] => Boolean(pair[1])),
    );
    return loadWeddingFacts(
      {
        plans: this.weddingPlans,
        events: this.events,
        bookings: this.bookings,
        vendors: this.vendors,
      },
      userIds,
      partnerOf,
    );
  }

  /**
   * Attaches the provider's trading name to each row.
   *
   * Without it the client holds a uuid and nothing else, and every booking list
   * reads as a wall of hex. Resolved in one query per provider type rather than
   * one per row.
   */
  private async withProviderNames<T extends Booking>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;

    const vendorIds = rows
      .filter((r) => r.providerType === ProviderType.VENDOR)
      .map((r) => r.providerId);
    const plannerIds = rows
      .filter((r) => r.providerType === ProviderType.PLANNER)
      .map((r) => r.providerId);

    const [vendors, planners] = await Promise.all([
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      plannerIds.length ? this.planners.find({ where: { id: In(plannerIds) } }) : Promise.resolve([]),
    ]);

    const names = new Map<string, string>();
    for (const v of vendors) names.set(v.id, v.name);
    for (const p of planners) names.set(p.id, p.agencyName);
    const vendorById = new Map(vendors.map((v) => [v.id, v]));

    return rows.map((row) => {
      const vendor =
        row.providerType === ProviderType.VENDOR ? vendorById.get(row.providerId) : undefined;
      return Object.assign(row, {
        providerName: names.get(row.providerId) ?? 'Provider',
        providerCity: vendor?.city ?? null,
        providerIsVenue: Boolean(vendor?.categories?.includes('venue')),
      });
    });
  }

  /** Seller-side listing: bookings against the caller's own listings. */
  async listIncoming(actor: AuthUser, q: BookingSearchDto): Promise<PaginatedResult<Booking>> {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) return paginate([], 0, q.page, q.limit);

    const qb = this.bookings
      .createQueryBuilder('b')
      .where('b."providerId" IN (:...ids)', { ids: providerIds });
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    qb.orderBy('b."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    // A provider's incoming list is where they read who is asking, for what and
    // when — so it needs the client context (name, event, service), not only the
    // provider names. Without it every row read "Customer" (EZ1-I68).
    const named = await this.withProviderNames(data);
    return paginate(await this.withClientContext(named), total, q.page, q.limit);
  }

  /**
   * Every request couples have sent this planner, newest first.
   *
   * All of them rather than one page: a planner's book is tens of weddings,
   * and the request screen counts and filters its tabs on the client.
   */
  async plannerRequests(actor: AuthUser): Promise<PlannerRequestCard[]> {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) return [];
    const rows = await this.bookings.find({
      where: { providerType: ProviderType.PLANNER, providerId: In(providerIds) },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    const enriched = await this.withClientContext(await this.withProviderNames(rows), {
      includeContact: true,
    });
    return enriched.map(toRequestCard);
  }

  /** One request in full, with whether the planner is free on the day. */
  async plannerRequest(actor: AuthUser, bookingId: string): Promise<PlannerRequestDetail> {
    const booking = await this.loadOrFail(bookingId);
    if (booking.providerType !== ProviderType.PLANNER) {
      throw new NotFoundException('Request not found');
    }
    await this.assertSellerSide(actor, booking);
    const [row] = await this.withClientContext(await this.withProviderNames([booking]), {
      includeContact: true,
    });

    const date = row.eventDate ?? null;
    let openings = 0;
    let otherBookings = 0;
    if (date) {
      const [slots, committed] = await Promise.all([
        this.availability.listBookable(ProviderType.PLANNER, row.providerId, date, date),
        this.bookings.count({
          where: {
            providerType: ProviderType.PLANNER,
            providerId: row.providerId,
            eventDate: date,
            status: In(COMMITTED),
          },
        }),
      ]);
      openings = slots
        .filter((s) => s.date === date)
        .reduce((n, s) => n + Math.max(0, s.remaining ?? 0), 0);
      otherBookings = committed - (COMMITTED.includes(row.status) ? 1 : 0);
    }
    const today = new Date().toISOString().slice(0, 10);
    return toRequestDetail(row, {
      state: dateAvailability({ date, today, openings, otherBookings }),
      openings,
      otherBookings,
    });
  }

  /**
   * The planner takes the request on, before any price is agreed.
   *
   * Nothing about the money or the date changes: the couple is told the
   * planner is interested, and the planner goes on to quote. Repeating it is
   * harmless.
   */
  async acceptPlannerRequest(actor: AuthUser, bookingId: string): Promise<PlannerRequestDetail> {
    const booking = await this.loadOrFail(bookingId);
    if (booking.providerType !== ProviderType.PLANNER) {
      throw new NotFoundException('Request not found');
    }
    await this.assertSellerSide(actor, booking);
    if (![BookingStatus.REQUESTED, BookingStatus.QUOTATION_SENT].includes(booking.status)) {
      throw new BadRequestException('Only an open request can be accepted');
    }
    if (!booking.providerAcceptedAt) {
      booking.providerAcceptedAt = new Date();
      await this.bookings.save(booking);
      await this.outbox.record({
        eventType: 'booking.request_accepted',
        aggregateType: 'booking',
        payload: { bookingId, userId: booking.userId, providerId: booking.providerId },
      });
    }
    return this.plannerRequest(actor, bookingId);
  }

  /**
   * The provider's account: what has been earned, what is still in escrow, and
   * the line-by-line ledger behind both.
   *
   * Held and released are reported separately because they mean very different
   * things to somebody deciding whether they can pay their own suppliers this
   * week. Everything is net of commission — the payout figure is the money that
   * actually reaches them, so it is the one shown as earnings.
   */
  async earnings(actor: AuthUser): Promise<{
    heldInEscrow: string;
    /** Earned and owed, but not yet transferred. Usually payout onboarding. */
    pendingPayout: string;
    released: string;
    refunded: string;
    commission: string;
    gross: string;
    currency: string;
    ledger: {
      paymentId: string;
      bookingId: string;
      /** Who the booking is for: their profile name, never their contact details. */
      clientName: string | null;
      /** What was booked: the service's name, or 'Wedding planning' for a planner. */
      serviceName: string | null;
      eventDate: string | null;
      /** Where the job itself stands, so a payout row can say what it waits on. */
      bookingStatus: BookingStatus | null;
      milestone: PaymentMilestone;
      status: PaymentStatus;
      amount: string;
      commissionAmount: string;
      payoutAmount: string;
      releasedAmount: string;
      availableAmount: string;
      /** The gateway's reference for the transfer, once one is made. */
      payoutRef: string | null;
      /** Why a payout has not happened, when it has not. */
      payoutNote: string | null;
      confirmedAt: Date | null;
      createdAt: Date;
      /** When the row last moved: for a paid-out row, when it was paid out. */
      updatedAt: Date;
    }[];
  }> {
    const providerIds = await this.ownedProviderIds(actor);
    const empty = {
      heldInEscrow: '0.00',
      pendingPayout: '0.00',
      released: '0.00',
      refunded: '0.00',
      commission: '0.00',
      gross: '0.00',
      currency: 'INR',
      ledger: [],
    };
    if (providerIds.length === 0) return empty;

    const bookings = await this.bookings.find({
      where: { providerId: In(providerIds) },
      select: ['id', 'currency', 'userId', 'providerType', 'vendorServiceId', 'eventDate', 'status'],
    });
    if (bookings.length === 0) return empty;

    const payments = await this.payments.find({
      where: { bookingId: In(bookings.map((b) => b.id)) },
      order: { createdAt: 'DESC' },
    });

    // A ledger row that says only a booking id cannot be matched to a job, so
    // each carries who it was for and what was booked. The customer's profile
    // name only: the email fallback other screens use is contact detail a
    // provider is not shown (WOW-06).
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const [clientProfiles, serviceNames] = await Promise.all([
      this.profiles.find({ where: { userId: In([...new Set(bookings.map((b) => b.userId))]) } }),
      serviceNamesByIds(this.serviceRows, bookings.map((b) => b.vendorServiceId)),
    ]);
    const clientNames = new Map(
      clientProfiles
        .filter((p) => p.userId && p.displayName)
        .map((p) => [p.userId as string, p.displayName as string]),
    );
    const serviceNameOf = (b: Booking | undefined) =>
      !b
        ? null
        : b.vendorServiceId
          ? (serviceNames.get(b.vendorServiceId) ?? null)
          : b.providerType === ProviderType.PLANNER
            ? 'Wedding planning'
            : null;

    // Money is added in minor units. Summing the decimal strings directly would
    // drift a paisa at a time and eventually disagree with the ledger below it.
    let held = 0;
    let owed = 0;
    let released = 0;
    let refunded = 0;
    let commission = 0;
    let gross = 0;

    for (const payment of payments) {
      const payout = toMinor(payment.payoutAmount ?? '0');
      const fee = toMinor(payment.commissionAmount ?? '0');
      const total = toMinor(payment.amount ?? '0');

      if (payment.status === PaymentStatus.HELD_IN_ESCROW || payment.status === PaymentStatus.DISPUTED) {
        held += payout;
      }
      // Owed is its own figure, not folded into either side. Counting it as
      // held would say the buyer might still get it back; counting it as
      // released would say the provider has been paid. Neither is true, and a
      // status with no bucket would drop the money out of the totals entirely.
      if (payment.status === PaymentStatus.PENDING_PAYOUT) {
        owed += payout;
        commission += fee;
        gross += total;
      }
      if (payment.status === PaymentStatus.RELEASED || payment.status === PaymentStatus.PARTIALLY_SETTLED) {
        released += payout;
        commission += fee;
        gross += total;
      }
      if (payment.status === PaymentStatus.REFUNDED) {
        refunded += total;
      }
    }

    return {
      heldInEscrow: toMajor(held),
      /** Earned, and not yet transferred. Usually payout onboarding. */
      pendingPayout: toMajor(owed),
      released: toMajor(released),
      refunded: toMajor(refunded),
      commission: toMajor(commission),
      gross: toMajor(gross),
      currency: bookings[0].currency ?? 'INR',
      ledger: payments.map((p) => ({
        paymentId: p.id,
        bookingId: p.bookingId,
        clientName: clientNames.get(bookingById.get(p.bookingId)?.userId ?? '') ?? null,
        serviceName: serviceNameOf(bookingById.get(p.bookingId)),
        eventDate: bookingById.get(p.bookingId)?.eventDate ?? null,
        bookingStatus: bookingById.get(p.bookingId)?.status ?? null,
        milestone: p.milestone,
        status: p.status,
        amount: p.amount,
        commissionAmount: p.commissionAmount,
        payoutAmount: p.payoutAmount,
        releasedAmount:
          p.status === PaymentStatus.RELEASED || p.status === PaymentStatus.PARTIALLY_SETTLED
            ? p.payoutAmount
            : '0.00',
        availableAmount: p.status === PaymentStatus.PENDING_PAYOUT ? p.payoutAmount : '0.00',
        payoutRef: p.payoutRef ?? null,
        payoutNote: p.payoutNote ?? null,
        confirmedAt: p.webhookVerifiedAt ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    };
  }

  /**
   * One of the provider's own transactions in full, for the Accounts detail
   * view (EZ1-I211).
   *
   * The mirror of the admin's `transactionDetail` for the seller's own money:
   * the same booking/customer/service/event context and the same escrow
   * position summed across the booking, but scoped so a provider only ever
   * opens a payment that sits on one of their own bookings. A payment on
   * somebody else's booking is answered with the same "not found" as one that
   * does not exist, so the endpoint never confirms another provider's rows.
   */
  async transactionDetail(actor: AuthUser, paymentId: string) {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) throw new NotFoundException('Payment not found');

    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');

    const booking = await this.bookings.findOne({ where: { id: payment.bookingId } });
    if (!booking || !providerIds.includes(booking.providerId)) {
      throw new NotFoundException('Payment not found');
    }

    const [siblings, client, service, event, offeringNames] = await Promise.all([
      this.payments.find({ where: { bookingId: booking.id }, order: { createdAt: 'ASC' } }),
      this.users.findOne({
        where: { id: booking.userId },
        select: ['id', 'role'],
      }),
      booking.vendorServiceId
        ? this.serviceRows.findOne({ where: { id: booking.vendorServiceId } })
        : Promise.resolve(null),
      booking.eventId
        ? this.events.findOne({ where: { id: booking.eventId } })
        : Promise.resolve(null),
      booking.offeringId
        ? this.vendorServices.offeringNamesByIds([booking.offeringId])
        : Promise.resolve(new Map<string, string>()),
    ]);

    const [clientProfile, serviceNames, vendor, weddings] = await Promise.all([
      this.profiles.findOne({ where: { userId: booking.userId } }),
      serviceNamesByIds(this.serviceRows, [booking.vendorServiceId]),
      booking.providerType === ProviderType.VENDOR
        ? this.vendors.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking.providerType === ProviderType.PLANNER
        ? this.weddingFactsFor([booking.userId])
        : Promise.resolve(new Map<string, WeddingFacts>()),
    ]);

    // When, where and for how many, from the function when it says and from
    // the booking form, the booked venue or the wedding when it does not — the
    // same derivation as the booking list, so the two screens agree.
    const context = bookingContextOf(
      {
        eventDate: booking.eventDate,
        serviceAnswers: booking.serviceAnswers,
        providerName: vendor?.name,
        providerCity: vendor?.city,
        providerIsVenue: Boolean(vendor?.categories?.includes('venue')),
      },
      event,
      weddings.get(booking.userId),
    );

    return {
      payment,
      booking: {
        id: booking.id,
        status: booking.status,
        amount: booking.amount,
        currency: booking.currency,
        eventDate: context.eventDate,
        eventName: context.eventName,
        venue: context.venue,
        city: context.city,
        guests: context.guests,
        createdAt: booking.createdAt,
      },
      // Who the money is from, without their email or phone (WOW-06): the
      // provider talks to the customer in the booking's chat.
      customer: client
        ? {
            id: client.id,
            name: clientProfile?.displayName ?? null,
            city: clientProfile?.city ?? null,
          }
        : null,
      // Selected service & catalog: the service, the package picked off it, how
      // many units were booked, and the agreed booking total.
      service: {
        id: service?.id ?? booking.vendorServiceId,
        name: booking.vendorServiceId
          ? (serviceNames.get(booking.vendorServiceId) ?? null)
          : booking.providerType === ProviderType.PLANNER
            ? 'Wedding planning'
            : null,
        offering: booking.offeringId ? (offeringNames.get(booking.offeringId) ?? null) : null,
        quantity: booking.quantity,
        total: booking.amount,
      },
      event: event
        ? {
            id: event.id,
            name: event.name,
            venue: context.venue,
            city: context.city,
            eventDate: context.eventDate,
            startTime: event.startTime,
          }
        : null,
      // Every instalment on the booking, oldest first: the milestone breakdown
      // (advance/second/final) and the payment timeline are read off this list.
      payments: siblings,
      // The same buckets as earnings() and the admin's view of this payment, so
      // no two screens disagree about where the money sits.
      summary: {
        total: booking.amount,
        ...escrowSummary(siblings),
      },
    };
  }

  /**
   * The buyer's escrow, grouped by booking (EZ1-I148).
   *
   * The mirror of {@link earnings} for the other side of the table: not what a
   * provider has earned, but what the couple has paid in and where it currently
   * sits. Scoped strictly on `payments.userId` — the client the booking is for —
   * so an individual only ever sees the money they themselves put into escrow,
   * never anybody else's.
   *
   * Amounts are the gross the buyer was charged (commission included): the buyer
   * paid the whole instalment, and the split between payout and commission is
   * the provider's concern, not theirs. This complements the per-booking
   * Instalments panel on Bookings rather than repeating it — one money view
   * across every booking at once.
   */
  async buyerEscrow(actor: AuthUser): Promise<{
    currency: string;
    heldInEscrow: string;
    released: string;
    refunded: string;
    records: {
      bookingId: string;
      providerType: ProviderType;
      providerName: string;
      serviceName: string | null;
      eventDate: string | null;
      bookingAmount: string;
      currency: string;
      /** The furthest-along status across this booking's instalments. */
      status: PaymentStatus;
      heldInEscrow: string;
      released: string;
      refunded: string;
      payments: {
        paymentId: string;
        milestone: PaymentMilestone;
        status: PaymentStatus;
        amount: string;
        method: PaymentMethod;
        /** The gateway's reference for the hold, where the gateway gave one. */
        reference: string | null;
        /** The gateway's reference for the payout, once released. */
        payoutRef: string | null;
        createdAt: Date;
        /** When the status last changed — the release/refund date, in effect. */
        updatedAt: Date;
      }[];
    }[];
  }> {
    const empty = {
      currency: this.cfg.payments.currency,
      heldInEscrow: '0.00',
      released: '0.00',
      refunded: '0.00',
      records: [],
    };

    const payments = await this.payments.find({
      where: { userId: actor.userId },
      order: { createdAt: 'ASC' },
    });
    if (payments.length === 0) return empty;

    const bookingIds = [...new Set(payments.map((p) => p.bookingId))];
    const bookings = await this.bookings.find({ where: { id: In(bookingIds) } });
    const named = await this.withProviderNames(bookings);

    const serviceIds = [
      ...new Set(named.map((b) => b.vendorServiceId).filter(Boolean)),
    ] as string[];
    const eventIds = [...new Set(named.map((b) => b.eventId).filter(Boolean))] as string[];
    const [serviceName, linkedEvents, weddings] = await Promise.all([
      serviceNamesByIds(this.serviceRows, serviceIds),
      eventIds.length ? this.events.find({ where: { id: In(eventIds) } }) : Promise.resolve([]),
      this.weddingFactsFor([
        ...new Set(
          named.filter((b) => b.providerType === ProviderType.PLANNER).map((b) => b.userId),
        ),
      ]),
    ]);
    const eventById = new Map(linkedEvents.map((e) => [e.id, e]));
    const byBooking = new Map(named.map((b) => [b.id, b]));

    // Same ranking the provider-facing list uses, so a booking whose instalments
    // sit in different states reports the one that best describes the whole.
    const RANK = PAYMENT_STATUS_RANK;

    const grouped = new Map<string, Payment[]>();
    for (const p of payments) {
      const list = grouped.get(p.bookingId) ?? [];
      list.push(p);
      grouped.set(p.bookingId, list);
    }

    let totalHeld = 0;
    let totalReleased = 0;
    let totalRefunded = 0;

    const records = bookingIds
      .filter((id) => byBooking.has(id))
      .map((id) => {
        const booking = byBooking.get(id)!;
        const rows = grouped.get(id) ?? [];

        let held = 0;
        let released = 0;
        let refunded = 0;
        let top = rows[0].status;
        for (const p of rows) {
          const amt = toMinor(p.amount);
          if (p.status === PaymentStatus.HELD_IN_ESCROW || p.status === PaymentStatus.DISPUTED) {
            held += amt;
          } else if (
            p.status === PaymentStatus.RELEASED ||
            p.status === PaymentStatus.PENDING_PAYOUT ||
            p.status === PaymentStatus.PARTIALLY_SETTLED
          ) {
            // From the buyer's side these all mean the same thing: the money has
            // left escrow towards the provider and is not coming back to them.
            released += amt;
          } else if (p.status === PaymentStatus.REFUNDED) {
            refunded += amt;
          }
          if ((RANK[p.status] ?? 0) > (RANK[top] ?? 0)) top = p.status;
        }
        totalHeld += held;
        totalReleased += released;
        totalRefunded += refunded;

        return {
          bookingId: id,
          providerType: booking.providerType,
          providerName: (booking as { providerName?: string }).providerName ?? 'Provider',
          serviceName: booking.vendorServiceId
            ? (serviceName.get(booking.vendorServiceId) ?? null)
            : booking.providerType === ProviderType.PLANNER
              ? 'Wedding planning'
              : null,
          // The function's date, else the form's, else the wedding's for a
          // planner — the same date the booking list shows for this booking.
          eventDate: bookingContextOf(
            {
              eventDate: booking.eventDate,
              serviceAnswers: booking.serviceAnswers,
            },
            booking.eventId ? eventById.get(booking.eventId) : null,
            booking.providerType === ProviderType.PLANNER ? weddings.get(booking.userId) : null,
          ).eventDate,
          bookingAmount: booking.amount,
          currency: booking.currency,
          status: top,
          heldInEscrow: toMajor(held),
          released: toMajor(released),
          refunded: toMajor(refunded),
          payments: rows.map((p) => ({
            paymentId: p.id,
            milestone: p.milestone,
            status: p.status,
            amount: p.amount,
            method: p.method,
            reference: p.providerRef ?? null,
            payoutRef: p.payoutRef ?? null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        };
      });

    // Most recent activity first — ordered by the latest payment in each group.
    records.sort((a, b) => {
      const latest = (bid: string) =>
        Math.max(...(grouped.get(bid) ?? []).map((p) => new Date(p.createdAt).getTime()));
      return latest(b.bookingId) - latest(a.bookingId);
    });

    return {
      currency: bookings[0].currency ?? this.cfg.payments.currency,
      heldInEscrow: toMajor(totalHeld),
      released: toMajor(totalReleased),
      refunded: toMajor(totalRefunded),
      records,
    };
  }

  private async ownedProviderIds(actor: AuthUser): Promise<string[]> {
    if (actor.role === UserRole.VENDOR) {
      const rows = await this.vendors.find({ where: { ownerUserId: actor.userId } });
      return rows.map((r) => r.id);
    }
    if (actor.role === UserRole.PLANNER) {
      const rows = await this.planners.find({ where: { ownerUserId: actor.userId } });
      return rows.map((r) => r.id);
    }
    return [];
  }

  private async loadOrFail(bookingId: string): Promise<Booking> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** The buyer, or an admin. Agents do not place bookings (EZ1-I29). */
  private async assertBuyerSide(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (booking.userId === actor.userId) return;
    throw new ForbiddenException('This booking does not belong to you');
  }

  /** The provider whose listing was booked, or an admin. */
  private async assertSellerSide(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    const provider = await this.providerOwner(booking.providerType, booking.providerId);
    if (provider.ownerUserId !== actor.userId) {
      throw new ForbiddenException('This booking was not made against your listing');
    }
  }

  /** Either side of the booking. */
  private async assertParticipant(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    try {
      await this.assertBuyerSide(actor, booking);
      return;
    } catch {
      // Not the buyer; fall through to the seller check, which throws if that
      // does not hold either.
    }
    // A match-fixed couple share one wedding, and the list already shows each
    // of them the other's bookings (EZ1-I160) — so opening one to read its
    // quotations, instalments, history or add-ons must not answer 403. Reading
    // only: paying and answering quotations stay with the one who booked.
    const partnerUserId = await this.matchmaking.fixedPartnerUserId(actor.userId);
    if (partnerUserId && booking.userId === partnerUserId) return;
    await this.assertSellerSide(actor, booking);
  }

  // The quotation flow lives in its own service but answers to the same
  // ownership rules, so the three checks are exposed rather than reimplemented.

  /** Throws unless the caller is the buyer, or the agent who booked for them. */
  assertBuyer(actor: AuthUser, booking: Booking): Promise<void> {
    return this.assertBuyerSide(actor, booking);
  }

  /** Throws unless the caller owns the listing that was booked. */
  assertSeller(actor: AuthUser, booking: Booking): Promise<void> {
    return this.assertSellerSide(actor, booking);
  }

  /** Throws unless the caller is on one side of the booking or the other. */
  assertEitherSide(actor: AuthUser, booking: Booking): Promise<void> {
    return this.assertParticipant(actor, booking);
  }

  /**
   * Whether the advance has been paid. What opens the booking's chat thread.
   *
   * Paid, not merely "still in escrow": the advance leaves escrow the moment
   * the provider starts work, and on an account whose payout onboarding is
   * not finished it sits as PENDING_PAYOUT. Counting only held/released money
   * closed the thread for both sides in the middle of the job. Any collected
   * advance counts; one that was begun, failed or refunded does not.
   */
  async advanceHeld(bookingId: string): Promise<boolean> {
    const advances = await this.payments.find({
      where: { bookingId, milestone: PaymentMilestone.ADVANCE },
    });
    return advances.some((payment) => isCollected(payment.status));
  }

  /**
   * The two accounts a booking is between.
   *
   * The seller is the owner of the listing rather than the listing itself,
   * because a thread is between people. The buyer is the client the booking is
   * *for*, not whoever placed it: an agent who booked on a family's behalf is
   * not the one the vendor needs to reach about their wedding.
   */
  async counterparties(booking: Booking): Promise<{ buyerUserId: string; sellerUserId: string }> {
    const provider = await this.providerOwner(booking.providerType, booking.providerId);
    return { buyerUserId: booking.userId, sellerUserId: provider.ownerUserId };
  }

  /** One booking, loaded and ownership-checked in a single step. */
  async forParticipant(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);
    return booking;
  }

  /** True when this user completed a booking with the provider (review gate). */
  async hasCompletedBookingWith(
    userId: string,
    providerType: ProviderType,
    providerId: string,
  ): Promise<boolean> {
    const count = await this.bookings.count({
      where: { userId, providerType, providerId, status: BookingStatus.COMPLETED },
    });
    return count > 0;
  }

  /**
   * A completed job with this provider that has not been reviewed yet.
   *
   * Returns the booking rather than a yes/no, because a review now belongs to
   * a booking: two completed jobs with the same vendor are two experiences and
   * earn two reviews, and one job cannot be reviewed twice. Asking "have they
   * ever bought from this vendor" could only ever answer the first half.
   */
  async unreviewedCompletedBooking(
    userId: string,
    providerType: ProviderType,
    providerId: string,
    reviewedBookingIds: string[],
  ): Promise<Booking | null> {
    const completed = await this.bookings.find({
      where: { userId, providerType, providerId, status: BookingStatus.COMPLETED },
      order: { createdAt: 'DESC' },
    });
    const used = new Set(reviewedBookingIds);
    return completed.find((b) => !used.has(b.id)) ?? null;
  }

  private async transition(booking: Booking, to: BookingStatus): Promise<Booking> {
    this.assertTransition(booking.status, to);
    booking.status = to;
    return this.bookings.save(booking);
  }

  private assertTransition(from: BookingStatus, to: BookingStatus): void {
    if (!ALLOWED[from].includes(to)) {
      throw new BadRequestException(`Illegal booking transition ${from} to ${to}`);
    }
  }
}
