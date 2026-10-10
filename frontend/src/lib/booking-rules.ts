/**
 * The booking lifecycle rules both portals act on, web and mobile.
 *
 * Dependency-free on purpose: the app reads this file through src/shared, and
 * a shared module may import nothing (see mobile/metro.config.js). The server
 * enforces every one of these; mirroring them here is what puts the right
 * buttons on the screen, with the reason a disabled one is disabled.
 */

export interface RuleBooking {
  status: string;
  amount?: string | null;
  currency?: string | null;
  estimatedAmount?: string | null;
  expectedBudget?: string | null;
  quotation?: { stage?: string | null } | null;
  /** Set by the server: the customer declined the latest quotation. */
  requoteRequested?: boolean;
  collectedMilestones?: string[];
  deliveredAt?: string | null;
  deliveryAcceptedAt?: string | null;
}

/** The customer declined the provider's latest quotation and wants a requote. */
export function isRequoteRequested(b: RuleBooking): boolean {
  if (b.requoteRequested !== undefined) return b.requoteRequested;
  return b.status === 'requested' && b.quotation?.stage === 'declined';
}

const positive = (v: string | null | undefined) => Number(v ?? 0) > 0;

/**
 * The price "Accept" agrees to: the budget the customer named, else the listed
 * package total they picked. Null once a quotation exists -- the price is then
 * agreed through quotations only -- or when the customer named no price.
 */
export function customerAsk(
  b: RuleBooking,
): { amount: number; basis: 'budget' | 'listed' } | null {
  if (b.status !== 'requested' || b.quotation) return null;
  if (positive(b.expectedBudget)) return { amount: Number(b.expectedBudget), basis: 'budget' };
  if (positive(b.estimatedAmount)) return { amount: Number(b.estimatedAmount), basis: 'listed' };
  return null;
}

