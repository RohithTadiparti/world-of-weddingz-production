/**
 * The vendor sign-up and business-listing rules, checked before the round trip.
 *
 * The API holds the same limits (backend/src/modules/vendors/vendor-listing-rules.ts
 * and the vendor DTO) and is what actually enforces them; this exists so the
 * form can say which field is wrong, in the same words, before Save.
 *
 * Deliberately free of React and of every import: the mobile app reads this
 * file too (mobile/src/shared/vendor-listing-rules.ts), and a shared module has
 * to be dependency-free (see mobile/metro.config.js).
 */

export const BUSINESS_NAME_MAX = 50;
export const REGISTRATION_NUMBER_MAX = 30;
export const REGISTERED_ADDRESS_MAX = 100;
export const MAX_PORTFOLIO_IMAGES = 10;
export const MAX_COMPLIANCE_DOCUMENTS = 3;
export const MAX_COMPLIANCE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const COMPLIANCE_DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const;
/** For a file input's `accept`, extensions and types both (Windows wants the extensions). */
export const COMPLIANCE_DOCUMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export type ComplianceDocumentType =
  | 'gst_certificate'
  | 'pan_card'
  | 'aadhaar_card'
  | 'business_registration_certificate';

export const COMPLIANCE_DOCUMENT_TYPES: readonly { value: ComplianceDocumentType; label: string }[] = [
  { value: 'gst_certificate', label: 'GST Certificate' },
  { value: 'pan_card', label: 'PAN Card' },
  { value: 'aadhaar_card', label: 'Aadhaar Card' },
  { value: 'business_registration_certificate', label: 'Business Registration Certificate' },
];

/** The helper text under the compliance documents section. */
export const COMPLIANCE_DOCUMENT_HELP =
  'Accepted documents: GST Certificate, PAN Card, Aadhaar Card, or Business Registration Certificate. ' +
  `Up to ${MAX_COMPLIANCE_DOCUMENTS} files, PDF, JPG, JPEG or PNG, 10 MB each.`;

export function complianceDocumentTypeLabel(type: string | null | undefined): string | null {
  return COMPLIANCE_DOCUMENT_TYPES.find((t) => t.value === type)?.label ?? null;
}

/**
 * A city as it is saved: each word capitalised, the rest lower case. Words
 * split on spaces and hyphens, so "new delhi" is "New Delhi" and
 * "navi-mumbai" is "Navi-Mumbai". The API applies the same rule.
 */
export function titleCaseCity(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

const BUSINESS_NAME = /^(?=.*[\p{L}\p{N}])[\p{L}\p{N} .&'-]+$/u;

export function businessNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Business name is required.';
  if (trimmed.length < 2) return 'Business name must be at least 2 characters.';
  if (trimmed.length > BUSINESS_NAME_MAX) {
    return `Business name can be at most ${BUSINESS_NAME_MAX} characters.`;
  }
  if (!BUSINESS_NAME.test(trimmed)) return 'Please enter a valid business name.';
  return undefined;
}

/** The Registration section's own rules: trading since is required, two lengths are capped. */
export function registrationFieldErrors(form: {
  tradingSince: string;
  registrationNumber: string;
  registeredAddress: string;
}): Partial<Record<'tradingSince' | 'registrationNumber' | 'registeredAddress', string>> {
  const errors: Partial<Record<'tradingSince' | 'registrationNumber' | 'registeredAddress', string>> =
    {};
  if (!form.tradingSince.trim()) errors.tradingSince = 'Trading since is required';
  if (form.registrationNumber.trim().length > REGISTRATION_NUMBER_MAX) {
    errors.registrationNumber = `Registration number can be at most ${REGISTRATION_NUMBER_MAX} characters`;
  }
  if (form.registeredAddress.trim().length > REGISTERED_ADDRESS_MAX) {
    errors.registeredAddress = `Registered address can be at most ${REGISTERED_ADDRESS_MAX} characters`;
  }
  return errors;
}

/**
 * New uploads added to the portfolio, in order, without repeats and without
 * going past the limit. `dropped` is how many did not fit.
 */
export function addPortfolioImages(
  portfolio: readonly string[],
  added: readonly string[],
): { portfolio: string[]; dropped: number } {
  const next = [...portfolio];
  let dropped = 0;
  for (const url of added) {
    if (next.includes(url)) continue;
    if (next.length >= MAX_PORTFOLIO_IMAGES) {
      dropped += 1;
      continue;
    }
    next.push(url);
  }
  return { portfolio: next, dropped };
}

/** How many more images the portfolio can take. */
export function portfolioSlotsLeft(portfolio: readonly string[]): number {
  return Math.max(0, MAX_PORTFOLIO_IMAGES - portfolio.length);
}

/** The business profile picture: the chosen image while it is in the portfolio, else the first. */
export function profileImageOf(
  portfolio: readonly string[],
  chosen: string | null | undefined,
): string | null {
  if (chosen && portfolio.includes(chosen)) return chosen;
  return portfolio[0] ?? null;
}

/** The profile picture and the rest of the portfolio, for showing them apart. */
export function orderedPortfolio(
  portfolio: readonly string[],
  chosen: string | null | undefined,
): { profile: string | null; rest: string[] } {
  const profile = profileImageOf(portfolio, chosen);
  return { profile, rest: portfolio.filter((url) => url !== profile) };
}

/** Removes an image; if it was the profile picture, the first remaining image takes over. */
export function removePortfolioImage(
  portfolio: readonly string[],
  url: string,
  chosen: string | null | undefined,
): { portfolio: string[]; profileImage: string | null } {
  const next = portfolio.filter((u) => u !== url);
  return { portfolio: next, profileImage: profileImageOf(next, chosen === url ? null : chosen) };
}

/** Why a file cannot be a compliance document, or null when it can. */
export function complianceFileProblem(file: {
  name: string;
  size: number;
  type?: string;
}): string | null {
  const extension = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!(COMPLIANCE_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'Upload a PDF, JPG, JPEG or PNG file.';
  }
  if (file.size > MAX_COMPLIANCE_DOCUMENT_BYTES) {
    return 'That file is over 10 MB. Choose a smaller one.';
  }
  return null;
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const USERNAME_MESSAGE = 'Use 3-40 lowercase letters, numbers, dots, underscores or hyphens';

/**
 * Whether the sign-up form insists on a username. A vendor signs in with the
 * email address or mobile number they register with, so for them it is
 * optional; every other persona keeps the rule the form already had.
 */
export function usernameRequired(accountType: string): boolean {
  return accountType !== 'vendor';
}

/** The username's problem, or undefined. A blank one is fine where it is optional. */
export function validateUsername(username: string, accountType: string): string | undefined {
  const value = username.trim().toLowerCase();
  if (!value && !usernameRequired(accountType)) return undefined;
  return USERNAME_PATTERN.test(value) ? undefined : USERNAME_MESSAGE;
}
