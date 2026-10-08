import { BadRequestException } from '@nestjs/common';
import { SupportCasesService } from './support-cases.service';
import { SupportCase } from './entities/support-case.entity';
import type { CaseQueryDto } from './dto/case.dto';
import { CaseStatus, CaseSubject, NotificationType, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const officer: AuthUser = {
  userId: 'officer-1',
  email: 'officer@wow.in',
  role: UserRole.IN_PERSON,
  managedByAgentId: null,
};

const stub = {} as never;

/**
 * A builder with the only methods list() touches, answering the rows it is
 * seeded with.
 */
function listBuilder(rows: unknown[] = []) {
  const builder: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'skip', 'take']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.getManyAndCount = jest.fn().mockResolvedValue([rows, rows.length]);
  return builder;
}

const emptyRepo = () => ({ find: jest.fn().mockResolvedValue([]) }) as never;

/**
 * The Support page and the case queue both read GET /verification/cases, so an
 * officer's own raised cases have to be a query on the one endpoint rather than
 * a second one. The scope is what keeps the two apart.
 */
describe('SupportCasesService.list officer scopes', () => {
  it('answers the Support page with the cases the officer raised', async () => {
    const builder = listBuilder([]);
    const service = new SupportCasesService(
      { createQueryBuilder: jest.fn(() => builder) } as never,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub,
    );
    await service.list(officer, { page: 1, limit: 20, scope: 'raised' } as CaseQueryDto);
    expect(builder.where).toHaveBeenCalledWith('c."raisedByUserId" = :me', {
      me: officer.userId,
    });
  });

  it('keeps the allocated queue as the default an officer reads', async () => {
    const builder = listBuilder([]);
    const service = new SupportCasesService(
      { createQueryBuilder: jest.fn(() => builder) } as never,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      stub, stub, stub, stub,
    );
    await service.list(officer, { page: 1, limit: 20 } as CaseQueryDto);
    expect(builder.where).toHaveBeenCalledWith('c."assignedToUserId" = :me', {
      me: officer.userId,
    });
  });
});

/**
 * An officer's proposal is what the complainant is shown as the answer to their
 * problem. The action label says what the officer clicked, not what the person
 * learns, so the note is the message and cannot be left out.
 */
describe('SupportCasesService.settle proposals', () => {
  const caseRow = () =>
    ({
      id: 'case-1',
      title: 'My listing is rejected',
      status: CaseStatus.IN_PROGRESS,
      subjectType: CaseSubject.VENDOR,
      subjectId: null,
      raisedByUserId: 'planner-1',
      assignedToUserId: officer.userId,
      history: [],
      settlementOutcome: null,
      settlementAmount: null,
      settlementNotes: null,
      resolutionAction: null,
    }) as unknown as SupportCase;

  const makeService = (cases: Record<string, unknown>) =>
    new SupportCasesService(
      cases as never,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      { record: jest.fn() } as never,
      { createForRole: jest.fn(), create: jest.fn() } as never,
      stub, stub,
    );

  it('refuses a proposal that says nothing to the person who raised it', async () => {
    const save = jest.fn();
    const service = makeService({ findOne: jest.fn().mockResolvedValue(caseRow()), save });
    await expect(
      service.settle(officer, 'case-1', {
        outcome: 'no_action',
        action: 'request_correction',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the note on the proposal it submits for review', async () => {
    const save = jest.fn(async (x: SupportCase) => x);
    const notifications = { createForRole: jest.fn(), create: jest.fn() };
    const service = new SupportCasesService(
      { findOne: jest.fn().mockResolvedValue(caseRow()), save } as never,
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
      { record: jest.fn() } as never,
      notifications as never,
      stub, stub,
    );
    const out = await service.settle(officer, 'case-1', {
      outcome: 'no_action',
      action: 'request_correction',
      notes: 'The listing was rejected for a missing GST certificate; upload it and resubmit.',
    } as never);
    expect(out.status).toBe(CaseStatus.RESOLUTION_SUBMITTED);
    expect(out.settlementNotes).toBe(
      'The listing was rejected for a missing GST certificate; upload it and resubmit.',
    );
    expect(notifications.createForRole).toHaveBeenCalledWith(
      UserRole.ADMIN,
      NotificationType.DISPUTE_UPDATE,
      expect.objectContaining({ caseId: 'case-1' }),
    );
  });

  it('lets an administrator decide in one step without a note', async () => {
    const admin: AuthUser = {
      userId: 'admin-1',
      email: 'admin@wow.in',
      role: UserRole.ADMIN,
      managedByAgentId: null,
    };
    const save = jest.fn(async (x: SupportCase) => x);
    const service = makeService({ findOne: jest.fn().mockResolvedValue(caseRow()), save });
    const out = await service.settle(admin, 'case-1', {
      outcome: 'no_action',
    } as never);
    expect(out.status).toBe(CaseStatus.RESOLVED);
    expect(save).toHaveBeenCalled();
  });
});

/**
 * "My business listing" is offered to planners as well as vendors, but the
 * listing context was resolved only from the vendor table, so a planner's case
 * reached the officer with nothing about the business it was raised over.
 */
describe('SupportCasesService listing context', () => {
  const listingCase = (raisedBy: string) =>
    ({
      id: 'case-9',
      title: 'My listing is rejected',
      status: CaseStatus.IN_PROGRESS,
      subjectType: CaseSubject.VENDOR,
      subjectId: null,
      raisedByUserId: raisedBy,
      assignedToUserId: officer.userId,
      history: [],
    }) as unknown as SupportCase;

  const makeService = (planners: unknown[], vendors: unknown[]) => {
    const rows = [listingCase('planner-1')];
    const builder = listBuilder(rows);
    return new SupportCasesService(
      { createQueryBuilder: jest.fn(() => builder) } as never,
      emptyRepo(), // users
      emptyRepo(), // payments
      emptyRepo(), // bookings
      { find: jest.fn().mockResolvedValue(vendors) } as never,
      emptyRepo(), // slots
      { find: jest.fn().mockResolvedValue(planners) } as never,
      emptyRepo(), // profiles
      stub, // availability
      emptyRepo(), // agencies
      stub, stub, stub,
      stub, stub, stub, stub,
    );
  };

  it('shows the planner agency on a listing case raised by a planner', async () => {
    const service = makeService(
      [
        {
          id: 'planner-profile-1',
          ownerUserId: 'planner-1',
          agencyName: 'Bhanu Weddings',
          city: 'Hyderabad',
          isApproved: false,
          services: ['full_planning'],
        },
      ],
      [],
    );
    const page = await service.list(officer, { page: 1, limit: 20 } as CaseQueryDto);
    expect(page.data[0].business).toMatchObject({
      id: 'planner-profile-1',
      name: 'Bhanu Weddings',
      city: 'Hyderabad',
      isApproved: false,
    });
  });

  it('still shows the vendor business a vendor raised the case about', async () => {
    const service = makeService(
      [],
      [
        {
          id: 'vendor-1',
          ownerUserId: 'planner-1',
          name: 'Sri Caterers',
          category: 'catering',
          categories: [],
          city: 'Hyderabad',
          status: 'approved',
          isApproved: true,
        },
      ],
    );
    const page = await service.list(officer, { page: 1, limit: 20 } as CaseQueryDto);
    expect(page.data[0].business).toMatchObject({ id: 'vendor-1', name: 'Sri Caterers' });
  });
});
