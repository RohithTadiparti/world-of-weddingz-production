/**
 * The biodata wizard's steps, and which of them somebody may move on to.
 *
 * Every step after the first used to be reachable at any time: "Skip" on each
 * card and the section chips above it both jumped straight ahead, so a profile
 * could be half-filled from the middle with the photographs and the basic
 * details never entered. A later step is now open only once every step before
 * it has its required fields saved, and the step that holds things up says
 * which fields those are.
 *
 * What counts as filled in is the server's completion report, field by field,
 * so the wizard cannot drift from what the profile is judged complete on.
 */

/**
 * The order the form is filled in, matching the mobile app's steps.
 *
 * Saving a section moves to the next one rather than leaving somebody scrolling
 * back up to find where they were — which is the reported complaint, and the
 * reason people stopped halfway. Photographs come first here (last on mobile)
 * because the server will not save the personal details without three of them.
 */
export const ALL_STEPS = [
  'photos',
  'basic',
  'marital',
  'education',
  'family',
  'horoscope',
  'preferences',
] as const;

export type StepName = (typeof ALL_STEPS)[number];

/** What each step is called, in the header and the "next" line after a save. */
export const STEP_TITLE: Record<StepName, string> = {
  photos: 'Photographs',
  basic: 'Basic Information',
  marital: 'Marital History',
  education: 'Education & Career',
  family: 'Family Background',
  horoscope: 'Horoscope',
  preferences: 'Partner Preferences',
};

/** Marital history is a step only for somebody who has been married. */
export function stepsFor(maritalStatus: unknown): StepName[] {
  const married = Boolean(maritalStatus) && maritalStatus !== 'never_married';
  return ALL_STEPS.filter((s) => s !== 'marital' || married);
}

export interface MissingField {
  key: string;
  label: string;
}

/** The parts of the server's completion report the wizard reads. */
export interface StepCompletion {
  sections: {
    section: string;
    complete: boolean;
    label: string;
    /** Absent from an older server, which only says whether a section is done. */
    missingFields?: MissingField[];
  }[];
}

/**
 * The server sections each step fills in. Basic information is three of them;
 * the photographs are counted under the personal section, but are their own
 * step here, so they are split out of it below.
 */
export const STEP_SECTIONS: Record<StepName, string[]> = {
  photos: ['personal'],
  basic: ['personal', 'religion', 'marital'],
  marital: ['marital'],
  education: ['education', 'occupation'],
  family: ['family'],
  horoscope: ['horoscope'],
  preferences: ['preferences'],
};

const PHOTOS = 'photos';

/**
 * The required fields of a step that are not saved yet, by label.
 *
 * Without a completion report (still loading) nothing can be said to be done,
 * so the step is reported as waiting on its own title rather than as complete.
 */
export function stepMissing(step: StepName, completion: StepCompletion | undefined): string[] {
  if (!completion) return [STEP_TITLE[step]];
  const labels: string[] = [];
  for (const name of STEP_SECTIONS[step]) {
    const section = completion.sections.find((s) => s.section === name);
    if (!section) continue;
    if (!section.missingFields) {
      // An older server: only the section, and the photographs cannot be told
      // apart from the rest of the personal details.
      if (!section.complete && step !== 'photos') labels.push(section.label);
      continue;
    }
    const fields = section.missingFields.filter((f) =>
      step === 'photos' ? f.key === PHOTOS : f.key !== PHOTOS,
    );
    labels.push(...fields.map((f) => f.label));
  }
  return [...new Set(labels)];
}

/** Whether every required field of a step is saved. */
export function stepDone(step: StepName, completion: StepCompletion | undefined): boolean {
  return stepMissing(step, completion).length === 0;
}

/**
 * The earliest step before `target` that is not done, or null when `target`
 * may be opened. Going back is always allowed.
 */
export function blockingStep(
  target: StepName,
  steps: StepName[],
  completion: StepCompletion | undefined,
): StepName | null {
  const index = steps.indexOf(target);
  for (const step of steps.slice(0, Math.max(0, index))) {
    if (!stepDone(step, completion)) return step;
  }
  return null;
}

/** The message shown on a step that is holding the next one back. */
export function blockedMessage(step: StepName, completion: StepCompletion | undefined): string {
  const missing = stepMissing(step, completion);
  if (!completion) return 'Your saved biodata is still loading.';
  return `Complete ${STEP_TITLE[step]} before moving on. Still needed: ${missing.join(', ')}.`;
}
