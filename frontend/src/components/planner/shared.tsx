import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AirplaneTilt,
  Buildings,
  CalendarCheck,
  Camera,
  Car,
  CaretLeft,
  CaretRight,
  ClipboardText,
  Clock,
  Confetti,
  EnvelopeSimple,
  Flower,
  ForkKnife,
  ListChecks,
  MusicNotes,
  PaintBrush,
  Star,
  UsersThree,
  Wallet,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { api } from '../../lib/api';
import type { SocialLink } from '../../lib/social-links';
import { PLANNER_SERVICES, type PlannerWedding } from '../../lib/planner-profile';

/**
 * What the planner profile and its wedding pages share.
 *
 * The profile, the list of a planner's weddings and a single wedding all read
 * the same listing (GET /wedding-planners/:id) under the same query key, so a
 * couple who opens a wedding from the carousel and comes back does not wait
 * for the planner a second time.
 */

export interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

export interface Planner {
  id: string;
  agencyName: string;
  bio?: string | null;
  city?: string | null;
  state?: string | null;
  servesCities?: string[];
  packages?: PlannerPackage[];
  yearsExperience: number;
  website?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
  socialLinks?: SocialLink[];
  portfolio?: string[];
  ratingAvg: number;
  ratingCount: number;
  services?: string[];
  specializations?: string[];
  introVideoUrl?: string | null;
  weddingsCompleted?: number | null;
  planningApproach?: string | null;
  weddings?: PlannerWedding[];
}

export function usePlanner(id: string) {
  return useQuery({
    queryKey: ['planner', id],
    queryFn: async () => (await api.get(`/wedding-planners/${id}`)).data as Planner,
    enabled: Boolean(id),
    retry: false,
  });
}

/** Today as a calendar date in the viewer's own zone, never shifted by UTC. */
export const iso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

/** A calendar date ("2026-11-14") as a local date. */
export function localDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "15 December 2026". */
export const longDate = (value: string) =>
  localDate(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** A wedding's place and date, as one line under its title. */
export function weddingMeta(w: Pick<PlannerWedding, 'location' | 'date'>): string {
  return [w.location, w.date ? longDate(w.date) : null].filter(Boolean).join(' · ');
}

/**
 * One glyph per service, so a grid of sixteen checkboxes can be scanned
 * rather than read. A key the catalogue gains later falls back to the
 * clipboard rather than to nothing.
 */
export const SERVICE_ICONS: Record<string, Icon> = {
  full_planning: ClipboardText,
  partial_planning: ListChecks,
  day_of_coordination: CalendarCheck,
  destination_wedding: AirplaneTilt,
  venue_management: Buildings,
  decoration: Flower,
  catering: ForkKnife,
  photography: Camera,
  makeup: PaintBrush,
  entertainment: MusicNotes,
  transportation: Car,
  guest_management: UsersThree,
  invitations: EnvelopeSimple,
  budget_management: Wallet,
  timeline_management: Clock,
  event_planning: Confetti,
};

/**
 * The services a couple can tick: the planner's own when they have named any,
 * else the whole catalogue, since a planner who has not filled the list in
 * still takes requests and the couple should be able to say what they need.
 */
export function offeredServices(planner: Pick<Planner, 'services'>): string[] {
  const known = new Set<string>(PLANNER_SERVICES.map((s) => s.key));
  const own = (planner.services ?? []).filter((k) => known.has(k));
  return own.length ? own : PLANNER_SERVICES.map((s) => s.key);
}

/* ------------------------------------------------------------------------ */
/* The couple's selection, kept while they look around                       */
/* ------------------------------------------------------------------------ */

export interface PlannerSelection {
  services: string[];
  date: string;
  specializations: string[];
}

const EMPTY: PlannerSelection = { services: [], date: '', specializations: [] };
const storageKey = (plannerId: string) => `planner-request:${plannerId}`;

function readSelection(plannerId: string): PlannerSelection {
  try {
    const raw = sessionStorage.getItem(storageKey(plannerId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<PlannerSelection>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return {
      services: strings(parsed.services),
      date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : '',
      specializations: strings(parsed.specializations),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * The services, date and specialisations a couple has picked on a planner's
 * profile.
 *
 * Kept in session storage under the planner's id, because the profile invites
 * them to open a past wedding and come back, and a selection that vanished on
 * the way would have to be made again. A `?date=` on the address (Hire a
 * Planner passes the date the couple searched for) wins over a stored one.
 * Storage can be refused (a private window, a blocked site), in which case the
 * selection simply lives as long as the page.
 */
export function usePlannerSelection(plannerId: string, dateFromAddress: string) {
  const [selection, setSelection] = useState<PlannerSelection>(() => {
    const stored = readSelection(plannerId);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateFromAddress) ? { ...stored, date: dateFromAddress } : stored;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(plannerId), JSON.stringify(selection));
    } catch {
      /* Storage refused: the selection lives in memory only. */
    }
  }, [plannerId, selection]);

  const toggle = useCallback((field: 'services' | 'specializations', key: string) => {
    setSelection((s) => ({
      ...s,
      [field]: s[field].includes(key) ? s[field].filter((k) => k !== key) : [...s[field], key],
    }));
  }, []);

  const clear = useCallback(() => setSelection(EMPTY), []);

  return { selection, setSelection, toggle, clear };
}

/* ------------------------------------------------------------------------ */
/* Small shared pieces                                                       */
/* ------------------------------------------------------------------------ */

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          weight={value >= n - 0.25 ? 'fill' : 'regular'}
          className={value >= n - 0.25 ? 'text-gold' : 'text-gray-300'}
          aria-hidden
        />
      ))}
    </span>
  );
}

