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

function build(users = emptyRepo(), repos: Record<string, ReturnType<typeof emptyRepo>> = {}) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const adminBookings = { attachParties: jest.fn(async (rows: unknown[]) => rows) };
  const r = (name: string) => repos[name] ?? emptyRepo();
  const service = new AdminAccountsService(
    users as never, // users
    r('vendors') as never,
    r('bookings') as never,
    r('payments') as never,
    r('profiles') as never,
    r('profileDetails') as never,
    r('planners') as never,
    r('serviceAreas') as never,
    r('cases') as never,
    r('verifications') as never,
    r('charges') as never,
    r('interests') as never,
    r('agencies') as never,
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
      businesses: [],
      plannerBusinesses: [],
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
    const [emailClause, emailParams] = qb.andWhere.mock.calls[0];
    expect(emailClause).toContain('(LOWER(u.email) LIKE :contactNeedle)');
    expect(emailParams).toMatchObject({ contactNeedle: '%rohith@gmail%' });

    qb.andWhere.mockClear();
    await service.directory({ page: 1, limit: 25, q: '98765 43210' } as never);
    const [clause, params] = qb.andWhere.mock.calls[0];
    expect(clause).toContain('LOWER(u.email) LIKE :contactNeedle');
    expect(clause).toContain("REGEXP_REPLACE(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE :contactNeedleDigits");
    expect(params).toMatchObject({
      contactNeedle: '%98765 43210%',
      contactNeedleDigits: '%9876543210%',
    });
  });

  it('also finds an account by the person or business name it is listed under', async () => {
    const { qb, repo } = directoryRepo([{ ...ACCOUNT }]);
    const { service } = build(repo);

    await service.directory({ page: 1, limit: 25, q: 'Meera_' } as never);
    const [clause, params] = qb.andWhere.mock.calls[0];
    expect(clause).toContain('LOWER(np."displayName") LIKE :nameNeedle');
    expect(clause).toContain('LOWER(na."agencyName") LIKE :nameNeedle');
    expect(clause).toContain('LOWER(npl."agencyName") LIKE :nameNeedle');
    expect(clause).toContain('LOWER(nv.name) LIKE :nameNeedle');
    // A wildcard typed in the box is a literal character.
    expect(params.nameNeedle).toBe('%meera\\_%');
  });

  /*
   * WOW-01..04: the lists led with a masked email, a column of r***@gmail.com
   * nobody could tell apart. Each row now carries the person's name, the
   * business it runs, and the masked contact only as the last resort.
   */
  it('names each row by person, then business, then masked contact', async () => {
    const rows = [
      { ...ACCOUNT, id: 'u-bride', email: 'bride@example.org', role: UserRole.BRIDE },
      { ...ACCOUNT, id: 'u-agent', email: 'desk@bandhan.in', role: UserRole.AGENT },
      { ...ACCOUNT, id: 'u-planner', email: 'plan@events.in', role: UserRole.PLANNER },
      { ...ACCOUNT, id: 'u-nobody', email: 'nobody@example.org', role: UserRole.BRIDE },
      { ...ACCOUNT, id: 'u-phone', email: null, phone: '+919000011111', role: UserRole.BRIDE },
    ];
    const { repo } = directoryRepo(rows);
    const profiles = emptyRepo({
      find: jest.fn().mockResolvedValue([
        { id: 'p-bride', userId: 'u-bride', displayName: 'Bride Display' },
        { id: 'p-agent', userId: 'u-agent', displayName: 'Ravi Kumar' },
      ]),
    });
    const profileDetails = emptyRepo({
      find: jest
        .fn()
        .mockResolvedValue([{ profileId: 'p-bride', firstName: 'Meera', lastName: 'Rao', surname: null }]),
    });
    const agencies = emptyRepo({
      find: jest.fn().mockResolvedValue([{ ownerUserId: 'u-agent', agencyName: 'Bandhan Agency' }]),
    });
    const planners = emptyRepo({
      find: jest.fn().mockResolvedValue([{ ownerUserId: 'u-planner', agencyName: 'Sharma Weddings' }]),
    });
    const { service } = build(repo, { profiles, profileDetails, agencies, planners });

    const page = await service.directory({ page: 1, limit: 25 } as never);
    const byId = Object.fromEntries(
      page.data.map((r) => [
        r.id as string,
        { name: r.name, personName: r.personName, businessName: r.businessName },
      ]),
    );

    expect(byId['u-bride']).toEqual({ name: 'Meera Rao', personName: 'Meera Rao', businessName: null });
    expect(byId['u-agent']).toEqual({
      name: 'Ravi Kumar',
      personName: 'Ravi Kumar',
      businessName: 'Bandhan Agency',
    });
    expect(byId['u-planner']).toEqual({
      name: 'Sharma Weddings',
      personName: null,
      businessName: 'Sharma Weddings',
    });
    expect(byId['u-nobody'].name).toBe('n***@example.org');
    expect(byId['u-phone'].name).toBe('********1111');
    expect(JSON.stringify(page)).not.toContain('nobody@example.org');
    expect(JSON.stringify(page)).not.toContain('9000011111');
  });
});

