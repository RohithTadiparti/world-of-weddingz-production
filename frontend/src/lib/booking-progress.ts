/**
 * Where a booking stands, said the same way wherever one is shown (EZ1-I264,
 * EZ1-I265, EZ1-I266).
 *
 * The server works out the facts — the quotation stage, which instalments are
 * in, whether the customer has signed the delivery off. These are the words
 * for them, and the one thing each job is waiting on the provider to do.
 */

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

export const QUOTATION_STAGE_TONE: Record<QuotationStage, string> = {
  sent: 'bg-brand-soft text-brand-strong',
  requoted: 'bg-brand-soft text-brand-strong',
  accepted: 'bg-positive-bg text-positive-fg',
  declined: 'bg-critical-bg text-critical-fg',
  withdrawn: 'bg-caution-bg text-caution-fg',
  expired: 'bg-caution-bg text-caution-fg',
  superseded: 'bg-surface-sunken text-gray-600',
};

/** Where a job goes. Delivered is its own step: the balance is still unpaid. */
export const PROGRESS_STEPS = [
  'Request',
  'Quotation',
  'Accepted',
  'Paid',
  'Confirmed',
  'In progress',
  'Delivered',
  'Completed',
];

/**
 * The step a booking is on, or null for one that left the path (cancelled,
 * disputed).
 *
 * Paying the advance is what confirms a booking, so a confirmed job has passed
 * both Paid and Confirmed.
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

export interface ProgressBooking {
  status: string;
  quotation?: QuotationSummary | null;
  collectedMilestones?: string[];
  deliveredAt?: string | null;
  deliveryAcceptedAt?: string | null;
}

/**
 * Whether this arrived as a request against a date the provider never opened.
 *
 * The customer wanted a day with no published window and asked anyway, which
 * the provider has to answer differently: they are being asked whether they
 * *can* do it at all (EZ1-I227). Still an ordinary booking underneath, so it is
 * derived rather than given a status of its own — by the server, with the same
 * rule as its tab count (EZ1-I266), and here only for a server that predates it.
 */
export function isRequestOnDate(b: {
  status: string;
  slotId?: string | null;
  eventDate: string | null;
  requestOnDate?: boolean;
}): boolean {
  if (b.requestOnDate !== undefined) return b.requestOnDate;
  return (
    !b.slotId &&
    Boolean(b.eventDate) &&
    ['requested', 'quotation_sent', 'quotation_accepted'].includes(b.status)
  );
}

/**
 * Whether "Mark delivered" can go through yet.
 *
 * The server refuses it until the second instalment is in. A row from before
 * the server said which instalments were collected is given the benefit of the
 * doubt, and the server's refusal still explains itself.
 */
export function canMarkDelivered(booking: ProgressBooking): boolean {
  return !booking.collectedMilestones || booking.collectedMilestones.includes('second');
}

/**
 * Whether "Mark as completed" can go through yet: the balance is in and the
 * customer has accepted the delivery (EZ1-I266). The server checks the same.
 */
export function canMarkCompleted(booking: ProgressBooking): boolean {
  return (
    booking.status === 'completed_pending_final_payment' &&
    Boolean(booking.collectedMilestones?.includes('final')) &&
    (!booking.deliveredAt || Boolean(booking.deliveryAcceptedAt))
  );
}

/** The one thing this booking is waiting on the provider for, or on whom. */
export function nextActionFor(booking: ProgressBooking): string {
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
