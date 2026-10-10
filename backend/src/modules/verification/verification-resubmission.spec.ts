import { BadRequestException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationRequest } from './entities/verification-request.entity';
import {
  ApplicantType,
  BusinessStatus,
  NotificationType,
  UserRole,
  VerificationStatus,
} from '../../common/enums';

const admin = { userId: 'admin-1', role: UserRole.ADMIN } as never;
const vendorActor = { userId: 'vendor-1', role: UserRole.VENDOR } as never;

function request(overrides: Partial<VerificationRequest> = {}): VerificationRequest {
  return {
    id: 'req-1',
    applicantType: ApplicantType.VENDOR,
    applicantUserId: 'vendor-1',
    subjectId: 'biz-1',
    status: VerificationStatus.SUBMITTED,
    assignedToUserId: 'officer-1',
    previousOfficerUserId: null,
    allocatedByUserId: 'admin-1',
    allocatedAt: new Date(),
    findings: { visited: true, observations: 'Kitchen seen', issues: ['GST mismatch'], evidence: [], recommendation: 'revisit' },
    remarks: null,
    history: [],
    revisitCount: 0,
    slaDeadline: new Date(Date.now() - 1000),
    slaBreachedAt: null,
    verificationStartedAt: new Date(),
    ...overrides,
  } as VerificationRequest;
}

/**
 * The vendor verification cycle after a send-back (rows 11, 23, 25).
 *
 * Built by hand rather than through Nest so every collaborator the rule
 * touches is visible in the test.
 */
function build(row: VerificationRequest, businessStatus = BusinessStatus.PENDING_VERIFICATION) {
  let current = row;
  const requests = {
    findOne: jest.fn(async () => current),
    save: jest.fn(async (r: VerificationRequest) => {
      current = { ...r };
      return current;
    }),
  };
  const vendors = { findOne: jest.fn(async () => ({ id: 'biz-1', status: businessStatus, city: null })) };
  const users = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id.startsWith('officer')
        ? { id: where.id, role: UserRole.IN_PERSON, isActive: true }
        : { id: where.id, email: 'vendor@gmail.com' },
    ),
    find: jest.fn(async () => [{ id: 'officer-1' }, { id: 'officer-2' }]),
  };
  const availability = { findOne: jest.fn(async () => null), find: jest.fn(async () => []) };
  const areas = { find: jest.fn(async () => []) };
  const audit = { record: jest.fn() };
  const notifications = { create: jest.fn(async () => ({})), createForRole: jest.fn(async () => 1) };
  const mail = { sendVerificationOutcome: jest.fn() };
  const cfg = { verification: { slaHours: 72 } };
  const lifecycle = {
    canDecide: jest.fn(async () => ({ ok: true, reason: null })),
    requireCorrection: jest.fn(),
    requireReverification: jest.fn(),
    awaitAnotherReview: jest.fn(),
    reject: jest.fn(),
    approve: jest.fn(),
    markInProgress: jest.fn(),
  };
  const service = new (VerificationService as unknown as new (...args: unknown[]) => VerificationService)(
    requests,
    areas,
    availability,
    users,
    {},
    vendors,
    {},
    audit,
    notifications,
    mail,
    cfg,
    lifecycle,
    {},
  );
  // workload() reads a query builder; officers with no work rank equally.
  (requests as unknown as { createQueryBuilder: unknown }).createQueryBuilder = () => {
    const qb = {
      select: () => qb,
      addSelect: () => qb,
      where: () => qb,
      groupBy: () => qb,
      addGroupBy: () => qb,
      getRawMany: async () => [],
    };
    return qb;
  };
  return { service, requests, vendors, notifications, lifecycle, audit, mail, current: () => current };
}

const progressCalls = (notifications: { create: jest.Mock }) =>
  notifications.create.mock.calls.filter((c) => c[1] === NotificationType.VERIFICATION_PROGRESS);

describe('requesting changes from the vendor', () => {
  it('takes the request off the previous officer and stops the SLA clock', async () => {
    const t = build(request());
    await t.service.requestCorrection(admin, 'req-1', { fields: ['gstNumber'], reason: 'GST does not match' } as never);
    const saved = t.current();
    expect(saved.status).toBe(VerificationStatus.ADDITIONAL_REVIEW);
    expect(saved.assignedToUserId).toBeNull();
    expect(saved.previousOfficerUserId).toBe('officer-1');
    expect(saved.findings).toBeNull();
    expect(saved.slaDeadline).toBeNull();
    expect(t.lifecycle.canDecide).toHaveBeenCalledWith('biz-1', 'correct');
    // The correction reason is written for the vendor, so they may read it.
    expect((await t.service.myStatus('vendor-1')).remarks).toBe('GST does not match');
  });
});

