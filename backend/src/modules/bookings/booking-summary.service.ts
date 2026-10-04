import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { BookingAddon } from './entities/booking-addon.entity';
import { Payment } from './entities/payment.entity';
import { Quotation } from './entities/quotation.entity';
import { BookingsService } from './bookings.service';
import { paymentBreakup, quotationStage, summariseQuotations } from './booking-summary';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingAddonStatus } from '../../common/enums';

/**
 * One booking's money and negotiation in one read (EZ1-I264, EZ1-I265).
 *
 * The booking detail was assembled from three endpoints and still could not
 * say what the customer hoped to spend against what was agreed, what the
 * add-ons came to, or where the money sat beyond a status word. Everything here
 * is read from the rows that own it -- quotations, add-ons, payments -- so both
 * portals show the same figures.
 */
@Injectable()
export class BookingSummaryService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Quotation) private readonly quotations: Repository<Quotation>,
    @InjectRepository(BookingAddon) private readonly addons: Repository<BookingAddon>,
    private readonly bookingsService: BookingsService,
  ) {}

  async summary(actor: AuthUser, bookingId: string) {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    await this.bookingsService.assertEitherSide(actor, booking);

    const [quotations, payments, addons, instalments] = await Promise.all([
      this.quotations.find({ where: { bookingId }, order: { createdAt: 'ASC' } }),
      this.payments.find({ where: { bookingId } }),
      this.addons.find({ where: { bookingId } }),
      this.bookingsService.milestones(actor, bookingId),
    ]);

    const accepted = quotations.find((q) => q.id === booking.acceptedQuotationId) ?? null;
    const agreed = addons.filter((a) => a.status === BookingAddonStatus.ACCEPTED);
    const addonsMinor = agreed.reduce(
      (total, a) =>
        total + Math.round(Number(a.vendorPrice ?? a.proposedPrice ?? 0) * 100) * (a.quantity ?? 1),
      0,
    );
    const hasPrice = Number(booking.amount) > 0;
    const projected = this.bookingsService.splitAmount(booking.amount);

    return {
      bookingId,
      status: booking.status,
      currency: booking.currency,
      price: {
        /** What the customer said they hoped to spend, before any quote. */
        budget: booking.expectedBudget,
        /** The quotation the booking was struck on. */
        quoted: accepted?.amount ?? null,
        /**
         * Priced without a quotation: a listed price the customer booked at.
         * The amount is still agreed, so "Not agreed yet" would be untrue.
         */
        listedPrice: !accepted && hasPrice,
        /** The agreed price before add-ons. */
        base: booking.baseAmount ?? accepted?.amount ?? (hasPrice ? booking.amount : null),
        addonsTotal: (addonsMinor / 100).toFixed(2),
        addonsAgreed: agreed.length,
        addonsAwaiting: addons.filter(
          (a) => a.status === BookingAddonStatus.REQUESTED || a.status === BookingAddonStatus.REQUOTED,
        ).length,
        grandTotal: booking.amount,
      },
      quotation: summariseQuotations(quotations),
      /** Every offer, newest first, with what became of each. */
      quotations: quotations
        .map((q, index) => ({
          id: q.id,
          amount: q.amount,
          currency: q.currency,
          status: q.status,
          stage: quotationStage(q, quotations.slice(0, index)),
          lines: q.lines,
          notes: q.notes,
          terms: q.terms,
          validUntil: q.validUntil,
          responseNote: q.responseNote,
          respondedAt: q.respondedAt,
          createdAt: q.createdAt,
        }))
        .reverse(),
      payments: paymentBreakup(booking.amount, payments),
      /** The split of the whole agreed total, once every instalment is in. */
      projected: hasPrice
        ? { commission: projected.commission, vendorEarnings: projected.payout }
        : null,
      instalments: instalments.milestones,
      delivery: {
        deliveredAt: booking.deliveredAt,
        deliveryNotes: booking.deliveryNotes,
        deliveryAcceptedAt: booking.deliveryAcceptedAt,
      },
    };
  }
}
