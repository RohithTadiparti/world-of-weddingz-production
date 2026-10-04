/**
 * The words for the platform's stored values, said the same way on every page.
 *
 * Pages kept their own small maps, and where a map had no entry they printed
 * the enum with its underscores swapped for spaces — "pending payout", "held
 * in escrow", "final" — or the same state in three wordings on three screens.
 * Every value a person reads goes through here instead, and an unknown one is
 * still turned into a sentence-cased phrase rather than a raw key.
 */

import { BOOKING_STATUS_LABEL, MILESTONE_LABEL, ROLE_LABEL, type UserRole } from './permissions';
import { QUOTATION_STAGE_LABEL, type QuotationStage } from './booking-progress';

/** "pending_payout" → "Pending payout". An absent value reads as the fallback. */
export function humanize(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback;
  const text = String(value).replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : fallback;
}

/**
 * Who is reading about the money.
 *
 * The same payment state is a different sentence to each side of it, on
 * purpose: `pending_payout` is money owed to the provider, money that has left
 * the couple's escrow, and a payout the administrator still has to see through.
 * What must never differ is the wording within one side.
 */
export type PaymentAudience = 'provider' | 'buyer' | 'admin';

export const PAYMENT_STATUS_LABELS: Record<PaymentAudience, Record<string, string>> = {
  provider: {
    initiated: 'Payment started',
    held_in_escrow: 'Held in escrow',
    disputed: 'Frozen: case open',
    pending_payout: 'Owed to you',
    released: 'Paid out',
    refunded: 'Refunded',
    partially_settled: 'Part settled',
    failed: 'Payment failed',
  },
  buyer: {
    initiated: 'Processing',
    held_in_escrow: 'Held in escrow',
    disputed: 'Frozen: case open',
    pending_payout: 'Released, payout to the provider pending',
    released: 'Released to provider',
    refunded: 'Refunded to you',
    partially_settled: 'Part settled',
    failed: 'Payment failed',
  },
  // The same words the Reports dashboard uses, so a figure followed from a
  // report lands on rows that say what the report said.
  admin: {
    initiated: 'Started, not yet paid',
    held_in_escrow: 'Held in escrow',
    disputed: 'Frozen by a dispute',
    pending_payout: 'Awaiting payout',
    released: 'Released to provider',
    refunded: 'Refunded',
    partially_settled: 'Partially settled',
    failed: 'Failed',
  },
};

export function paymentStatusLabel(
  status: string | null | undefined,
  audience: PaymentAudience = 'admin',
): string {
  if (!status) return '';
  return PAYMENT_STATUS_LABELS[audience][status] ?? humanize(status);
}

/** "final" → "Balance", the one name for each instalment. */
export function milestoneLabel(milestone: string | null | undefined): string {
  if (!milestone) return '';
  return MILESTONE_LABEL[milestone] ?? humanize(milestone);
}

/** A booking status in the buyer's (and the administrator's) words. */
export function bookingStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return BOOKING_STATUS_LABEL[status] ?? humanize(status);
}

/**
 * The same statuses, said from the seller's side of the table.
 *
 * The shared labels are written for the buyer — "Request sent", "Quotation
 * received" — and a vendor reading their own queue was being told what they had
 * been sent by themselves. The status is the same status the customer sees; it
 * is the sentence that differs (EZ1-I259).
 */
export const SELLER_STATUS_LABEL: Record<string, string> = {
  ...BOOKING_STATUS_LABEL,
  requested: 'New request',
  quotation_sent: 'Quotation sent',
  quotation_accepted: 'Accepted by the customer',
  payment_pending: 'Awaiting the advance',
  pending: 'Paid, awaiting your confirmation',
  completed_pending_final_payment: 'Delivered',
};

/** The server's business-status enum, humanised. */
export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for review',
  first_review: 'In review',
  pending_verification: 'Awaiting verification',
  verification_in_progress: 'Verification in progress',
  verified: 'Verified',
  live: 'Live in search',
  reverification_required: 'Re-verification required',
  rejected: 'Rejected',
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABEL[role as UserRole] ?? humanize(role);
}

/**
 * A stored quotation's status, in the words its stage already has.
 *
 * The row keeps `rejected` where the negotiation calls the same fact
 * `declined`; both read as the stage label so the history and the badge agree.
 */
export function quotationStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  const stage = (status === 'rejected' ? 'declined' : status) as QuotationStage;
  return QUOTATION_STAGE_LABEL[stage] ?? humanize(status);
}

/** Who cancelled a booking, as the server resolves it for display (EZ1-I77). */
export const CANCELLED_BY_LABEL: Record<string, string> = {
  customer: 'the customer',
  provider: 'the provider',
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export const RSVP_STATUS_LABEL: Record<string, string> = {
  invited: 'Awaiting a reply',
  attending: 'Attending',
  declined: 'Declined',
  maybe: 'Maybe',
};

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

/** A label from one of the maps above, or the value made readable. */
export function labelFrom(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback = '',
): string {
  if (!value) return fallback;
  return map[value] ?? humanize(value, fallback);
}

/** "₹1,20,000" for rupees, "USD 1,200" for anything else. */
export function formatMoney(value: string | number | null | undefined, currency = 'INR'): string {
  const amount = Number(value ?? 0).toLocaleString('en-IN');
  return currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`;
}

/**
 * What a booking costs, or honestly that nobody has priced it yet.
 *
 * A request carries no amount until a quotation is agreed, and "₹0" beside it
 * reads as free. The latest offer stands in when there is one; otherwise it
 * says so in words (EZ1-I264).
 */
export function bookingAmountLabel(booking: {
  amount: string | number | null | undefined;
  currency?: string | null;
  quotation?: { amount: string | number; currency?: string | null } | null;
}): string {
  const currency = booking.currency || 'INR';
  if (Number(booking.amount ?? 0) > 0) return formatMoney(booking.amount, currency);
  const quoted = booking.quotation;
  if (quoted && Number(quoted.amount ?? 0) > 0) {
    return `Quoted ${formatMoney(quoted.amount, quoted.currency || currency)}`;
  }
  return 'Not yet priced';
}

/**
 * "Showing the latest 100 of 240", when a list holds fewer rows than the count
 * above it — so a tab reading 240 over a hundred rows explains itself.
 */
export function partialListNote(loaded: number, total: number | null | undefined): string | null {
  if (total === null || total === undefined || total <= loaded) return null;
  return `Showing the latest ${loaded} of ${total}`;
}
