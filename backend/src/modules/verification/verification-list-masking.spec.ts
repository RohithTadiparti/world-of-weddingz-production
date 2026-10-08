import { VerificationService } from './verification.service';
import { SupportCasesService } from './support-cases.service';
import { OfficersService } from './officers.service';
import { ApplicantType, UserRole } from '../../common/enums';

/**
 * The whole-queue views are administrator lists, so contact details on them
 * are masked (ISS-11). An officer's own queue keeps them whole: the officer is
 * the one who has to ring the applicant to arrange the visit.
 */

function listBuilder(rows: unknown[]) {
  const builder: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'skip', 'take']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.getManyAndCount = jest.fn().mockResolvedValue([rows, rows.length]);
  return builder;
}

describe('VerificationService.list', () => {
  function build() {
    const requests = {
      createQueryBuilder: jest.fn(() =>
        listBuilder([
          { id: 'r1', applicantUserId: 'u1', applicantType: ApplicantType.VENDOR, subjectId: null },
        ]),
      ),
    };
    const users = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'u1', email: 'vendor@caterers.in', phone: '9876543210' }]),
    };
    const none = { find: jest.fn().mockResolvedValue([]) };
    return new (VerificationService as unknown as new (...args: unknown[]) => VerificationService)(
      requests,
      {},
      {},
      users,
      none,
      none,
      none,
      ...Array(6).fill({}),
    );
  }

  it('masks the applicant contact for an administrator', async () => {
    const page = await build().list(
      { userId: 'admin-1', role: UserRole.ADMIN } as never,
      { page: 1, limit: 20 } as never,
    );
    expect(page.data[0]).toMatchObject({
      applicantEmail: 'v***@caterers.in',
      applicantPhone: '******3210',
    });
  });

  it("keeps it whole on an officer's own queue", async () => {
    const page = await build().list(
      { userId: 'officer-1', role: UserRole.IN_PERSON } as never,
      { page: 1, limit: 20 } as never,
    );
    expect(page.data[0]).toMatchObject({
      applicantEmail: 'vendor@caterers.in',
      applicantPhone: '9876543210',
    });
  });
});

describe('SupportCasesService.list', () => {
  function build() {
    const cases = { createQueryBuilder: jest.fn(() => listBuilder([{ id: 'c1' }])) };
    const service = new (SupportCasesService as unknown as new (
      ...args: unknown[]
    ) => SupportCasesService)(cases, ...Array(20).fill({}));
    jest.spyOn(service as never, 'withContext' as never).mockImplementation((async (
      rows: { id: string }[],
    ) =>
      rows.map((row) => ({
        ...row,
        createdAt: new Date(0),
        // A nameless raiser is named by their email.
        raisedByName: 'raiser@example.org',
        raisedByEmail: 'raiser@example.org',
        account: { email: 'raiser@example.org', role: 'bride', isActive: true },
        business: { name: 'Sri Caterers', contactPhone: '9876543210' },
      }))) as never);
    return service;
  }

  it('masks every contact detail on the all-cases list for an administrator', async () => {
    const page = await build().list(
      { userId: 'admin-1', role: UserRole.ADMIN } as never,
      { page: 1, limit: 20 } as never,
    );
    const row = page.data[0] as unknown as {
      raisedByEmail: string;
      raisedByName: string;
      account: { email: string };
      business: unknown;
      createdAt: Date;
    };
    expect(row.raisedByEmail).toBe('r***@example.org');
    expect(row.raisedByName).toBe('r***@example.org');
    expect(row.account.email).toBe('r***@example.org');
    expect(row.business).toEqual({ name: 'Sri Caterers', contactPhone: '******3210' });
    expect(row.createdAt).toEqual(new Date(0));
  });

  it('leaves the officer queue unmasked', async () => {
    const page = await build().list(
      { userId: 'officer-1', role: UserRole.IN_PERSON } as never,
      { page: 1, limit: 20 } as never,
    );
    expect((page.data[0] as unknown as Record<string, unknown>).raisedByEmail).toBe(
      'raiser@example.org',
    );
  });
});

describe('OfficersService.list', () => {
  it('masks the roster, including a name that falls back to the email', async () => {
    const users = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'o1',
          email: 'field.one@wow.in',
          phone: '+91 98765 43210',
          isActive: true,
          role: UserRole.IN_PERSON,
          createdAt: new Date(0),
        },
      ]),
    };
    const none = { find: jest.fn().mockResolvedValue([]) };
    const service = new OfficersService(
      users as never,
      none as never,
      none as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const [officer] = await service.list();
    expect(officer).toMatchObject({
      id: 'o1',
      email: 'f***@wow.in',
      phone: '********3210',
      name: 'f***@wow.in',
    });
  });
});
