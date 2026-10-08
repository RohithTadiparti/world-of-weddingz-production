import { NotFoundException } from '@nestjs/common';
import { WeddingPlannersService, publicPlanner } from './wedding-planners.service';
import { PlannerProfile } from './entities/planner-profile.entity';

const PRIVATE = [
  'ownerUserId',
  'payoutAccountId',
  'contactPerson',
  'contactPhone',
  'contactEmail',
  'address',
  'pincode',
];

const row = (overrides: Partial<PlannerProfile> = {}) =>
  ({
    id: 'p1',
    ownerUserId: 'owner-1',
    agencyName: 'Shubh Events',
    city: 'Hyderabad',
    state: 'Telangana',
    contactPerson: 'Anitha',
    contactPhone: '+919876543210',
    contactEmail: 'anitha@shubh.in',
    address: '12 Road No. 3',
    pincode: '500034',
    payoutAccountId: 'acc_123',
    packages: [{ name: 'Full', price: 100000 }],
    portfolio: [],
    isApproved: true,
    ratingAvg: 4.5,
    ratingCount: 2,
    ...overrides,
  }) as PlannerProfile;

describe('public planner view', () => {
  it('drops ownership, payout and direct-contact columns and keeps the business', () => {
    const view = publicPlanner(row());
    for (const field of PRIVATE) expect(view).not.toHaveProperty(field);
    expect(view).toMatchObject({
      id: 'p1',
      agencyName: 'Shubh Events',
      city: 'Hyderabad',
      state: 'Telangana',
      packages: [{ name: 'Full', price: 100000 }],
    });
  });

  it('answers 404 for an unapproved listing and strips the approved one', async () => {
    const planners = {
      findOne: jest.fn(async ({ where }: { where: { isApproved: boolean } }) =>
        where.isApproved ? null : row({ isApproved: false }),
      ),
    };
    const service = new WeddingPlannersService(planners as never, {} as never, {} as never, {} as never);
    await expect(service.findPublic('p1')).rejects.toBeInstanceOf(NotFoundException);

    planners.findOne.mockResolvedValueOnce(row());
    const view = await service.findPublic('p1');
    expect(view).not.toHaveProperty('contactPhone');
    expect(view).not.toHaveProperty('ownerUserId');
  });

  it('strips search results too', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[row()], 1]),
    };
    const planners = { createQueryBuilder: jest.fn(() => qb) };
    const redis = { wrap: jest.fn((_key: string, _ttl: number, fn: () => unknown) => fn()) };
    const service = new WeddingPlannersService(planners as never, {} as never, redis as never, {} as never);
    const result = await service.search({ page: 1, limit: 12 } as never);
    expect(result.data[0]).not.toHaveProperty('payoutAccountId');
    expect(result.data[0]).not.toHaveProperty('contactEmail');
    expect(result.data[0].agencyName).toBe('Shubh Events');
  });
});
