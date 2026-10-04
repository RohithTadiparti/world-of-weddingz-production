/**
 * The categories a business lists under (EZ1-I263).
 *
 * Pure, so the rules are stated once and tested without a database. Whether
 * each slug is a real, active catalogue category is the service's check, since
 * that needs the catalogue.
 */

export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = 5;

/** What a catalogue category slug looks like: lower-case words joined by hyphens. */
export const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The categories a request asks for, as one clean list.
 *
 * `categories` is the field. `category` is what app builds from before
 * EZ1-I263 still send, and is read as a list of one so those builds keep
 * working. Order is kept, because the first category is the one a listing is
 * shown under first; repeats and blanks are dropped. Undefined means the
 * request did not mention categories at all, which on an update means "leave
 * them alone".
 */
export function requestedCategories(input: {
  categories?: string[] | null;
  category?: string | null;
}): string[] | undefined {
  const raw = input.categories ?? (input.category ? [input.category] : undefined);
  if (raw === undefined || raw === null) return undefined;
  const seen = new Set<string>();
  for (const value of raw) {
    const slug = String(value).trim().toLowerCase();
    if (slug) seen.add(slug);
  }
  return [...seen];
}

/** Why a list of categories cannot be saved, or null when it can. */
export function categoryCountProblem(list: string[]): string | null {
  if (list.length < MIN_CATEGORIES) return 'Choose at least one category';
  if (list.length > MAX_CATEGORIES) return `Choose at most ${MAX_CATEGORIES} categories`;
  return null;
}
