/**
 * The "when" of a booking request (rows 13 and 14).
 *
 * Two options sit side by side, both visible from the start and neither
 * chosen: "Pick a Date & Time" (one of the vendor's published slots) and
 * "Request on Date" (a date and time the vendor has not published). Each is
 * selected and unselected on its own; unselecting one never hides the other.
 * A request needs one of them filled, never both.
 *
 * Dependency-free: the app reads this through src/shared.
 */

export interface ScheduleSelection {
  pickSlot: boolean;
  requestDate: boolean;
  slotId: string;
  /** The picked slot's own date, for checking it against the event. */
  slotDate: string | null;
  date: string;
  time: string;
}

export const EMPTY_SCHEDULE: ScheduleSelection = {
  pickSlot: false,
  requestDate: false,
  slotId: '',
  slotDate: null,
  date: '',
  time: '',
};

/** Selecting or unselecting one option; unselecting clears only its own pick. */
export function toggleOption(
  sel: ScheduleSelection,
  option: 'pickSlot' | 'requestDate',
): ScheduleSelection {
  const next = { ...sel, [option]: !sel[option] };
  if (option === 'pickSlot' && !next.pickSlot) return { ...next, slotId: '', slotDate: null };
  if (option === 'requestDate' && !next.requestDate) return { ...next, date: '', time: '' };
  return next;
}

const slotChosen = (s: ScheduleSelection) => s.pickSlot && Boolean(s.slotId);
const dateChosen = (s: ScheduleSelection) => s.requestDate && Boolean(s.date);

/** The day the request is for, whichever option supplied it. */
export function scheduleDate(sel: ScheduleSelection): string | null {
  if (slotChosen(sel)) return sel.slotDate;
  if (dateChosen(sel)) return sel.date;
  return null;
}

/**
 * What stops the request, in a sentence, or null when it can be sent.
 * The event check matches the server's: a request for a function is for that
 * function's day.
 */
export function scheduleError(
  sel: ScheduleSelection,
  event?: { name: string; eventDate: string | null } | null,
): string | null {
  if (!sel.pickSlot && !sel.requestDate) {
    return 'Choose "Pick a Date & Time" or "Request on Date".';
  }
  const hasSlot = slotChosen(sel);
  const hasDate = dateChosen(sel);
  if (sel.requestDate && sel.time && !sel.date) return 'Choose the date you need before the time.';
  if (!hasSlot && !hasDate) {
    if (sel.pickSlot && sel.requestDate) return 'Pick one of the open slots, or enter the date you need.';
    return sel.pickSlot ? 'Pick one of the open slots.' : 'Enter the date you need.';
  }
  if (hasSlot && hasDate) {
    return 'You picked a slot and a requested date. Unselect one so the vendor knows which to confirm.';
  }
  const day = scheduleDate(sel);
  if (event?.eventDate && day && event.eventDate.slice(0, 10) !== day.slice(0, 10)) {
    return (
      `${event.name || 'The event'} is on ${event.eventDate.slice(0, 10)}, but the date you chose is ${day.slice(0, 10)}. ` +
      'Pick a date that matches the event, or choose a different event.'
    );
  }
  return null;
}

/** The part of the request body that says when. Call once scheduleError is null. */
export function schedulePayload(
  sel: ScheduleSelection,
): { slotId: string } | { eventDate: string; requestedTime?: string } | Record<string, never> {
  if (slotChosen(sel)) return { slotId: sel.slotId };
  if (dateChosen(sel)) return { eventDate: sel.date, ...(sel.time ? { requestedTime: sel.time } : {}) };
  return {};
}