describe('resubmission after corrections (rows 23 and 25)', () => {
  const parked = () =>
    request({
      status: VerificationStatus.ADDITIONAL_REVIEW,
      assignedToUserId: 'officer-1',
      findings: null,
      history: [{ at: 'x', byUserId: 'admin-1', status: 'additional_review', remarks: 'Correction requested (gstNumber): fix' }],
    });

  it('recognises a parked request as awaiting resubmission', () => {
    const t = build(parked());
    expect(t.service.isAwaitingResubmission(parked())).toBe(true);
    expect(t.service.isAwaitingResubmission(request({ status: VerificationStatus.NEW }))).toBe(false);
  });

  it('returns it to NEW, unassigned, for a fresh allocation and tells the administrators', async () => {
    const t = build(parked());
    const saved = await t.service.markResubmitted('req-1', vendorActor, 'Kitchen Co');
    expect(saved.status).toBe(VerificationStatus.NEW);
    expect(saved.assignedToUserId).toBeNull();
    expect(saved.allocatedByUserId).toBeNull();
    expect(saved.previousOfficerUserId).toBe('officer-1');
    expect(saved.slaDeadline).toBeNull();
    expect(saved.history.at(-1)?.status).toBe(VerificationStatus.NEW);
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.resubmitted' }));
    expect(t.notifications.createForRole).toHaveBeenCalledWith(
      UserRole.ADMIN,
      NotificationType.VERIFICATION_REQUESTED,
      expect.objectContaining({ requestId: 'req-1', resubmitted: true, awaitingAllocation: true }),
    );
  });

  it('leaves a request that is not parked alone', async () => {
    const t = build(request({ status: VerificationStatus.NEW, assignedToUserId: null }));
    await t.service.markResubmitted('req-1', vendorActor);
    expect(t.requests.save).not.toHaveBeenCalled();
  });

  it('refuses to allocate while the vendor is still editing', async () => {
    const t = build(parked(), BusinessStatus.REVERIFICATION_REQUIRED);
    await expect(t.service.allocate(admin, 'req-1', {} as never)).rejects.toThrow(BadRequestException);
  });

  it('never auto-allocates the resubmission back to the previous officer', async () => {
    const t = build(
      request({ status: VerificationStatus.NEW, assignedToUserId: null, previousOfficerUserId: 'officer-1', findings: null }),
    );
    const saved = await t.service.allocate(admin, 'req-1', {} as never);
    expect(saved.assignedToUserId).toBe('officer-2');
    expect(saved.status).toBe(VerificationStatus.ASSIGNED);
  });
});

describe('tracking notifications for the vendor (row 11)', () => {
  it('says an officer was assigned without naming them or passing on the note', async () => {
    const t = build(request({ status: VerificationStatus.NEW, assignedToUserId: null, findings: null }));
    await t.service.allocate(admin, 'req-1', { officerUserId: 'officer-2', note: 'Internal: check the back room' } as never);
    const [call] = progressCalls(t.notifications);
    expect(call[0]).toBe('vendor-1');
    expect(call[2]).toEqual({ requestId: 'req-1', businessId: 'biz-1', applicantType: 'vendor', stage: 'officer_assigned' });
    expect(JSON.stringify(call[2])).not.toContain('officer-2');
    expect(JSON.stringify(call[2])).not.toContain('back room');
  });

  it('says the visit is with an administrator without the findings or recommendation', async () => {
    const t = build(request({ status: VerificationStatus.IN_PROGRESS, findings: null }));
    await t.service.submitFindings({ userId: 'officer-1', role: UserRole.IN_PERSON } as never, 'req-1', {
      visited: true,
      observations: 'The premises do not match the address',
      issues: ['Address mismatch'],
      recommendation: 'reject',
    } as never);
    const [call] = progressCalls(t.notifications);
    expect(call[2]).toEqual(expect.objectContaining({ stage: 'findings_submitted' }));
    const text = JSON.stringify(call[2]);
    expect(text).not.toContain('premises');
    expect(text).not.toContain('reject');
    expect(text).not.toContain('Address mismatch');
  });

  it('treats another review as a locked revisit with an internal remark', async () => {
    const t = build(request({ status: VerificationStatus.ADMIN_REVIEW }));
    await t.service.decide(admin, 'req-1', {
      status: VerificationStatus.ADDITIONAL_REVIEW,
      remarks: 'Officer seemed rushed, send someone senior',
    } as never);
    expect(t.lifecycle.awaitAnotherReview).toHaveBeenCalledWith('biz-1');
    expect(t.lifecycle.requireReverification).not.toHaveBeenCalled();
    const [call] = progressCalls(t.notifications);
    expect(call[2]).toEqual(expect.objectContaining({ stage: 'additional_review' }));
    expect(JSON.stringify(t.notifications.create.mock.calls)).not.toContain('rushed');
    expect(t.mail.sendVerificationOutcome).not.toHaveBeenCalled();
    expect((await t.service.myStatus('vendor-1')).remarks).toBeNull();
    // A fresh clock for the new visit.
    expect(t.current().slaDeadline).not.toBeNull();
  });

  it('still gives a rejection reason to the applicant', async () => {
    const t = build(request({ status: VerificationStatus.ADMIN_REVIEW }));
    await t.service.decide(admin, 'req-1', {
      status: VerificationStatus.REJECTED,
      remarks: 'The business could not be found at the address',
    } as never);
    expect((await t.service.myStatus('vendor-1')).remarks).toBe('The business could not be found at the address');
  });
});

describe('reopening a refused request through support (row 27)', () => {
  it('parks the refused request on the vendor so it can be resubmitted', async () => {
    const t = build(request({ status: VerificationStatus.REJECTED }));
    const saved = await t.service.reopenRejected(admin, 'biz-1', 'Documents re-checked, please correct GST');
    expect(saved?.status).toBe(VerificationStatus.ADDITIONAL_REVIEW);
    expect(saved?.assignedToUserId).toBeNull();
    expect(t.service.isAwaitingResubmission(saved!)).toBe(true);
    expect(t.service.isApplicantFacing(saved!)).toBe(true);
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.reopened' }));
  });
});
