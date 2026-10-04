import { describe, expect, it } from 'vitest';
import { Notification, describe as describeNotification } from './notification-copy';

const row = (type: string, payload: Record<string, unknown>): Notification => ({
  id: 'n1',
  type,
  payload,
  targetModule: 'matches',
  targetAction: 'view',
  targetId: null,
  isRead: false,
  createdAt: '2026-09-19T10:00:00Z',
});

/**
 * An interest in a profile an agency runs. The agency has many clients, so a
 * line that says "your profile" tells them nothing — it has to name which one.
 */
describe('interest notifications for a managed profile', () => {
  const who = { counterpartName: 'Chaitra Gowda', counterpartCity: 'Bengaluru' };

  it('names the client for the agency whose client has an account', () => {
    expect(
      describeNotification(row('match_interest_for_client', { ...who, subjectName: 'Kiran Gowda' })),
    ).toBe('Chaitra Gowda from Bengaluru is interested in Kiran Gowda — review it.');
  });

  it('names the client for the agency running an unclaimed profile', () => {
    expect(
      describeNotification(
        row('match_interest', { ...who, subjectName: 'Kiran Gowda', forManagedProfile: true }),
      ),
    ).toBe('Chaitra Gowda from Bengaluru is interested in Kiran Gowda.');
  });

  it('still says "your profile" to somebody reading about their own', () => {
    expect(
      describeNotification(
        row('match_interest', { ...who, subjectName: 'Kiran Gowda', forManagedProfile: false }),
      ),
    ).toBe('Chaitra Gowda from Bengaluru would like to take your profile forward.');
  });
});

/** The agency turned an interest down; the sender is told who answered. */
describe("an interest declined by the other family's agency", () => {
  it('names whose agency declined it', () => {
    expect(
      describeNotification(row('match_declined_by_agency', { counterpartName: 'Kiran Gowda' })),
    ).toBe("Kiran Gowda's agency has declined this proposal.");
  });

  it('says which client it was for, to a steward', () => {
    expect(
      describeNotification(
        row('match_declined_by_agency', {
          counterpartName: 'Kiran Gowda',
          subjectName: 'Chaitra Gowda',
          forManagedProfile: true,
        }),
      ),
    ).toBe("Kiran Gowda's agency has declined this proposal for Chaitra Gowda.");
  });

  it('still reads without a name', () => {
    expect(describeNotification(row('match_declined_by_agency', {}))).toBe(
      "The family's agency has declined this proposal.",
    );
  });
});
