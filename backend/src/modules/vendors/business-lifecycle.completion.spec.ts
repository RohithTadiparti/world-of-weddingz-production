import { BadRequestException } from '@nestjs/common';
import { BusinessStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BusinessLifecycleService, blockingMessage } from './business-lifecycle.service';

const owner: AuthUser = {
  userId: 'owner',
  email: 'owner@example.com',
  role: UserRole.VENDOR,
  managedByAgentId: null,
};

const categories = [
  { id: 'c-bridal', slug: 'bridal-wear', name: 'Bridal Wear' },
  { id: 'c-groom', slug: 'groom-wear', name: 'Groom Wear' },
];
const definitions = [
  { id: 'd-lehenga', categoryId: 'c-bridal', name: 'Lehenga' },
  { id: 'd-saree', categoryId: 'c-bridal', name: 'Saree draping' },
  { id: 'd-sherwani', categoryId: 'c-groom', name: 'Sherwani' },
];

/**
 * The catalog step of the completion checklist, and the two routes it gates.
 *
 * Every selected category needs a service, and every service on sale needs a
 * live price. The checklist used to read only the first service's prices, so
 * one priced service let a whole multi-category listing through.
 */
describe('catalog completeness on the business checklist', () => {
  let business: Record<string, unknown>;
  let services: Record<string, unknown>[];
  let offerings: Record<string, unknown>[];
  let raise: jest.Mock;
  let service: BusinessLifecycleService;

  beforeEach(() => {
    business = {
      id: 'v1',
      ownerUserId: 'owner',
      name: 'Everafter',
      categories: ['bridal-wear', 'groom-wear'],
      city: 'Hyderabad',
      registeredAddress: '1 Road',
      tradingSince: '2019-04-01',
      panNumber: 'ABCDE1234F',
      contactPhone: '9876543210',
      complianceDocuments: ['doc'],
      portfolio: ['photo'],
      status: BusinessStatus.FIRST_REVIEW,
    };
    services = [
      { id: 's1', vendorId: 'v1', definitionId: 'd-lehenga', displayName: null, active: true },
      { id: 's2', vendorId: 'v1', definitionId: 'd-sherwani', displayName: null, active: true },
    ];
    offerings = [
      { id: 'o1', vendorServiceId: 's1', active: true },
      { id: 'o2', vendorServiceId: 's2', active: true },
    ];
    raise = jest.fn(async () => ({ id: 'req-1' }));

    service = new BusinessLifecycleService(
      {
        findOne: jest.fn(async () => business),
        save: jest.fn(async (b) => b),
      } as never,
      { find: jest.fn(async () => services) } as never,
      { find: jest.fn(async () => offerings) } as never,
      { raise, startSla: jest.fn(), isAwaitingResubmission: jest.fn(() => false) } as never,
      { record: jest.fn() } as never,
      { create: jest.fn() } as never,
      { raw: { keys: jest.fn(async () => []) }, del: jest.fn() } as never,
      { find: jest.fn(async () => categories) } as never,
      { find: jest.fn(async () => definitions) } as never,
    );
  });

  const catalogItem = async () =>
    (await service.completion(owner, 'v1')).items.find((i) => i.key === 'catalog')!;

  it('is complete when every selected category has a priced service', async () => {
    const item = await catalogItem();
    expect(item.complete).toBe(true);
    expect(item.missing).toBeNull();
    expect(item.issues).toEqual([]);
  });

  it('names the category with no service', async () => {
    services = [services[0]];
    const item = await catalogItem();
    expect(item.complete).toBe(false);
    expect(item.issues).toEqual(['Groom Wear: add at least one service']);
  });

  it('reads the prices of every service, not only the first', async () => {
    offerings = [offerings[0]];
    const item = await catalogItem();
    expect(item.issues).toEqual(['Groom Wear: pricing is missing for Sherwani']);
  });

  it('treats a retired price as no price', async () => {
    offerings = [offerings[0], { id: 'o2', vendorServiceId: 's2', active: false }];
    expect((await catalogItem()).issues).toEqual(['Groom Wear: pricing is missing for Sherwani']);
  });

  it('uses the vendor’s own name for a service when it has one', async () => {
    services.push({
      id: 's3',
      vendorId: 'v1',
      definitionId: 'd-saree',
      displayName: 'Bridal draping',
      active: true,
    });
    expect((await catalogItem()).issues).toEqual([
      'Bridal Wear: pricing is missing for Bridal draping',
    ]);
  });

  it('refuses submission for verification with the same per-category reasons', async () => {
    services = [services[0]];
    offerings = [];
    await expect(service.submitForVerification(owner, 'v1')).rejects.toThrow(
      new BadRequestException(
        'Finish these first: Catalog services (Bridal Wear: pricing is missing for Lehenga; ' +
          'Groom Wear: add at least one service).',
      ),
    );
    expect(raise).not.toHaveBeenCalled();
  });

  it('refuses to open the first review on the same grounds', async () => {
    business.status = BusinessStatus.DRAFT;
    offerings = [];
    await expect(service.beginFirstReview(owner, 'v1')).rejects.toThrow(
      'Bridal Wear: pricing is missing for Lehenga',
    );
  });

  it('submits once the catalog is complete', async () => {
    const result = await service.submitForVerification(owner, 'v1');
    expect(result.status).toBe(BusinessStatus.PENDING_VERIFICATION);
    expect(raise).toHaveBeenCalled();
  });
});

describe('blockingMessage', () => {
  it('lists plain labels for items without details', () => {
    expect(
      blockingMessage([
        { key: 'a', label: 'Documents', complete: false, missing: 'x' },
        { key: 'b', label: 'Portfolio', complete: true, missing: null },
        { key: 'c', label: 'Catalog services', complete: false, missing: 'y', issues: ['Y'] },
      ]),
    ).toBe('Finish these first: Documents, Catalog services (Y).');
  });
});
