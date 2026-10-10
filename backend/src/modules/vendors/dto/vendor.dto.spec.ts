import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVendorDto, UpdateVendorDto } from './vendor.dto';

const DOC = (name: string) => `https://cdn.wow.test/users/u/attachments/${name}`;
const IMG = (n: number) => `https://cdn.wow.test/vendors/v/portfolio/${n}.jpg`;

async function check(cls: typeof CreateVendorDto | typeof UpdateVendorDto, body: object) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  const messages: string[] = [];
  const walk = (list: typeof errors) =>
    list.forEach((e) => {
      messages.push(...Object.values(e.constraints ?? {}).map((m) => `${e.property}: ${m}`));
      walk(e.children ?? []);
    });
  walk(errors);
  return { dto, messages, properties: errors.map((e) => e.property) };
}

const base = { name: 'Lotus Decor', categories: ['decor'] };

describe('CreateVendorDto business details', () => {
  it('accepts a business name of exactly 50 characters and refuses 51', async () => {
    expect((await check(CreateVendorDto, { ...base, name: 'a'.repeat(50) })).messages).toEqual([]);
    const { properties, messages } = await check(CreateVendorDto, { ...base, name: 'a'.repeat(51) });
    expect(properties).toEqual(['name']);
    expect(messages.join()).toContain('50 characters');
  });

  it('stores the city in title case', async () => {
    const { dto, messages } = await check(CreateVendorDto, { ...base, city: 'hyderabad' });
    expect(messages).toEqual([]);
    expect(dto.city).toBe('Hyderabad');
    expect((await check(CreateVendorDto, { ...base, city: 'new delhi' })).dto.city).toBe('New Delhi');
  });
});

describe('CreateVendorDto registration', () => {
  it('limits the registration number to 30 characters', async () => {
    expect(
      (await check(CreateVendorDto, { ...base, registrationNumber: 'R'.repeat(30) })).messages,
    ).toEqual([]);
    expect(
      (await check(CreateVendorDto, { ...base, registrationNumber: 'R'.repeat(31) })).properties,
    ).toEqual(['registrationNumber']);
  });

  it('limits the registered address to 100 characters', async () => {
    expect(
      (await check(CreateVendorDto, { ...base, registeredAddress: 'x'.repeat(100) })).messages,
    ).toEqual([]);
    expect(
      (await check(CreateVendorDto, { ...base, registeredAddress: 'x'.repeat(101) })).properties,
    ).toEqual(['registeredAddress']);
  });
});

describe('CreateVendorDto portfolio', () => {
  it('takes up to 10 images and refuses an 11th', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => IMG(i));
    expect((await check(CreateVendorDto, { ...base, portfolio: ten })).messages).toEqual([]);
    const { properties, messages } = await check(CreateVendorDto, {
      ...base,
      portfolio: [...ten, IMG(10)],
    });
    expect(properties).toEqual(['portfolio']);
    expect(messages.join()).toContain('10');
  });

  it('accepts a profile picture, or null to clear it', async () => {
    expect(
      (await check(CreateVendorDto, { ...base, portfolio: [IMG(1)], profileImage: IMG(1) })).messages,
    ).toEqual([]);
    expect((await check(UpdateVendorDto, { profileImage: null })).messages).toEqual([]);
    expect((await check(UpdateVendorDto, { profileImage: 'not a url' })).properties).toEqual([
      'profileImage',
    ]);
  });
});

describe('CreateVendorDto compliance documents', () => {
  it('takes up to 3 documents and refuses a 4th', async () => {
    const three = [DOC('gst.pdf'), DOC('pan.jpg'), DOC('reg.png')];
    expect((await check(CreateVendorDto, { ...base, complianceDocuments: three })).messages).toEqual([]);
    expect(
      (await check(CreateVendorDto, { ...base, complianceDocuments: [...three, DOC('x.pdf')] }))
        .properties,
    ).toEqual(['complianceDocuments']);
  });

  it('accepts the four document types and nothing else', async () => {
    expect(
      (
        await check(CreateVendorDto, {
          ...base,
          complianceDocuments: [DOC('a.pdf'), DOC('b.pdf'), DOC('c.pdf')],
          complianceDocumentTypes: ['gst_certificate', 'pan_card', 'aadhaar_card'],
        })
      ).messages,
    ).toEqual([]);
    expect(
      (await check(UpdateVendorDto, { complianceDocumentTypes: ['business_registration_certificate', null] }))
        .messages,
    ).toEqual([]);
    expect(
      (await check(UpdateVendorDto, { complianceDocumentTypes: ['passport'] })).properties,
    ).toEqual(['complianceDocumentTypes']);
  });
});

describe('Vendor social links', () => {
  const ig = (handle: string) => ({ platform: 'instagram', url: `https://www.instagram.com/${handle}` });

  it.each([CreateVendorDto, UpdateVendorDto])('%p refuses the same platform twice', async (cls) => {
    const body = cls === CreateVendorDto ? base : {};
    const { properties, messages } = await check(cls, {
      ...body,
      socialLinks: [ig('lotus'), { platform: 'website', url: 'https://lotus.in' }, ig('lotus2')],
    });
    expect(properties).toEqual(['socialLinks']);
    expect(messages.join()).toContain('Instagram');
  });

  it('allows one link of each type, and several "other" links', async () => {
    const { messages } = await check(UpdateVendorDto, {
      socialLinks: [
        { platform: 'website', url: 'https://lotus.in' },
        ig('lotus'),
        { platform: 'facebook', url: 'https://www.facebook.com/lotus' },
        { platform: 'youtube', url: 'https://www.youtube.com/@lotus' },
        { platform: 'whatsapp', url: 'https://wa.me/919876543210' },
        { platform: 'other', url: 'https://www.behance.net/lotus', label: 'Behance' },
        { platform: 'other', url: 'https://dribbble.com/lotus', label: 'Dribbble' },
      ],
    });
    expect(messages).toEqual([]);
  });
});
