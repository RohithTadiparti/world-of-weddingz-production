import { Logger } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AppConfigService } from '../../../config/app-config.service';
import { NotificationType, UserRole } from '../../../common/enums';
import { runWithRequestId } from '../../../common/logging/request-context';
import { LogMailProvider, MailMessage, MailProvider } from '../../../platform/mail/mail.provider';
import { MailService } from '../../../platform/mail/mail.service';
import { AuditInput } from '../../../platform/audit/audit.service';
import { OperationalAlert } from '../entities/operational-alert.entity';
import {
  ALERT_DELIVERY_HISTORY_LIMIT,
  AlertDeliveryMetadata,
  OPERATIONAL_ALERT_AUDIT_ACTIONS,
  OPERATIONAL_ALERT_LOG_EVENTS,
} from './alert-delivery.types';
import { ALERT_DELIVERY_MAX_FAILED_ATTEMPTS, AlertDeliveryService } from './alert-delivery.service';

const T0 = new Date('2026-10-09T10:00:00.000Z');
const HOUR = 3_600_000;
const ALERT_ID = '0b6c8f8e-3b0e-4c55-9d0e-2a4c3f1b9a11';

const ADMIN_A = '11111111-1111-4111-8111-111111111111';
const ADMIN_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_INACTIVE = '33333333-3333-4333-8333-333333333333';
const BRIDE = '44444444-4444-4444-8444-444444444444';
const OFFICER = '55555555-5555-4555-8555-555555555555';

// Canary values that must never appear in logs, mail, notifications, audit
// rows or persisted delivery metadata.
const SECRET = 'canary-secret-7f3a';
const COOKIE = 'wow_session=canary-cookie-91bd';
const TOKEN = 'canary-bearer-token-0c4e';
const BODY = '{"password":"canary-request-body-55aa"}';
const RECIPIENTS = ['ops-canary@example.com', 'oncall-canary@example.org'];

type Row = Record<string, unknown>;

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, expected]) =>
    expected instanceof FindOperator
      ? expected.type === 'in' && (expected.value as unknown[]).includes(row[key])
      : row[key] === expected,
  );

const filter = <T extends Row>(rows: T[], where: Row | Row[]): T[] => {
  const options = Array.isArray(where) ? where : [where];
  return rows.filter((row) => options.some((w) => matches(row, w)));
};

class AlertStore {
  rows = new Map<string, OperationalAlert>();
  find = jest.fn(async ({ where }: { where: Row | Row[] }) =>
    filter([...this.rows.values()] as unknown as Row[], where).map((r) => structuredClone(r)),
  );
  findOne = jest.fn(async ({ where }: { where: Row }) => {
    const [row] = filter([...this.rows.values()] as unknown as Row[], where);
    return row ? structuredClone(row) : null;
  });
  update = jest.fn(async (id: string, patch: Partial<OperationalAlert>) => {
    Object.assign(this.rows.get(id)!, structuredClone(patch));
  });
  manager = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work({ getRepository: () => this }),
    ),
  };
  put(alert: OperationalAlert): void {
    this.rows.set(alert.id, structuredClone(alert));
  }
  get(id = ALERT_ID): OperationalAlert {
    return structuredClone(this.rows.get(id)!);
  }
}

const userRows: Row[] = [
  { id: ADMIN_A, role: UserRole.ADMIN, isActive: true },
  { id: ADMIN_B, role: UserRole.ADMIN, isActive: true },
  { id: ADMIN_INACTIVE, role: UserRole.ADMIN, isActive: false },
  { id: BRIDE, role: UserRole.BRIDE, isActive: true },
  { id: OFFICER, role: UserRole.IN_PERSON, isActive: true },
];

const alertRow = (over: Partial<OperationalAlert> = {}): OperationalAlert =>
  ({
    id: ALERT_ID,
    fingerprint: 'capacity:cpuPercent',
    metric: 'cpuPercent',
    severity: 'warning',
    status: 'open',
    observedValue: 72.5,
    thresholdValue: 70,
    unit: 'percent',
    source: 'railway-runtime',
    firstObservedAt: new Date(T0),
    lastObservedAt: new Date(T0),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    lastNotifiedAt: null,
    deliveryMetadata: {},
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    ...over,
  }) as OperationalAlert;

class FailingProvider implements MailProvider {
  readonly mode = 'smtp' as const;
  async send(): Promise<void> {
    throw new Error(`SMTP auth failed for ${SECRET}`);
  }
}

