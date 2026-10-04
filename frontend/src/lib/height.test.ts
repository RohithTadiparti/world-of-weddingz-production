import { describe, expect, it } from 'vitest';
import { cmToFeetInches, feetInchesToCm, formatHeight, heightPartsError, heightPartsFromCm, migrateHeightDraft } from './height';

describe('centimetre height conversion', () => {
  it.each([
    [5, 6, 168],
    [5, 7, 170],
    [5, 10, 178],
    [5, 11, 180],
  ])('converts %s ft %s in to %s cm and back', (feet, inches, cm) => {
    expect(feetInchesToCm(feet, inches)).toBe(cm);
    expect(cmToFeetInches(cm)).toEqual({ feet, inches });
    expect(formatHeight(cm)).toBe(`${feet} ft ${inches} in`);
  });
  it.each([12, 13, -1, '12', '5.5'])('rejects invalid inches %s', (inches) => {
    expect(feetInchesToCm(5, inches)).toBeNull();
  });

  it('keeps raw feet and inches independently while validating incomplete and invalid edits', () => {
    expect(heightPartsFromCm(168)).toEqual({ feet: '5', inches: '6' });
    expect(heightPartsError({ feet: '', inches: '6' }, true)).toBe('Feet must be a whole number.');
    expect(heightPartsError({ feet: '5', inches: '12' }, true)).toBe('Inches must be between 0 and 11.');
    expect(heightPartsError({ feet: '5', inches: '7' }, true)).toBeNull();
  });
  it('keeps centimetre drafts and converts legacy feet/inches drafts once', () => {
    const old = { heightCm: 170, preferredHeightMinCm: 150, preferredHeightMaxCm: 190, heightFeet: 5.6, firstName: 'Ada' };
    const migrated = migrateHeightDraft(old);
    expect(migrated).toEqual({ heightCm: 170, preferredHeightMinCm: 150, preferredHeightMaxCm: 190, firstName: 'Ada' });
    expect(migrateHeightDraft(migrated)).toEqual(migrated);
    expect(migrateHeightDraft({ heightFeet: 5.6, preferredHeightMinFeet: 5.7 })).toEqual({ heightCm: 171, preferredHeightMinCm: 174 });
    expect(old.heightFeet).toBe(5.6);
    expect(formatHeight(null)).toBe('');
  });
  it.each([
    ['5.1', 155],
    ['5.5', 168],
    ['5.75', 175],
    ['6.25', 191],
  ])('migrates decimal feet %s to %s whole centimeters', (feet, cm) => {
    expect(migrateHeightDraft({ heightFeet: feet })).toEqual({ heightCm: cm });
  });
});
