import { NotFoundException } from '@nestjs/common';
import { AdminAccountsService } from './admin-accounts.service';
import { AuditAction } from '../../platform/audit/audit.service';
import { UserRole } from '../../common/enums';

/** A repository that answers every read with nothing, unless told otherwise. */
function emptyRepo(overrides: Record<string, unknown> = {}) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
  };
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => qb),
    ...overrides,
  };
}

const ACCOUNT = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'rohith@gmail.com',
  phone: '+919876543210',
  role: UserRole.AGENT,
  isActive: true,
  isVerified: true,
  managedByAgentId: null,
  createdAt: new Date(0),
};

function build(users = emptyRepo()) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const adminBookings = { attachParties: jest.fn(async (rows: unknown[]) => rows) };
  const r = () => emptyRepo();
  const service = new AdminAccountsService(
    users as never, // users
    r() as never, // vendors
    r() as never, // bookings
    r() as never, // payments
    r() as never, // profiles
    r() as never, // profileDetails
    r() as never, // planners
    r() as never, // serviceAreas
    r() as never, // cases
    r() as never, // verifications
    r() as never, // charges
    r() as never, // interests
    adminBookings as never,
    audit as never,
  );
  return { service, audit };
}

describe('AdminAccountsService contact masking', () => {
  it('masks the account email and mobile on the detail read', async () => {
    const users = emptyRepo({
      findOne: jest.fn().mockResolvedValue({ ...ACCOUNT }),
      find: jest.fn().mockResolvedValue([
        { id: 'c1', email: 'client.one@example.org', role: 'bride', isActive: true, createdAt: new Date(0) },
      ]),
    });
    const { service } = build(users);
    // The agent dashboard is its own read model; not what this test is about.
    jest.spyOn(service as never, 'agentDashboard' as never).mockResolvedValue(null as never);

    const detail = await service.accountDetail(ACCOUNT.id);

    expect(detail.user).toMatchObject({
      id: ACCOUNT.id,
      email: 'r***@gmail.com',
      phone: '********3210',
      contactMasked: true,
    });
    expect(detail.agency?.clients[0].email).toBe('c***@example.org');
    expect(JSON.stringify(detail)).not.toContain('rohith@gmail.com');
    expect(JSON.stringify(detail)).not.toContain('9876543210');
  });

  it('reveals the full contact details only through the audited read', async () => {
    const users = emptyRepo({ findOne: jest.fn().mockResolvedValue({ ...ACCOUNT }) });
    const { service, audit } = build(users);
    const actor = { userId: 'admin-1', role: UserRole.ADMIN } as never;

    await expect(service.revealContact(actor, ACCOUNT.id)).resolves.toEqual({
      id: ACCOUNT.id,
      email: 'rohith@gmail.com',
      phone: '+919876543210',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ADMIN_CONTACT_REVEALED,
        actor,
        resourceType: 'user',
        resourceId: ACCOUNT.id,
      }),
    );
    // The audit row names which fields were seen, never the values.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('rohith@gmail.com');
  });

  it('refuses to reveal an account that does not exist, and audits nothing', async () => {
    const { service, audit } = build();
    await expect(
      service.revealContact({ userId: 'admin-1', role: UserRole.ADMIN } as never, ACCOUNT.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AdminAccountsService.directory', () => {
  function directoryRepo(rows: unknown[]) {
    const qb = {
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([rows, rows.length]),
    };
    return { qb, repo: emptyRepo({ createQueryBuilder: jest.fn(() => qb) }) };
  }

  it('masks email and mobile on every row (ISS-11)', async () => {
    const { repo } = directoryRepo([{ ...ACCOUNT }]);
    const { service } = build(repo);

    const page = await service.directory({ page: 1, limit: 25 } as never);

    expect(page.data[0]).toMatchObject({
      id: ACCOUNT.id,
      email: 'r***@gmail.com',
      phone: '********3210',
      contactMasked: true,
    });
    expect(JSON.stringify(page)).not.toContain('rohith@gmail.com');
    expect(JSON.stringify(page)).not.toContain('9876543210');
  });

  it('still searches the raw email and the mobile digits in the database', async () => {
    const { qb, repo } = directoryRepo([{ ...ACCOUNT }]);
    const { service } = build(repo);

    await service.directory({ page: 1, limit: 25, q: 'Rohith@Gmail' } as never);
    expect(qb.andWhere).toHaveBeenCalledWith('(LOWER(u.email) LIKE :contactNeedle)', {
      contactNeedle: '%rohith@gmail%',
    });

    qb.andWhere.mockClear();
    await service.directory({ page: 1, limit: 25, q: '98765 43210' } as never);
    const [clause, params] = qb.andWhere.mock.calls[0];
    expect(clause).toContain('LOWER(u.email) LIKE :contactNeedle');
    expect(clause).toContain("REGEXP_REPLACE(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE :contactNeedleDigits");
    expect(params).toEqual({ contactNeedle: '%98765 43210%', contactNeedleDigits: '%9876543210%' });
  });
});
