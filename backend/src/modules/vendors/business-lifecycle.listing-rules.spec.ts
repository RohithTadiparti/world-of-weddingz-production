import { ForbiddenException } from '@nestjs/common';
import { BusinessStatus, UserRole } from '../../common/enums';
import { POST_VERIFICATION_EDITABLE_FIELDS } from './business-lifecycle';
import { BusinessLifecycleService } from './business-lifecycle.service';
import { Vendor } from './entities/vendor.entity';

const OWNER = { userId: 'u1', role: UserRole.VENDOR } as never;

function serviceFor(vendor: Partial<Vendor>) {
  const vendors = { findOne: jest.fn(async () => vendor) };
  const none = { find: jest.fn(async () => []) };
  return new BusinessLifecycleService(
    vendors as never,
    none as never,
    none as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    none as never,
    none as never,
  );
}

const complete: Partial<Vendor> = {
  id: 'v1',
  ownerUserId: 'u1',
  status: BusinessStatus.DRAFT,
  name: 'Lotus Decor',
  categories: ['decor'],
  city: 'Hyderabad',
  registeredAddress: '12 Road No 1, Banjara Hills',
  panNumber: 'ABCDE1234F',
  contactPhone: '+919876543210',
  tradingSince: '2018-06-01',
  portfolio: ['https://cdn.wow.test/a.jpg'],
  complianceDocuments: ['https://cdn.wow.test/gst.pdf'],
};

describe('completion: trading since', () => {
  it('is required before a listing can be submitted', async () => {
    const state = await serviceFor({ ...complete, tradingSince: null }).completion(OWNER, 'v1');
    const business = state.items.find((i) => i.key === 'business');
    expect(business?.complete).toBe(false);
    expect(business?.missing).toContain('trading since');
  });

  it('is satisfied by a date', async () => {
    const state = await serviceFor(complete).completion(OWNER, 'v1');
    expect(state.items.find((i) => i.key === 'business')?.complete).toBe(true);
  });
});

describe('profile picture and document types under the edit locks', () => {
  const service = serviceFor(complete);

  it('lets a verified listing change its profile picture with its portfolio', () => {
    expect(POST_VERIFICATION_EDITABLE_FIELDS).toEqual(expect.arrayContaining(['profileImage']));
    expect(() =>
      service.assertIdentityEditable(
        { ...complete, status: BusinessStatus.LIVE, profileImage: 'a' } as Vendor,
        { profileImage: 'b', portfolio: ['a', 'b'] },
      ),
    ).not.toThrow();
  });

  it('opens the picture with the portfolio, and the types with the documents, under a correction', () => {
    const underCorrection = (fields: string[]) =>
      ({
        ...complete,
        status: BusinessStatus.REVERIFICATION_REQUIRED,
        correctionFields: fields,
        profileImage: 'a',
        complianceDocumentTypes: [null],
      }) as Vendor;
    expect(() =>
      service.assertIdentityEditable(underCorrection(['portfolio']), { profileImage: 'b' }),
    ).not.toThrow();
    expect(() =>
      service.assertIdentityEditable(underCorrection(['complianceDocuments']), {
        complianceDocumentTypes: ['pan_card'],
      }),
    ).not.toThrow();
    expect(() =>
      service.assertIdentityEditable(underCorrection(['name']), { profileImage: 'b' }),
    ).toThrow(ForbiddenException);
  });
});
