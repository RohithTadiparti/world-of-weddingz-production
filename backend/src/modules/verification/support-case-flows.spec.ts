import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportCasesService } from './support-cases.service';
import { SupportCase } from './entities/support-case.entity';
import { BUSINESS_CHANGE_CATEGORY } from './dto/case.dto';
import {
  BusinessStatus,
  CaseStatus,
  CaseSubject,
  NotificationType,
  SettlementOutcome,
  UserRole,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const BIZ = '8f6c1d7e-3b1a-4c2d-9e4f-1a2b3c4d5e6f';
const admin = { userId: 'admin-1', role: UserRole.ADMIN } as AuthUser;
const vendor = { userId: 'vendor-1', role: UserRole.VENDOR } as AuthUser;
const officer = { userId: 'officer-1', role: UserRole.IN_PERSON } as AuthUser;

function supportCase(overrides: Partial<SupportCase> = {}): SupportCase {
  return {
    id: 'case-1',
    subjectType: CaseSubject.VENDOR,
    subjectId: BIZ,
    raisedByUserId: 'vendor-1',
    title: 'Change request: verified business details',
    description: 'We moved premises.',
    status: CaseStatus.OPEN,
    assignedToUserId: null,
    evidence: [],
    findings: null,
    settlementOutcome: null,
    settlementNotes: null,
    resolutionAction: null,
    category: BUSINESS_CHANGE_CATEGORY,
    requestedFields: ['registeredAddress'],
    history: [{ at: '2026-10-01', byUserId: 'vendor-1', status: CaseStatus.OPEN }],
    createdAt: new Date(),
    ...overrides,
  } as SupportCase;
}

/**
 * Support cases end to end through the service (rows 24, 26, 27 and the
 * vendor Support page): every transition, who may make it, and who is told.
 */
function build(row: SupportCase, businessStatus: BusinessStatus = BusinessStatus.LIVE) {
  let current = row;
  const cases = {
    findOne: jest.fn(async () => current),
    save: jest.fn(async (c: SupportCase) => {
      current = { ...c };
      return current;
    }),
    create: jest.fn((c: Partial<SupportCase>) => ({ ...c }) as SupportCase),
  };
  const business = { id: BIZ, ownerUserId: 'vendor-1', status: businessStatus, name: 'Kitchen Co' };
  const vendors = { findOne: jest.fn(async () => business), find: jest.fn(async () => [business]) };
  const planners = { findOne: jest.fn(async () => null), find: jest.fn(async () => []) };
  const empty = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
  const audit = { record: jest.fn() };
  const notifications = { create: jest.fn(async () => ({})), createForRole: jest.fn(async () => 1) };
  const lifecycle = {
    requireCorrection: jest.fn(),
    requireReverification: jest.fn(),
    reopenRejected: jest.fn(),
  };
  const verification = { reopenRejected: jest.fn() };
  const service = new SupportCasesService(
    cases as never,
    empty as never,
    empty as never,
    empty as never,
    vendors as never,
    empty as never,
    planners as never,
    empty as never,
    empty as never,
    empty as never,
    empty as never,
    empty as never,
    empty as never,
    audit as never,
    notifications as never,
    lifecycle as never,
    {} as never,
    verification as never,
  );
  return { service, cases, vendors, audit, notifications, lifecycle, verification, current: () => current };
}

describe('business change requests (rows 24 and 26)', () => {
  it('resolves the request when edit access is granted, and tells the vendor', async () => {
    const t = build(supportCase());
    const saved = await t.service.grantBusinessChangeAccess(admin, 'case-1', { fields: ['registeredAddress'] });
    expect(saved.status).toBe(CaseStatus.RESOLVED);
    expect(saved.resolvedByUserId).toBe('admin-1');
    expect(t.lifecycle.requireCorrection).toHaveBeenCalledWith(BIZ, 'We moved premises.', ['registeredAddress'], admin);
    expect(t.notifications.create).toHaveBeenCalledWith(
      'vendor-1',
      NotificationType.BUSINESS_CHANGE_UPDATE,
      expect.objectContaining({ caseId: 'case-1', status: 'edit_access_granted' }),
    );
  });

  it('cancels an ungranted request, audits it and tells the vendor why', async () => {
    const t = build(supportCase());
    const saved = await t.service.cancelBusinessChange(admin, 'case-1', { reason: 'Not supported for this listing' });
    expect(saved.status).toBe(CaseStatus.CANCELLED);
    expect(saved.history.at(-1)).toEqual(expect.objectContaining({ status: CaseStatus.CANCELLED }));
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'case.cancelled', resourceId: 'case-1' }));
    expect(t.notifications.create).toHaveBeenCalledWith(
      'vendor-1',
      NotificationType.BUSINESS_CHANGE_UPDATE,
      expect.objectContaining({ status: 'cancelled', reason: 'Not supported for this listing' }),
    );
    expect(t.lifecycle.requireCorrection).not.toHaveBeenCalled();
  });

  it('lets only an administrator cancel', async () => {
    const t = build(supportCase());
    await expect(t.service.cancelBusinessChange(vendor, 'case-1', {})).rejects.toThrow(ForbiddenException);
    await expect(t.service.cancelBusinessChange(officer, 'case-1', {})).rejects.toThrow(ForbiddenException);
  });

  it('refuses to cancel once access was granted, or an ordinary case', async () => {
    const granted = build(supportCase({ status: CaseStatus.RESOLVED }));
    await expect(granted.service.cancelBusinessChange(admin, 'case-1', {})).rejects.toThrow(BadRequestException);
    const ordinary = build(supportCase({ category: null }));
    await expect(ordinary.service.cancelBusinessChange(admin, 'case-1', {})).rejects.toThrow(BadRequestException);
  });

  it('does not let a cancelled request be granted afterwards', async () => {
    const t = build(supportCase({ status: CaseStatus.CANCELLED }));
    await expect(
      t.service.grantBusinessChangeAccess(admin, 'case-1', { fields: ['registeredAddress'] }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('the vendor Support page: reply and what the raiser may read', () => {
  const working = () =>
    supportCase({
      category: null,
      requestedFields: null,
      status: CaseStatus.WAITING_FOR_INFORMATION,
      assignedToUserId: 'officer-1',
      findings: 'Officer only: suspect duplicate listing',
      history: [
        { at: '1', byUserId: 'vendor-1', status: CaseStatus.OPEN },
        { at: '2', byUserId: 'admin-1', status: CaseStatus.ALLOCATED, note: 'Give this to someone strict' },
        { at: '3', byUserId: 'officer-1', status: CaseStatus.IN_PROGRESS, note: 'Officer only: suspect duplicate listing' },
        { at: '4', byUserId: 'officer-1', status: CaseStatus.WAITING_FOR_INFORMATION, note: 'Please upload the lease' },
      ],
    });

  it('returns a waiting case to the officer and tells them', async () => {
    const t = build(working());
    const view = await t.service.reply(vendor, 'case-1', { message: 'Lease attached', evidence: ['https://x/lease.pdf'] });
    expect(t.current().status).toBe(CaseStatus.IN_PROGRESS);
    expect(t.current().evidence).toEqual(['https://x/lease.pdf']);
    expect(t.current().history.at(-1)).toEqual(
      expect.objectContaining({ kind: 'reply', note: 'Lease attached', byUserId: 'vendor-1' }),
    );
    expect(t.notifications.create).toHaveBeenCalledWith('officer-1', NotificationType.DISPUTE_UPDATE, expect.any(Object));
    expect(view.findings).toBeNull();
  });

  it('lets only the raiser reply, and not on a finished case', async () => {
    await expect(build(working()).service.reply(officer, 'case-1', { message: 'hi' })).rejects.toThrow(ForbiddenException);
    await expect(
      build(supportCase({ status: CaseStatus.CLOSED })).service.reply(vendor, 'case-1', { message: 'hi' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('never shows the raiser the findings or the desk notes', async () => {
    const t = build(working());
    const view = await t.service.findOne(vendor, 'case-1');
    const text = JSON.stringify(view);
    expect(view.findings).toBeNull();
    expect(text).not.toContain('suspect duplicate');
    expect(text).not.toContain('someone strict');
    expect(text).not.toContain('officer-1');
    // The question put to them is theirs to read.
    expect(text).toContain('Please upload the lease');
  });

  it('shows the assigned officer and an administrator the whole case', async () => {
    expect((await build(working()).service.findOne(officer, 'case-1')).findings).toContain('suspect duplicate');
    expect((await build(working()).service.findOne(admin, 'case-1')).findings).toContain('suspect duplicate');
  });
});

describe('a "My business listing" case about a refused listing (row 27)', () => {
  it('accepts a link to the caller\'s own business', async () => {
    const t = build(supportCase({ category: null }));
    await t.service.raise(vendor, {
      subjectType: CaseSubject.VENDOR,
      subjectId: BIZ,
      title: 'My listing was rejected',
      description: 'Please look at the decision again.',
    });
    expect(t.cases.create).toHaveBeenCalledWith(expect.objectContaining({ subjectId: BIZ, category: null }));
  });

  it('refuses a link to somebody else\'s business, or one that does not exist', async () => {
    const t = build(supportCase());
    const dto = { subjectType: CaseSubject.VENDOR, subjectId: BIZ, title: 'Listing', description: 'Somebody else.' };
    await expect(t.service.raise({ userId: 'stranger', role: UserRole.VENDOR } as AuthUser, dto)).rejects.toThrow(
      ForbiddenException,
    );
    t.vendors.findOne.mockResolvedValueOnce(null as never);
    await expect(t.service.raise(vendor, dto)).rejects.toThrow(NotFoundException);
  });

  it('gives the officer and administrator the complete linked business', async () => {
    const t = build(supportCase({ category: null, assignedToUserId: 'officer-1' }));
    t.vendors.find.mockResolvedValue([
      {
        id: BIZ,
        ownerUserId: 'vendor-1',
        name: 'Kitchen Co',
        status: BusinessStatus.REJECTED,
        registeredAddress: '12 MG Road',
        registrationNumber: 'REG-1',
        contactPhone: '9876543210',
        complianceDocuments: ['https://x/doc.pdf'],
        portfolio: ['https://x/p.jpg'],
        description: 'Caterers',
      },
    ] as never);
    const view = await t.service.findOne(officer, 'case-1');
    expect(view.business).toEqual(
      expect.objectContaining({
        id: BIZ,
        registeredAddress: '12 MG Road',
        registrationNumber: 'REG-1',
        complianceDocuments: ['https://x/doc.pdf'],
        portfolio: ['https://x/p.jpg'],
      }),
    );
  });

  it('turns the officer\'s unlock into a proposal, and the administrator\'s approval reopens the refused listing', async () => {
    const t = build(supportCase({ category: null, status: CaseStatus.IN_PROGRESS, assignedToUserId: 'officer-1' }), BusinessStatus.REJECTED);
    const proposed = await t.service.settle(officer, 'case-1', {
      outcome: SettlementOutcome.NO_ACTION,
      action: 'unlock_listing',
      notes: 'GST certificate was valid; correct the address and resubmit.',
    });
    expect(proposed.status).toBe(CaseStatus.RESOLUTION_SUBMITTED);
    expect(t.lifecycle.reopenRejected).not.toHaveBeenCalled();
    expect(t.notifications.createForRole).toHaveBeenCalledWith(UserRole.ADMIN, NotificationType.DISPUTE_UPDATE, expect.any(Object));

    const approved = await t.service.review(admin, 'case-1', { decision: 'approve' });
    expect(approved.status).toBe(CaseStatus.RESOLVED);
    const reason = 'GST certificate was valid; correct the address and resubmit.';
    expect(t.lifecycle.reopenRejected).toHaveBeenCalledWith(BIZ, reason, admin);
    expect(t.verification.reopenRejected).toHaveBeenCalledWith(admin, BIZ, reason);
  });

  it('unlocks a live listing on an approved "request correction" too', async () => {
    const t = build(supportCase({ category: null, status: CaseStatus.RESOLUTION_SUBMITTED, settlementOutcome: SettlementOutcome.NO_ACTION, resolutionAction: 'request_correction', settlementNotes: 'Fix the address' }));
    await t.service.review(admin, 'case-1', { decision: 'approve' });
    expect(t.lifecycle.requireReverification).toHaveBeenCalledWith(BIZ, 'Fix the address', admin);
  });

  it('sends a proposal back to another officer when the administrator says so', async () => {
    const t = build(supportCase({ category: null, status: CaseStatus.RESOLUTION_SUBMITTED, settlementOutcome: SettlementOutcome.NO_ACTION, resolutionAction: 'unlock_listing', assignedToUserId: 'officer-1' }));
    (t.service as unknown as { users: unknown }).users = {
      findOne: jest.fn(async () => ({ id: 'officer-2', role: UserRole.IN_PERSON, isActive: true })),
      find: jest.fn(async () => []),
    };
    const saved = await t.service.review(admin, 'case-1', { decision: 'reassign', officerUserId: '0b6f0a4e-1111-4222-8333-444455556666', note: 'Look at the documents again' });
    expect(saved.status).toBe(CaseStatus.REASSIGNED);
    expect(saved.resolutionAction).toBeNull();
    expect(t.lifecycle.reopenRejected).not.toHaveBeenCalled();
  });
});
