import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  SocialLink,
  SocialLinksDto,
  normaliseSocialLinks,
  resolveSocialLinks,
} from './social-links.dto';
import { CreateVendorDto } from '../../modules/vendors/dto/vendor.dto';

async function linkErrors(links: unknown) {
  const dto = plainToInstance(SocialLinksDto, { socialLinks: links });
  const errors = await validate(dto);
  const messages: string[] = [];
  const walk = (list: typeof errors) =>
    list.forEach((e) => {
      messages.push(...Object.values(e.constraints ?? {}));
      walk(e.children ?? []);
    });
  walk(errors);
  return { dto, messages };
}

describe('SocialLinksDto socialLinks', () => {
  it.each([
    ['instagram', 'https://www.instagram.com/everafter'],
    ['instagram', 'https://m.instagram.com/everafter'],
    ['youtube', 'https://youtu.be/abc123'],
    ['youtube', 'https://www.youtube.com/@everafter'],
    ['facebook', 'https://web.facebook.com/everafter'],
    ['facebook', 'https://fb.com/everafter'],
    ['pinterest', 'https://in.pinterest.com/everafter'],
    ['pinterest', 'https://pin.it/abc'],
    ['x', 'https://x.com/everafter'],
    ['x', 'https://twitter.com/everafter'],
    ['linkedin', 'https://www.linkedin.com/company/everafter'],
    ['website', 'https://everafter.in'],
    ['other', 'https://www.behance.net/everafter'],
    // Phones capitalise what is typed; a host is case-insensitive, and the
    // form (which lowercases before checking) must not pass what this refuses.
    ['instagram', 'https://WWW.Instagram.com/everafter'],
    ['youtube', 'https://YouTu.be/abc123'],
  ])('accepts a %s link %p', async (platform, url) => {
    expect((await linkErrors([{ platform, url }])).messages).toEqual([]);
  });

  it.each([
    ['instagram', 'https://instagram.evil.com/everafter', 'Instagram links must be on instagram.com'],
    ['youtube', 'https://vimeo.com/123', 'YouTube links must be on youtube.com or youtu.be'],
    ['facebook', 'https://facebook.co/everafter', 'Facebook links must be on facebook.com'],
    ['pinterest', 'https://pinterest.co.uk/everafter', 'Pinterest links must be on pinterest.com or pin.it'],
    ['x', 'https://threads.net/everafter', 'X links must be on x.com or twitter.com'],
    ['linkedin', 'https://linkedin.co/everafter', 'LinkedIn links must be on linkedin.com'],
  ])('refuses a %s link on another host', async (platform, url, message) => {
    const { messages } = await linkErrors([{ platform, url }]);
    expect(messages.join(' ')).toContain(message);
  });

  it('refuses http and bare addresses, naming the platform', async () => {
    expect(
      (await linkErrors([{ platform: 'instagram', url: 'http://instagram.com/x' }])).messages,
    ).toEqual(['Enter a full Instagram link starting with https://']);
    expect((await linkErrors([{ platform: 'website', url: 'everafter.in' }])).messages).toEqual([
      'Enter a full website link starting with https://',
    ]);
    expect(
      (await linkErrors([{ platform: 'other', url: 'https://localhost/x' }])).messages,
    ).toHaveLength(1);
  });

  it('refuses an unknown platform', async () => {
    const { messages } = await linkErrors([{ platform: 'myspace', url: 'https://myspace.com/x' }]);
    expect(messages).toEqual(['Choose which platform this link is for']);
  });

  it('trims the url and refuses one over 200 characters', async () => {
    const { dto } = await linkErrors([{ platform: 'x', url: '  https://x.com/a  ' }]);
    expect(dto.socialLinks?.[0].url).toBe('https://x.com/a');
    const long = `https://everafter.in/${'a'.repeat(190)}`;
    expect((await linkErrors([{ platform: 'website', url: long }])).messages).toContain(
      'A link can be at most 200 characters',
    );
  });

  it('allows at most ten links', async () => {
    const link = (i: number) => ({ platform: 'website', url: `https://site${i}.in` });
    expect((await linkErrors(Array.from({ length: 10 }, (_, i) => link(i)))).messages).toEqual([]);
    expect((await linkErrors(Array.from({ length: 11 }, (_, i) => link(i)))).messages).toEqual([
      'Add at most 10 links',
    ]);
  });

  it('caps a label at 40 characters', async () => {
    const url = 'https://www.behance.net/everafter';
    expect(
      (await linkErrors([{ platform: 'other', url, label: 'a'.repeat(40) }])).messages,
    ).toEqual([]);
    expect(
      (await linkErrors([{ platform: 'other', url, label: 'a'.repeat(41) }])).messages,
    ).toEqual(['A link name can be at most 40 characters']);
  });

  it('is validated on a vendor listing too', async () => {
    const dto = plainToInstance(CreateVendorDto, {
      name: 'Everafter',
      socialLinks: [{ platform: 'facebook', url: 'ftp://facebook.com/x' }],
    });
    const errors = await validate(dto, { skipMissingProperties: true });
    expect(errors.map((e) => e.property)).toContain('socialLinks');
  });
});

