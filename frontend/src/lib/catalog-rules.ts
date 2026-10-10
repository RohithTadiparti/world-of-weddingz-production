/**
 * The vendor catalog's rules and read-backs, shared by the web and the mobile
 * app (mobile/src/shared/catalog-rules.ts re-exports this file).
 *
 * The server is the rule: backend/src/modules/catalog/offering-rules.ts for a
 * price, catalog-completeness.ts for "is the catalog finished", and
 * vendors/slot-rules.ts for a window's capacity. These are the same rules a
 * round trip earlier, with the same words, so a vendor reads one sentence
 * whichever side refused.
 *
 * Dependency-free on purpose (see mobile/metro.config.js): React Native reads
 * it too. The only import is the equally dependency-free social-links module.
 */
import { SocialLink, instagramProfileUrl } from './social-links';

// ---------------------------------------------------------------- pricing

export const PRICING_NAME_MAX = 140;
export const PRICING_DESCRIPTION_MIN = 50;
export const PRICING_DESCRIPTION_MAX = 500;

export const PRICING_LABEL: Record<string, string> = {
  fixed: 'Fixed price',
  per_person: 'Per person',
  per_hour: 'Per hour',
  per_day: 'Per day',
  per_session: 'Per session',
  per_item: 'Per item',
  starting_from: 'Starting from',
  custom_quote: 'Custom quote',
  no_public_price: 'Price on request',
};

/** The two models that publish no amount: the vendor quotes after the request. */
export const QUOTE_ONLY = ['custom_quote', 'no_public_price'];

/**
 * A pricing name as the server stores it: whitespace collapsed, and the first
 * letter of each space-separated word upper-cased. The rest of each word is
 * kept as typed, so "pre-wedding-shoot" becomes "Pre-wedding-shoot" and
 * "DJ night" becomes "DJ Night".
 */
