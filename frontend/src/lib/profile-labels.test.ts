import { describe, expect, it } from 'vitest';
import { cardStewardshipLine, profileSideLabel, stewardshipLine } from './profile-labels';

describe('profileSideLabel', () => {
  it('reads a real managingFor first', () => {
    expect(profileSideLabel('bride', 'male')).toBe('Bride');
    expect(profileSideLabel('Groom', 'female')).toBe('Groom');
  });

  it('falls back to the gender for an agency-built profile with no managingFor', () => {
    expect(profileSideLabel(null, 'Female')).toBe('Bride');
    expect(profileSideLabel(undefined, 'male')).toBe('Groom');
  });

  it('never turns an unknown managingFor into Groom', () => {
    expect(profileSideLabel('family', null)).toBe('Profile');
    expect(profileSideLabel('family', 'female')).toBe('Bride');
    expect(profileSideLabel(null, null)).toBe('Profile');
  });
});

describe('stewardshipLine', () => {
  it('says "Managed by" once for an agency label', () => {
    expect(stewardshipLine({ kind: 'agency', label: 'Managed by an agency', relation: null })).toBe(
      'Managed by an agency',
    );
  });

  it('prefers a family relation', () => {
    expect(stewardshipLine({ kind: 'family', label: 'Managed by a family member', relation: 'Parent' })).toBe(
      'Managed by their parent',
    );
  });

  it('adds the prefix only to a bare label', () => {
    expect(stewardshipLine({ kind: 'agency', label: 'ABC Marriages' })).toBe('Managed by ABC Marriages');
    expect(stewardshipLine(null)).toBeNull();
  });
});

describe('cardStewardshipLine', () => {
  it('leaves an agency to the "Added by" line when it is named there', () => {
    expect(
      cardStewardshipLine({
        stewardship: { kind: 'agency', label: 'Managed by ABC', relation: null },
        sourceAgency: 'ABC',
      }),
    ).toBeNull();
    expect(
      cardStewardshipLine({ stewardship: { kind: 'agency', label: 'Managed by an agency', relation: null } }),
    ).toBe('Managed by an agency');
  });

  it('falls back to managedByRelation for an older payload', () => {
    expect(cardStewardshipLine({ managedByRelation: 'Sibling' })).toBe('Managed by their sibling');
    expect(cardStewardshipLine({})).toBeNull();
  });
});