describe('AdminAccountsService detail pages (WOW-05)', () => {
  const actor = { userId: 'admin-1', role: UserRole.ADMIN } as never;

  it("masks a planner business's contact lines and names the account", async () => {
    const users = emptyRepo({
      findOne: jest.fn().mockResolvedValue({ ...ACCOUNT, role: UserRole.PLANNER }),
    });
    const planners = emptyRepo({
      find: jest.fn().mockResolvedValue([
        {
          id: 'pl1',
          ownerUserId: ACCOUNT.id,
          agencyName: 'Sharma Weddings',
          contactPhone: '+91 99887 76655',
          contactEmail: 'hello@sharma.in',
          servesCities: [],
          packages: [],
        },
      ]),
    });
    const profiles = emptyRepo({
      find: jest.fn().mockResolvedValue([{ id: 'own', userId: ACCOUNT.id, displayName: 'Anil Sharma' }]),
    });
    const { service } = build(users, { planners, profiles });

    const detail = await service.accountDetail(ACCOUNT.id);

    expect(detail.user).toMatchObject({
      name: 'Anil Sharma',
      businessName: 'Sharma Weddings',
      phone: '********3210',
    });
    expect(detail.profiles[0]).toMatchObject({ id: 'own', own: true });
    expect(detail.plannerBusinesses[0]).toMatchObject({
      name: 'Sharma Weddings',
      contactPhone: '********6655',
      contactEmail: 'h***@sharma.in',
      contactMasked: true,
    });
    const json = JSON.stringify(detail);
    expect(json).not.toContain('99887');
    expect(json).not.toContain('hello@sharma.in');
  });

  it("returns the businesses' contact lines with the account reveal, audited once", async () => {
    const users = emptyRepo({ findOne: jest.fn().mockResolvedValue({ ...ACCOUNT }) });
    const vendors = emptyRepo({
      find: jest.fn().mockResolvedValue([{ id: 'v1', contactPhone: '9876500000' }]),
    });
    const planners = emptyRepo({
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'pl1', contactPhone: '9988776655', contactEmail: 'hello@sharma.in' }]),
    });
    const { service, audit } = build(users, { vendors, planners });

    const revealed = await service.revealContact(actor, ACCOUNT.id);

    expect(revealed.businesses).toEqual([{ id: 'v1', contactPhone: '9876500000' }]);
    expect(revealed.plannerBusinesses).toEqual([
      { id: 'pl1', contactPhone: '9988776655', contactEmail: 'hello@sharma.in' },
    ]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].metadata).toEqual({
      fields: ['email', 'phone'],
      businesses: ['v1'],
      plannerBusinesses: ['pl1'],
    });
  });

  it('masks the full profile page: its contact lines and every account around it', async () => {
    const profile = {
      id: 'p1',
      userId: 'owner-1',
      managedByUserId: 'agent-1',
      idVerifiedByUserId: 'officer-1',
      displayName: 'Meera Rao',
      contactEmail: 'meera@example.org',
      contactPhone: '+91 91234 56789',
    };
    const profiles = emptyRepo({ findOne: jest.fn().mockResolvedValue(profile) });
    const accounts: Record<string, unknown> = {
      'owner-1': { id: 'owner-1', email: 'meera.login@example.org', phone: '+919111122222' },
      'agent-1': { id: 'agent-1', email: 'desk@bandhan.in' },
      'officer-1': { id: 'officer-1', email: 'field@wow.in' },
    };
    const users = emptyRepo({
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => accounts[where.id] ?? null),
    });
    const { service } = build(users, { profiles });

    const detail = await service.profileDetail('p1');

    expect(detail.profile).toMatchObject({
      contactEmail: 'm***@example.org',
      contactPhone: '********6789',
      contactMasked: true,
    });
    expect(detail.owner).toMatchObject({ email: 'm***@example.org', phone: '********2222' });
    expect(detail.steward?.email).toBe('d***@bandhan.in');
    expect(detail.verifiedBy?.email).toBe('f***@wow.in');
    const json = JSON.stringify(detail);
    for (const raw of [
      'meera@example.org',
      '91234',
      'meera.login@',
      '9111122222',
      'desk@bandhan.in',
      'field@wow.in',
    ]) {
      expect(json).not.toContain(raw);
    }
  });

  it("reveals a profile's own contact lines through an audited read", async () => {
    const profiles = emptyRepo({
      findOne: jest.fn().mockResolvedValue({
        id: 'p1',
        contactEmail: 'meera@example.org',
        contactPhone: '+91 91234 56789',
      }),
    });
    const { service, audit } = build(emptyRepo(), { profiles });

    await expect(service.revealProfileContact(actor, 'p1')).resolves.toEqual({
      id: 'p1',
      email: 'meera@example.org',
      phone: '+91 91234 56789',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ADMIN_CONTACT_REVEALED,
        actor,
        resourceType: 'profile',
        resourceId: 'p1',
        metadata: { fields: ['contactEmail', 'contactPhone'] },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('meera@example.org');
  });

  it('refuses to reveal a profile that does not exist, and audits nothing', async () => {
    const { service, audit } = build();
    await expect(service.revealProfileContact(actor, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
