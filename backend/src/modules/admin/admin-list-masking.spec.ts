import { AdminConsoleService } from './admin-console.service';
import { AdminService } from './admin.service';
import { UserRole } from '../../common/enums';

/**
 * Administrator lists show contact details masked (ISS-11), while the search
 * an administrator types still runs on the stored values.
 */

function qb(rows: unknown[] = []) {
  const builder: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'leftJoin',
    'innerJoin',
    'orderBy',
    'skip',
    'take',
  ]) {
    builder[m] = jest.fn(() => builder);
  }
  builder.getRawMany = jest.fn().mockResolvedValue([]);
  builder.getManyAndCount = jest.fn().mockResolvedValue([rows, rows.length]);
  return builder;
}

function repo(overrides: Record<string, unknown> = {}) {
  const builder = qb();
  return {
    builder,
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => builder),
    ...overrides,
  };
}

const OFFICERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'field.one@wow.in',
    phone: '+91 98765 43210',
    isActive: true,
    createdAt: new Date(0),
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'second.officer@wow.in',
    phone: '9000011111',
    isActive: true,
    createdAt: new Date(0),
  },
];

function consoleService(
  repos: Record<string, ReturnType<typeof repo>> = {},
  adminBookings: unknown = {},
) {
  const r = (name: string) => repos[name] ?? repo();
  return new AdminConsoleService(
    r('users') as never,
    r('vendors') as never,
    r('reviews') as never,
    r('bookings') as never,
    r('profiles') as never,
    r('vendorServices') as never,
    r('offerings') as never,
    r('definitions') as never,
    r('categories') as never,
    r('serviceAreas') as never,
    r('cases') as never,
    r('verifications') as never,
    r('sessions') as never,
    r('availability') as never,
    adminBookings as never,
  );
}

describe('AdminConsoleService.officers', () => {
  it('masks each officer email, including the name it falls back to', async () => {
    const users = repo({ find: jest.fn().mockResolvedValue(OFFICERS.map((o) => ({ ...o }))) });
    const rows = await consoleService({ users }).officers();

    expect(rows.map((o) => o.email)).toEqual(['f***@wow.in', 's***@wow.in']);
    expect(rows[0].name).toBe('f***@wow.in');
    expect(JSON.stringify(rows)).not.toContain('field.one@wow.in');
    expect(JSON.stringify(rows)).not.toContain('98765');
  });

  it('answers the roster search by raw email, phone digits, name or coverage', async () => {
    const users = repo({ find: jest.fn().mockResolvedValue(OFFICERS.map((o) => ({ ...o }))) });
    const profiles = repo({
      find: jest.fn().mockResolvedValue([{ userId: OFFICERS[1].id, displayName: 'Meera Rao' }]),
    });
    const serviceAreas = repo({
      find: jest
        .fn()
        .mockResolvedValue([{ officerUserId: OFFICERS[0].id, label: 'Hyderabad West' }]),
    });
    const service = consoleService({ users, profiles, serviceAreas });
    const ids = async (q: string) => (await service.officers(q)).map((o) => o.id);

    expect(await ids('field.one@')).toEqual([OFFICERS[0].id]);
    expect(await ids('43210')).toEqual([OFFICERS[0].id]);
    expect(await ids('meera')).toEqual([OFFICERS[1].id]);
    expect(await ids('hyderabad')).toEqual([OFFICERS[0].id]);
    expect(await ids('nobody')).toEqual([]);
  });

  /*
   * A roster that answers "Available" for an officer who has never set the
   * field is asserting something nobody said; the administrator sees that it is
   * unset instead (and allocation is unchanged — see availabilityView).
   */
  it('shows an officer who has never set availability as not set', async () => {
    const users = repo({ find: jest.fn().mockResolvedValue([OFFICERS[0]]) });
    const availability = repo({ find: jest.fn().mockResolvedValue([]) });
    const rows = await consoleService({ users, availability }).officers();
    expect(rows[0].availability).toBe('not_set');
  });

  it('still reports the status an officer set for themselves', async () => {
    const users = repo({ find: jest.fn().mockResolvedValue([OFFICERS[0]]) });
    const availability = repo({
      find: jest.fn().mockResolvedValue([
        {
          officerUserId: OFFICERS[0].id,
          status: 'on_leave',
          leaveFrom: '2026-10-01',
          leaveTo: '2026-10-31',
          leaveReason: null,
        },
      ]),
    });
    const rows = await consoleService({ users, availability }).officers();
    expect(rows[0].availability).toBe('on_leave');
  });
});

