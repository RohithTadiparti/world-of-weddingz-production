import { describe, expect, it } from 'vitest';
import {
  SocialLink,
  availableSocialPlatforms,
  duplicateSocialPlatforms,
  httpsHost,
  instagramProfileUrl,
  listingInstagramUrl,
  listingSocialLinks,
  normaliseSocialLinks,
  socialLinkError,
  socialLinkErrors,
  socialLinkName,
} from './social-links';

describe('socialLinkError', () => {
  it.each<[SocialLink['platform'], string]>([
    ['instagram', 'https://www.instagram.com/everafter'],
    ['youtube', 'https://youtu.be/abc'],
    ['facebook', 'https://web.facebook.com/everafter'],
    ['facebook', 'https://fb.com/everafter'],
    ['pinterest', 'https://in.pinterest.com/everafter'],
    ['pinterest', 'https://pin.it/abc'],
    ['x', 'https://twitter.com/everafter'],
    ['linkedin', 'https://linkedin.com/in/everafter'],
    ['website', 'https://everafter.in'],
    ['other', 'https://www.behance.net/everafter'],
  ])('accepts a %s link %s', (platform, url) => {
    expect(socialLinkError({ platform, url })).toBeNull();
  });

  it('names the platform when a link is on the wrong host', () => {
    expect(socialLinkError({ platform: 'instagram', url: 'https://instagram.evil.com/x' })).toBe(
      'Instagram links must be on instagram.com',
    );
    expect(socialLinkError({ platform: 'x', url: 'https://threads.net/x' })).toBe(
      'X links must be on x.com or twitter.com',
    );
  });

  it('refuses http, bare domains and blanks', () => {
    expect(socialLinkError({ platform: 'youtube', url: 'http://youtube.com/x' })).toBe(
      'Enter a full YouTube link starting with https://',
    );
    expect(socialLinkError({ platform: 'website', url: 'everafter.in' })).toBe(
      'Enter a full website link starting with https://',
    );
    expect(socialLinkError({ platform: 'website', url: '  ' })).toBe('Enter the website link');
    expect(socialLinkError({ platform: 'other', url: 'https://localhost/x' })).not.toBeNull();
  });

  it('caps the url and the label', () => {
    expect(
      socialLinkError({ platform: 'website', url: `https://everafter.in/${'a'.repeat(190)}` }),
    ).toBe('A link can be at most 200 characters');
    expect(
      socialLinkError({ platform: 'other', url: 'https://behance.net/a', label: 'a'.repeat(41) }),
    ).toBe('A link name can be at most 40 characters');
  });

  it('reports a list over ten links', () => {
    const links = Array.from({ length: 11 }, (_, i) => ({
      platform: 'website' as const,
      url: `https://site${i}.in`,
    }));
    expect(socialLinkErrors(links.slice(0, 10)).any).toBe(false);
    // An "Add a link" row left empty is dropped on save, not refused.
    expect(socialLinkErrors([...links.slice(0, 10), { platform: 'x', url: ' ' }]).any).toBe(false);
    expect(socialLinkErrors(links).list).toBe('Add at most 10 links');
  });
});

describe('normaliseSocialLinks', () => {
  it('trims, drops blank rows, keeps labels only on other and removes repeats', () => {
    expect(
      normaliseSocialLinks([
        { platform: 'instagram', url: ' https://Instagram.com/a ' },
        { platform: 'website', url: '' },
        { platform: 'x', url: 'https://x.com/a', label: 'ignored' },
        { platform: 'other', url: 'https://behance.net/a', label: ' Films ' },
        { platform: 'instagram', url: 'https://instagram.com/a' },
      ]),
    ).toEqual([
      { platform: 'instagram', url: 'https://Instagram.com/a' },
      { platform: 'x', url: 'https://x.com/a' },
      { platform: 'other', url: 'https://behance.net/a', label: 'Films' },
    ]);
  });
});

describe('listingSocialLinks', () => {
  it('shows the list, https only', () => {
    expect(
      listingSocialLinks({
        socialLinks: [
          { platform: 'facebook', url: 'https://facebook.com/a' },
          { platform: 'other', url: 'javascript:alert(1)' },
        ],
      }),
    ).toEqual([{ platform: 'facebook', url: 'https://facebook.com/a' }]);
  });

  it('falls back to the single fields from an older server', () => {
    expect(
      listingSocialLinks({ website: 'https://everafter.in', instagramUrl: null, youtubeUrl: 'https://youtu.be/a' }),
    ).toEqual([
      { platform: 'website', url: 'https://everafter.in' },
      { platform: 'youtube', url: 'https://youtu.be/a' },
    ]);
  });

  it('names a link by its label or its platform', () => {
    expect(socialLinkName({ platform: 'other', url: 'https://a.in', label: 'Films' })).toBe('Films');
    expect(socialLinkName({ platform: 'linkedin', url: 'https://linkedin.com/a' })).toBe('LinkedIn');
    expect(httpsHost('https://WWW.Everafter.in/x')).toBe('www.everafter.in');
  });
});

