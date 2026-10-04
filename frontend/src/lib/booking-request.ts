/**
 * How a booking request is priced and what it must say.
 *
 * Mirrors backend/src/modules/catalog/booking-request-rules.ts, which is what
 * the request is checked and stored by. The total shown here is the estimate
 * the server writes on the booking, so the two must multiply the same way.
 */

import type { FieldSpec } from './dynamic-form';

/** Where a quantity is part of the price rather than decoration. */
export const QUANTITY_MODELS = ['per_person', 'per_item', 'per_hour', 'per_day', 'per_session'];

/** The two models that publish no amount — the vendor quotes after the request. */
export const QUOTE_ONLY = ['custom_quote', 'no_public_price'];

export interface PricedOffering {
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
}

/** The published price as it reads on the offering: one unit, not a total. */
export function offeringPrice(o: PricedOffering): string {
  if (QUOTE_ONLY.includes(o.pricingModel)) {
    return o.pricingModel === 'custom_quote' ? 'Quoted per job' : 'Price on request';
  }
  const amount = `${o.currency} ${Number(o.price).toLocaleString()}`;
  if (o.pricingModel === 'starting_from') return `From ${amount}`;
  return o.unitLabel ? `${amount} ${o.unitLabel}` : amount;
}

/**
 * The total for the chosen price and quantity, or null where there is none to
 * show: a quote-only price, or a per-unit price with no quantity yet.
 *
 * "Guest mehendi for the day" at 12,000 for 10 days is 120,000. The form used
 * to go on showing 12,000 whatever was typed into "How many".
 */
export function estimateTotal(
  offering: Pick<PricedOffering, 'pricingModel' | 'price'>,
  quantity: number | null | undefined,
): number | null {
  if (QUOTE_ONLY.includes(offering.pricingModel)) return null;
  const price = Number(offering.price);
  if (offering.price === null || !Number.isFinite(price)) return null;
  if (QUANTITY_MODELS.includes(offering.pricingModel)) {
    if (!quantity || quantity < 1) return null;
    return Math.round(price * quantity * 100) / 100;
  }
  return price;
}

/** The trades that cannot quote without a written brief. See the server twin. */
export const REQUIREMENTS_CATEGORIES = ['venue', 'catering', 'flower-decors', 'florist'];

/**
 * Whether "What do you need?" is required: only for venue, catering and
 * florist, and only where the service asks no questions of its own.
 */
export function requirementsRequired(
  categorySlugs: (string | null | undefined)[],
  hasFormFields: boolean,
): boolean {
  if (hasFormFields) return false;
  return categorySlugs.some((slug) => typeof slug === 'string' && REQUIREMENTS_CATEGORIES.includes(slug));
}

/** The catalog's "Date of the function" question. */
export const FUNCTION_DATE_KEY = 'event_date';

/**
 * The questions to put on the request form.
 *
 * "Date of the function" is left off: the buyer picks a date and time just
 * above it, and the server answers the question from that pick.
 */
export function requestFormFields(fields: FieldSpec[]): FieldSpec[] {
  return fields.filter((f) => f.key !== FUNCTION_DATE_KEY);
}

/**
 * The stored estimate on a booking, as it reads: the total, and "unit × qty"
 * where a quantity went into it. Null when the request carried no estimate.
 *
 * Read back from `estimatedAmount` and `quantity` rather than the offering,
 * so an old request says what was shown then, not today's price.
 */
export function estimateSummary(
  estimatedAmount: string | null | undefined,
  quantity: number | null | undefined,
  currency = 'INR',
): { total: string; breakdown: string | null } | null {
  const total = Number(estimatedAmount);
  if (!estimatedAmount || !Number.isFinite(total) || total <= 0) return null;
  const money = (n: number) => `${currency} ${n.toLocaleString('en-IN')}`;
  const breakdown =
    quantity && quantity > 1 ? `${money(Math.round((total / quantity) * 100) / 100)} × ${quantity}` : null;
  return { total: money(total), breakdown };
}
