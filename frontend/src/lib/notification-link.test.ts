import { describe, expect, it } from 'vitest';
import { notificationLink } from './notification-link';
import { describe as describeNotification, TYPE_LABEL, type Notification } from './notification-copy';

const CASE = '11111111-1111-4111-8111-111111111111';
const BIZ = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const BOOKING = '44444444-4444-4444-8444-444444444444';

const note = (type: string, targetModule: string | null, targetId: string | null, payload = {}): Notification => ({
  id: 'n1',
  type,
  payload,
  targetModule,
  targetAction: 'view',
  targetId,
  isRead: false,
  createdAt: '2026-10-09T10:00:00Z',
});

const admin = { canAllocate: true };
const officer = { canFieldwork: true };

/** Every bell row opens the item it is about (row 21b). */
describe('notification links', () => {
  it('opens a support case on the case, for each reader', () => {
    const n = note('dispute_update', 'support', CASE);
    expect(notificationLink(n)).toBe(`/support?case=${CASE}`);
    expect(notificationLink(n, officer)).toBe(`/cases?case=${CASE}`);
    expect(notificationLink(n, admin)).toBe(`/admin/support?tab=cases&case=${CASE}`);
  });

  it('opens a business change update on the request', () => {
    expect(notificationLink(note('business_change_update', 'support', CASE))).toBe(`/support?case=${CASE}`);
  });

  it('opens a booking with it highlighted', () => {
    expect(notificationLink(note('booking_request', 'bookings', BOOKING))).toBe(`/bookings?highlight=${BOOKING}`);
  });

  it('sends a verification decision or update to the applicant\'s own listing', () => {
    expect(notificationLink(note('verification_progress', 'verification', BIZ, { requestId: REQ }))).toBe(
      `/console?business=${BIZ}`,
    );
    expect(notificationLink(note('verification_decided', 'verification', BIZ))).toBe(`/console?business=${BIZ}`);
  });

  it('opens the visit itself for staff', () => {
    expect(notificationLink(note('verification_assigned', 'verification', REQ), officer)).toBe(
      `/verification?request=${REQ}`,
    );
    expect(notificationLink(note('verification_submitted', 'verification', REQ), admin)).toBe(
      `/verification?request=${REQ}`,
    );
  });

  it('never falls back to the generic notifications page for a known module', () => {
    for (const module of ['bookings', 'quotations', 'support', 'verification', 'chat', 'events', 'matches', 'planner']) {
      expect(notificationLink(note('x', module, null))).not.toBe('/notifications');
      expect(notificationLink(note('x', module, null))).not.toBeNull();
    }
  });

  it('still routes rows written before targets were stamped', () => {
    expect(notificationLink(note('dispute_update', null, null, { caseId: CASE }))).toBe(`/support?case=${CASE}`);
    expect(notificationLink(note('booking_paid', null, null, { bookingId: BOOKING }))).toBe(`/bookings?highlight=${BOOKING}`);
  });
});

/** Vendor tracking copy (row 11): status only. */
describe('verification tracking copy', () => {
  it('labels and describes the new types', () => {
    expect(TYPE_LABEL.verification_progress).toBe('Verification update');
    expect(TYPE_LABEL.business_change_update).toBe('Business change request');
    expect(describeNotification(note('verification_progress', 'verification', BIZ, { stage: 'officer_assigned' }))).toBe(
      'A verification officer has been assigned to your listing.',
    );
    expect(describeNotification(note('verification_progress', 'verification', BIZ, { stage: 'nope' }))).toBe(
      'There is an update on your verification.',
    );
  });

  it('describes a business change request outcome', () => {
    expect(
      describeNotification(note('business_change_update', 'support', CASE, { status: 'cancelled', reason: 'Duplicate' })),
    ).toBe('Your business change request was cancelled. Reason: Duplicate');
    expect(describeNotification(note('business_change_update', 'support', CASE, { status: 'edit_access_granted' }))).toBe(
      'Edit access was granted. Update the approved details and submit them for verification.',
    );
  });

  it('words decisions in the applicant\'s terms', () => {
    expect(describeNotification(note('verification_decided', 'verification', BIZ, { status: 'live' }))).toBe(
      'Your listing was approved and is now live.',
    );
    expect(
      describeNotification(
        note('verification_decided', 'verification', BIZ, { status: 'reverification_required', reason: 'Fix GST' }),
      ),
    ).toBe('Changes were requested on your listing. Update it and submit it again. Reason: Fix GST');
  });

  it('tells an administrator a resubmission needs a new officer', () => {
    expect(
      describeNotification(
        note('verification_requested', 'verification', REQ, { subjectName: 'Kitchen Co', resubmitted: true }),
      ),
    ).toBe('Kitchen Co has resubmitted after corrections and is waiting for a new officer to be allocated.');
  });
});
