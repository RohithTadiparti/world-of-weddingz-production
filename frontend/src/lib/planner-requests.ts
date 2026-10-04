/**
 * A couple's request to a wedding planner, as the API returns it
 * (`GET /bookings/planner-requests`), and the words the planner reads it in.
 *
 * The status is worked out on the server from the booking and its quotations;
 * this file only names and colours it. Free of React, like planner-profile.ts,
 * because the mobile app reads it too (mobile/src/lib/planner-requests.ts).
 */
import { PLANNER_SERVICES } from './planner-profile';

export type PlannerRequestStatus =
  | 'new'
  | 'accepted'
  | 'quotation_sent'
  | 'requote_requested'
  | 'declined'
  | 'closed';

export type DateAvailability = 'no_date' | 'past' | 'available' | 'booked' | 'unpublished';

export interface PlannerRequestCard {
  id: string;
  requestNumber: string;
  status: PlannerRequestStatus;
  receivedAt: string;
  client: { userId: string; name: string | null; photo: string | null; city: string | null };
  weddingDate: string | null;
  location: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  services: string[];
}

export interface PlannerRequestDetail extends PlannerRequestCard {
  client: PlannerRequestCard['client'] & { email: string | null };
  bookingStatus: string;
  acceptedAt: string | null;
  guestCountMin: number | null;
  guestCountMax: number | null;
  weddingType: string | null;
  requirements: string | null;
  notes: string | null;
  referenceImages: string[];
  availability: { state: DateAvailability; openings: number; otherBookings: number };
  quotation: {
    id: string;
    amount: string;
    currency: string;
    stage: 'sent' | 'requoted' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'superseded';
    responseNote: string | null;
    respondedAt: string | null;
    sentAt: string;
    count: number;
    declinedCount: number;
  } | null;
  amount: string;
  cancellationReason: string | null;
  cancelledAt: string | null;
}

export const STATUS_LABEL: Record<PlannerRequestStatus, string> = {
  new: 'New Request',
  accepted: 'Accepted',
  quotation_sent: 'Quotation Sent',
  requote_requested: 'Re-quotation Requested',
  declined: 'Declined',
  closed: 'Closed',
};

/** Pill classes from index.css; quotation-sent borrows the info family. */
export const STATUS_TONE: Record<PlannerRequestStatus, string> = {
  new: 'pill-brand',
  accepted: 'pill-positive',
  quotation_sent: 'pill bg-info-bg text-info-fg',
  requote_requested: 'pill-caution',
  declined: 'pill-critical',
  closed: 'pill-neutral',
};

/** The tabs over the list, in the order a planner works through them. */
export const STATUS_TABS: { key: PlannerRequestStatus | 'all'; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'quotation_sent', label: 'Quoted' },
  { key: 'requote_requested', label: 'Re-quotes' },
  { key: 'declined', label: 'Declined' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

/** A requested service's name, from its catalogue key ("full_planning"). */
export function serviceLabel(key: string): string {
  return PLANNER_SERVICES.find((s) => s.key === key)?.label ?? key.replace(/_/g, ' ');
}

/** Kept in step with the API's WEDDING_TYPES (bookings/planner-requests.ts). */
export const WEDDING_TYPES = [
  'Traditional',
  'Destination',
  'Intimate',
  'Court / Registered',
  'Theme',
  'Interfaith',
  'Other',
];

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "₹1,50,000 – ₹2,00,000", "Up to ₹2,00,000", "From ₹1,50,000", or the fallback. */
export function budgetRange(min: number | null, max: number | null, fallback = 'Not shared'): string {
  if (min && max && min !== max) return `${rupees(min)} – ${rupees(max)}`;
  if (max) return min ? rupees(max) : `Up to ${rupees(max)}`;
  if (min) return `From ${rupees(min)}`;
  return fallback;
}

/** "250 – 300", "Up to 300", "250+", or the fallback. */
export function guestRange(min: number | null, max: number | null, fallback = 'Not shared'): string {
  if (min && max && min !== max) return `${min} – ${max}`;
  if (max) return min ? String(max) : `Up to ${max}`;
  if (min) return `${min}+`;
  return fallback;
}

/** "Just now", "5 minutes ago", "2 hours ago", "3 days ago", then the date. */
export function receivedAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** What the planner can do next, given where the request stands. */
export function requestActions(r: Pick<PlannerRequestDetail, 'status' | 'bookingStatus'>): {
  accept: boolean;
  quote: 'send' | 'revise' | null;
  decline: boolean;
} {
  const open = r.bookingStatus === 'requested' || r.bookingStatus === 'quotation_sent';
  if (!open) return { accept: false, quote: null, decline: false };
  switch (r.status) {
    case 'new':
      return { accept: true, quote: 'send', decline: true };
    case 'accepted':
      return { accept: false, quote: 'send', decline: true };
    case 'quotation_sent':
      return { accept: false, quote: 'revise', decline: true };
    case 'requote_requested':
      return { accept: false, quote: 'revise', decline: true };
    default:
      return { accept: false, quote: null, decline: false };
  }
}