describe('normaliseSocialLinks', () => {
  it('keeps the first of two identical links, ignoring host case', () => {
    expect(
      normaliseSocialLinks([
        { platform: 'instagram', url: 'https://www.Instagram.com/everafter' },
        { platform: 'website', url: 'https://everafter.in' },
        { platform: 'instagram', url: 'https://www.instagram.com/everafter' },
      ]),
    ).toEqual([
      { platform: 'instagram', url: 'https://www.Instagram.com/everafter' },
      { platform: 'website', url: 'https://everafter.in' },
    ]);
  });

  it('keeps a label only on other links', () => {
    expect(
      normaliseSocialLinks([
        { platform: 'x', url: 'https://x.com/a', label: 'Ignored' },
        { platform: 'other', url: 'https://behance.net/a', label: ' Portfolio ' },
        { platform: 'other', url: 'https://dribbble.com/a', label: '  ' },
      ]),
    ).toEqual([
      { platform: 'x', url: 'https://x.com/a' },
      { platform: 'other', url: 'https://behance.net/a', label: 'Portfolio' },
      { platform: 'other', url: 'https://dribbble.com/a' },
    ]);
  });
});

describe('resolveSocialLinks', () => {
  const current = {
    socialLinks: [
      { platform: 'facebook', url: 'https://facebook.com/everafter' },
      { platform: 'instagram', url: 'https://instagram.com/old' },
      { platform: 'instagram', url: 'https://instagram.com/second' },
    ] as SocialLink[],
  };

  it('leaves the links alone when the request mentions none', () => {
    expect(resolveSocialLinks({}, current)).toBeNull();
  });

  it('takes a submitted list as the whole list and derives the single columns', () => {
    expect(
      resolveSocialLinks(
        {
          socialLinks: [
            { platform: 'youtube', url: 'https://youtu.be/a' },
            { platform: 'website', url: 'https://everafter.in' },
            { platform: 'website', url: 'https://everafter.co' },
          ],
          instagramUrl: 'https://instagram.com/ignored',
        },
        current,
      ),
    ).toEqual({
      socialLinks: [
        { platform: 'youtube', url: 'https://youtu.be/a' },
        { platform: 'website', url: 'https://everafter.in' },
        { platform: 'website', url: 'https://everafter.co' },
      ],
      website: 'https://everafter.in',
      instagramUrl: null,
      youtubeUrl: 'https://youtu.be/a',
    });
  });

  it('merges the single fields an older app sends into the list', () => {
    expect(
      resolveSocialLinks(
        {
          instagramUrl: 'https://instagram.com/new',
          youtubeUrl: 'https://youtube.com/@new',
          website: null,
        },
        current,
      ),
    ).toEqual({
      socialLinks: [
        { platform: 'facebook', url: 'https://facebook.com/everafter' },
        { platform: 'instagram', url: 'https://instagram.com/new' },
        { platform: 'instagram', url: 'https://instagram.com/second' },
        { platform: 'youtube', url: 'https://youtube.com/@new' },
      ],
      website: null,
      instagramUrl: 'https://instagram.com/new',
      youtubeUrl: 'https://youtube.com/@new',
    });
  });

  it('leaves the list as it was when an older app resubmits the same values', () => {
    const resolved = resolveSocialLinks(
      { instagramUrl: 'https://instagram.com/old', youtubeUrl: null, website: null },
      current,
    );
    expect(resolved?.socialLinks).toEqual(current.socialLinks);
  });

  it('drops a platform whose single field an older app cleared', () => {
    const resolved = resolveSocialLinks({ instagramUrl: null }, current);
    expect(resolved?.socialLinks).toEqual([
      { platform: 'facebook', url: 'https://facebook.com/everafter' },
    ]);
    expect(resolved?.instagramUrl).toBeNull();
  });

  it('starts a list from the single fields on a listing that has none', () => {
    expect(resolveSocialLinks({ website: 'https://everafter.in' })?.socialLinks).toEqual([
      { platform: 'website', url: 'https://everafter.in' },
    ]);
  });
});
