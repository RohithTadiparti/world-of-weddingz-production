import { ForbiddenException } from '@nestjs/common';
import { BusinessStatus } from '../../common/enums';
import { POST_VERIFICATION_EDITABLE_FIELDS } from './business-lifecycle';
import { BusinessLifecycleService, sameValue } from './business-lifecycle.service';
import { Vendor } from './entities/vendor.entity';

/** Only the synchronous edit guard is exercised; it touches no dependency. */
const service = new BusinessLifecycleService(
  ...(Array.from({ length: 9 }, () => ({})) as ConstructorParameters<
    typeof BusinessLifecycleService
  >),
);

const stored = [{ url: 'https://instagram.com/everafter', platform: 'instagram' }];

function listing(status: BusinessStatus, extra: Partial<Vendor> = {}): Vendor {
  return {
    status,
    name: 'Everafter',
    // As Postgres returns jsonb: keys reordered from how they were saved.
    socialLinks: stored,
    instagramUrl: 'https://instagram.com/everafter',
    website: null,
    youtubeUrl: null,
    correctionFields: null,
    ...extra,
  } as unknown as Vendor;
}

describe('social links on a verified listing', () => {
  it('are among the fields a verified listing may still change', () => {
    expect(POST_VERIFICATION_EDITABLE_FIELDS).toEqual(
      expect.arrayContaining(['socialLinks', 'instagramUrl', 'youtubeUrl', 'website']),
    );
  });

  it.each([BusinessStatus.VERIFIED, BusinessStatus.LIVE])(
    'can be edited while the listing is %s',
    (status) => {
      expect(() =>
        service.assertIdentityEditable(listing(status), {
          name: 'Everafter',
          socialLinks: [
            { platform: 'facebook', url: 'https://facebook.com/everafter' },
            { platform: 'x', url: 'https://x.com/everafter' },
          ],
          instagramUrl: null,
          website: null,
          youtubeUrl: null,
        }),
      ).not.toThrow();
    },
  );

  it('still refuses a change to a verified detail sent alongside them', () => {
    expect(() =>
      service.assertIdentityEditable(listing(BusinessStatus.LIVE), {
        name: 'Somebody Else',
        socialLinks: [],
      }),
    ).toThrow(ForbiddenException);
  });

  it('pass a targeted correction untouched even though Postgres reordered their keys', () => {
    const business = listing(BusinessStatus.REVERIFICATION_REQUIRED, {
      correctionFields: ['name'],
    } as Partial<Vendor>);
    expect(() =>
      service.assertIdentityEditable(business, {
        name: 'Everafter Weddings',
        socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/everafter' }],
      }),
    ).not.toThrow();
    expect(() =>
      service.assertIdentityEditable(business, {
        socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/someone' }],
      }),
    ).toThrow(ForbiddenException);
  });
});

describe('sameValue', () => {
  it('ignores object key order but not array order', () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(null, null)).toBe(true);
  });
});
