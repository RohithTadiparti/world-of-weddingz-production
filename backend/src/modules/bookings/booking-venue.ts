/**
 * Where, when and for how many a booking is, when no wedding function is
 * linked to say so.
 *
 * A request placed straight from a vendor's page carries these on the service's
 * own booking form — the date of the function, where it is held, the guest
 * count — and a venue business is itself the place. Reading only the linked
 * event left every such booking saying "Date not set" and "Venue not given"
 * over details the customer (or their planner) had typed in.
 */

export interface VenueSource {
  answers?: Record<string, unknown> | null;
  providerName?: string | null;
  providerCity?: string | null;
  /** The booked listing is a venue, so the booking is held there. */
  providerIsVenue?: boolean;
}

export function venueOf(src: VenueSource): { venue: string | null; city: string | null } {
  // A venue business is where its bookings are held, whatever else was typed.
  if (src.providerIsVenue && src.providerName) {
    return { venue: src.providerName, city: src.providerCity ?? null };
  }
  // Otherwise the place given on the booking form: a location answer is an
  // object carrying a city, and optionally a label for the venue itself.
  for (const value of Object.values(src.answers ?? {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const place = value as { label?: unknown; city?: unknown };
    const city = typeof place.city === 'string' ? place.city.trim() : '';
    if (!city) continue;
    const label = typeof place.label === 'string' ? place.label.trim() : '';
    return { venue: label && label !== city ? label : null, city };
  }
  return { venue: null, city: null };
}

export interface WeddingFacts {
  /** The couple's wedding plan date. */
  weddingDate: string | null;
  /** The couple's own functions. */
  events: { name: string; eventDate: string | null; venue: string | null; city: string | null; expectedGuests: number | null }[];
  /** What the couple has booked with vendors, and where each is held. */
  vendorBookings: { eventDate: string | null; venue: string | null; city: string | null; isVenue: boolean }[];
}

/**
 * The wedding a planner was booked for, read from the wedding itself.
 *
 * A booking with a planner is for the whole wedding, not one function, so it
 * carries no date, venue or event of its own — and a planner's queue showed
 * "Date not set" and "Venue not given" while the couple's plan, their functions
 * and the venue already booked for them all said otherwise. Earliest dates win
 * because the first function is the first day the planner is needed; a booked
 * venue business beats a venue typed on a function, because it is confirmed.
 */
export function weddingContextOf(facts: WeddingFacts): {
  date: string | null;
  venue: string | null;
  city: string | null;
  eventNames: string | null;
  guests: number | null;
} {
  const earliest = (dates: (string | null)[]) =>
    dates.filter((d): d is string => Boolean(d)).sort()[0] ?? null;

  const date =
    facts.weddingDate ??
    earliest(facts.events.map((e) => e.eventDate)) ??
    earliest(facts.vendorBookings.map((b) => b.eventDate));

  // Couples book more than one venue across a wedding. The one booked for the
  // day this booking is dated to is the one that describes it; any other
  // booked venue only when none is.
  const venues = facts.vendorBookings.filter((b) => b.isVenue && (b.venue || b.city));
  const bookedVenue = venues.find((b) => date && b.eventDate === date) ?? venues[0];
  const eventVenue = facts.events.find((e) => e.venue || e.city);
  const anyPlace = facts.vendorBookings.find((b) => b.venue || b.city);
  const place = bookedVenue ?? eventVenue ?? anyPlace;

  const names = facts.events.map((e) => e.name).filter(Boolean);
  const guests = facts.events.reduce<number | null>(
    (most, e) => (e.expectedGuests && e.expectedGuests > (most ?? 0) ? e.expectedGuests : most),
    null,
  );

  return {
    date,
    venue: place?.venue ?? null,
    // A venue with no city still leaves the city to be found elsewhere: any
    // function that names one, then anything booked that does.
    city:
      place?.city ??
      facts.events.find((e) => e.city)?.city ??
      facts.vendorBookings.find((b) => b.city)?.city ??
      null,
    eventNames: names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : null,
    guests,
  };
}

/** The function's date from the booking form, when the booking has none of its own. */
export function dateOf(answers?: Record<string, unknown> | null): string | null {
  const value = answers?.event_date;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** The guest count from the booking form, when no linked function carries one. */
export function guestsOf(answers?: Record<string, unknown> | null): number | null {
  const value = Number(answers?.guest_count);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The linked wedding function, as far as a booking's context needs it. */
export interface LinkedEvent {
  name: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  expectedGuests: number | null;
}

export interface ContextBooking {
  eventDate?: string | null;
  serviceAnswers?: Record<string, unknown> | null;
  providerName?: string | null;
  providerCity?: string | null;
  providerIsVenue?: boolean;
}

/**
 * What a booking is for, where and when, read from every place that says so.
 *
 * Each fact is taken field by field from the strongest source that has it: the
 * linked function, then the booking's own column and form answers (and the
 * venue business itself), then — for a planner, who is booked for the whole
 * wedding — the wedding. Reading only the linked function made a function with
 * no date or venue wipe out the date and place the booking form carried, so a
 * booking for a dated day still read "Date not set". Pass `wedding` only for a
 * planner booking.
 */
export function bookingContextOf(
  booking: ContextBooking,
  event?: LinkedEvent | null,
  wedding?: WeddingFacts | null,
  /**
   * A planner is booked for the whole wedding, so any of its facts will do.
   * A vendor is booked for a day, so only what the couple has on that same day
   * describes it. Defaults to the whole wedding for callers that pass `wedding`
   * only for planner bookings.
   */
  opts: { wholeWedding?: boolean } = {},
): {
  eventName: string | null;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  guests: number | null;
} {
  const place = venueOf({
    answers: booking.serviceAnswers,
    providerName: booking.providerName,
    providerCity: booking.providerCity,
    providerIsVenue: booking.providerIsVenue,
  });
  const wholeWedding = opts.wholeWedding ?? true;
  const context = wedding && wholeWedding ? weddingContextOf(wedding) : null;
  const eventDate =
    event?.eventDate || booking.eventDate || dateOf(booking.serviceAnswers) || context?.date || null;
  // A DJ or a photographer booked for the 12th, with nothing on its own form
  // about where: the venue the couple booked for the 12th, or their function
  // on that day, is where it is — and "Venue not given" was wrong.
  const sameDay = wedding && !wholeWedding && eventDate ? sameDayOf(wedding, eventDate) : null;
  return {
    eventName: event?.name || context?.eventNames || sameDay?.eventName || null,
    eventDate,
    venue: event?.venue || place.venue || context?.venue || sameDay?.venue || null,
    city: event?.city || place.city || context?.city || sameDay?.city || null,
    guests:
      event?.expectedGuests ||
      guestsOf(booking.serviceAnswers) ||
      context?.guests ||
      sameDay?.guests ||
      null,
  };
}

/** What the couple has on one day: the venue booked for it, and the function held on it. */
export function sameDayOf(
  facts: WeddingFacts,
  date: string,
): { eventName: string | null; venue: string | null; city: string | null; guests: number | null } {
  const venue = facts.vendorBookings.find(
    (b) => b.isVenue && b.eventDate === date && (b.venue || b.city),
  );
  const fn = facts.events.find((e) => e.eventDate === date);
  return {
    eventName: fn?.name ?? null,
    venue: venue?.venue ?? fn?.venue ?? null,
    city: venue?.city ?? fn?.city ?? null,
    guests: fn?.expectedGuests ?? null,
  };
}
