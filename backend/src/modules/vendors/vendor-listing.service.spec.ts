import { BadRequestException } from '@nestjs/common';
import { VendorsService, publicVendor } from './vendors.service';
import { BusinessStatus } from '../../common/enums';
import { Vendor } from './entities/vendor.entity';
import {
  UploadedMediaRecogniser,
  configureUploadedMedia,
} from '../../platform/storage/uploaded-media';

const USER = '5b1d0000-0000-4000-8000-000000000001';
const upload = (area: string, name: string) =>
  `https://wow.test/api/mock-storage/users/${USER}/${area}/1767000000000-3f2a9c1d2e3f4a5b-${name}`;
const IMG_A = upload('profile', 'a.jpg');
const IMG_B = upload('profile', 'b.jpg');
const IMG_C = upload('profile', 'c.jpg');
const GST = upload('attachments', 'gst.pdf');
const PAN = upload('attachments', 'pan.png');
const HEIC = upload('attachments', 'scan.heic');

const none = {} as never;

function setup(stored: Partial<Vendor> = {}) {
  const row = {
    id: 'v1',
    ownerUserId: 'u1',
    name: 'Lotus Decor',
    city: 'Hyderabad',
    status: BusinessStatus.DRAFT,
    portfolio: [IMG_A, IMG_B],
    profileImage: IMG_B,
    complianceDocuments: [GST],
    complianceDocumentTypes: ['gst_certificate'],
    socialLinks: [],
    correctionFields: null,
    ...stored,
  };
  const vendors = {
    findOne: jest.fn(async () => ({ ...row })),
    find: jest.fn(async () => [{ ...row }]),
    create: jest.fn((r: object) => r),
    save: jest.fn(async (r: object) => r),
  };
  const catalogCategories = { find: jest.fn(async () => [{ slug: 'decor' }]) };
  const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() };
  const lifecycle = { assertIdentityEditable: jest.fn() };
  const service = new VendorsService(
    vendors as never,
    catalogCategories as never,
    none, none, none, none, none, none, none,
    redis as never,
    none,
    lifecycle as never,
  );
  return { vendors, service, lifecycle };
}

const saved = (vendors: ReturnType<typeof setup>['vendors']) =>
  vendors.save.mock.calls[0][0] as Record<string, unknown>;

beforeAll(() => {
  configureUploadedMedia(
    new UploadedMediaRecogniser({ cdnBaseUrl: '', mockBaseUrl: 'https://wow.test/api/mock-storage' }),
  );
});

describe('VendorsService profile picture', () => {
  it('keeps the chosen picture when it is one of the portfolio images', async () => {
    const { vendors, service } = setup();
    await service.update('u1', 'v1', { portfolio: [IMG_A, IMG_B, IMG_C], profileImage: IMG_C });
    expect(saved(vendors)).toMatchObject({ portfolio: [IMG_A, IMG_B, IMG_C], profileImage: IMG_C });
  });

  it('refuses a picture that is not among the portfolio images', async () => {
    const { vendors, service } = setup();
    await expect(
      service.update('u1', 'v1', { portfolio: [IMG_A], profileImage: IMG_C }),
    ).rejects.toThrow(new BadRequestException(['profileImage must be one of the portfolio images']));
    // Against the stored list when the portfolio is not being changed.
    await expect(service.update('u1', 'v1', { profileImage: IMG_C })).rejects.toThrow(
      BadRequestException,
    );
    expect(vendors.save).not.toHaveBeenCalled();
  });

  it('moves to the first image when the chosen one is removed', async () => {
    const { vendors, service } = setup();
    await service.update('u1', 'v1', { portfolio: [IMG_A] });
    expect(saved(vendors)).toMatchObject({ portfolio: [IMG_A], profileImage: IMG_A });
  });

  it('gives a new listing its first image when none was chosen', async () => {
    const { vendors, service } = setup();
    await service.create('u1', { name: 'Lotus', categories: ['decor'], portfolio: [IMG_A, IMG_B] });
    expect(saved(vendors)).toMatchObject({ profileImage: IMG_A });
  });
});

