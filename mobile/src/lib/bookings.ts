import type { Tone } from '@/components/chrome';

/**
 * The provider's incoming work, and the rules for reading it.
 *
 * All of this is lifted from the web client's BookingConsole and
 * ProviderBookings, which keep it in component files. The tabs, the labels and
 * the "next action" wording are the parts a vendor learns by using the product,
 * so they are kept word for word.
 */

export interface IncomingBooking {
  id: string;
  /** The customer the booking is for. */
  userId?: string;
  /** The listing that was booked. */
  providerName?: string | null;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  /**
   * The published window this was booked into, when there was one.
   *
   * Null means the customer named a date the provider had not opened — a
   * "request on date" rather than a booking against a slot. The distinction is
   * not a status, it is how the request arrived, which is why it is read from
   * here rather than from `status`.
   */
  slotId?: string | null;
  requirements: string | null;
  /** Planner requests only: the services the couple ticked, as catalogue keys. */
  requestedServices?: string[];
  clientName: string | null;
  /** How the vendor prices the booked service, e.g. "fixed" (WOW-06). */
  pricingModel?: string | null;
  /** The customer declined the latest quotation (row 17). */
  requoteRequested?: boolean;
  /** HH:MM asked for on a request for an unpublished date (row 13). */
  requestedTime?: string | null;
  clientCity?: string | null;
  clientPhoto?: string | null;
  /** A note the customer added to the request, distinct from requirements. */
  notes?: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  expectedGuests: number | null;
  serviceName: string | null;
  /** The package the customer picked, if any. */
  offeringName?: string | null;
  /** What the customer said they had in mind, before any quote. */
  expectedBudget?: string | null;
  paymentStatus: string | null;
  /** What the customer has actually paid so far, summed by the server. */
  paidAmount?: string | null;
  cancellationReason?: string | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
  vendorServiceId?: string | null;
  serviceAnswers?: Record<string, unknown>;
  quantity?: number | null;
  /** The chosen price times the quantity: the total the customer was shown. */
  estimatedAmount?: string | null;
  /** Designs the customer attached to the request, as uploaded image URLs. */
  referenceImages?: string[];
  /** The newest quotation and where the negotiation stands (EZ1-I264). */
  quotation?: QuotationSummary | null;
  /** Worked out by the server with the same rule as the tab count (EZ1-I266). */
  requestOnDate?: boolean;
  /** Which instalments are in, so an action that needs one can say so. */
  collectedMilestones?: string[];
  deliveredAt?: string | null;
  deliveryAcceptedAt?: string | null;
}

export type QuotationStage =
  | 'sent'
  | 'requoted'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'superseded';

export interface QuotationSummary {
  id: string;
  amount: string;
  currency: string;
  status: string;
  stage: QuotationStage;
  responseNote: string | null;
  respondedAt: string | null;
  sentAt: string;
  count: number;
  declinedCount: number;
}

export const QUOTATION_STAGE_LABEL: Record<QuotationStage, string> = {
  sent: 'Quotation sent',
  requoted: 'Revised quotation sent',
  accepted: 'Quotation accepted',
  // Declining hands the booking back to the provider to re-price, so the two
  // are one fact and are said as one.
  declined: 'Declined — re-quote requested',
  withdrawn: 'Quotation withdrawn',
  expired: 'Quotation expired',
  superseded: 'Replaced by a revised quotation',
};

export const QUOTATION_STAGE_TONE: Record<QuotationStage, Tone> = {
  sent: 'brand',
  requoted: 'brand',
  accepted: 'positive',
  declined: 'critical',
  withdrawn: 'caution',
  expired: 'caution',
  superseded: 'neutral',
};


/**
 * The same statuses, said from the seller's side of the table.
 *
 * The shared labels are written for the buyer — "Request sent", "Quotation
 * received" — and a vendor reading their own queue was being told what they had
 * been sent by themselves. The status is the same status the customer sees; it
 * is the sentence that differs (EZ1-I259).
 */
export const SELLER_STATUS_LABEL: Record<string, string> = {
  requested: 'New request',
  quotation_sent: 'Quotation sent',
  quotation_accepted: 'Accepted by the customer',
  payment_pending: 'Awaiting the advance',
  pending: 'Paid, awaiting your confirmation',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed_pending_final_payment: 'Delivered',
  completed: 'Completed',
  disputed: 'Under investigation',
  cancelled: 'Cancelled',
};

/**
 * Whether "Mark delivered" can go through yet.
 *
 * The server refuses it until the second instalment is in. A row from before
 * the server said which instalments were collected is given the benefit of the
 * doubt, and the server's refusal still explains itself.
 */
export function canMarkDelivered(booking: IncomingBooking): boolean {
  return !booking.collectedMilestones || booking.collectedMilestones.includes('second');
}

/**
 * Whether "Mark as completed" can go through yet: the balance is in and the
 * customer has accepted the delivery (EZ1-I266). The server checks the same.
 */
export function canMarkCompleted(booking: IncomingBooking): boolean {
  return (
    booking.status === 'completed_pending_final_payment' &&
    Boolean(booking.collectedMilestones?.includes('final')) &&
    (!booking.deliveredAt || Boolean(booking.deliveryAcceptedAt))
  );
}

