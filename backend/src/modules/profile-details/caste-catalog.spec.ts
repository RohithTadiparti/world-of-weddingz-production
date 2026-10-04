import { casteCatalogResponse, isKnownSubCaste, OTHER_NOT_LISTED } from './caste-catalog';

describe('caste catalog', () => {
  it('returns distinct dependent options for Reddy and Velama', () => {
    const response = casteCatalogResponse();
    const reddy = response.find((entry) => entry.casteName === 'Reddy');
    const velama = response.find((entry) => entry.casteName === 'Velama');

    expect(reddy?.subCastes.map((entry) => entry.subCasteName)).toContain('Panta Reddy');
    expect(reddy?.subCastes.map((entry) => entry.subCasteName)).toContain(OTHER_NOT_LISTED);
    expect(velama?.subCastes.map((entry) => entry.subCasteName)).toContain('Koppula Velama');
    expect(velama?.subCastes.map((entry) => entry.subCasteName)).not.toContain('Panta Reddy');
  });

  it('rejects a known sub-caste paired with the wrong caste', () => {
    expect(isKnownSubCaste('Velama', 'Panta Reddy')).toBe(false);
    expect(isKnownSubCaste('Reddy', 'Panta Reddy')).toBe(true);
    expect(isKnownSubCaste('Velama', 'A regional name')).toBe(true);
  });
});