describe('VendorsService compliance documents', () => {
  it('accepts new PDF, JPG, JPEG and PNG uploads with their types', async () => {
    const { vendors, service } = setup();
    await service.update('u1', 'v1', {
      complianceDocuments: [GST, PAN],
      complianceDocumentTypes: ['gst_certificate', 'pan_card'],
    });
    expect(saved(vendors)).toMatchObject({
      complianceDocuments: [GST, PAN],
      complianceDocumentTypes: ['gst_certificate', 'pan_card'],
    });
  });

  it('refuses a new document in any other format', async () => {
    const { vendors, service } = setup();
    await expect(service.update('u1', 'v1', { complianceDocuments: [GST, HEIC] })).rejects.toThrow(
      new BadRequestException(['Compliance documents must be PDF, JPG, JPEG or PNG files']),
    );
    expect(vendors.save).not.toHaveBeenCalled();
  });

  it('keeps a stored document in an older format when it is resent', async () => {
    const { vendors, service } = setup({ complianceDocuments: [HEIC], complianceDocumentTypes: [null] });
    await service.update('u1', 'v1', { complianceDocuments: [HEIC, GST] });
    expect(saved(vendors)).toMatchObject({ complianceDocuments: [HEIC, GST] });
  });

  it('refuses more types than documents', async () => {
    const { service } = setup();
    await expect(
      service.update('u1', 'v1', {
        complianceDocuments: [GST],
        complianceDocumentTypes: ['gst_certificate', 'pan_card'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps the stored types for a client that resends documents without them', async () => {
    const { vendors, service } = setup();
    await service.update('u1', 'v1', { complianceDocuments: [PAN, GST] });
    expect(saved(vendors)).toMatchObject({ complianceDocumentTypes: [null, 'gst_certificate'] });
  });
});

describe('VendorsService city', () => {
  it('does not count a stored city that only differs in case as a change', async () => {
    const { lifecycle, service, vendors } = setup({
      city: 'hyderabad',
      status: BusinessStatus.REVERIFICATION_REQUIRED,
      correctionFields: ['name'],
    });
    await service.update('u1', 'v1', { name: 'Lotus Weddings', city: 'Hyderabad' });
    expect(lifecycle.assertIdentityEditable.mock.calls[0][1]).toMatchObject({ city: 'hyderabad' });
    // Not flagged for correction, so the stored value is left as it was.
    expect(saved(vendors)).toMatchObject({ city: 'hyderabad' });
  });

  it('writes the title-cased city where the city may be edited', async () => {
    const { service, vendors } = setup({ city: 'hyderabad' });
    await service.update('u1', 'v1', { city: 'Hyderabad' });
    expect(saved(vendors)).toMatchObject({ city: 'Hyderabad' });
  });
});

describe('VendorsService social links on read', () => {
  const links = [
    { platform: 'instagram', url: 'https://www.instagram.com/lotus' },
    { platform: 'website', url: 'https://lotus.in' },
    { platform: 'instagram', url: 'https://www.instagram.com/lotus.decor' },
  ];

  it('shows a legacy listing with each platform once', async () => {
    const { service } = setup({ socialLinks: links as never });
    const [own] = await service.listOwn('u1');
    expect(own.socialLinks.map((l) => l.platform)).toEqual(['instagram', 'website']);
    expect(
      publicVendor({ ...own, socialLinks: links } as unknown as Vendor).socialLinks.map(
        (l) => l.platform,
      ),
    ).toEqual(['instagram', 'website']);
  });

  it('puts the profile picture on the public view', () => {
    expect(
      publicVendor({ portfolio: [IMG_A, IMG_B], profileImage: IMG_B } as unknown as Vendor)
        .profileImage,
    ).toBe(IMG_B);
    expect(
      publicVendor({ portfolio: [IMG_A, IMG_B], profileImage: null } as unknown as Vendor)
        .profileImage,
    ).toBe(IMG_A);
  });
});