/** A titled panel: every section of the profile sits in one. */
export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={`card min-w-0 sm:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={headingId} className="font-serif text-[1.625rem] font-normal leading-tight text-brand">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm leading-relaxed text-gray-600">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A dialog over the page: a sheet from the bottom on a phone, a centred panel
 * wider up. Escape and the backdrop close it, the page behind does not scroll
 * while it is open, and focus goes into it so a keyboard user lands inside.
 */
export function Modal({
  title,
  onClose,
  children,
  size = 'md',
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Read through a ref so a parent passing a fresh arrow each render does not
  // re-run the effect, which would pull focus out of the field being typed in.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const returnTo = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      returnTo?.focus?.();
    };
  }, []);

  const width = size === 'xl' ? 'sm:max-w-4xl' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-[--radius-lg] border border-gray-200 bg-surface shadow-lifted outline-none sm:rounded-[--radius-lg] ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <h2 id={headingId} className="min-w-0 font-serif text-[1.5rem] leading-tight text-brand">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 grid h-10 w-10 shrink-0 place-items-center text-gray-500 hover:text-gray-900"
            aria-label="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-gray-200 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * A video link played over the page: YouTube and Vimeo pages through their
 * own player, an uploaded file in a video element.
 */
export function VideoModal({
  url,
  embed,
  title,
  onClose,
}: {
  url: string;
  embed: string | null;
  title: string;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} size="xl">
      <div className="aspect-video w-full bg-black">
        {embed ? (
          <iframe
            src={`${embed}?autoplay=1`}
            title={title}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <video src={url} controls autoPlay playsInline className="h-full w-full">
            Your browser cannot play this video.
          </video>
        )}
      </div>
    </Modal>
  );
}

/** Photographs one at a time, with the arrow keys and buttons to move through them. */
export function Lightbox({
  photos,
  start,
  title,
  onClose,
}: {
  photos: string[];
  start: number;
  title: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const count = photos.length;
  const step = useCallback((by: number) => setIndex((i) => (i + by + count) % count), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  return (
    <Modal title={`${title} (${index + 1} of ${count})`} onClose={onClose} size="xl">
      <div className="relative bg-surface-sunken">
        <img src={photos[index]} alt={`Photo ${index + 1} of ${count}`} className="mx-auto max-h-[70vh] w-auto object-contain" />
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center border border-gray-200 bg-surface/90 text-gray-800 hover:text-brand"
              aria-label="Previous photo"
            >
              <CaretLeft size={20} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center border border-gray-200 bg-surface/90 text-gray-800 hover:text-brand"
              aria-label="Next photo"
            >
              <CaretRight size={20} aria-hidden />
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
