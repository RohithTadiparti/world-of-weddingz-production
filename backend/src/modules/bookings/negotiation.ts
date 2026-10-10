import { BookingStatus, QuotationStatus } from '../../common/enums';
import type { QuotationEventKind } from './entities/quotation-event.entity';

/**
 * How a booking's price was arrived at, read the same way on both portals.
 *
 * The figures a negotiation starts from -- the provider's listed price and the
 * customer's budget -- are written when the request is placed; every offer, the
 * customer's answer to it and the price finally agreed follow. The pure half
 * lives here so the rules are tested without a database.
 */

export interface NegotiationEventLike {
  id?: string;
  kind: QuotationEventKind;
  amount: string | null;
  currency: string;
  actorRole: 'customer' | 'provider' | 'system' | null;
  quotationId: string | null;
  note: string | null;
  occurredAt: Date;
}

export interface NegotiationBooking {
  id: string;
  status: BookingStatus;
  amount: string;
  baseAmount?: string | null;
  currency: string;
  estimatedAmount?: string | null;
  expectedBudget?: string | null;
  acceptedQuotationId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface NegotiationQuotation {
  id: string;
  amount: string;
  currency: string;
  status: QuotationStatus;
  responseNote: string | null;
  respondedAt: Date | null;
  validUntil?: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

export type NegotiationStatus =
  | 'listed'
  | 'requested'
  | 'awaiting_customer'
  | 'superseded'
  | 'expired'
  | 'rejected'
  | 'withdrawn'
  | 'accepted';

export interface NegotiationEntry {
  kind: QuotationEventKind;
  label: string;
  amount: string | null;
  currency: string;
  status: NegotiationStatus;
  statusLabel: string;
  by: 'customer' | 'provider' | 'system' | null;
  at: Date;
  note: string | null;
  quotationId: string | null;
}

export interface NegotiationView {
  entries: NegotiationEntry[];
  /** The price both sides agreed, once they have. */
  finalPrice: { amount: string; currency: string; at: Date; source: 'quotation' | 'request' } | null;
  /** The customer declined the latest quotation and is waiting on a requote. */
  requoteRequested: boolean;
}

const STATUS_LABEL: Record<NegotiationStatus, string> = {
  listed: 'Listed',
  requested: 'Requested',
  awaiting_customer: 'Awaiting the customer',
  superseded: 'Replaced by a revised quotation',
  expired: 'Expired',
  rejected: 'Rejected - requote requested',
  withdrawn: 'Withdrawn',
  accepted: 'Accepted',
};

const positive = (value: string | null | undefined): boolean => Number(value ?? 0) > 0;
const fixed = (value: string | number): string => Number(value).toFixed(2);

/** The two figures a request carries before anybody has quoted. */
export function requestEvents(
  booking: Pick<NegotiationBooking, 'estimatedAmount' | 'expectedBudget' | 'currency' | 'createdAt'>,
): NegotiationEventLike[] {
  const events: NegotiationEventLike[] = [];
  if (positive(booking.estimatedAmount)) {
    events.push({
      kind: 'listed_price',
      amount: fixed(booking.estimatedAmount as string),
      currency: booking.currency,
      actorRole: 'provider',
      quotationId: null,
      note: null,
      occurredAt: booking.createdAt,
    });
  }
  if (positive(booking.expectedBudget)) {
    events.push({
      kind: 'budget',
      amount: fixed(booking.expectedBudget as string),
      currency: booking.currency,
      actorRole: 'customer',
      quotationId: null,
      note: null,
      occurredAt: booking.createdAt,
    });
  }
  return events;
}

/**
 * The history as far as it can be rebuilt from the booking and its quotations.
 *
 * What the migration backfills for bookings placed before events were kept,
 * and the fallback for any booking that somehow has none.
 */
export function deriveEvents(
  booking: NegotiationBooking,
  quotations: NegotiationQuotation[],
): NegotiationEventLike[] {
  const events = requestEvents(booking);
  const sorted = [...quotations].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  for (const q of sorted) {
    events.push({
      kind: 'quotation_sent',
      amount: q.amount,
      currency: q.currency,
      actorRole: 'provider',
      quotationId: q.id,
      note: null,
      occurredAt: q.createdAt,
    });
    const answered = q.respondedAt ?? q.updatedAt ?? q.createdAt;
    const kind: QuotationEventKind | null =
      q.status === QuotationStatus.ACCEPTED
        ? 'quotation_accepted'
        : q.status === QuotationStatus.REJECTED
          ? 'quotation_rejected'
          : q.status === QuotationStatus.WITHDRAWN
            ? 'quotation_withdrawn'
            : null;
    if (kind) {
      events.push({
        kind,
        amount: q.amount,
        currency: q.currency,
        actorRole: kind === 'quotation_withdrawn' ? 'provider' : 'customer',
        quotationId: q.id,
        note: q.responseNote,
        occurredAt: answered,
      });
    }
  }
  const acceptedByQuotation = sorted.some((q) => q.status === QuotationStatus.ACCEPTED);
  const priced = positive(booking.baseAmount ?? booking.amount);
  const agreedStates = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
    BookingStatus.COMPLETED,
    BookingStatus.DISPUTED,
  ];
  if (!acceptedByQuotation && priced && agreedStates.includes(booking.status)) {
    events.push({
      kind: 'request_accepted',
      amount: fixed((booking.baseAmount ?? booking.amount) as string),
      currency: booking.currency,
      actorRole: 'provider',
      quotationId: null,
      note: null,
      occurredAt: booking.updatedAt ?? booking.createdAt,
    });
  }
  return events;
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

const KIND_ORDER: Record<QuotationEventKind, number> = {
  listed_price: 0,
  budget: 1,
  quotation_sent: 2,
  quotation_rejected: 3,
  quotation_withdrawn: 3,
  quotation_accepted: 4,
  request_accepted: 4,
};

/**
 * The negotiation as both sides read it: each step with its amount, who made
 * it, when, and what became of it.
 */
export function negotiationView(
  events: NegotiationEventLike[],
  quotations: NegotiationQuotation[] = [],
  now = Date.now(),
): NegotiationView {
  const ordered = [...events].sort(
    (a, b) => time(a.occurredAt) - time(b.occurredAt) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
  const answers = new Map<string, QuotationEventKind>();
  for (const e of ordered) {
    if (e.quotationId && e.kind !== 'quotation_sent') answers.set(e.quotationId, e.kind);
  }
  const quotationById = new Map(quotations.map((q) => [q.id, q]));
  const sent = ordered.filter((e) => e.kind === 'quotation_sent');
  const lastSent = sent[sent.length - 1];

  let sentIndex = 0;
  const entries: NegotiationEntry[] = ordered.map((e) => {
    let label: string;
    let status: NegotiationStatus;
    switch (e.kind) {
      case 'listed_price':
        label = "Vendor's listed price";
        status = 'listed';
        break;
      case 'budget':
        label = "Customer's requested budget";
        status = 'requested';
        break;
      case 'quotation_sent': {
        label = sentIndex === 0 ? 'Vendor quotation' : 'Vendor counteroffer (revised quotation)';
        sentIndex += 1;
        const answer = e.quotationId ? answers.get(e.quotationId) : undefined;
        const row = e.quotationId ? quotationById.get(e.quotationId) : undefined;
        if (answer === 'quotation_accepted') status = 'accepted';
        else if (answer === 'quotation_rejected') status = 'rejected';
        else if (answer === 'quotation_withdrawn') status = 'withdrawn';
        else if (row?.status === QuotationStatus.EXPIRED) status = 'expired';
        else if (
          row?.status === QuotationStatus.SENT &&
          row.validUntil &&
          time(row.validUntil) <= now
        )
          status = 'expired';
        else if (e !== lastSent || row?.status === QuotationStatus.SUPERSEDED) status = 'superseded';
        else status = 'awaiting_customer';
        break;
      }
      case 'quotation_rejected':
        label = 'Customer rejected the quotation and asked for a requote';
        status = 'rejected';
        break;
      case 'quotation_withdrawn':
        label = 'Vendor withdrew the quotation';
        status = 'withdrawn';
        break;
      case 'quotation_accepted':
        label = 'Final accepted price';
        status = 'accepted';
        break;
      case 'request_accepted':
      default:
        label = "Final accepted price (vendor accepted the customer's price)";
        status = 'accepted';
        break;
    }
    return {
      kind: e.kind,
      label,
      amount: e.amount,
      currency: e.currency,
      status,
      statusLabel: STATUS_LABEL[status],
      by: e.actorRole,
      at: e.occurredAt,
      note: e.note,
      quotationId: e.quotationId,
    };
  });

  const finalEvent = [...ordered]
    .reverse()
    .find((e) => e.kind === 'quotation_accepted' || e.kind === 'request_accepted');
  const lastQuotationStep = [...ordered]
    .reverse()
    .find((e) =>
      ['quotation_sent', 'quotation_rejected', 'quotation_withdrawn', 'quotation_accepted'].includes(
        e.kind,
      ),
    );

  return {
    entries,
    finalPrice:
      finalEvent && finalEvent.amount
        ? {
            amount: finalEvent.amount,
            currency: finalEvent.currency,
            at: finalEvent.occurredAt,
            source: finalEvent.kind === 'quotation_accepted' ? 'quotation' : 'request',
          }
        : null,
    requoteRequested: !finalEvent && lastQuotationStep?.kind === 'quotation_rejected',
  };
}

/**
 * Whether the customer has declined the provider's latest quotation and the
 * booking is waiting on a requote. In that state the provider may only send a
 * revised quotation or cancel: accepting would have to pick a price, and the
 * only prices left are ones the customer has already moved past.
 */
export function awaitingRequote(
  status: BookingStatus,
  quotations: Pick<NegotiationQuotation, 'status' | 'createdAt'>[],
): boolean {
  if (status !== BookingStatus.REQUESTED || quotations.length === 0) return false;
  const latest = [...quotations].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  return latest.status === QuotationStatus.REJECTED;
}

/**
 * The price the customer asked for, which is what "accept the request" agrees
 * to: the budget they named, else the listed price they picked. Never the
 * listed price over a lower budget -- that would charge the customer more than
 * they asked to pay without anyone saying so.
 */
export function customerAsk(booking: {
  estimatedAmount?: string | null;
  expectedBudget?: string | null;
}): { amount: string; basis: 'budget' | 'listed' } | null {
  if (positive(booking.expectedBudget)) {
    return { amount: fixed(booking.expectedBudget as string), basis: 'budget' };
  }
  if (positive(booking.estimatedAmount)) {
    return { amount: fixed(booking.estimatedAmount as string), basis: 'listed' };
  }
  return null;
}
