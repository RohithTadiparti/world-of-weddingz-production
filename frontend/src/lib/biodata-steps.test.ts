import { describe, expect, it } from 'vitest';
import {
  StepCompletion,
  blockedMessage,
  blockingStep,
  stepDone,
  stepMissing,
  stepsFor,
} from './biodata-steps';

const field = (key: string, label: string) => ({ key, label });

/** A completion report with the given fields still missing, per section. */
function report(missing: Record<string, { key: string; label: string }[]> = {}): StepCompletion {
  const sections = [
    'personal', 'religion', 'horoscope', 'marital', 'family', 'education', 'occupation', 'preferences', 'identity',
  ];
  return {
    sections: sections.map((section) => ({
      section,
      label: section,
      complete: !(missing[section]?.length),
      missingFields: missing[section] ?? [],
    })),
  };
}

const steps = stepsFor('never_married');

/**
 * The biodata wizard used to let a later step be opened with the earlier ones
 * empty: Skip and the section chips jumped straight ahead (QA test 13).
 */
describe('biodata wizard steps', () => {
  it('keeps somebody on the photographs until three are uploaded', () => {
    const completion = report({
      personal: [field('photos', '3 profile photographs'), field('firstName', 'First name')],
    });
    expect(stepMissing('photos', completion)).toEqual(['3 profile photographs']);
    expect(blockingStep('basic', steps, completion)).toBe('photos');
    expect(blockingStep('education', steps, completion)).toBe('photos');
    expect(blockingStep('photos', steps, completion)).toBeNull();
  });

  it('refuses a step after an incomplete basic step and names what is missing', () => {
    const completion = report({
      personal: [field('firstName', 'First name'), field('heightCm', 'Height')],
      religion: [field('caste', 'Caste')],
      education: [field('course', 'Course')],
    });
    expect(blockingStep('basic', steps, completion)).toBeNull();
    expect(blockingStep('education', steps, completion)).toBe('basic');
    expect(blockingStep('preferences', steps, completion)).toBe('basic');
    expect(stepMissing('basic', completion)).toEqual(['First name', 'Height', 'Caste']);
    expect(blockedMessage('basic', completion)).toBe(
      'Complete Basic Information before moving on. Still needed: First name, Height, Caste.',
    );
  });

  it('opens each step once every step before it is saved', () => {
    const completion = report({ education: [field('course', 'Course')], identity: [field('governmentId', 'ID')] });
    expect(stepDone('basic', completion)).toBe(true);
    expect(blockingStep('education', steps, completion)).toBeNull();
    expect(blockingStep('family', steps, completion)).toBe('education');
    // Identity is verified on its own track and never holds a step back.
    expect(blockingStep('preferences', steps, report({ identity: [field('governmentId', 'ID')] }))).toBeNull();
  });

  it('always allows going back', () => {
    const completion = report({ personal: [field('photos', '3 profile photographs')] });
    expect(blockingStep('photos', steps, completion)).toBeNull();
  });

  it('holds everything past the first step until the saved biodata has loaded', () => {
    expect(blockingStep('basic', steps, undefined)).toBe('photos');
    expect(blockedMessage('photos', undefined)).toMatch(/still loading/);
  });

  it('falls back to whole sections from a server without field detail', () => {
    const completion: StepCompletion = {
      sections: [
        { section: 'personal', label: 'Personal details', complete: false },
        { section: 'religion', label: 'Religion and community', complete: true },
        { section: 'marital', label: 'Marital status', complete: true },
      ],
    };
    expect(stepDone('photos', completion)).toBe(true);
    expect(stepMissing('basic', completion)).toEqual(['Personal details']);
  });

  it('includes the marital history step only for somebody who has been married', () => {
    expect(stepsFor('never_married')).not.toContain('marital');
    expect(stepsFor('divorced')).toContain('marital');
  });
});
