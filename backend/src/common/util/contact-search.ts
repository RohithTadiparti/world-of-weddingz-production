import { likeEscape } from './like';

/** A phone needle shorter than this matches too much to be a search. */
const MIN_PHONE_DIGITS = 3;

/**
 * A WHERE fragment that finds an account by its email or mobile number.
 *
 * Administrator lists show contact details masked (ISS-11), but an
 * administrator still arrives with "the person at rohith@gmail.com" or "the
 * one calling from 98765 43210". So the search runs on the raw columns here,
 * in the database, and only the response is masked: typing a full or partial
 * address, or any run of digits from the number, still finds the row.
 *
 * The email is matched case-insensitively as a substring. The phone is matched
 * on digits only, so `+91 98765-43210`, `9876543210` and `43210` all find the
 * same account whatever spacing it was stored with.
 */
export function contactSearchClause(
  columns: { email: string; phone: string },
  needle: string,
  key = 'contactNeedle',
): { clause: string; params: Record<string, string> } {
  const text = needle.trim().toLowerCase();
  const digits = text.replace(/\D/g, '');
  const params: Record<string, string> = { [key]: `%${likeEscape(text)}%` };
  const parts = [`LOWER(${columns.email}) LIKE :${key}`];
  if (digits.length >= MIN_PHONE_DIGITS) {
    params[`${key}Digits`] = `%${digits}%`;
    parts.push(`REGEXP_REPLACE(COALESCE(${columns.phone}, ''), '\\D', '', 'g') LIKE :${key}Digits`);
  }
  return { clause: `(${parts.join(' OR ')})`, params };
}

/**
 * The same rule for rows already in memory, for the short lists (the officer
 * roster) that are assembled in full before they are returned.
 */
export function contactMatches(
  contact: { email?: string | null; phone?: string | null },
  needle: string,
): boolean {
  const text = needle.trim().toLowerCase();
  if (!text) return true;
  if ((contact.email ?? '').toLowerCase().includes(text)) return true;
  const digits = text.replace(/\D/g, '');
  return (
    digits.length >= MIN_PHONE_DIGITS && (contact.phone ?? '').replace(/\D/g, '').includes(digits)
  );
}