describe('AdminConsoleService.businesses', () => {
  it('masks the owner email and listing phone, and searches name or owner contact', async () => {
    const vendor = {
      id: 'v1',
      ownerUserId: 'u1',
      name: 'Sri Caterers',
      contactPhone: '9876543210',
      createdAt: new Date(0),
    };
    const vendors = repo();
    vendors.builder.getManyAndCount.mockResolvedValue([[vendor], 1]);
    const users = repo({
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 'u1', email: 'owner@caterers.in', isActive: true, createdAt: new Date(0) },
        ]),
    });

    const page = await consoleService({ vendors, users }).businesses({
      page: 1,
      limit: 20,
      q: 'owner@cat',
    } as never);

    expect(page.data[0].owner?.email).toBe('o***@caterers.in');
    expect(page.data[0].contactPhone).toBe('******3210');
    expect(vendors.builder.leftJoin).toHaveBeenCalled();
    const [clause, params] = vendors.builder.andWhere.mock.calls[0];
    expect(clause).toContain('LOWER(v.name) LIKE :needle');
    expect(clause).toContain('LOWER(owner.email) LIKE :contactNeedle');
    expect(params).toMatchObject({ needle: '%owner@cat%', contactNeedle: '%owner@cat%' });
    // A row whose owner has no profile name falls back to the masked email.
    expect(page.data[0].owner?.name).toBe('o***@caterers.in');
  });

  it("leads each row with the owner's own name, and searches it (WOW-03)", async () => {
    const vendor = { id: 'v1', ownerUserId: 'u1', name: 'Sri Caterers', createdAt: new Date(0) };
    const vendors = repo();
    vendors.builder.getManyAndCount.mockResolvedValue([[vendor], 1]);
    const users = repo({
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 'u1', email: 'owner@caterers.in', isActive: true, createdAt: new Date(0) },
        ]),
    });
    const profiles = repo({
      find: jest.fn().mockResolvedValue([{ id: 'p1', userId: 'u1', displayName: 'Suresh Reddy' }]),
    });

    const page = await consoleService({ vendors, users, profiles }).businesses({
      page: 1,
      limit: 20,
      q: 'suresh',
    } as never);

    expect(page.data[0].owner?.name).toBe('Suresh Reddy');
    expect(page.data[0].name).toBe('Sri Caterers');
    const [clause] = vendors.builder.andWhere.mock.calls[0];
    expect(clause).toContain('LOWER(np."displayName") LIKE :needle');
  });
});

describe('AdminConsoleService.businessDetail (WOW-05)', () => {
  it("masks the owner's email and mobile and the business contact number", async () => {
    const vendors = repo({
      findOne: jest.fn().mockResolvedValue({
        id: 'v1',
        ownerUserId: 'u1',
        name: 'Sri Caterers',
        contactPhone: '+91 98765 11111',
      }),
    });
    const users = repo({
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'owner@caterers.in',
        phone: '+919876522222',
        isActive: true,
      }),
    });
    const profiles = repo({
      find: jest.fn().mockResolvedValue([{ id: 'p1', userId: 'u1', displayName: 'Suresh Reddy' }]),
    });
    const service = consoleService({ vendors, users, profiles }, {
      attachParties: jest.fn(async (rows: unknown[]) => rows),
    });

    const detail = await service.businessDetail('v1');

    expect(detail.business).toMatchObject({ contactPhone: '********1111', contactMasked: true });
    expect(detail.owner).toMatchObject({
      id: 'u1',
      name: 'Suresh Reddy',
      email: 'o***@caterers.in',
      phone: '********2222',
      contactMasked: true,
    });
    const json = JSON.stringify(detail);
    expect(json).not.toContain('owner@caterers.in');
    expect(json).not.toContain('98765');
  });
});

describe('AdminConsoleService.staff', () => {
  it('masks staff emails', async () => {
    const users = repo({
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 'a1', email: 'chief.admin@wow.in', isActive: true, createdAt: new Date(0) },
        ]),
    });
    const rows = await consoleService({ users }).staff('admin');
    expect(rows[0]).toMatchObject({ id: 'a1', email: 'c***@wow.in', role: UserRole.ADMIN });
  });
});

describe('AdminService lists', () => {
  function adminService(repos: Record<string, ReturnType<typeof repo>> = {}) {
    const r = (name: string) => repos[name] ?? repo();
    return new AdminService(
      r('users') as never,
      r('vendors') as never,
      r('planners') as never,
      r('bookings') as never,
      r('disputes') as never,
      r('profiles') as never,
      r('interests') as never,
      r('payments') as never,
      r('charges') as never,
      r('verifications') as never,
      r('cases') as never,
      r('agencies') as never,
      r('vendorServices') as never,
      r('quotations') as never,
      {} as never,
      {} as never,
    );
  }

  it('masks emails on the users list', async () => {
    const users = repo({
      findAndCount: jest
        .fn()
        .mockResolvedValue([[{ id: 'u1', email: 'bride@example.org', role: UserRole.BRIDE }], 1]),
    });
    const page = await adminService({ users }).listUsers(1, 20);
    expect(page.data[0].email).toBe('b***@example.org');
  });

  it('masks business contact fields on the approval queues', async () => {
    const vendors = repo({
      find: jest.fn().mockResolvedValue([{ id: 'v1', contactPhone: '9876543210' }]),
    });
    const planners = repo({
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 'p1', contactPhone: '9876543210', contactEmail: 'plan@events.in' },
        ]),
    });
    const service = adminService({ vendors, planners });

    expect((await service.listPendingVendors())[0].contactPhone).toBe('******3210');
    expect((await service.listPendingPlanners())[0]).toMatchObject({
      contactPhone: '******3210',
      contactEmail: 'p***@events.in',
    });
  });
});
