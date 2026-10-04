import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VendorServicesService } from './vendor-services.service';
import { VendorService } from './entities/vendor-service.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { CatalogService } from './catalog.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { UpsertVendorServiceDto } from './dto/catalog.dto';

const owner: AuthUser = {
  userId: 'owner',
  email: 'owner@example.com',
  role: UserRole.VENDOR,
  managedByAgentId: null,
};

/**
 * A service whose category the business no longer lists.
 *
 * It used to vanish from every view while staying bookable. It has to stay in
 * front of the vendor (and the admin and officer) so it can be switched off,
 * and has to be off sale so the public sees the same thing it can book.
 */
describe('vendor services outside the selected categories', () => {
  let service: VendorServicesService;
  let vendorCategories: string[];
  let offeringsData: Record<string, unknown>[];

  const catering = { id: 'cat-catering', slug: 'catering' };
  const decor = { id: 'cat-decor', slug: 'decor' };
  const services: Partial<VendorService>[] = [
    { id: 'vs-cater', vendorId: 'v1', definitionId: 'd-cater', active: true },
    { id: 'vs-decor', vendorId: 'v1', definitionId: 'd-decor', active: true },
  ];
  const definitions = [
    { id: 'd-cater', categoryId: catering.id },
    { id: 'd-decor', categoryId: decor.id },
  ];
  const servicesRepo = {
    find: jest.fn(async () => services),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      services.find((s) => s.id === where.id) ?? null,
    ),
    save: jest.fn(async (s) => s),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    vendorCategories = ['catering'];
    offeringsData = [
      { id: 'o1', vendorServiceId: 'vs-cater', active: true },
      { id: 'o2', vendorServiceId: 'vs-decor', active: true },
    ];

    const moduleRef = await Test.createTestingModule({
      providers: [
        VendorServicesService,
        { provide: getRepositoryToken(VendorService), useValue: servicesRepo },
        {
          provide: getRepositoryToken(ServiceOffering),
          useValue: {
            find: jest.fn(async () => offeringsData),
          },
        },
        { provide: getRepositoryToken(ServiceDefinition), useValue: { find: jest.fn(async () => definitions) } },
        {
          provide: getRepositoryToken(ServiceCategory),
          useValue: {
            find: jest.fn(async () => [catering, decor]),
            findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
              [catering, decor].find((c) => c.id === where.id) ?? null,
            ),
          },
        },
        {
          provide: getRepositoryToken(Vendor),
          useValue: {
            findOne: jest.fn(async () => ({ id: 'v1', ownerUserId: 'owner', categories: vendorCategories })),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            attributesForMany: jest.fn(async () => new Map()),
            attributesFor: jest.fn(async () => []),
            getDefinition: jest.fn(async (id: string) => definitions.find((d) => d.id === id)),
          },
        },
        { provide: AppConfigService, useValue: { features: { catalogReviewThresholdPercent: 0 } } },
      ],
    }).compile();

    service = moduleRef.get(VendorServicesService);
  });

  it('shows the vendor every service, flagging the one outside its categories as not bookable', async () => {
    const list = await service.listForVendor('v1');
    expect(list.map((s) => s.id)).toEqual(['vs-cater', 'vs-decor']);
    const decorRow = list.find((s) => s.id === 'vs-decor')!;
    expect(decorRow.outsideSelectedCategories).toBe(true);
    expect(decorRow.bookable).toBe(false);
    expect(list.find((s) => s.id === 'vs-cater')!.bookable).toBe(true);
  });

  it('leaves it out of the public listing', async () => {
    const list = await service.listForVendor('v1', true);
    expect(list.map((s) => s.id)).toEqual(['vs-cater']);
  });

  it('returns only public, active catalogue data to a visitor', async () => {
    services[0].attributes = { seats: 250 };
    offeringsData = [
      {
        id: 'o1', vendorServiceId: 'vs-cater', active: true, name: 'Hall hire',
        pendingPrice: '99999', pendingSince: new Date(), concurrentCapacity: 12,
        pricingModel: 'fixed', price: '50000', currency: 'INR', unitLabel: null,
        minQuantity: null, maxQuantity: null, isPackage: false, inclusions: [], description: null,
      },
      { id: 'o2', vendorServiceId: 'vs-cater', active: false, name: 'Retired package' },
    ];
    const list = await service.listForVendor('v1', true);
    expect(list[0]).toMatchObject({ id: 'vs-cater', attributes: { seats: 250 } });
    expect(list[0].offerings).toHaveLength(1);
    expect(list[0].offerings[0]).not.toHaveProperty('pendingPrice');
    expect(list[0]).not.toHaveProperty('concurrentCapacity');
  });

  it('treats a business with no categories yet as having chosen everything it sells', async () => {
    vendorCategories = [];
    const list = await service.listForVendor('v1', true);
    expect(list.map((s) => s.id)).toEqual(['vs-cater', 'vs-decor']);
    expect(list.every((s) => !s.outsideSelectedCategories)).toBe(true);
  });

  it('lets the vendor switch it off', async () => {
    const saved = await service.updateService(owner, 'v1', 'vs-decor', { active: false } as UpsertVendorServiceDto);
    expect(saved.active).toBe(false);
  });

  it('refuses any other edit to it', async () => {
    await expect(
      service.updateService(owner, 'v1', 'vs-decor', { description: 'New words' } as UpsertVendorServiceDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a booking against it', async () => {
    await expect(service.validateBookingAnswers('vs-decor', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('UpsertVendorServiceDto', () => {
  it('accepts the retired concurrentCapacity field that older app builds still send', () => {
    const dto = plainToInstance(UpsertVendorServiceDto, {
      definitionId: '8f6c1d7e-3b1a-4c2d-9e4f-1a2b3c4d5e6f',
      concurrentCapacity: 5,
    });
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });
});