export function formatMoney(amount: number | string | null | undefined, currency = 'INR'): string {
  return `${currency} ${Number(amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Why "Mark as completed" cannot go through yet, or null when it can. */
export function completionBlocker(b: RuleBooking): string | null {
  if (b.status !== 'completed_pending_final_payment') return 'Only a delivered booking can be completed.';
  if (!b.collectedMilestones?.includes('final')) {
    return 'The customer has not paid the final balance yet.';
  }
  if (b.deliveredAt && !b.deliveryAcceptedAt) {
    return 'The customer has paid the balance but has not accepted the delivery yet. Use chat, or raise an issue.';
  }
  return null;
}

/** Why "Mark delivered" cannot go through yet, or null when it can. */
export function deliveryBlocker(b: RuleBooking): string | null {
  if (b.collectedMilestones && !b.collectedMilestones.includes('second')) {
    return 'Available once the customer has paid the second instalment.';
  }
  return null;
}

export type SellerActionKey =
  | 'requote'
  | 'send_quote'
  | 'accept_request'
  | 'decline'
  | 'cancel'
  | 'withdraw_quote'
  | 'confirm'
  | 'start'
  | 'deliver'
  | 'complete'
  | 'raise_issue';

export interface SellerAction {
  key: SellerActionKey;
  label: string;
  /** PUT /bookings/:id/<path>, where the action is a plain request. */
  path?: string;
  primary?: boolean;
  /** When set the action is shown disabled, with this as the reason. */
  disabledReason?: string | null;
  /** For accept_request: the exact amount being agreed. */
  amount?: number;
}

/** Statuses a provider may raise an issue on: money is in and work is under way. */
const ISSUE_STATUSES = ['confirmed', 'in_progress', 'completed_pending_final_payment'];

/**
 * What the provider may do with a booking right now (rows 17 and 20).
 *
 * The requote-requested state offers exactly two answers -- a revised
 * quotation or cancelling -- because accepting would have to pick a price the
 * negotiation has already moved past. A delivered booking whose balance is in
 * but whose delivery is not yet accepted shows "Mark as completed" disabled
 * with the reason, beside "Raise an issue".
 */
export function sellerActions(b: RuleBooking, opts: { canQuote: boolean }): SellerAction[] {
  const actions: SellerAction[] = [];
  switch (b.status) {
    case 'requested': {
      if (isRequoteRequested(b)) {
        if (opts.canQuote) {
          actions.push({ key: 'requote', label: 'Quotation rejected - Requote', primary: true });
        }
        actions.push({ key: 'cancel', label: 'Cancel', path: 'cancel' });
        return actions;
      }
      const ask = customerAsk(b);
      if (ask) {
        actions.push({
          key: 'accept_request',
          label: `Accept at ${ask.basis === 'budget' ? "customer's budget" : 'listed price'} ${formatMoney(ask.amount, b.currency ?? 'INR')}`,
          path: 'accept',
          primary: true,
          amount: ask.amount,
        });
      }
      if (opts.canQuote) {
        actions.push({ key: 'send_quote', label: b.quotation ? 'Send revised quotation' : 'Send quotation' });
      }
      actions.push({ key: 'decline', label: 'Decline', path: 'cancel' });
      return actions;
    }
    case 'quotation_sent':
      if (opts.canQuote) actions.push({ key: 'send_quote', label: 'Revise quotation' });
      actions.push({ key: 'withdraw_quote', label: 'Withdraw quotation', path: 'quotations/withdraw' });
      return actions;
    case 'quotation_accepted':
      actions.push({ key: 'confirm', label: 'Accept the job', path: 'confirm', primary: true });
      actions.push({ key: 'decline', label: 'Decline', path: 'cancel' });
      return actions;
    case 'payment_pending':
    case 'pending':
      actions.push({ key: 'cancel', label: 'Cancel', path: 'cancel' });
      return actions;
    case 'confirmed':
      actions.push({ key: 'start', label: 'Start work', path: 'start', primary: true });
      actions.push({ key: 'cancel', label: 'Cancel', path: 'cancel' });
      break;
    case 'in_progress':
      actions.push({
        key: 'deliver',
        label: 'Mark delivered',
        path: 'complete',
        primary: true,
        disabledReason: deliveryBlocker(b),
      });
      break;
    case 'completed_pending_final_payment':
      actions.push({
        key: 'complete',
        label: 'Mark as completed',
        path: 'mark-completed',
        primary: true,
        disabledReason: completionBlocker(b),
      });
      break;
    default:
      return actions;
  }
  if (ISSUE_STATUSES.includes(b.status)) actions.push({ key: 'raise_issue', label: 'Raise an issue' });
  return actions;
}

/**
 * The customer's two answers to a delivery (row 21): accept it, or raise an
 * issue. Choosing one disables the other. An open issue (the booking is then
 * disputed) blocks acceptance until it is resolved, which the server enforces
 * too; an accepted delivery cannot then be disputed from this screen.
 */
export function deliveryDecision(
  b: RuleBooking,
  opts: { canRaise: boolean; disputing?: boolean; accepting?: boolean },
): {
  showAccept: boolean;
  acceptDisabledReason: string | null;
  showRaise: boolean;
  raiseDisabledReason: string | null;
} {
  const awaitingAcceptance = Boolean(b.deliveredAt) && !b.deliveryAcceptedAt;
  const showAccept = awaitingAcceptance && b.status !== 'cancelled';
  const acceptDisabledReason =
    b.status === 'disputed'
      ? 'An issue is open on this booking. You can accept the delivery once it is resolved.'
      : opts.disputing
        ? 'You are raising an issue. Cancel it to accept the delivery instead.'
        : null;
  const disputable = ['confirmed', 'in_progress', 'completed_pending_final_payment', 'completed'];
  const showRaise = opts.canRaise && disputable.includes(b.status);
  const raiseDisabledReason = b.deliveryAcceptedAt
    ? 'You accepted the delivery, so an issue can no longer be raised from here.'
    : opts.accepting
      ? 'You are accepting the delivery.'
      : null;
  return { showAccept, acceptDisabledReason, showRaise, raiseDisabledReason };
}

export const PRICING_MODEL_LABEL: Record<string, string> = {
  fixed: 'Fixed price',
  per_person: 'Per person',
  per_hour: 'Per hour',
  per_day: 'Per day',
  per_session: 'Per session',
  per_item: 'Per item',
  starting_from: 'Starting from',
  custom_quote: 'Custom quote',
  no_public_price: 'Price on request',
};

/** "fixed" -> "Fixed price"; "fixed,per_hour" -> "Fixed price / Per hour". */
export function pricingModelLabel(model: string | null | undefined): string | null {
  if (!model) return null;
  const parts = model
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => PRICING_MODEL_LABEL[m] ?? m.replace(/_/g, ' '));
  return parts.length ? parts.join(' / ') : null;
}

/** Whether the booking's chat is a place both sides can write right now. */
export function chatOpenFor(b: RuleBooking): boolean {
  if (b.status === 'completed' || b.status === 'cancelled') return false;
  return Boolean(b.collectedMilestones?.includes('advance'));
}

export interface NegotiationEntryView {
  kind: string;
  label: string;
  amount: string | null;
  currency: string;
  status: string;
  statusLabel: string;
  by: string | null;
  at: string;
  note: string | null;
}

/** Who moved on one step of the negotiation, said for the reader's side. */
export function negotiationActor(by: string | null, viewer: 'customer' | 'provider'): string {
  if (by === 'customer') return viewer === 'customer' ? 'You' : 'Customer';
  if (by === 'provider') return viewer === 'provider' ? 'You' : 'Vendor';
  return 'Platform';
}

export type PaymentFilter = 'all' | 'escrow' | 'available' | 'paid' | 'refunded';

/** Which tab of the vendor Payments page a payment row belongs in. */
export function paymentBucket(status: string): Exclude<PaymentFilter, 'all'> | 'other' {
  if (status === 'held_in_escrow' || status === 'disputed') return 'escrow';
  if (status === 'pending_payout') return 'available';
  if (status === 'released' || status === 'partially_settled') return 'paid';
  if (status === 'refunded') return 'refunded';
  return 'other';
}

/** When an instalment held in escrow becomes the provider's, in words. */
export function releaseCondition(row: { milestone: string; status: string }): string {
  if (row.status === 'disputed') return 'Frozen until the open issue is settled';
  if (row.milestone === 'advance') return 'Released when you start the work';
  return 'Released when the booking is completed and the delivery accepted';
}
