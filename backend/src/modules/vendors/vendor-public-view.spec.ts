import { NotFoundException } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { BusinessStatus, UserRole } from '../../common/enums';

const OWNER = '00000000-0000-4000-8000-0000000000aa';

function serviceWith(vendor: Record<string, unknown> | null) {
  const vendors = { findOne: jest.fn().mockResolvedValue(vendor) };
  const none = {} as never;
  return new VendorsService(
    vendors as never,
    none, none, none, none, none, none, none, none, none, none, none,
  );
}

const listing = (overrides: Record<string, unknown> = {}) => ({
  id: 'v1',
  ownerUserId: OWNER,
  name: 'Lotus Decor',
  category: 'decor',
  categories: ['decor'],
  isApproved: false,
  status: BusinessStatus.VERIFICATION_IN_PROGRESS,
  gstNumber: '36ABCDE1234F1Z5',
  payoutAccountId: 'pa1',
  ...overrides,
});

describe('VendorsService.findOne (public listing view)', () => {
  it('answers 404 for a listing that is not live, to an anonymous caller', async () => {
    await expect(serviceWith(listing()).findOne('v1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 to a signed-in caller who does not own it', async () => {
    await expect(
      serviceWith(listing()).findOne('v1', { userId: 'someone-else', role: UserRole.BRIDE }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still shows the owner and administrators their listing in review', async () => {
    await expect(
      serviceWith(listing()).findOne('v1', { userId: OWNER, role: UserRole.VENDOR }),
    ).resolves.toMatchObject({ id: 'v1', status: BusinessStatus.VERIFICATION_IN_PROGRESS });
    await expect(
      serviceWith(listing()).findOne('v1', { userId: 'admin-1', role: UserRole.ADMIN }),
    ).resolves.toMatchObject({ id: 'v1' });
  });

  it('shows a live listing to anybody, without the private columns', async () => {
    const view = await serviceWith(
      listing({ isApproved: true, status: BusinessStatus.LIVE }),
    ).findOne('v1');
    expect(view).toMatchObject({ id: 'v1', isApproved: true });
    expect(view).not.toHaveProperty('ownerUserId');
    expect(view).not.toHaveProperty('gstNumber');
    expect(view).not.toHaveProperty('payoutAccountId');
  });

  it('answers 404 for an id that does not exist', async () => {
    await expect(serviceWith(null).findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
