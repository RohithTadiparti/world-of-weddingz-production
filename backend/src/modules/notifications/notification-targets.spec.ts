import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationType } from '../../common/enums';
import { DELIVERY } from './notification-delivery';
import { NOTIFICATION_TARGET } from './notification-targets';

describe('notification maps', () => {
  it('give every notification type a target and a delivery spec', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TARGET[type]).toBeDefined();
      expect(DELIVERY[type]).toBeDefined();
      expect(DELIVERY[type].title.length).toBeGreaterThan(0);
    }
    expect(Object.keys(NOTIFICATION_TARGET).sort()).toEqual(Object.values(NotificationType).sort());
    expect(Object.keys(DELIVERY).sort()).toEqual(Object.values(NotificationType).sort());
  });

  it('adds every code value to the Postgres enum through a migration', () => {
    const directory = join(__dirname, '../../database/migrations');
    const sql = readdirSync(directory)
      .map((file) => readFileSync(join(directory, file), 'utf8'))
      .join('\n');
    for (const type of Object.values(NotificationType)) {
      expect({ type, inSchema: sql.includes(`'${type}'`) }).toEqual({ type, inSchema: true });
    }
  });

  describe('operational alerts', () => {
    it('open the administrator Infrastructure page on the alert', () => {
      expect(NOTIFICATION_TARGET[NotificationType.OPERATIONAL_ALERT]).toEqual({
        module: 'infrastructure',
        action: 'review',
        idKey: 'alertId',
      });
    });

    it('never go to WhatsApp and read as one line of facts', () => {
      const spec = DELIVERY[NotificationType.OPERATIONAL_ALERT];
      expect(spec.whatsappTemplate).toBeNull();
      expect(
        spec.body({
          event: 'opened',
          severity: 'critical',
          metric: 'cpuPercent',
          observedValue: 91,
          unit: 'percent',
          thresholdValue: 80,
        }),
      ).toBe('Critical: cpuPercent is 91 percent (threshold 80 percent).');
      expect(
        spec.body({ event: 'reminder', severity: 'warning', metric: 'accounts', observedValue: 6000, unit: 'count', thresholdValue: 5000 }),
      ).toBe('Still open: accounts is 6000 count (threshold 5000 count).');
    });
  });

  it('leaves existing domain targets unchanged', () => {
    expect(NOTIFICATION_TARGET[NotificationType.BOOKING_REQUEST]).toEqual({
      module: 'bookings',
      action: 'respond',
      idKey: 'bookingId',
    });
    expect(NOTIFICATION_TARGET[NotificationType.MATCH_INTEREST]).toEqual({
      module: 'matches',
      action: 'respond',
      idKey: 'counterpartProfileId',
    });
  });
});
