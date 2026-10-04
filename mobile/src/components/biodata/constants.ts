import {
  COMPLEXION_LABEL,
  FAMILY_STATUS_LABEL,
  FAMILY_TYPE_LABEL,
  MARITAL_LABEL,
  OCCUPATION_LABEL,
  SELF_MARITAL_STATUSES,
} from '@/shared/permissions';

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

export const MARITAL = SELF_MARITAL_STATUSES.map((value) => ({ value, label: MARITAL_LABEL[value] }));

export const NRI_OPTIONS = [
  { value: 'no_preference', label: "Doesn't matter" },
  { value: 'yes', label: 'Yes, prefer NRI' },
  { value: 'no', label: 'No, prefer non-NRI' },
];

export const NRI_LABEL: Record<string, string> = {
  no_preference: "Doesn't matter",
  yes: 'Yes, prefer NRI',
  no: 'No, prefer non-NRI',
};

export const FAMILY_TYPES = options(FAMILY_TYPE_LABEL);

export const OCCUPATION_STATUS = options(OCCUPATION_LABEL);

/** Income besides the main occupation; the same list as the web form. */
export const OTHER_INCOME_SOURCES = [
  { value: 'business', label: 'Business on the side' },
  { value: 'rental', label: 'Rental income' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'investments', label: 'Investments' },
  { value: 'freelance', label: 'Freelance / consulting' },
  { value: 'other', label: 'Other' },
];

/** The server takes up to five. */
export const OTHER_INCOME_LIMIT = 5;

export const stored = (value: unknown): string =>
  typeof value === 'number' || (typeof value === 'string' && value.trim()) ? String(value) : '';

/**
 * First and last name to start the form with: the biodata's own when it has
 * them, otherwise the account's display name split at the first space.
 */
export function namesFrom(
  displayName: unknown,
  details: Record<string, unknown>,
): { firstName: string; lastName: string } {
  const first = stored(details.firstName);
  const last = stored(details.lastName) || stored(details.surname);
  if (first || last) return { firstName: first, lastName: last };
  const [head = '', ...rest] = String(displayName ?? '').trim().split(/\s+/);
  return { firstName: head, lastName: rest.join(' ') };
}

/** The account's display name, from the two biodata fields. */
export const displayNameOf = (firstName: string, lastName: string): string =>
  [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');

export const COMPLEXIONS = options(COMPLEXION_LABEL);


export const FAMILY_STATUSES = options(FAMILY_STATUS_LABEL);

export const LIFE_STATUSES = [
  { value: 'alive', label: 'Alive' },
  { value: 'deceased', label: 'Late' },
];

export const KUJA_DOSHAM_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Unknown' },
];

export const HOROSCOPE_EXPECTATIONS = [
  { value: 'required', label: 'Required' },
  { value: 'preferred', label: 'Preferred' },
  { value: 'not_required', label: 'Not required' },
];

export const KUJA_PREFERENCES = [
  { value: 'must_match', label: 'Must match' },
  { value: 'no_objection', label: 'No objection' },
];