describe('instagramProfileUrl', () => {
  it.each([
    ['@everafter.events', 'https://www.instagram.com/everafter.events/'],
    ['instagram.com/everafter', 'https://www.instagram.com/everafter/'],
    ['www.instagram.com/everafter/', 'https://www.instagram.com/everafter/'],
    ['https://www.instagram.com/everafter', 'https://www.instagram.com/everafter/'],
    ['http://m.instagram.com/ever_after/', 'https://www.instagram.com/ever_after/'],
    ['https://Instagram.com/everafter?igsh=abc123', 'https://www.instagram.com/everafter/'],
    ['https://www.instagram.com/everafter/reels/', 'https://www.instagram.com/everafter/'],
    ['  https://instagram.com/everafter#top  ', 'https://www.instagram.com/everafter/'],
  ])('reads %s as the profile', (value, expected) => {
    expect(instagramProfileUrl(value)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['   '],
    ['@'],
    ['https://www.instagram.com/'],
    ['https://www.instagram.com/p/Cx1abc/'],
    ['https://www.instagram.com/reel/Cx1abc/'],
    ['https://instagram.com.evil.in/everafter'],
    ['https://evil.in/instagram.com/everafter'],
    ['https://www.facebook.com/everafter'],
    ['javascript:alert(1)'],
    ['@not a handle'],
    ['https://www.instagram.com/' + 'a'.repeat(31)],
  ])('refuses %s', (value) => {
    expect(instagramProfileUrl(value)).toBeNull();
  });
});

describe('listingInstagramUrl', () => {
  it('prefers the Instagram entry in the list', () => {
    expect(
      listingInstagramUrl({
        socialLinks: [
          { platform: 'website', url: 'https://everafter.in' },
          { platform: 'instagram', url: 'https://instagram.com/from_list' },
        ],
        instagramUrl: 'https://instagram.com/from_field',
      }),
    ).toBe('https://www.instagram.com/from_list/');
  });

  it('skips a list entry that is not a profile and falls back to the single field', () => {
    expect(
      listingInstagramUrl({
        socialLinks: [{ platform: 'instagram', url: 'https://www.instagram.com/p/abc/' }],
        instagramUrl: '@from_field',
      }),
    ).toBe('https://www.instagram.com/from_field/');
    expect(listingInstagramUrl({ instagramUrl: 'instagram.com/older' })).toBe(
      'https://www.instagram.com/older/',
    );
  });

  it('ignores Instagram addresses filed under another platform, and gives null for none', () => {
    expect(
      listingInstagramUrl({
        socialLinks: [{ platform: 'website', url: 'https://www.instagram.com/everafter' }],
      }),
    ).toBeNull();
    expect(listingInstagramUrl({ socialLinks: [], instagramUrl: null })).toBeNull();
    expect(listingInstagramUrl(null)).toBeNull();
  });
});

describe('one link of each type', () => {
  const links: SocialLink[] = [
    { platform: 'website', url: 'https://lotus.in' },
    { platform: 'instagram', url: '' },
    { platform: 'other', url: 'https://behance.net/lotus', label: 'Behance' },
  ];

  it('leaves a type out of "Add a link" once it is on the list', () => {
    const offered = availableSocialPlatforms(links).map((p) => p.value);
    expect(offered).not.toContain('website');
    expect(offered).not.toContain('instagram');
    expect(offered).toEqual(expect.arrayContaining(['facebook', 'youtube', 'whatsapp', 'other']));
  });

  it("keeps a row's own type selectable on that row", () => {
    const forInstagramRow = availableSocialPlatforms(links, 1).map((p) => p.value);
    expect(forInstagramRow).toContain('instagram');
    expect(forInstagramRow).not.toContain('website');
  });

  it('offers a type again once its link is removed', () => {
    const offered = availableSocialPlatforms(links.filter((l) => l.platform !== 'website'));
    expect(offered.map((p) => p.value)).toContain('website');
  });

  it('names a repeated type, never "other"', () => {
    expect(duplicateSocialPlatforms(links)).toEqual([]);
    expect(
      duplicateSocialPlatforms([...links, { platform: 'website', url: 'https://lotus2.in' }]),
    ).toEqual(['website']);
    const twice = [...links, { platform: 'website' as const, url: 'https://lotus2.in' }];
    expect(socialLinkErrors(twice, { uniquePlatforms: true }).list).toBe(
      'Add each type of link once: Website is listed more than once',
    );
    // The planner listing does not hold links to one per type.
    expect(socialLinkErrors(twice).list).toBeNull();
  });
});