/** The one thing this booking is waiting on the provider for, or on whom. */
export function nextActionFor(booking: IncomingBooking): string {
  const stage = booking.quotation?.stage;
  switch (booking.status) {
    case 'requested':
      if (stage === 'declined') return 'The customer declined your quotation — send a revised one';
      if (stage === 'withdrawn' || stage === 'expired') return 'Send a new quotation';
      return 'Send a quotation';
    case 'quotation_sent':
      return stage === 'expired'
        ? 'Your quotation has expired — send a new one'
        : 'Waiting for the customer to answer your quotation';
    case 'quotation_accepted':
      return 'Accept the job';
    case 'payment_pending':
      return 'Awaiting the advance';
    case 'confirmed':
      return 'Advance received — start the work';
    case 'in_progress':
      return canMarkDelivered(booking)
        ? 'Mark delivered when done'
        : 'Waiting for the second instalment before you can mark it delivered';
    case 'completed_pending_final_payment':
      if (!booking.collectedMilestones?.includes('final')) return 'Delivered — awaiting the final payment';
      return canMarkCompleted(booking)
        ? 'Balance received — mark the booking completed'
        : 'Balance received — waiting for the customer to confirm the delivery';
    case 'completed':
      return booking.deliveredAt && !booking.deliveryAcceptedAt
        ? 'Waiting for the customer to confirm the delivery before the payout'
        : '';
    default:
      return '';
  }
}

/**
 * The step a booking is on in LIFECYCLE, or null for one that left the path
 * (cancelled, disputed). Paying the advance is what confirms a booking, so a
 * confirmed job has passed both Paid and Confirmed.
 */
export function progressIndex(status: string, quotation?: QuotationSummary | null): number | null {
  switch (status) {
    case 'requested':
      return quotation ? 1 : 0;
    case 'quotation_sent':
      return 1;
    case 'quotation_accepted':
    case 'payment_pending':
      return 2;
    case 'pending':
      return 3;
    case 'confirmed':
      return 4;
    case 'in_progress':
      return 5;
    case 'completed_pending_final_payment':
      return 6;
    case 'completed':
      return 7;
    default:
      return null;
  }
}

/** The tabs, and which statuses each gathers. */
export const BOOKING_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  {
    key: 'requests',
    label: 'Requests',
    statuses: ['requested', 'quotation_sent', 'quotation_accepted'],
  },
  // Derived rather than status-based; `statuses` stays empty and the filter
  // special-cases it.
  { key: 'request_on_date', label: 'Request on Date', statuses: [] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['payment_pending', 'pending', 'confirmed'] },
  // Delivered and awaiting the customer's confirmation is still work in hand:
  // the balance is unpaid and the job can still be disputed.
  {
    key: 'in_progress',
    label: 'In progress',
    statuses: ['in_progress', 'completed_pending_final_payment'],
  },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled', 'disputed'] },
];

/**
 * The tab that gathers a status.
 *
 * A figure on the dashboard opens the bucket it counts, so the count and the
 * list behind it cannot disagree about which bucket that is. Anything the tabs
 * do not name falls back to All rather than to an empty screen.
 */
export function tabForStatus(status: string): string {
  return BOOKING_TABS.find((tab) => tab.statuses.includes(status))?.key ?? 'all';
}

export const PAYMENT_LABEL: Record<string, string> = {
  initiated: 'Payment started',
  held_in_escrow: 'Held in escrow',
  disputed: 'Disputed',
  pending_payout: 'Owed to you',
  released: 'Paid out',
  refunded: 'Refunded',
  // A case settled part of it, some released and some returned. The web
  // ledger's wording, so the card and Accounts say the same thing.
  partially_settled: 'Part settled',
  failed: 'Failed',
};

export const PAYMENT_TONE: Record<string, Tone> = {
  initiated: 'neutral',
  held_in_escrow: 'brand',
  disputed: 'critical',
  pending_payout: 'caution',
  released: 'positive',
  refunded: 'critical',
  partially_settled: 'brand',
  failed: 'critical',
};

/**
 * Whether this arrived as a request against a date the provider never opened.
 *
 * The customer wanted a day with no published window and asked anyway, which
 * the provider has to answer differently: they are being asked whether they
 * *can* do it at all, not merely for a price against a slot they already
 * offered. Still an ordinary booking underneath, so it is derived here rather
 * than given a status of its own.
 */
export function isRequestOnDate(booking: IncomingBooking): boolean {
  if (booking.requestOnDate !== undefined) return booking.requestOnDate;
  return (
    !booking.slotId &&
    Boolean(booking.eventDate) &&
    ['requested', 'quotation_sent', 'quotation_accepted'].includes(booking.status)
  );
}

/** Where a job goes, said once rather than implied by six section headings. */
export const LIFECYCLE = [
  'Request',
  'Quotation',
  'Accepted',
  'Paid',
  'Confirmed',
  'In progress',
  // Delivered is its own step, not a synonym for completed: the vendor has
  // handed the work over and the customer has still to confirm it and pay the
  // balance. Leaving it out is what made "Awaiting the final payment" look
  // like a variety of Completed.
  'Delivered',
  'Completed',
];
