import { Profile } from '../users/entities/profile.entity';
import { matchGender } from '../matchmaking/match-gender';
import { ProfileDetails } from './entities/profile-details.entity';
import { ProfileSibling } from './entities/profile-sibling.entity';

/**
 * The biodata completion rules, as plain functions over stored rows.
 *
 * They live outside ProfileDetailsService so that matchmaking can ask the same
 * question — is this biodata ready to be put in front of another family? —
 * about a whole candidate pool from rows it has already loaded, without a
 * service round trip per profile and without a second copy of the rules that
 * could drift from the one the biodata wizard shows.
 */

/** The sections a profile has to complete before it is considered ready. */
export const REQUIRED_SECTIONS = [
  'personal',
  'religion',
  'horoscope',
  'marital',
  'family',
  'education',
  'occupation',
  'preferences',
  'identity',
] as const;

export type ProfileSection = (typeof REQUIRED_SECTIONS)[number];

export interface CompletionReport {
  profileId: string;
  complete: boolean;
  /** Fraction complete, for the progress bar. */
  percent: number;
  sections: {
    section: ProfileSection;
    complete: boolean;
    label: string;
    /** The required fields still empty, so a client can name them. */
    missingFields: MissingField[];
  }[];
  missing: ProfileSection[];
}

/** A required biodata field that has not been filled in yet. */
export interface MissingField {
  key: string;
  label: string;
}

export const SECTION_LABEL: Record<ProfileSection, string> = {
  personal: 'Personal details',
  religion: 'Religion and community',
  horoscope: 'Horoscope',
  marital: 'Marital status',
  family: 'Family',
  education: 'Education',
  occupation: 'Occupation',
  preferences: 'Partner preferences',
  identity: 'Identity verification',
};

/** How many photographs a profile needs before the rest can be filled in. */
export const REQUIRED_PHOTOS = 3;

/**
 * Computed from the stored data every time it is asked for.
 *
 * A stored "complete" flag drifts the moment anything is edited or a rule
 * changes, and a profile that claims to be complete when it is not is worse
 * than one that admits it is not.
 */
export function completionReport(
  profileId: string,
  profile: Profile,
  details: ProfileDetails | null,
  siblings: ProfileSibling[],
): CompletionReport {
  const has = (value: unknown) =>
    value !== null && value !== undefined && value !== '' &&
    !(typeof value === 'object' && Object.keys(value as object).length === 0);

  // A profile with no biodata row yet is missing every field the row holds.
  const d: Partial<ProfileDetails> = details ?? {};
  /** The required fields of a section that are still empty, in form order. */
  const lacking = (checks: [filled: boolean, field: MissingField][]): MissingField[] =>
    checks.filter(([filled]) => !filled).map(([, field]) => field);

  /*
   * Field by field rather than one yes/no per section, so the biodata wizard
   * can say exactly what is holding a step back instead of only refusing to
   * move on. A section is complete exactly when nothing is listed for it.
   */
  const missingFields: Record<ProfileSection, MissingField[]> = {
    // Native place moved to the family section and place of birth is no
    // longer collected, so neither can be a condition of this one being
    // complete — every existing profile would otherwise become incomplete on
    // deploy, and the fix would look like data loss.
    personal: lacking([
      [
        (profile.photos?.length ?? 0) >= REQUIRED_PHOTOS,
        { key: 'photos', label: `${REQUIRED_PHOTOS} profile photographs` },
      ],
      [has(d.firstName), { key: 'firstName', label: 'First name' }],
      [has(d.lastName), { key: 'lastName', label: 'Last name' }],
      [has(profile.gender), { key: 'gender', label: 'Gender' }],
      [has(profile.dateOfBirth), { key: 'dateOfBirth', label: 'Date of birth' }],
      [has(d.heightCm), { key: 'heightCm', label: 'Height' }],
      [has(d.complexion), { key: 'complexion', label: 'Complexion' }],
      [has(d.communicationAddress), { key: 'communicationAddress', label: 'Communication address' }],
    ]),
    religion: lacking([
      [has(d.religion), { key: 'religion', label: 'Religion' }],
      [has(d.caste), { key: 'caste', label: 'Caste' }],
      [has(d.motherTongue), { key: 'motherTongue', label: 'Mother tongue' }],
    ]),
    // Answering "no horoscope" completes the section: the question has been
    // answered, which is all the profile needs.
    horoscope: lacking([
      [
        d.horoscopeAvailable === false || has(d.horoscope),
        { key: 'horoscope', label: 'Horoscope details, or that there is no horoscope' },
      ],
    ]),
    marital: lacking([[has(d.maritalStatus), { key: 'maritalStatus', label: 'Marital status' }]]),
    // The native place is asked here now.
    family: lacking([
      [has(d.father), { key: 'father', label: "Father's name" }],
      [has(d.mother), { key: 'mother', label: "Mother's name" }],
      [has(d.familyType), { key: 'familyType', label: 'Family type' }],
      [
        matchGender(profile) !== 'male' || has(d.familyNetWorth),
        { key: 'familyNetWorth', label: 'Family net worth' },
      ],
      // Counts and records have to agree, or the family section is telling
      // two different stories.
      [d.brothers !== null && siblings.length >= 0, { key: 'brothers', label: 'Brothers' }],
      [d.sisters !== null, { key: 'sisters', label: 'Sisters' }],
    ]),
    education: lacking([
      [has(d.highestQualification), { key: 'highestQualification', label: 'Highest qualification' }],
      [has(d.course), { key: 'course', label: 'Course' }],
    ]),
    occupation: lacking([
      [has(d.occupationStatus), { key: 'occupationStatus', label: 'Occupation status' }],
    ]),
    preferences: lacking([
      [has(d.preferredAgeMin), { key: 'preferredAgeMin', label: 'Preferred age' }],
      [has(d.preferredHeightMinCm), { key: 'preferredHeightMinCm', label: 'Preferred height' }],
    ]),
    identity: lacking([
      [Boolean(profile.governmentIdHash), { key: 'governmentId', label: 'Government ID' }],
    ]),
  };

  const sections = REQUIRED_SECTIONS.map((section) => ({
    section,
    complete: missingFields[section].length === 0,
    label: SECTION_LABEL[section],
    missingFields: missingFields[section],
  }));
  const missing = sections.filter((s) => !s.complete).map((s) => s.section);

  return {
    profileId,
    complete: missing.length === 0,
    percent: Math.round(((sections.length - missing.length) / sections.length) * 100),
    sections,
    missing,
  };
}

/**
 * Is the biodata complete enough to send to another family?
 *
 * Identity is excluded: whether a profile has been verified is its own
 * question, asked by its own gate where one applies, and it should not read as
 * a hole in the biodata.
 */
export function isBiodataReady(report: CompletionReport): boolean {
  return report.missing.every((section) => section === 'identity');
}

/** The labels of the biodata sections still missing, identity aside. */
export function missingBiodataLabels(report: CompletionReport): string[] {
  return report.sections
    .filter((s) => !s.complete && s.section !== 'identity')
    .map((s) => s.label);
}
