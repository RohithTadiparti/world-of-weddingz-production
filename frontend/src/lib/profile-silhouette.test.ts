import { describe, expect, it } from 'vitest';
import { SILHOUETTES, SILHOUETTE_TONES, silhouetteFor } from './profile-silhouette';

/**
 * Which stand-in figure a profile without a photo gets. Gender reaches the
 * clients as 'male' / 'female', sometimes capitalised, sometimes padded and
 * sometimes not at all.
 */
describe('silhouetteFor', () => {
  it('draws a groom for a man', () => {
    for (const g of ['male', 'Male', 'MALE', ' male ', 'm', 'M', 'man', 'groom']) {
      expect(silhouetteFor(g)).toBe('groom');
    }
  });

  it('draws a bride for a woman', () => {
    for (const g of ['female', 'Female', 'FEMALE', ' female', 'f', 'F', 'woman', 'bride']) {
      expect(silhouetteFor(g)).toBe('bride');
    }
  });

  it('falls back to the neutral figure when gender is missing or unrecognised', () => {
    for (const g of [undefined, null, '', '   ', 'other', 'prefer_not_to_say', 'females']) {
      expect(silhouetteFor(g)).toBe('neutral');
    }
  });
});

describe('SILHOUETTES', () => {
  it('draws every variant only in tones the apps know how to colour', () => {
    for (const shapes of Object.values(SILHOUETTES)) {
      expect(shapes.length).toBeGreaterThan(0);
      for (const s of shapes) {
        expect(SILHOUETTE_TONES[s.tone]).toBeDefined();
        expect(s.d).not.toMatch(/NaN|undefined/);
      }
    }
  });
});
