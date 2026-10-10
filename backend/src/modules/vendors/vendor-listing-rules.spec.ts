import {
  alignComplianceDocumentTypes,
  dedupeSocialLinksByPlatform,
  duplicateSocialPlatforms,
  isComplianceDocumentFormat,
  resolveProfileImage,
  titleCaseCity,
} from './vendor-listing-rules';

describe('titleCaseCity', () => {
  it.each([
    ['hyderabad', 'Hyderabad'],
    ['HYDERABAD', 'Hyderabad'],
    ['  new   delhi ', 'New Delhi'],
    ['navi-mumbai', 'Navi-Mumbai'],
    ['navi - mumbai', 'Navi-Mumbai'],
    ['thiruvananthapuram', 'Thiruvananthapuram'],
    ['', ''],
  ])('%p becomes %p', (input, expected) => {
    expect(titleCaseCity(input)).toBe(expected);
  });

  it('leaves a non-string for the validators', () => {
    expect(titleCaseCity(42)).toBe(42);
    expect(titleCaseCity(null)).toBeNull();
  });
});

describe('isComplianceDocumentFormat', () => {
  it.each([
    'https://cdn.wow.test/users/u/attachments/gst.pdf',
    'https://cdn.wow.test/users/u/attachments/pan.JPG',
    'media://users/u/attachments/aadhaar.jpeg',
    'https://wow.test/api/mock-storage/users/u/attachments/reg.png?X-Amz-Signature=abc',
  ])('accepts %p', (url) => expect(isComplianceDocumentFormat(url)).toBe(true));

  it.each([
    'https://cdn.wow.test/users/u/attachments/photo.heic',
    'https://cdn.wow.test/users/u/attachments/scan.webp',
    'https://cdn.wow.test/users/u/attachments/noextension',
    42,
  ])('refuses %p', (url) => expect(isComplianceDocumentFormat(url)).toBe(false));
});

describe('social link platforms', () => {
  const ig = { platform: 'instagram' as const, url: 'https://instagram.com/a' };
  const ig2 = { platform: 'instagram' as const, url: 'https://instagram.com/b' };
  const web = { platform: 'website' as const, url: 'https://a.in' };
  const other1 = { platform: 'other' as const, url: 'https://behance.net/a', label: 'Behance' };
  const other2 = { platform: 'other' as const, url: 'https://dribbble.com/a', label: 'Dribbble' };

  it('names a platform used twice, but not repeated `other` links', () => {
    expect(duplicateSocialPlatforms([ig, web, ig2, other1, other2])).toEqual(['instagram']);
    expect(duplicateSocialPlatforms([ig, web, other1, other2])).toEqual([]);
    expect(duplicateSocialPlatforms(undefined)).toEqual([]);
  });

  it('keeps the first link of each platform when reading a legacy list', () => {
    expect(dedupeSocialLinksByPlatform([ig, web, ig2, other1, other2])).toEqual([
      ig,
      web,
      other1,
      other2,
    ]);
    expect(dedupeSocialLinksByPlatform(null)).toEqual([]);
  });
});

describe('resolveProfileImage', () => {
  it('keeps the chosen picture while it is in the portfolio', () => {
    expect(resolveProfileImage(['a', 'b'], 'b')).toBe('b');
  });

  it('falls back to the first image, or to none', () => {
    expect(resolveProfileImage(['a', 'b'], 'gone')).toBe('a');
    expect(resolveProfileImage(['a'], null)).toBe('a');
    expect(resolveProfileImage([], 'a')).toBeNull();
  });
});

describe('alignComplianceDocumentTypes', () => {
  it('uses the types the client sent, position for position', () => {
    expect(alignComplianceDocumentTypes(['a', 'b'], ['pan_card', null])).toEqual(['pan_card', null]);
  });

  it('carries stored types over for a client that sent none', () => {
    expect(
      alignComplianceDocumentTypes(['b', 'c'], undefined, {
        documents: ['a', 'b'],
        types: ['pan_card', 'gst_certificate'],
      }),
    ).toEqual(['gst_certificate', null]);
  });
});
