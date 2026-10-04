/**
 * What a wedding planner's public profile is made of, beyond the basics.
 *
 * The services a planner offers, the kinds of wedding they specialise in, the
 * weddings in their portfolio and the four states a day on their calendar can
 * be in. The server holds the same keys (backend wedding-planners
 * `planner-catalog.ts`) and refuses any other, so a profile cannot carry a
 * service the request form does not know how to name.
 *
 * Deliberately free of React and of every import: the mobile app reads this
 * file too (mobile/src/shared/planner-profile.ts), and a shared module has to
 * be dependency-free (see mobile/metro.config.js).
 */

export const PLANNER_SERVICES = [
  { key: 'full_planning', label: 'Full Wedding Planning' },
  { key: 'partial_planning', label: 'Partial Wedding Planning' },
  { key: 'day_of_coordination', label: 'Day-of Coordination' },
  { key: 'destination_wedding', label: 'Destination Wedding' },
  { key: 'venue_management', label: 'Venue Management' },
  { key: 'decoration', label: 'Decoration Coordination' },
  { key: 'catering', label: 'Catering Coordination' },
  { key: 'photography', label: 'Photography Coordination' },
  { key: 'makeup', label: 'Makeup Coordination' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'transportation', label: 'Transportation' },
  { key: 'guest_management', label: 'Guest Management' },
  { key: 'invitations', label: 'Invitation Management' },
  { key: 'budget_management', label: 'Budget Management' },
  { key: 'timeline_management', label: 'Timeline Management' },
  { key: 'event_planning', label: 'Event-specific Planning' },
] as const;

export type PlannerServiceKey = (typeof PLANNER_SERVICES)[number]['key'];

export const PLANNER_SPECIALIZATIONS = [
  { key: 'traditional', label: 'Traditional' },
  { key: 'telugu', label: 'Telugu' },
  { key: 'tamil', label: 'Tamil' },
  { key: 'north_indian', label: 'North Indian' },
  { key: 'christian', label: 'Christian' },
  { key: 'muslim', label: 'Muslim' },
  { key: 'luxury', label: 'Luxury' },
  { key: 'destination', label: 'Destination' },
  { key: 'modern', label: 'Modern' },
  { key: 'intimate', label: 'Intimate' },
  { key: 'budget', label: 'Budget-friendly' },
  { key: 'theme', label: 'Theme' },
] as const;

export type PlannerSpecializationKey = (typeof PLANNER_SPECIALIZATIONS)[number]['key'];

export const MAX_PLANNER_WEDDINGS = 24;
export const MAX_WEDDING_PHOTOS = 30;
export const MAX_WEDDING_VIDEOS = 6;
export const MAX_WEDDING_EVENTS = 12;

/** One event of a portfolio wedding: the haldi, the sangeet. */
export interface PlannerWeddingEvent {
  name: string;
  /** ISO calendar date, when the planner gave one. */
  date?: string | null;
  description?: string | null;
}

/** A wedding the planner ran, as shown in their portfolio. */
export interface PlannerWedding {
  /** Assigned by the server; stable across edits, used in the wedding's address. */
  id: string;
  /** The couple, as the planner names them: "Rahul & Priya". */
  title: string;
  location?: string | null;
  date?: string | null;
  description?: string | null;
  /** Falls back to the first photo when absent. */
  coverUrl?: string | null;
  photos: string[];
  /** https links: uploaded files, or YouTube / Vimeo pages. */
  videos: string[];
  events: PlannerWeddingEvent[];
}

/**
 * How a day reads to a couple.
 *
 * `limited`: still open, but some of the day is already taken. `booked`: every
 * window is taken. `unavailable`: the planner blocked it. A day with nothing
 * published is absent from the answer rather than a fifth state, because the
 * planner may still take it; the couple can ask.
 */
export type PlannerDayStatus = 'available' | 'limited' | 'booked' | 'unavailable';

export interface PlannerDay {
  date: string;
  status: PlannerDayStatus;
  /** Openings left that day; zero unless available or limited. */
  openings: number;
}

export const DAY_STATUS_LABEL: Record<PlannerDayStatus, string> = {
  available: 'Available',
  limited: 'Limited availability',
  booked: 'Booked',
  unavailable: 'Not available',
};

export function plannerServiceLabel(key: string): string {
  return PLANNER_SERVICES.find((s) => s.key === key)?.label ?? key;
}

export function plannerSpecializationLabel(key: string): string {
  return PLANNER_SPECIALIZATIONS.find((s) => s.key === key)?.label ?? key;
}

/** The picture a wedding card leads with. */
export function weddingCover(w: Pick<PlannerWedding, 'coverUrl' | 'photos'>): string | null {
  return w.coverUrl || w.photos?.[0] || null;
}

/**
 * A YouTube or Vimeo page as the address its player embeds from, or null for
 * anything else (an uploaded file plays in a video element instead).
 */
export function videoEmbedUrl(url: string): string | null {
  const yt =
    /^https:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)([\w-]{6,})/i.exec(url) ??
    /^https:\/\/youtu\.be\/([\w-]{6,})/i.exec(url);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = /^https:\/\/(?:www\.)?vimeo\.com\/(\d+)/i.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

/** A still for a video link, where the host publishes one. */
export function videoThumbnail(url: string): string | null {
  const embed = videoEmbedUrl(url);
  const yt = embed && /youtube\.com\/embed\/([\w-]+)/.exec(embed);
  return yt ? `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` : null;
}
