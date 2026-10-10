import { PricingModel } from '../../common/enums';
import { QUOTE_ONLY } from './booking-request-rules';

/**
 * The rules a price (an offering) is written under, kept pure so they are
 * stated once and tested without a database. The web and mobile forms check
 * the same rules a round trip earlier (frontend/src/lib/catalog-rules.ts
 * mirrors this file), and the messages are worded identically so the vendor
 * reads the same sentence whichever side refused.
 */

export const PRICING_NAME_MAX = 140;
export const PRICING_DESCRIPTION_MIN = 50;
export const PRICING_DESCRIPTION_MAX = 500;

/**
 * A pricing name as it is stored: whitespace collapsed, and the first letter
 * of every space-separated word upper-cased.
 *
 * Only the first letter of a word changes. The rest is kept as typed, so a
 * hyphenated word is one word ("pre-wedding-shoot" becomes
 * "Pre-wedding-shoot", not "Pre-Wedding-Shoot") and an acronym survives
 * ("DJ night" becomes "DJ Night", not "Dj Night").
 */
export function titleCaseWords(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface OfferingText {
  name?: string | null;
  description?: string | null;
  pricingModel: PricingModel | string;
  price?: string | number | null;
}

export interface OfferingProblems {
  name?: string;
  price?: string;
  description?: string;
}

/** What is wrong with a price before it is saved, field by field. Empty when nothing is. */
export function offeringProblems(input: OfferingText): OfferingProblems {
  const problems: OfferingProblems = {};

  const name = titleCaseWords(input.name);
  if (!name) problems.name = 'Pricing name is required';
  else if (name.length > PRICING_NAME_MAX) {
    problems.name = `Pricing name must be at most ${PRICING_NAME_MAX} characters`;
  }

  if (!QUOTE_ONLY.includes(input.pricingModel as PricingModel)) {
    const raw = input.price;
    const amount = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      problems.price = 'Pricing amount must be greater than 0';
    }
  }

  const description = String(input.description ?? '').trim();
  if (!description) problems.description = 'Description is required';
  else if (description.length < PRICING_DESCRIPTION_MIN) {
    problems.description = `Description must be at least ${PRICING_DESCRIPTION_MIN} characters (${description.length} now)`;
  } else if (description.length > PRICING_DESCRIPTION_MAX) {
    problems.description = `Description must be at most ${PRICING_DESCRIPTION_MAX} characters`;
  }

  return problems;
}

/** The name and description exactly as they are stored. */
export function normaliseOfferingText(input: {
  name?: string | null;
  description?: string | null;
}): { name: string; description: string } {
  return {
    name: titleCaseWords(input.name),
    description: String(input.description ?? '').trim(),
  };
}
