import { PricingModel } from '../../common/enums';

/**
 * The two rules a booking request is priced and checked by, kept in one place
 * so the web form (frontend/src/lib/booking-request.ts mirrors them) and the
 * server that stores the request cannot disagree.
 */

/** The two models that carry no published amount — the vendor quotes instead. */
export const QUOTE_ONLY: PricingModel[] = [PricingModel.CUSTOM_QUOTE, PricingModel.NO_PUBLIC_PRICE];

/** The models where a quantity is part of the price rather than decoration. */
export const QUANTITY_MODELS: PricingModel[] = [
  PricingModel.PER_PERSON,
  PricingModel.PER_ITEM,
  PricingModel.PER_HOUR,
  PricingModel.PER_DAY,
  PricingModel.PER_SESSION,
];

/**
 * What the buyer was shown as the total when they asked: the published price,
 * times how many where the price counts something.
 *
 * "Guest mehendi for the day" at 12,000 a day for ten days is 120,000, and the
 * form used to go on saying 12,000 whatever was typed into "How many". Null
 * where there is nothing to multiply — a quote-only price, or a per-unit price
 * with no quantity given. A `starting_from` price is the floor, not a total,
 * and is returned as that floor.
 */
export function estimateAmount(
  offering: { pricingModel: string; price: string | number | null },
  quantity?: number | null,
): number | null {
  if (QUOTE_ONLY.includes(offering.pricingModel as PricingModel)) return null;
  const price = Number(offering.price);
  if (offering.price === null || !Number.isFinite(price)) return null;
  if (QUANTITY_MODELS.includes(offering.pricingModel as PricingModel)) {
    if (!quantity || quantity < 1) return null;
    return Math.round(price * quantity * 100) / 100;
  }
  return price;
}

/**
 * The trades whose request cannot be priced without a written brief.
 *
 * A hall is quoted on the guest count and the menu on the head count and the
 * cuisine; a florist on what is wanted. A mehendi artist or a photographer
 * quotes from the price the buyer already picked. `flower-decors` is the live
 * florist category; `florist` is its slug in the blueprint catalog.
 */
export const REQUIREMENTS_CATEGORIES = ['venue', 'catering', 'flower-decors', 'florist'];

/**
 * Whether "What do you need?" must be filled in.
 *
 * Only for the trades above, and only where the service has no booking form of
 * its own: a service that asks its own questions has already had the brief,
 * and the free text below it is "anything else".
 */
export function requirementsRequired(
  categorySlugs: (string | null | undefined)[],
  hasFormFields: boolean,
): boolean {
  if (hasFormFields) return false;
  return categorySlugs.some((slug) => typeof slug === 'string' && REQUIREMENTS_CATEGORIES.includes(slug));
}
