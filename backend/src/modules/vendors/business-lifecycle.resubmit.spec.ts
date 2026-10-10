import { BusinessLifecycleService } from './business-lifecycle.service';
import { canTransition } from './business-lifecycle';
import { BusinessStatus, NotificationType, UserRole, VerificationStatus } from '../../common/enums';

const vendor = { userId: 'vendor-1', role: UserRole.VENDOR } as never;
const admin = { userId: 'admin-1', role: UserRole.ADMIN } as never;

/**
 * Resubmission after a send-back, another review, and reopening a refused
 * listing (rows 11, 23, 25 and 27), at the one writer of a business's status.
 */
function build(status: BusinessStatus, requestStatus = VerificationStatus.ADDITIONAL_REVIEW) {
  const business = {
    id: 'biz-1',
    ownerUserId: 'vendor-1',
    name: 'Kitchen Co',
    status,
    revisionCount: 1,
    categories: ['catering'],
    city: 'Hyderabad',
    registeredAddress: '12 MG Road',
    tradingSince: '2019-04-01',
    panNumber: 'ABCDE1234F',
    contactPhone: '9876543210',
    complianceDocuments: ['https://x/doc.pdf'],
    portfolio: ['https://x/p.jpg'],
    archivedAt: new Date(),
    decisionReason: 'Refused',
  };
  const vendors = { findOne: jest.fn(async () => business), save: jest.fn(async (b: object) => b) };
  const services = { find: jest.fn(async () => [{ id: 'svc-1', definitionId: 'd-buffet', displayName: null, active: true }]) };
  const offerings = { find: jest.fn(async () => [{ vendorServiceId: 'svc-1', active: true }]) };
  const verification = {
    raise: jest.fn(async () => ({ id: 'req-1', status: requestStatus })),
    isAwaitingResubmission: jest.fn(
      (r: { status: VerificationStatus }) =>
        r.status === VerificationStatus.ADDITIONAL_REVIEW || r.status === VerificationStatus.ISSUE,
    ),
    markResubmitted: jest.fn(async () => ({ id: 'req-1', status: VerificationStatus.NEW })),
    startSla: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const notifications = { create: jest.fn() };
  const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() };
  const service = new BusinessLifecycleService(
    vendors as never,
    services as never,
    offerings as never,
    verification as never,
    audit as never,
    notifications as never,
    redis as never,
    { find: jest.fn(async () => [{ id: 'c-catering', slug: 'catering', name: 'Catering' }]) } as never,
    { find: jest.fn(async () => [{ id: 'd-buffet', categoryId: 'c-catering', name: 'Buffet' }]) } as never,
  );
  return { service, business, verification, notifications, audit };
}

describe('resubmitting a listing that was sent back', () => {
  it('moves it to awaiting verification in one step and hands it back for fresh allocation', async () => {
    const t = build(BusinessStatus.REVERIFICATION_REQUIRED);
    const result = await t.service.submitForVerification(vendor, 'biz-1');
    expect(result.status).toBe(BusinessStatus.PENDING_VERIFICATION);
    expect(t.verification.markResubmitted).toHaveBeenCalledWith('req-1', vendor, 'Kitchen Co');
    expect(t.verification.startSla).toHaveBeenCalledWith('req-1');
    expect(t.notifications.create).toHaveBeenCalledWith('vendor-1', NotificationType.VERIFICATION_PROGRESS, {
      businessId: 'biz-1',
      requestId: 'req-1',
      stage: 'resubmitted',
    });
  });

  it('does not touch a fresh request on a first submission', async () => {
    const t = build(BusinessStatus.FIRST_REVIEW, VerificationStatus.NEW);
    await t.service.submitForVerification(vendor, 'biz-1');
    expect(t.verification.markResubmitted).not.toHaveBeenCalled();
    expect(t.notifications.create).toHaveBeenCalledWith(
      'vendor-1',
      NotificationType.VERIFICATION_PROGRESS,
      expect.objectContaining({ stage: 'submitted' }),
    );
  });
});

describe('another review', () => {
  it('keeps the listing locked and back at awaiting verification', async () => {
    const t = build(BusinessStatus.VERIFICATION_IN_PROGRESS);
    await t.service.awaitAnotherReview('biz-1');
    expect(t.business.status).toBe(BusinessStatus.PENDING_VERIFICATION);
    expect(t.notifications.create).not.toHaveBeenCalled();
  });

  it('is a decision the lifecycle allows from a pending or in-progress listing', async () => {
    expect(await build(BusinessStatus.PENDING_VERIFICATION).service.canDecide('biz-1', 'revisit')).toEqual({ ok: true, reason: null });
    expect(await build(BusinessStatus.VERIFICATION_IN_PROGRESS).service.canDecide('biz-1', 'revisit')).toEqual({ ok: true, reason: null });
    expect((await build(BusinessStatus.VERIFICATION_IN_PROGRESS).service.canDecide('biz-1', 'correct')).ok).toBe(true);
    expect(canTransition(BusinessStatus.VERIFICATION_IN_PROGRESS, BusinessStatus.PENDING_VERIFICATION)).toBe(true);
  });
});

describe('reopening a refused listing through support', () => {
  it('returns it to the vendor for correction, un-archived, and tells them', async () => {
    const t = build(BusinessStatus.REJECTED);
    await t.service.reopenRejected('biz-1', 'Correct the address and resubmit', admin);
    expect(t.business.status).toBe(BusinessStatus.REVERIFICATION_REQUIRED);
    expect(t.business.archivedAt).toBeNull();
    expect(t.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ via: 'support_case_unlock' }) }),
    );
    expect(t.notifications.create).toHaveBeenCalledWith(
      'vendor-1',
      NotificationType.VERIFICATION_DECIDED,
      expect.objectContaining({ status: BusinessStatus.REVERIFICATION_REQUIRED }),
    );
  });

  it('leaves a listing that is not refused alone', async () => {
    const t = build(BusinessStatus.LIVE);
    expect(await t.service.reopenRejected('biz-1', 'x', admin)).toBeNull();
    expect(t.business.status).toBe(BusinessStatus.LIVE);
  });

  it('is still not a move any other path can make', () => {
    expect(canTransition(BusinessStatus.REJECTED, BusinessStatus.REVERIFICATION_REQUIRED)).toBe(false);
  });
});
