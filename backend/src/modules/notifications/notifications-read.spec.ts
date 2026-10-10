import { NotificationsService } from './notifications.service';
import { NOTIFICATION_TARGET } from './notification-targets';
import { DELIVERY } from './notification-delivery';
import { NotificationType } from '../../common/enums';

/**
 * The badge and the feed describe the same rows (row 22), every read is
 * signalled to the reader's open clients, and the new verification types point
 * at the right place (rows 11 and 21b).
 */
describe('reading notifications', () => {
  const row = (id: string, isRead: boolean, at: string) => ({
    id,
    isRead,
    createdAt: new Date(at),
    targetModule: 'verification',
    targetAction: 'view',
    targetId: null,
  });

  function build(rows: ReturnType<typeof row>[]) {
    const repo = {
      find: jest.fn(async ({ where }: { where: { isRead?: boolean } }) =>
        where.isRead === false ? rows.filter((r) => !r.isRead) : rows.slice(0, 2),
      ),
      count: jest.fn(async () => rows.filter((r) => !r.isRead).length),
      update: jest.fn(async () => ({ affected: 3 })),
      save: jest.fn(async (r: object) => ({ ...r, id: 'n-new' })),
      create: jest.fn((r: object) => r),
    };
    const gateway = { changed: jest.fn() };
    const service = new NotificationsService(
      repo as never,
      { findOne: jest.fn() } as never,
      { find: jest.fn(async () => []) } as never,
      { sendToUser: jest.fn(async () => ({})) } as never,
      { send: jest.fn() } as never,
      gateway as never,
    );
    return { service, repo, gateway };
  }

  it('lists every unread row, not only the newest hundred', async () => {
    const rows = [
      row('a', true, '2026-10-05'),
      row('b', true, '2026-10-04'),
      row('old-unread', false, '2026-01-01'),
    ];
    const { service } = build(rows);
    const listed = await service.listForUser('u1');
    expect(listed.map((n) => n.id)).toEqual(['a', 'b', 'old-unread']);
  });

  it('reads everything about one subject at once and reports the new count', async () => {
    const { service, repo, gateway } = build([row('x', true, '2026-10-01')]);
    const result = await service.markTargetRead('u1', 'booking-1');
    expect(repo.update).toHaveBeenCalledWith(
      { userId: 'u1', targetId: 'booking-1', isRead: false },
      { isRead: true },
    );
    expect(result).toEqual({ success: true, marked: 3, unread: 0 });
    expect(gateway.changed).toHaveBeenCalledWith('u1', { reason: 'read' });
  });

  it('scopes a single read to the caller and returns the count', async () => {
    const { service, repo } = build([row('x', false, '2026-10-01')]);
    const result = await service.markRead('u1', 'n-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'n-1', userId: 'u1' }, { isRead: true });
    expect(result.unread).toBe(1);
  });

  it('tells the reader\'s open clients when a notification is written', async () => {
    const { service, gateway } = build([]);
    await service.create('u1', NotificationType.VERIFICATION_PROGRESS, { businessId: 'b', stage: 'officer_assigned' });
    expect(gateway.changed).toHaveBeenCalledWith('u1', { reason: 'created' });
  });

  it('still writes the notification without a socket gateway', async () => {
    const { repo } = build([]);
    const bare = new NotificationsService(
      repo as never,
      {} as never,
      {} as never,
      { sendToUser: jest.fn(async () => ({})) } as never,
      {} as never,
    );
    await expect(bare.create('u1', NotificationType.DISPUTE_UPDATE, { caseId: 'c' })).resolves.toBeDefined();
  });
});

describe('verification and business change notification types', () => {
  it('opens the applicant\'s listing for a verification update', () => {
    expect(NOTIFICATION_TARGET[NotificationType.VERIFICATION_PROGRESS]).toEqual({
      module: 'verification',
      action: 'view',
      idKey: 'businessId',
    });
  });

  it('opens the change request for a business change update', () => {
    expect(NOTIFICATION_TARGET[NotificationType.BUSINESS_CHANGE_UPDATE]).toEqual({
      module: 'support',
      action: 'view',
      idKey: 'caseId',
    });
  });

  it('reads as status only, never findings', () => {
    const body = DELIVERY[NotificationType.VERIFICATION_PROGRESS].body;
    expect(body({ stage: 'findings_submitted', findings: 'secret' })).toBe(
      'The verification visit is complete and is with an administrator for a decision.',
    );
    expect(body({ stage: 'unknown' })).toBe('There is an update on your verification.');
    expect(DELIVERY[NotificationType.BUSINESS_CHANGE_UPDATE].body({ status: 'cancelled', reason: 'Duplicate' })).toBe(
      'Your business change request was cancelled. Reason: Duplicate',
    );
  });
});
