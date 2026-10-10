import type { SocialLink, SocialPlatform } from '../../common/dto/social-links.dto';

/**
 * The limits a vendor's business listing is held to, in one place so the DTO,
 * the service and the specs read the same numbers. The web and mobile forms
 * carry the same values (frontend/src/lib/vendor-listing-rules.ts) and check
 * them before the round trip; these are the ones that actually hold.
 */
export const BUSINESS_NAME_MAX = 50;
export const REGISTRATION_NUMBER_MAX = 30;
export const REGISTERED_ADDRESS_MAX = 100;
export const MAX_PORTFOLIO_IMAGES = 10;
export const MAX_COMPLIANCE_DOCUMENTS = 3;

/** The file types a compliance document may be. Matches the client's picker. */
export const COMPLIANCE_DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const;

/** What a compliance document is. The officer checks it against this. */
export const COMPLIANCE_DOCUMENT_TYPES = [
  'gst_certificate',
  'pan_card',
  'aadhaar_card',
  'business_registration_certificate',
] as const;

export type ComplianceDocumentType = (typeof COMPLIANCE_DOCUMENT_TYPES)[number];

/**
 * A city as it is stored and shown: each word capitalised, the rest lower
 * case, runs of whitespace collapsed. Words split on spaces and hyphens, so
 * "new delhi" is "New Delhi" and "navi-mumbai" is "Navi-Mumbai". Anything that
 * is not a string is left for the validators to refuse.
 */
export function titleCaseCity(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

/** The extension at the end of a media URL or `media://` reference, lower-cased. */
function extensionOf(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}

/** True when a document URL names a PDF, JPG, JPEG or PNG file. */
export function isComplianceDocumentFormat(url: unknown): boolean {
  return (
    typeof url === 'string' &&
    (COMPLIANCE_DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(url))
  );
}

/**
 * Platforms that may appear once only on a listing. `other` is the catch-all
 * with its own label ("Behance", "Wedding films"), so several are allowed.
 */
export function isSingleUsePlatform(platform: SocialPlatform | string | undefined): boolean {
  return Boolean(platform) && platform !== 'other';
}

/** The platforms named more than once, in first-seen order. */
export function duplicateSocialPlatforms(
  links: ReadonlyArray<{ platform?: string } | null | undefined> | null | undefined,
): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const link of links ?? []) {
    const platform = link?.platform;
    if (!platform || !isSingleUsePlatform(platform)) continue;
    if (seen.has(platform) && !repeated.includes(platform)) repeated.push(platform);
    seen.add(platform);
  }
  return repeated;
}

/**
 * The list with only the first link of each single-use platform kept.
 *
 * Listings saved before duplicates were refused can hold two Instagram links,
 * which the listing and the Review step then show twice. Applied when a
 * listing is read, so those rows read the way a new save would store them.
 */
export function dedupeSocialLinksByPlatform<T extends Pick<SocialLink, 'platform'>>(
  links: readonly T[] | null | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const link of links ?? []) {
    if (!link) continue;
    if (isSingleUsePlatform(link.platform)) {
      if (seen.has(link.platform)) continue;
      seen.add(link.platform);
    }
    out.push(link);
  }
  return out;
}

/**
 * The profile picture a listing ends up with: the chosen one while it is
 * still among the portfolio images, otherwise the first image, otherwise none.
 */
export function resolveProfileImage(
  portfolio: readonly string[] | null | undefined,
  chosen: string | null | undefined,
): string | null {
  const images = portfolio ?? [];
  if (chosen && images.includes(chosen)) return chosen;
  return images[0] ?? null;
}

/**
 * The document type beside each document, aligned by position.
 *
 * `sent` is what the client named, when it named any. A client that sent the
 * documents without their types (an older app build) keeps the type each
 * already-stored document had, and a new one gets none.
 */
export function alignComplianceDocumentTypes(
  documents: readonly string[],
  sent: ReadonlyArray<string | null> | undefined,
  stored?: { documents?: readonly string[] | null; types?: ReadonlyArray<string | null> | null },
): (string | null)[] {
  if (sent !== undefined) return documents.map((_, i) => sent[i] ?? null);
  const previous = new Map<string, string | null>();
  (stored?.documents ?? []).forEach((url, i) => previous.set(url, stored?.types?.[i] ?? null));
  return documents.map((url) => previous.get(url) ?? null);
}
