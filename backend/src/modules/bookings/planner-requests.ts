import { BookingStatus } from '../../common/enums';
import type { Booking, PlannerBrief } from './entities/booking.entity';
import type { QuotationSummary } from './booking-summary';

/** What kind of wedding it is, as the couple describes it on a planner request. */
export const WEDDING_TYPES = [
  'Traditional',
  'Destination',
  'Intimate',
  'Court / Registered',
  'Theme',
  'Interfaith',
  'Other',
] as const;

/**
 * A couple's request to a wedding planner, as the planner reads it.
 *
 * The booking row knows requested / quotation_sent / payment_pending and so
 * on; a planner triaging new work thinks in the stages below. They are derived
 * from the booking, its quotations and who cancelled it, never stored, so the
 * page cannot disagree with the booking it was read from.
 */
export type PlannerRequestStatus =
  /** Nobody has answered it yet. */
  | 'new'
  /** The planner took it on (or the couple agreed a price); work proceeds. */
  | 'accepted'
  /** An offer is waiting on the couple. */
  | 'quotation_sent'
  /** The couple declined the offer and asked for a new price. */
  | 'requote_requested'
  /** The planner turned it down. */
  | 'declined'
  /** Finished, or withdrawn by the couple or support. */
  | 'closed';

/** The booking states in which the price is agreed and the job is the planner's. */
const AGREED: BookingStatus[] = [
  BookingStatus.QUOTATION_ACCEPTED,
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
  BookingStatus.DISPUTED,
];

export interface RequestStatusInput {
  status: BookingStatus;
  providerAcceptedAt: Date | null;
  cancelledByRole?: string | null;
  quotation?: Pick<QuotationSummary, 'stage'> | null;
}

export function plannerRequestStatus(b: RequestStatusInput): PlannerRequestStatus {
  if (b.status === BookingStatus.CANCELLED) {
    return b.cancelledByRole === 'provider' ? 'declined' : 'closed';
  }
  if (b.status === BookingStatus.COMPLETED) return 'closed';
  if (AGREED.includes(b.status)) return 'accepted';

  switch (b.quotation?.stage) {
    case 'sent':
    case 'requoted':
      return 'quotation_sent';
    case 'declined':
      return 'requote_requested';
    case 'accepted':
      return 'accepted';
    case undefined:
      return b.providerAcceptedAt ? 'accepted' : 'new';
    // Withdrawn, expired or superseded: the planner has engaged, and the next
    // move is a fresh offer from them.
    default:
      return 'accepted';
  }
}

/**
 * A short reference both sides can quote — "REQ-2026-3F9A1C" — taken from the
 * year it arrived and the start of its id, so it needs no counter to keep.
 */
export function requestNumber(id: string, createdAt: Date): string {
  const year = new Date(createdAt).getFullYear();
  return `REQ-${year}-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** Whether the planner is free on the wedding date. */
export type DateAvailability =
  /** No date on the request. */
  | 'no_date'
  /** The date has passed. */
  | 'past'
  /** A published window has room. */
  | 'available'
  /** Another wedding is already committed that day and nothing is open. */
  | 'booked'
  /** Nothing published and nothing committed: the planner decides. */
  | 'unpublished';

export function dateAvailability(input: {
  date: string | null;
  today: string;
  openings: number;
  otherBookings: number;
}): DateAvailability {
  if (!input.date) return 'no_date';
  if (input.date < input.today) return 'past';
  if (input.openings > 0) return 'available';
  if (input.otherBookings > 0) return 'booked';
  return 'unpublished';
}

/** One row of the planner's request list. */
export interface PlannerRequestCard {
  id: string;
  requestNumber: string;
  status: PlannerRequestStatus;
  receivedAt: Date;
  client: { userId: string; name: string | null; photo: string | null; city: string | null };
  weddingDate: string | null;
  location: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  /** PLANNER_SERVICE_KEYS the couple ticked; the clients hold the labels. */
  services: string[];
}

/** The whole request, for the detail view. Never carries the couple's phone. */
export interface PlannerRequestDetail extends PlannerRequestCard {
  client: PlannerRequestCard['client'] & { email: string | null };
  bookingStatus: BookingStatus;
  acceptedAt: Date | null;
  guestCountMin: number | null;
  guestCountMax: number | null;
  weddingType: string | null;
  requirements: string | null;
  notes: string | null;
  referenceImages: string[];
  availability: { state: DateAvailability; openings: number; otherBookings: number };
  quotation: QuotationSummary | null;
  /** The agreed price, once there is one. */
  amount: string;
  cancellationReason: string | null;
  cancelledAt: Date | null;
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The card for one request. Expects a booking that has been through the
 * provider list's client context, so the couple's name, city and the
 * wedding's own date and place are already on it.
 */
export function toRequestCard(b: Booking): PlannerRequestCard {
  const brief: PlannerBrief = b.plannerBrief ?? {};
  // Requests made before the brief existed sent the budget as `amount`, and
  // before a quotation that is the only figure they have.
  const legacyBudget = b.quotation ? null : num(b.amount);
  const budgetMax = num(brief.budgetMax) ?? num(b.expectedBudget) ?? legacyBudget;
  return {
    id: b.id,
    requestNumber: requestNumber(b.id, b.createdAt),
    status: plannerRequestStatus(b),
    receivedAt: b.createdAt,
    client: {
      userId: b.userId,
      name: b.clientName ?? null,
      photo: b.clientPhoto ?? null,
      city: b.clientCity ?? null,
    },
    weddingDate: b.eventDate ?? null,
    location: brief.location || b.eventCity || b.clientCity || null,
    budgetMin: num(brief.budgetMin),
    budgetMax,
    currency: b.currency,
    services: b.requestedServices ?? [],
  };
}

export function toRequestDetail(
  b: Booking,
  availability: PlannerRequestDetail['availability'],
): PlannerRequestDetail {
  const brief: PlannerBrief = b.plannerBrief ?? {};
  const card = toRequestCard(b);
  return {
    ...card,
    client: { ...card.client, email: b.clientEmail ?? null },
    bookingStatus: b.status,
    acceptedAt: b.providerAcceptedAt,
    guestCountMin: brief.guestCountMin ?? null,
    guestCountMax: brief.guestCountMax ?? b.expectedGuests ?? null,
    weddingType: brief.weddingType ?? null,
    requirements: b.requirements,
    notes: b.notes ?? null,
    referenceImages: b.referenceImages ?? [],
    availability,
    quotation: b.quotation ?? null,
    amount: b.amount,
    cancellationReason: b.cancellationReason,
    cancelledAt: b.cancelledAt,
  };
}
