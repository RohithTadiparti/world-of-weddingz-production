import { CONSENT_RELATION_LABEL, ROLE_LABEL } from '@/shared/permissions';
import { humanise } from '@/lib/format';

/**
 * Enum values said as words, for the mobile screens.
 *
 * The label tables themselves are the web client's, read through
 * `@/shared/permissions`. What lives here is only what that module does not
 * carry: lookups that fall back to readable words when a value has no label
 * yet, and the few small tables no web lib file exports. A raw `self_employed`
 * or `in_person` on screen is a database value leaking out, and each helper
 * below exists because one did.
 */

/** A label from a table, or the value in words; null when there is no value. */
export function labelFor(table: Record<string, string>, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return table[value] ?? sentence(humanise(value));
}

/** `self employed` → `Self employed`. */
export function sentence(value: string): string {
  return value.replace(/^\w/, (c) => c.toUpperCase());
}

/** The persona as the product names it: "Verification officer", not `in_person`. */
export function roleLabel(role: string | null | undefined): string | null {
  return labelFor(ROLE_LABEL as Record<string, string>, role);
}

export const GENDER_LABEL: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
};

/** Bride/groom accounts represent a fixed side of a match. */
export function genderForIndividualRole(role: string | null | undefined): 'female' | 'male' | null {
  if (role === 'bride') return 'female';
  if (role === 'groom') return 'male';
  return null;
}

/** A wedding event's status. The server's enum is upcoming/ongoing/completed/cancelled. */
export const EVENT_STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Happening now',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * `18:30:00` → `6:30 pm`.
 *
 * Postgres hands a time column back with its seconds, and a start time printed
 * as `18:30:00` reads as a timestamp rather than as when to arrive. The same
 * wording as the time picker's `readableTime`, which lives with the form
 * controls and takes a value already trimmed to `HH:MM`.
 */
export function clockTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const suffix = hours < 12 ? 'am' : 'pm';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

/**
 * Age in whole years from a date of birth, for a profile whose server answer
 * carries the date rather than an age band. Null for a date that is missing or
 * not believable, so a screen says nothing rather than something wrong.
 */
export function ageFrom(dateOfBirth: string | null | undefined, now = new Date()): string | null {
  if (!dateOfBirth) return null;
  const text = String(dateOfBirth);
  const dob = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  if (Number.isNaN(dob.getTime())) return null;
  let years = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 18 && years < 120 ? `${years} years` : null;
}

/**
 * The age a list row shows: the exact age the server works out from the date of
 * birth, or the older five-year band only when talking to a server that predates
 * it. "27 yrs", never "26-30" when the age is known.
 */
export function ageText(age: number | null | undefined, ageRange?: string | null): string | null {
  if (typeof age === 'number' && age > 0) return `${age} yrs`;
  return ageRange ? `${ageRange} yrs` : null;
}

/** Who answers for a profile, as the server describes it. Null when self-managed. */
export interface Stewardship {
  kind: 'family' | 'agency' | 'steward';
  label: string;
  relation: string | null;
}

/** "Managed by a family member (father)", or the bare label for an agency. */
export function stewardshipLine(stewardship: Stewardship | null | undefined): string | null {
  if (!stewardship) return null;
  const relation = labelFor(CONSENT_RELATION_LABEL, stewardship.relation);
  return relation ? `${stewardship.label} (${relation.toLowerCase()})` : stewardship.label;
}