export function titleCaseWords(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface OfferingErrors {
  name?: string;
  price?: string;
  description?: string;
}

/** What is wrong with a price before it is sent, field by field. Empty when nothing is. */
export function offeringErrors(input: {
  name?: string | null;
  description?: string | null;
  pricingModel: string;
  price?: string | number | null;
}): OfferingErrors {
  const errors: OfferingErrors = {};

  const name = titleCaseWords(input.name);
  if (!name) errors.name = 'Pricing name is required';
  else if (name.length > PRICING_NAME_MAX) {
    errors.name = `Pricing name must be at most ${PRICING_NAME_MAX} characters`;
  }

  if (!QUOTE_ONLY.includes(input.pricingModel)) {
    const raw = input.price;
    const amount = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.price = 'Pricing amount must be greater than 0';
    }
  }

  const description = String(input.description ?? '').trim();
  if (!description) errors.description = 'Description is required';
  else if (description.length < PRICING_DESCRIPTION_MIN) {
    errors.description = `Description must be at least ${PRICING_DESCRIPTION_MIN} characters (${description.length} now)`;
  } else if (description.length > PRICING_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${PRICING_DESCRIPTION_MAX} characters`;
  }

  return errors;
}

export interface PricedOffering {
  pricingModel: string;
  price: string | number | null;
  currency: string;
  unitLabel?: string | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  isPackage?: boolean;
  inclusions?: string[];
}

/** The amount as a buyer reads it: "INR 450 per plate", "From INR 9,000", "Custom quote". */
export function offeringAmount(o: PricedOffering): string {
  if (QUOTE_ONLY.includes(o.pricingModel)) return PRICING_LABEL[o.pricingModel];
  const amount = `${o.currency} ${Number(o.price).toLocaleString('en-IN')}`;
  if (o.pricingModel === 'starting_from') return `From ${amount}`;
  return o.unitLabel ? `${amount} ${o.unitLabel}` : amount;
}

/**
 * Everything about how a price works, on one line: the model, the amount, the
 * quantities it is sold in and what a package contains. What an officer or the
 * vendor reads as "Pricing details".
 */
export function offeringPriceDetails(o: PricedOffering): string {
  const model = PRICING_LABEL[o.pricingModel] ?? o.pricingModel.replace(/_/g, ' ');
  const parts = QUOTE_ONLY.includes(o.pricingModel) ? [model] : [model, offeringAmount(o)];
  if (o.minQuantity && o.maxQuantity) parts.push(`${o.minQuantity} to ${o.maxQuantity}`);
  else if (o.minQuantity) parts.push(`from ${o.minQuantity}`);
  else if (o.maxQuantity) parts.push(`up to ${o.maxQuantity}`);
  if (o.isPackage) {
    const inclusions = (o.inclusions ?? []).filter(Boolean);
    parts.push(inclusions.length ? `Package: ${inclusions.join(', ')}` : 'Package');
  }
  return parts.join(' · ');
}

// -------------------------------------------------------- catalog summary

export interface SummaryOffering extends PricedOffering {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
}

export interface SummaryService {
  id: string;
  displayName?: string | null;
  description?: string | null;
  active?: boolean;
  definition?: { name?: string } | null;
  category?: { name?: string } | null;
  offerings?: SummaryOffering[];
}

export interface SummaryRow {
  serviceId: string;
  categoryName: string;
  serviceName: string;
  serviceDescription: string | null;
  active: boolean;
  prices: {
    id: string;
    name: string;
    details: string;
    description: string | null;
    active: boolean;
  }[];
}

/**
 * The catalog as a reviewer reads it: for every service, its category and
 * name, and for every price its name, details and description. One shape for
 * the vendor's own Review & Submit and for the administrator's and officer's
 * verification view, so the three cannot drift into showing different things.
 */
export function catalogSummary(services: readonly SummaryService[] | null | undefined): SummaryRow[] {
  return (services ?? []).map((service) => ({
    serviceId: service.id,
    categoryName: service.category?.name || 'Uncategorised',
    serviceName: service.displayName || service.definition?.name || 'Service',
    serviceDescription: service.description || null,
    active: service.active !== false,
    prices: (service.offerings ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      details: offeringPriceDetails(o),
      description: o.description || null,
      active: o.active !== false,
    })),
  }));
}

export interface ChecklistLike {
  items?: { key: string; complete: boolean; missing: string | null; issues?: string[] }[];
}

/**
 * Whether the Catalog & Services step is finished, by the server's checklist,
 * and the precise reasons when it is not ("Bridal Wear: pricing is missing for
 * Lehenga"). Not ready until the checklist has loaded: a button enabled on a
 * guess is one the server then refuses.
 */
export function catalogStep(completion: ChecklistLike | null | undefined): {
  ready: boolean;
  issues: string[];
} {
  const item = completion?.items?.find((i) => i.key === 'catalog');
  if (!item) return { ready: false, issues: [] };
  if (item.complete) return { ready: true, issues: [] };
  const issues =
    item.issues && item.issues.length > 0
      ? item.issues
      : (item.missing ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
  return { ready: false, issues };
}

// ------------------------------------------------------------ availability

export const MIN_SLOT_CAPACITY = 1;
export const MAX_SLOT_CAPACITY = 20;

/** Why a capacity typed into the window form cannot be used, or null. */
export function slotCapacityError(value: string | number): string | null {
  const text = String(value).trim();
  const n = text === '' ? NaN : Number(text);
  if (!Number.isInteger(n)) return 'Capacity must be a whole number of bookings';
  if (n < MIN_SLOT_CAPACITY) return `A window must take at least ${MIN_SLOT_CAPACITY} booking`;
  if (n > MAX_SLOT_CAPACITY) return `A window can take at most ${MAX_SLOT_CAPACITY} bookings`;
  return null;
}

export interface ServiceOptionLike {
  id: string;
  displayName?: string | null;
  definition?: { name?: string } | null;
}

/** A service's name in a picker or beside a window. */
export function serviceOptionName(service: ServiceOptionLike): string {
  return service.displayName || service.definition?.name || 'Service';
}

/** Which service a published window is for, as the vendor reads it beside the times. */
export function slotServiceLabel(
  vendorServiceId: string | null | undefined,
  services: readonly ServiceOptionLike[],
): string {
  if (!vendorServiceId) return 'All services';
  const service = services.find((s) => s.id === vendorServiceId);
  return service ? serviceOptionName(service) : 'A removed service';
}

// ----------------------------------------------------- summary read-backs

/** The address a link is compared by: the Instagram profile it names, or the URL tidied. */
function socialKey(link: SocialLink): string {
  const url = (link.url ?? '').trim();
  if (link.platform === 'instagram') {
    const profile = instagramProfileUrl(url);
    if (profile) return `instagram ${profile.toLowerCase()}`;
  }
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(.*)$/i.exec(url);
  if (!match) return `${link.platform} ${url}`;
  const host = match[2].toLowerCase().replace(/^www\./, '');
  const path = match[3].replace(/\/+$/, '');
  return `${link.platform} ${host}${path}${match[4]}`;
}

/**
 * A listing's links with repeats removed by platform and address, first one
 * kept. The same Instagram profile saved twice ("instagram.com/x" and
 * "www.instagram.com/x/") is one link to a reader, so it is shown once.
 */
export function uniqueSocialLinks(links: readonly SocialLink[] | null | undefined): SocialLink[] {
  const seen = new Set<string>();
  const out: SocialLink[] = [];
  for (const link of links ?? []) {
    if (!link?.url) continue;
    const key = socialKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

/** Portfolio addresses with blanks and repeats removed, in order. */
export function uniquePortfolio(urls: readonly (string | null | undefined)[] | null | undefined): string[] {
  return [...new Set((urls ?? []).filter((u): u is string => typeof u === 'string' && u.trim() !== ''))];
}
