import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Notification,
  TYPE_LABEL,
  describe as describeNotification,
  operationalAlertLink,
} from './notification-copy';

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

/**
 * The client's labels are a hand-kept mirror of the server's notification
 * types. Read the backend enum rather than copying it a third time, so a new
 * type cannot ship without a label.
 */
describe('notification type totality', () => {
  function backendNotificationTypes(): string[] {
    const source = readFileSync(
      join(__dirname, '../../../backend/src/common/enums/index.ts'),
      'utf8',
    );
    const body = /export enum NotificationType \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    return [...body.matchAll(/^\s{2}[A-Z_0-9]+ = '([a-z_0-9]+)',/gm)].map((m) => m[1]);
  }

  it('finds the backend enum', () => {
    expect(backendNotificationTypes()).toContain('booking_request');
    expect(backendNotificationTypes().length).toBeGreaterThan(20);
  });

  it('labels and describes every server notification type', () => {
    for (const type of backendNotificationTypes()) {
      expect({ type, label: TYPE_LABEL[type] ?? null }).not.toEqual({ type, label: null });
    }
  });
});

describe('operational alert notifications', () => {
  const alert = (payload: Record<string, unknown>): Notification => ({
    ...row('operational_alert', payload),
    targetModule: 'infrastructure',
    targetAction: 'review',
    targetId: '0b6c8f8e-3b0e-4c55-9d0e-2a4c3f1b9a11',
  });
  const facts = {
    severity: 'critical',
    metric: 'cpuPercent',
    observedValue: 91,
    unit: 'percent',
    thresholdValue: 80,
  };

  it('states the measurement against its threshold', () => {
    expect(describeNotification(alert({ ...facts, event: 'opened' }))).toBe(
      'Critical: CPU utilisation is 91 percent (threshold 80 percent).',
    );
  });

  it('says when a warning has escalated or is still open', () => {
    expect(describeNotification(alert({ ...facts, event: 'promoted' }))).toBe(
      'Escalated to critical: CPU utilisation is 91 percent (threshold 80 percent).',
    );
    expect(
      describeNotification(alert({ ...facts, severity: 'warning', event: 'reminder' })),
    ).toBe('Still open (warning): CPU utilisation is 91 percent (threshold 80 percent).');
  });

  it('falls back to the raw metric key for an unknown metric', () => {
    expect(
      describeNotification(alert({ ...facts, metric: 'queueDepth', unit: 'count', event: 'opened' })),
    ).toBe('Critical: queueDepth is 91 count (threshold 80 count).');
  });

  it('opens the Infrastructure page on the alert', () => {
    expect(TYPE_LABEL.operational_alert).toBe('Operational alert');
    expect(operationalAlertLink('0b6c8f8e-3b0e-4c55-9d0e-2a4c3f1b9a11')).toBe(
      '/admin/infrastructure?alert=0b6c8f8e-3b0e-4c55-9d0e-2a4c3f1b9a11',
    );
    expect(operationalAlertLink(null)).toBe('/admin/infrastructure');
  });
});
