import { SharingService } from './sharing.service';
import { ProfileLifecycle, ProfileVisibility, UserRole } from '../../common/enums';

/**
 * Shared With Me names the agency a profile came from and when (WOW-07). The
 * sharing agency's mobile and email are not the recipient's to see.
 */
describe('SharingService.sharedWithMe', () => {
  const repo = (rows: unknown[]) => ({ find: jest.fn().mockResolvedValue(rows) });

  function build(agencies: unknown[]) {
    const shares = repo([
      {
        id: 's1',
        profileId: 'p1',
        sharedByUserId: 'agent-a',
        recipientUserId: 'me',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    ]);
    const profiles = repo([
      {
        id: 'p1',
        lifecycle: ProfileLifecycle.ACTIVE,
        visibility: ProfileVisibility.PUBLIC,
      },
    ]);
    const users = repo([{ id: 'agent-a', email: 'desk@bandhan.in', phone: '+919876543210' }]);
    const service = new SharingService(
      shares as never,
      profiles as never,
      users as never,
      repo(agencies) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, users };
  }

  const actor = { userId: 'me', role: UserRole.AGENT } as never;

  it('names the sharing agency and nothing to contact it by', async () => {
    const { service, users } = build([
      {
        ownerUserId: 'agent-a',
        agencyName: 'Bandhan Agency',
        city: 'Hyderabad',
        contactPhone: '+919876543210',
      },
    ]);

    const rows = await service.sharedWithMe(actor);

    expect(rows).toHaveLength(1);
    expect(rows[0].sharedBy).toEqual({ agencyName: 'Bandhan Agency' });
    expect(rows[0].share.createdAt).toEqual(new Date('2026-10-01T00:00:00Z'));
    const json = JSON.stringify(rows.map((r) => r.sharedBy));
    expect(json).not.toContain('9876543210');
    expect(json).not.toContain('desk@bandhan.in');
    // The sharer's login is not even read.
    expect(users.find.mock.calls[0][0].select).toEqual(['id']);
  });

  it('falls back to no agency name, never to the sharer email', async () => {
    const { service } = build([]);
    const rows = await service.sharedWithMe(actor);
    expect(rows[0].sharedBy).toEqual({ agencyName: null });
  });
});