class SmtpProvider implements MailProvider {
  readonly mode = 'smtp' as const;
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe('AlertDeliveryService', () => {
  let store: AlertStore;
  let users: { find: jest.Mock; findOne: jest.Mock };
  let notifications: { create: jest.Mock };
  let audit: { record: jest.Mock };
  let captured: MailMessage[];
  let provider: MailProvider;
  let recipients: string[];
  let logs: jest.SpyInstance[];

  const config = () =>
    ({
      operations: { alertReminderHours: 24, alertRecipients: recipients },
      mail: {
        provider: provider.mode ?? 'log',
        appBaseUrl: 'https://wow.test',
        password: SECRET,
        user: TOKEN,
      },
      auth: { jwtSecret: SECRET },
    }) as unknown as AppConfigService;

  const service = () =>
    new AlertDeliveryService(
      config(),
      store as never,
      users as never,
      notifications as never,
      new MailService(provider, config()),
      audit as never,
    );

  const at = (offsetMs: number) => jest.setSystemTime(new Date(T0.getTime() + offsetMs));
  const meta = (id = ALERT_ID) => store.get(id).deliveryMetadata as unknown as AlertDeliveryMetadata;
  const auditActions = () => audit.record.mock.calls.map(([input]) => (input as AuditInput).action);
  const logged = () => logs.flatMap((spy) => spy.mock.calls.map((call) => call[0]));
  const logEvents = () =>
    logged()
      .filter((entry): entry is Row => typeof entry === 'object' && entry !== null)
      .map((entry) => entry.event);

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    store = new AlertStore();
    store.put(alertRow());
    users = {
      find: jest.fn(async ({ where }: { where: Row }) =>
        filter(userRows, where).map((u) => ({ id: u.id })),
      ),
      findOne: jest.fn(async ({ where }: { where: Row }) => filter(userRows, where)[0] ?? null),
    };
    notifications = {
      create: jest.fn(async (userId: string) => ({ id: `n-${userId}` })),
    };
    audit = { record: jest.fn(async () => true) };
    captured = [];
    provider = new LogMailProvider({
      store: jest.fn(async (_channel: string, _to: string, message: MailMessage) => {
        captured.push(message);
      }),
    } as never);
    recipients = [...RECIPIENTS];
    logs = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('a newly opened alert', () => {
    it('notifies every eligible active administrator exactly once', async () => {
      const result = await service().deliver(store.get());

      expect(result.event).toBe('opened');
      expect(result.failed).toBe(false);
      const notified = notifications.create.mock.calls.map(([userId]) => userId).sort();
      expect(notified).toEqual([ADMIN_A, ADMIN_B]);
      for (const [, type] of notifications.create.mock.calls) {
        expect(type).toBe(NotificationType.OPERATIONAL_ALERT);
      }
      expect(result.attempt?.portal).toEqual({
        status: 'delivered',
        at: T0.toISOString(),
        recipients: 2,
        error: null,
      });
    });

    it('notifies an administrator once even if the eligibility query repeats them', async () => {
      users.find.mockResolvedValueOnce([{ id: ADMIN_A }, { id: ADMIN_A }, { id: ADMIN_B }]);
      await service().deliver(store.get());
      expect(notifications.create).toHaveBeenCalledTimes(2);
    });

    it('asks only for active accounts in roles that hold the infrastructure permission', async () => {
      await service().deliver(store.get());
      const [{ where }] = users.find.mock.calls[0] as [{ where: Row }];
      expect(where.isActive).toBe(true);
      expect((where.role as FindOperator<unknown>).value).toEqual([UserRole.ADMIN]);
    });

    it('emails only the configured recipients and marks the log transport simulated', async () => {
      const result = await service().deliver(store.get());

      expect(captured.map((m) => m.to)).toEqual(RECIPIENTS);
      expect(result.attempt?.email).toEqual({
        status: 'simulated',
        at: T0.toISOString(),
        recipients: 2,
        provider: 'log',
        error: null,
      });
    });

    it('reports SMTP delivery as sent', async () => {
      provider = new SmtpProvider();
      const result = await service().deliver(store.get());
      expect(result.attempt?.email.status).toBe('sent');
      expect((provider as SmtpProvider).sent).toHaveLength(2);
    });

    it('reports email as not configured when no recipients exist', async () => {
      recipients = [];
      const result = await service().deliver(store.get());
      expect(result.attempt?.email).toMatchObject({
        status: 'not_configured',
        recipients: 0,
        error: null,
      });
      expect(captured).toHaveLength(0);
      expect(result.failed).toBe(false);
    });

    it('persists the attempt, the announced severity and lastNotifiedAt', async () => {
      const result = await service().deliver(store.get());
      const stored = store.get();

      expect(stored.lastNotifiedAt).toEqual(T0);
      expect(meta()).toEqual({
        version: 1,
        notifiedSeverity: 'warning',
        lastReminderAt: null,
        lastAttempt: result.attempt,
        history: [result.attempt],
      });
      expect(result.attempt).toMatchObject({
        event: 'opened',
        at: T0.toISOString(),
        severity: 'warning',
        audit: { status: 'recorded', at: T0.toISOString(), error: null },
      });
    });

    it('writes the opened audit event and a delivered log with one correlation id', async () => {
      const result = await runWithRequestId('req-ops-7', () => service().deliver(store.get()));
      const correlationId = result.attempt!.correlationId;

      expect(correlationId).toBe('req-ops-7');
      expect(auditActions()).toEqual([OPERATIONAL_ALERT_AUDIT_ACTIONS.opened]);
      const [input] = audit.record.mock.calls[0] as [AuditInput];
      expect(input).toMatchObject({
        resourceType: 'operational_alert',
        resourceId: ALERT_ID,
        actor: null,
        metadata: { correlationId, event: 'opened', alertId: ALERT_ID },
      });
      const delivered = logged().find(
        (entry) => (entry as Row)?.event === OPERATIONAL_ALERT_LOG_EVENTS.delivered,
      ) as Row;
      expect(delivered).toMatchObject({ correlationId, alertId: ALERT_ID, deliveryEvent: 'opened' });
      for (const [, , payload] of notifications.create.mock.calls) {
        expect(payload).toMatchObject({ correlationId, alertId: ALERT_ID });
      }
      expect(captured[0].text).toContain(`Correlation ID: ${correlationId}`);
    });

    it('generates a UUID correlation id outside a request', async () => {
      const result = await service().deliver(store.get());
      expect(result.attempt!.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('carries exactly the permitted facts in the in-app payload', async () => {
      await service().deliver(store.get());
      const [, , payload] = notifications.create.mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(
        [
          'alertId',
          'correlationId',
          'event',
          'firstObservedAt',
          'metric',
          'observedValue',
          'recommendedAction',
          'severity',
          'source',
          'thresholdValue',
          'unit',
        ].sort(),
      );
      expect(payload).toMatchObject({
        severity: 'warning',
        metric: 'cpuPercent',
        observedValue: 72.5,
        unit: 'percent',
        thresholdValue: 70,
        source: 'railway-runtime',
        firstObservedAt: T0.toISOString(),
      });
      expect(String(payload.recommendedAction).length).toBeGreaterThan(20);
    });
  });

  describe('deduplication', () => {
    it('sends nothing for a duplicate evaluation of an announced, unchanged alert', async () => {
      await service().deliver(store.get());
      jest.clearAllMocks();
      captured.length = 0;

      at(HOUR);
      const result = await service().deliver(store.get());

      expect(result).toEqual({ alertId: ALERT_ID, event: null, attempt: null, failed: false });
      expect(notifications.create).not.toHaveBeenCalled();
      expect(captured).toHaveLength(0);
      expect(audit.record).not.toHaveBeenCalled();
      expect(store.update).not.toHaveBeenCalled();
      expect(logEvents()).toEqual([OPERATIONAL_ALERT_LOG_EVENTS.suppressed]);
    });

    it('sends a warning-to-critical promotion exactly once', async () => {
      await service().deliver(store.get());
      store.put({ ...store.get(), severity: 'critical', thresholdValue: 80, observedValue: 85 });
      jest.clearAllMocks();
      captured.length = 0;

      at(HOUR);
      const promoted = await service().deliver(store.get());
      expect(promoted.event).toBe('promoted');
      expect(notifications.create).toHaveBeenCalledTimes(2);
      expect(captured).toHaveLength(2);
      expect(auditActions()).toEqual([OPERATIONAL_ALERT_AUDIT_ACTIONS.promoted]);
      expect(meta().notifiedSeverity).toBe('critical');
      expect(store.get().lastNotifiedAt).toEqual(new Date(T0.getTime() + HOUR));

      jest.clearAllMocks();
      at(2 * HOUR);
      expect((await service().deliver(store.get())).event).toBeNull();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('opens directly at critical without a later promotion', async () => {
      store.put(alertRow({ severity: 'critical', thresholdValue: 80, observedValue: 90 }));
      expect((await service().deliver(store.get())).event).toBe('opened');
      at(HOUR);
      expect((await service().deliver(store.get())).event).toBeNull();
    });
  });

  describe('reminders', () => {
    it('sends nothing before the reminder period, then exactly one due reminder', async () => {
      await service().deliver(store.get());
      jest.clearAllMocks();
      captured.length = 0;

      at(24 * HOUR - 1);
      expect((await service().deliver(store.get())).event).toBeNull();
      expect(notifications.create).not.toHaveBeenCalled();

      at(24 * HOUR);
      const reminder = await service().deliver(store.get());
      expect(reminder.event).toBe('reminder');
      expect(notifications.create).toHaveBeenCalledTimes(2);
      expect(captured).toHaveLength(2);
      expect(auditActions()).toEqual([OPERATIONAL_ALERT_AUDIT_ACTIONS.reminded]);
      expect(meta().lastReminderAt).toBe(new Date(T0.getTime() + 24 * HOUR).toISOString());

      jest.clearAllMocks();
      at(25 * HOUR);
      expect((await service().deliver(store.get())).event).toBeNull();
      at(48 * HOUR - 1);
      expect((await service().deliver(store.get())).event).toBeNull();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('never reminds about an acknowledged alert', async () => {
      await service().deliver(store.get());
      store.put({
        ...store.get(),
        status: 'acknowledged',
        acknowledgedAt: new Date(T0.getTime() + HOUR),
        acknowledgedBy: ADMIN_A,
      });
      jest.clearAllMocks();

      for (const hours of [24, 48, 240]) {
        at(hours * HOUR);
        expect((await service().deliver(store.get())).event).toBeNull();
      }
      expect(notifications.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('resolution', () => {
    it('writes audit and log evidence and sends nothing', async () => {
      await service().deliver(store.get());
      store.put({ ...store.get(), status: 'resolved', resolvedAt: new Date(T0.getTime() + HOUR) });
      jest.clearAllMocks();
      captured.length = 0;
      at(HOUR);

      const result = await service().deliver(store.get());

      expect(result.event).toBe('resolved');
      expect(notifications.create).not.toHaveBeenCalled();
      expect(captured).toHaveLength(0);
      expect(auditActions()).toEqual([OPERATIONAL_ALERT_AUDIT_ACTIONS.resolved]);
      expect(logEvents()).toContain(OPERATIONAL_ALERT_LOG_EVENTS.resolved);
      expect(result.attempt).toMatchObject({
        event: 'resolved',
        portal: { status: 'skipped', at: null, recipients: 0, error: null },
        email: { status: 'skipped', at: null, recipients: 0, provider: 'log', error: null },
        audit: { status: 'recorded' },
      });
      expect(meta().history.map((a) => a.event)).toEqual(['resolved', 'opened']);

      jest.clearAllMocks();
      at(30 * HOUR);
      expect((await service().deliver(store.get())).event).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('acknowledgement evidence', () => {
    it('audits and logs the acknowledgement without sending or changing acknowledgement fields', async () => {
      await service().deliver(store.get());
      jest.clearAllMocks();
      captured.length = 0;
      at(2 * HOUR);
      const alert = store.get();

      const attempt = await service().recordAcknowledged(alert, ADMIN_A, 'req-ack-1');

      expect(attempt).toEqual({
        event: 'acknowledged',
        at: new Date(T0.getTime() + 2 * HOUR).toISOString(),
        correlationId: 'req-ack-1',
        severity: 'warning',
        portal: { status: 'skipped', at: null, recipients: 0, error: null },
        email: { status: 'skipped', at: null, recipients: 0, provider: 'log', error: null },
        audit: { status: 'recorded', at: new Date(T0.getTime() + 2 * HOUR).toISOString(), error: null },
      });
      expect(notifications.create).not.toHaveBeenCalled();
      expect(captured).toHaveLength(0);
      const [input] = audit.record.mock.calls[0] as [AuditInput];
      expect(input).toMatchObject({
        action: OPERATIONAL_ALERT_AUDIT_ACTIONS.acknowledged,
        actor: { userId: ADMIN_A, role: UserRole.ADMIN },
        resourceId: ALERT_ID,
        metadata: { correlationId: 'req-ack-1' },
      });
      expect(logged()).toContainEqual(
        expect.objectContaining({
          event: OPERATIONAL_ALERT_LOG_EVENTS.acknowledged,
          correlationId: 'req-ack-1',
          alertId: ALERT_ID,
        }),
      );
      const stored = store.get();
      expect(stored.acknowledgedAt).toBeNull();
      expect(stored.acknowledgedBy).toBeNull();
      expect(stored.lastNotifiedAt).toEqual(T0);
      expect(meta().lastAttempt).toEqual(attempt);
      expect(meta().history.map((a) => a.event)).toEqual(['acknowledged', 'opened']);
      expect(meta().notifiedSeverity).toBe('warning');
      expect(alert.deliveryMetadata).toEqual(meta());
    });
  });

  describe('channel failures', () => {
    it('reports a failed portal channel without failing email, and audits the failure', async () => {
      notifications.create.mockImplementation(async (userId: string) => {
        if (userId === ADMIN_B) throw new Error(`insert failed ${SECRET}`);
        return { id: 'n' };
      });

      const result = await service().deliver(store.get());

      expect(result.failed).toBe(true);
      expect(result.attempt?.portal).toEqual({
        status: 'failed',
        at: T0.toISOString(),
        recipients: 1,
        error: 'portal_delivery_failed',
      });
      expect(result.attempt?.email.status).toBe('simulated');
      expect(auditActions()).toEqual([
        OPERATIONAL_ALERT_AUDIT_ACTIONS.opened,
        OPERATIONAL_ALERT_AUDIT_ACTIONS.deliveryFailed,
      ]);
      expect(logEvents()).toContain(OPERATIONAL_ALERT_LOG_EVENTS.deliveryFailed);
      expect(logEvents()).not.toContain(OPERATIONAL_ALERT_LOG_EVENTS.delivered);
      expect(meta().lastAttempt?.portal.error).toBe('portal_delivery_failed');
    });

    it('reports a portal eligibility query failure as a failed portal channel', async () => {
      users.find.mockRejectedValueOnce(new Error('db down'));
      const result = await service().deliver(store.get());
      expect(result.attempt?.portal).toMatchObject({
        status: 'failed',
        recipients: 0,
        error: 'portal_delivery_failed',
      });
    });

    it('reports a failed mail channel without failing the portal', async () => {
      provider = new FailingProvider();
      const result = await service().deliver(store.get());

      expect(result.failed).toBe(true);
      expect(result.attempt?.portal.status).toBe('delivered');
      expect(result.attempt?.email).toEqual({
        status: 'failed',
        at: T0.toISOString(),
        recipients: 2,
        provider: 'smtp',
        error: 'mail_delivery_failed',
      });
      expect(auditActions()).toContain(OPERATIONAL_ALERT_AUDIT_ACTIONS.deliveryFailed);
    });

    it('reports a lost audit row', async () => {
      audit.record.mockResolvedValue(false);
      const result = await service().deliver(store.get());
      expect(result.failed).toBe(true);
      expect(result.attempt?.audit).toEqual({
        status: 'failed',
        at: null,
        error: 'audit_write_failed',
      });
      expect(result.attempt?.portal.status).toBe('delivered');
      expect(logEvents()).toContain(OPERATIONAL_ALERT_LOG_EVENTS.deliveryFailed);
    });

    it('does not count zero eligible administrators as success', async () => {
      users.find.mockResolvedValue([]);
      const result = await service().deliver(store.get());
      expect(result.attempt?.portal).toEqual({
        status: 'skipped',
        at: T0.toISOString(),
        recipients: 0,
        error: 'no_eligible_administrators',
      });
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('does not retry an announcement somebody received', async () => {
      provider = new FailingProvider();
      await service().deliver(store.get());
      jest.clearAllMocks();
      at(HOUR);
      expect((await service().deliver(store.get())).event).toBeNull();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('retries an announcement nobody received on later evaluations, a bounded number of times', async () => {
      recipients = [];
      notifications.create.mockRejectedValue(new Error('down'));

      for (let attempt = 1; attempt <= ALERT_DELIVERY_MAX_FAILED_ATTEMPTS; attempt += 1) {
        at((attempt - 1) * HOUR);
        const result = await service().deliver(store.get());
        expect(result.event).toBe('opened');
        expect(result.failed).toBe(true);
      }
      expect(meta().notifiedSeverity).toBe('warning');
      expect(store.get().lastNotifiedAt).toEqual(
        new Date(T0.getTime() + (ALERT_DELIVERY_MAX_FAILED_ATTEMPTS - 1) * HOUR),
      );

      at(ALERT_DELIVERY_MAX_FAILED_ATTEMPTS * HOUR);
      expect((await service().deliver(store.get())).event).toBeNull();
      expect(notifications.create).toHaveBeenCalledTimes(2 * ALERT_DELIVERY_MAX_FAILED_ATTEMPTS);
    });

    it('keeps the history newest first and bounded', async () => {
      const ack = service();
      for (let i = 0; i < ALERT_DELIVERY_HISTORY_LIMIT + 5; i += 1) {
        at(i * 1000);
        await ack.recordAcknowledged(store.get(), ADMIN_A, `req-${i}`);
      }
      const history = meta().history;
      expect(history).toHaveLength(ALERT_DELIVERY_HISTORY_LIMIT);
      expect(history[0].correlationId).toBe(`req-${ALERT_DELIVERY_HISTORY_LIMIT + 4}`);
      expect(history[ALERT_DELIVERY_HISTORY_LIMIT - 1].correlationId).toBe('req-5');
    });
  });

  describe('scheduler evaluation', () => {
    const OTHER = '9e1f2d3c-4b5a-4687-9a0b-1c2d3e4f5a6b';

    it('delivers changed and active alerts and survives one alert failing', async () => {
      store.put(alertRow({ id: OTHER, fingerprint: 'capacity:accounts', metric: 'accounts', unit: 'count' }));
      const svc = service();
      const deliver = jest.spyOn(svc, 'deliver');
      deliver.mockImplementationOnce(async () => {
        throw new Error('boom');
      });

      const results = await svc.deliverEvaluation({
        opened: [ALERT_ID],
        promoted: [],
        resolved: [],
        unchanged: [OTHER],
      });

      expect(deliver).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(1);
      expect(logEvents()).toContain(OPERATIONAL_ALERT_LOG_EVENTS.deliveryFailed);
    });

    it('records resolution only for alerts resolved in this evaluation', async () => {
      store.put(alertRow({ status: 'resolved' }));
      const svc = service();
      expect(await svc.deliverEvaluation({ opened: [], promoted: [], resolved: [], unchanged: [] })).toEqual([]);
      const results = await svc.deliverEvaluation({
        opened: [],
        promoted: [],
        resolved: [ALERT_ID],
        unchanged: [],
      });
      expect(results.map((r) => r.event)).toEqual(['resolved']);
    });
  });

  describe('sensitive data', () => {
    it('keeps secrets, cookies, tokens, request bodies and recipient addresses out of every output', async () => {
      // Hostile extra properties on the entity must not be spread anywhere.
      const hostile = Object.assign(alertRow(), {
        cookie: COOKIE,
        authorization: `Bearer ${TOKEN}`,
        requestBody: BODY,
      });
      store.put(hostile);
      store.rows.get(ALERT_ID)!.deliveryMetadata = { token: TOKEN, recipients: RECIPIENTS };

      await runWithRequestId('req-canary', async () => {
        await service().deliver(Object.assign(store.get(), { cookie: COOKIE, requestBody: BODY }));
      });
      at(HOUR);
      store.put({ ...store.get(), severity: 'critical' });
      provider = new FailingProvider();
      await service().deliver(store.get());
      await service().recordAcknowledged(store.get(), ADMIN_A, 'req-ack');

      const outputs = {
        logs: JSON.stringify(logged()),
        mail: JSON.stringify(captured.map(({ subject, text, html }) => ({ subject, text, html }))),
        notifications: JSON.stringify(notifications.create.mock.calls),
        audit: JSON.stringify(audit.record.mock.calls),
        metadata: JSON.stringify(store.get().deliveryMetadata),
      };
      for (const [channel, text] of Object.entries(outputs)) {
        for (const canary of [SECRET, COOKIE, TOKEN, BODY, ...RECIPIENTS, 'canary-request-body']) {
          expect({ channel, leaked: text.includes(canary) ? canary : null }).toEqual({
            channel,
            leaked: null,
          });
        }
      }
      expect(captured.length).toBeGreaterThan(0);
    });
  });
});
