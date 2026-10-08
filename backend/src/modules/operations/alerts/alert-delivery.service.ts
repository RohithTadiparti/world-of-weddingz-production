import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Permission, roleHasPermission } from '../../../common/authz/permissions';
import { NotificationType, UserRole } from '../../../common/enums';
import { errorType } from '../../../common/logging/log-redaction';
import { currentRequestId } from '../../../common/logging/request-context';
import { isValidRequestId } from '../../../common/logging/request-id';
import { AppConfigService } from '../../../config/app-config.service';
import { AuditActionName, AuditService } from '../../../platform/audit/audit.service';
import { MailService, OperationalAlertMail } from '../../../platform/mail/mail.service';
import { User } from '../../auth/entities/user.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { AlertEvaluationResult, CapacityMetricKey } from '../capacity/capacity.types';
import { OperationalAlert } from '../entities/operational-alert.entity';
import {
  ALERT_DELIVERY_HISTORY_LIMIT,
  AlertDeliveryAttempt,
  AlertDeliveryErrorCode,
  AlertDeliveryEvent,
  AlertDeliveryMetadata,
  AuditDeliveryOutcome,
  EMPTY_ALERT_DELIVERY_METADATA,
  EmailDeliveryOutcome,
  OPERATIONAL_ALERT_AUDIT_ACTIONS,
  OPERATIONAL_ALERT_LOG_EVENTS,
  PortalDeliveryOutcome,
} from './alert-delivery.types';

/** The events `deliver` can decide on; acknowledgement is recorded separately. */
export type AlertDeliveryDecision = Exclude<AlertDeliveryEvent, 'acknowledged'>;

export interface AlertDeliveryResult {
  alertId: string;
  /** What was due for this alert, or null when nothing was (a duplicate evaluation). */
  event: AlertDeliveryDecision | null;
  /** The attempt recorded in deliveryMetadata, or null when nothing was due. */
  attempt: AlertDeliveryAttempt | null;
  /** True when any channel or the audit write failed during this attempt. */
  failed: boolean;
}

/**
 * Retry policy for an announcement (opened, promoted or reminder) that reached
 * nobody because a channel failed: it is attempted again on the next hourly
 * evaluation, at most this many times in total, and then treated as announced
 * so the normal reminder clock takes over. An attempt that reached anybody
 * (an in-app notification written or an SMTP email accepted) is never retried,
 * so a partial failure cannot duplicate what was already received.
 */
export const ALERT_DELIVERY_MAX_FAILED_ATTEMPTS = 3;

const HOUR_MS = 3_600_000;

const AUDIT_ACTION: Record<AlertDeliveryEvent, AuditActionName> = {
  opened: OPERATIONAL_ALERT_AUDIT_ACTIONS.opened,
  promoted: OPERATIONAL_ALERT_AUDIT_ACTIONS.promoted,
  reminder: OPERATIONAL_ALERT_AUDIT_ACTIONS.reminded,
  acknowledged: OPERATIONAL_ALERT_AUDIT_ACTIONS.acknowledged,
  resolved: OPERATIONAL_ALERT_AUDIT_ACTIONS.resolved,
};

/** What an operator should do first, per metric. Deterministic and secret-free. */
export const RECOMMENDED_ACTIONS: Record<CapacityMetricKey, string> = {
  accounts:
    'Review registered-account growth against the capacity plan and start the AWS migration readiness review if growth continues.',
  dailyActiveUsers:
    'Check service replica and database connection headroom, and start the AWS migration readiness review if the level is sustained.',
  requestsPerDay:
    'Review request volume by route for abuse or client retry loops, confirm rate limits, and check service scaling headroom.',
  concurrentUsers:
    'Check replica count, WebSocket connections and database pool headroom, and scale the service if the load is sustained.',
  databaseGigabytes:
    'Review the largest tables and retention jobs, confirm backups complete, and plan storage expansion or migration.',
  p95LatencyMs:
    'Inspect slow routes and database queries, check CPU and memory, and scale or roll back the latest release if it regressed.',
  errorRatePercent:
    'Inspect recent server errors by route and release, check dependency health, and roll back the latest release if it introduced them.',
  cpuPercent:
    'Identify the busy route or job, stop any runaway work, and scale the service if the load is legitimate.',
  memoryPercent:
    'Check memory growth since the last deploy, restart the service if it is leaking, and scale memory if usage is legitimate.',
  railwayMonthlyInr:
    'Review the hosting usage breakdown, remove idle resources, and confirm the budget or the AWS migration plan.',
};

/** Reads persisted delivery state, keeping only the contract's own fields. */
export function readDeliveryMetadata(raw: unknown): AlertDeliveryMetadata {
  const value = raw as Partial<AlertDeliveryMetadata> | null | undefined;
  if (!value || value.version !== 1 || !Array.isArray(value.history)) {
    return { ...EMPTY_ALERT_DELIVERY_METADATA, history: [] };
  }
  return {
    version: 1,
    notifiedSeverity:
      value.notifiedSeverity === 'warning' || value.notifiedSeverity === 'critical'
        ? value.notifiedSeverity
        : null,
    lastReminderAt: typeof value.lastReminderAt === 'string' ? value.lastReminderAt : null,
    lastAttempt: value.lastAttempt ?? null,
    history: value.history.slice(0, ALERT_DELIVERY_HISTORY_LIMIT),
  };
}

/** Somebody actually received it: an in-app row was written or SMTP accepted it. */
const reachedSomebody = (attempt: AlertDeliveryAttempt): boolean =>
  attempt.portal.status === 'delivered' || attempt.email.status === 'sent';

const channelFailed = (attempt: AlertDeliveryAttempt): boolean =>
  attempt.portal.status === 'failed' ||
  attempt.email.status === 'failed' ||
  attempt.audit.status === 'failed';

const retryable = (attempt: AlertDeliveryAttempt): boolean =>
  !reachedSomebody(attempt) && (attempt.portal.status === 'failed' || attempt.email.status === 'failed');

interface StatePatch {
  notifiedSeverity?: 'warning' | 'critical';
  lastReminderAt?: string;
  lastNotifiedAt?: Date;
}

/**
 * Delivers operational alerts to administrators (in-app), to the configured
 * operational recipients (email), to the audit trail and to structured logs,
 * without flooding anybody.
 *
 * Every decision is made from the alert's persisted state and its
 * deliveryMetadata, so a repeated or concurrent evaluation of an unchanged
 * alert sends nothing. All delivery state is written to
 * operational_alerts.deliveryMetadata (the shared contract) and lastNotifiedAt.
 */
@Injectable()
export class AlertDeliveryService {
  private readonly logger = new Logger(AlertDeliveryService.name);

  constructor(
    private readonly config: AppConfigService,
    @InjectRepository(OperationalAlert)
    private readonly alerts: Repository<OperationalAlert>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Delivers whatever is due after one evaluation: the alerts it opened,
   * promoted or resolved, plus every open or acknowledged alert (for due
   * reminders and bounded retries). One alert failing never stops the others.
   */
  async deliverEvaluation(result: AlertEvaluationResult): Promise<AlertDeliveryResult[]> {
    const changed = [...new Set([...result.opened, ...result.promoted, ...result.resolved])];
    const [active, touched] = await Promise.all([
      this.alerts.find({ where: { status: In(['open', 'acknowledged']) } }),
      changed.length ? this.alerts.find({ where: { id: In(changed) } }) : Promise.resolve([]),
    ]);
    const byId = new Map<string, OperationalAlert>();
    for (const alert of [...active, ...touched]) byId.set(alert.id, alert);

    const results: AlertDeliveryResult[] = [];
    for (const alert of byId.values()) {
      try {
        results.push(await this.deliver(alert));
      } catch (err) {
        this.logger.error({
          event: OPERATIONAL_ALERT_LOG_EVENTS.deliveryFailed,
          alertId: alert.id,
          correlationId: currentRequestId() ?? null,
          stage: 'deliver',
          errorType: errorType(err),
        });
      }
    }
    return results;
  }

  async deliver(alert: OperationalAlert): Promise<AlertDeliveryResult> {
    const correlationId = this.correlationId();
    const now = new Date();
    const metadata = readDeliveryMetadata(alert.deliveryMetadata);
    const event = this.decide(alert, metadata, now);

    if (!event) {
      this.logger.debug({
        event: OPERATIONAL_ALERT_LOG_EVENTS.suppressed,
        alertId: alert.id,
        status: alert.status,
        severity: alert.severity,
        correlationId,
      });
      return { alertId: alert.id, event: null, attempt: null, failed: false };
    }

    const attempt =
      event === 'resolved'
        ? await this.recordWithoutSending(alert, 'resolved', correlationId, null, now)
        : await this.announce(alert, event, correlationId, metadata, now);
    return { alertId: alert.id, event, attempt, failed: channelFailed(attempt) };
  }

  /**
   * Evidence for an administrator's acknowledgement. The caller (the
   * acknowledgement endpoint) sets acknowledgedAt/acknowledgedBy itself; this
   * only writes the audit event, the structured log and the delivery history.
   * Nothing is sent.
   */
  async recordAcknowledged(
    alert: OperationalAlert,
    actorUserId: string,
    correlationId: string,
  ): Promise<AlertDeliveryAttempt> {
    const id = isValidRequestId(correlationId) ? correlationId : randomUUID();
    return this.recordWithoutSending(alert, 'acknowledged', id, actorUserId, new Date());
  }

  // ---------------------------------------------------------------------------

  private correlationId(): string {
    return currentRequestId() ?? randomUUID();
  }

  /**
   * opened   — never announced in this lifecycle (the evaluator clears
   *            deliveryMetadata when it reopens an alert);
   * promoted — announced as warning, now critical (once: notifiedSeverity);
   * reminder — still open (not acknowledged, not resolved) and at least
   *            alertReminderHours since the later of the last notification
   *            and the last reminder;
   * resolved — resolved and not yet recorded as such.
   */
  private decide(
    alert: OperationalAlert,
    metadata: AlertDeliveryMetadata,
    now: Date,
  ): AlertDeliveryDecision | null {
    if (alert.status === 'resolved') {
      return metadata.lastAttempt?.event === 'resolved' ||
        metadata.history.some((attempt) => attempt.event === 'resolved')
        ? null
        : 'resolved';
    }
    if (!metadata.notifiedSeverity) return 'opened';
    if (metadata.notifiedSeverity === 'warning' && alert.severity === 'critical') return 'promoted';
    if (alert.status !== 'open') return null;

    const clock = Math.max(
      alert.lastNotifiedAt ? new Date(alert.lastNotifiedAt).getTime() : 0,
      metadata.lastReminderAt ? Date.parse(metadata.lastReminderAt) : 0,
    );
    if (!clock) return null;
    const dueAt = clock + this.config.operations.alertReminderHours * HOUR_MS;
    return now.getTime() >= dueAt ? 'reminder' : null;
  }

  private content(
    alert: OperationalAlert,
    event: OperationalAlertMail['event'],
    correlationId: string,
  ): OperationalAlertMail {
    return {
      event,
      alertId: alert.id,
      severity: alert.severity,
      metric: alert.metric,
      observedValue: alert.observedValue,
      unit: alert.unit,
      thresholdValue: alert.thresholdValue,
      source: alert.source,
      firstObservedAt: new Date(alert.firstObservedAt).toISOString(),
      recommendedAction:
        RECOMMENDED_ACTIONS[alert.metric] ??
        'Review the metric on the administrator Infrastructure page.',
      correlationId,
    };
  }

  private async announce(
    alert: OperationalAlert,
    event: OperationalAlertMail['event'],
    correlationId: string,
    metadata: AlertDeliveryMetadata,
    now: Date,
  ): Promise<AlertDeliveryAttempt> {
    const content = this.content(alert, event, correlationId);
    const portal = await this.deliverPortal(content);
    const email = await this.deliverEmail(content);
    const audit = await this.writeAudit(AUDIT_ACTION[event], alert, null, {
      ...content,
      portal: { status: portal.status, recipients: portal.recipients, error: portal.error },
      email: {
        status: email.status,
        recipients: email.recipients,
        provider: email.provider,
        error: email.error,
      },
    });
    const attempt: AlertDeliveryAttempt = {
      event,
      at: now.toISOString(),
      correlationId,
      severity: alert.severity,
      portal,
      email,
      audit,
    };

    if (channelFailed(attempt)) await this.reportFailure(alert, attempt);
    else {
      // Nobody reached without a failure (no eligible administrator, email not
      // configured or simulated) is not an error, but it is worth a warning.
      const level = reachedSomebody(attempt) ? 'log' : 'warn';
      this.logger[level]({
        event: OPERATIONAL_ALERT_LOG_EVENTS.delivered,
        deliveryEvent: event,
        ...this.logFacts(content),
        ...this.channelSummary(attempt),
      });
    }

    // Bounded retry: an announcement nobody received is left un-announced so
    // the next evaluation tries again, until the attempt cap is reached.
    const priorFailures = this.leadingRetryableFailures(metadata, event);
    const announced = !retryable(attempt) || priorFailures + 1 >= ALERT_DELIVERY_MAX_FAILED_ATTEMPTS;
    const patch: StatePatch = {};
    if (announced) {
      patch.lastNotifiedAt = now;
      if (event === 'reminder') patch.lastReminderAt = now.toISOString();
      else patch.notifiedSeverity = alert.severity;
    }
    await this.persist(alert, attempt, patch);
    return attempt;
  }

  private leadingRetryableFailures(
    metadata: AlertDeliveryMetadata,
    event: AlertDeliveryDecision,
  ): number {
    let count = 0;
    for (const attempt of metadata.history) {
      if (attempt.event === 'acknowledged') continue;
      if (attempt.event !== event || !retryable(attempt)) break;
      count += 1;
    }
    return count;
  }

  private async recordWithoutSending(
    alert: OperationalAlert,
    event: 'resolved' | 'acknowledged',
    correlationId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<AlertDeliveryAttempt> {
    const facts = {
      event,
      alertId: alert.id,
      severity: alert.severity,
      metric: alert.metric,
      observedValue: alert.observedValue,
      unit: alert.unit,
      thresholdValue: alert.thresholdValue,
      source: alert.source,
      firstObservedAt: new Date(alert.firstObservedAt).toISOString(),
      correlationId,
    };
    const actor = actorUserId ? await this.actor(actorUserId) : null;
    const audit = await this.writeAudit(AUDIT_ACTION[event], alert, actor, facts);
    const attempt: AlertDeliveryAttempt = {
      event,
      at: now.toISOString(),
      correlationId,
      severity: alert.severity,
      portal: { status: 'skipped', at: null, recipients: 0, error: null },
      email: {
        status: 'skipped',
        at: null,
        recipients: 0,
        provider: this.mail.providerMode,
        error: null,
      },
      audit,
    };

    const { event: _event, ...logFacts } = facts;
    this.logger.log({
      event:
        event === 'resolved'
          ? OPERATIONAL_ALERT_LOG_EVENTS.resolved
          : OPERATIONAL_ALERT_LOG_EVENTS.acknowledged,
      deliveryEvent: event,
      ...logFacts,
      ...(actorUserId ? { actorUserId } : {}),
      audit: audit.status,
    });
    if (channelFailed(attempt)) await this.reportFailure(alert, attempt);
    await this.persist(alert, attempt, {});
    return attempt;
  }

  private async actor(userId: string): Promise<{ userId: string; role: UserRole }> {
    try {
      const user = await this.users.findOne({ where: { id: userId }, select: ['id', 'role'] });
      return { userId, role: user?.role ?? UserRole.ADMIN };
    } catch {
      // Only administrators hold the permission that reaches this path.
      return { userId, role: UserRole.ADMIN };
    }
  }

  /** Every ACTIVE account whose role grants admin:infrastructure:read, once each. */
  private async eligibleAdministratorIds(): Promise<string[]> {
    const roles = Object.values(UserRole).filter((role) =>
      roleHasPermission(role, Permission.ADMIN_INFRASTRUCTURE_READ),
    );
    if (roles.length === 0) return [];
    const rows = await this.users.find({
      where: { role: In(roles), isActive: true },
      select: ['id'],
    });
    return [...new Set(rows.map((row) => row.id))];
  }

  private async deliverPortal(content: OperationalAlertMail): Promise<PortalDeliveryOutcome> {
    let ids: string[];
    try {
      ids = await this.eligibleAdministratorIds();
    } catch {
      return {
        status: 'failed',
        at: new Date().toISOString(),
        recipients: 0,
        error: 'portal_delivery_failed',
      };
    }
    if (ids.length === 0) {
      return {
        status: 'skipped',
        at: new Date().toISOString(),
        recipients: 0,
        error: 'no_eligible_administrators',
      };
    }

    const payload: Record<string, unknown> = { ...content };
    let delivered = 0;
    let failed = 0;
    for (const userId of ids) {
      try {
        await this.notifications.create(userId, NotificationType.OPERATIONAL_ALERT, payload);
        delivered += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      status: failed ? 'failed' : 'delivered',
      at: new Date().toISOString(),
      recipients: delivered,
      error: failed ? 'portal_delivery_failed' : null,
    };
  }

  private async deliverEmail(content: OperationalAlertMail): Promise<EmailDeliveryOutcome> {
    const recipients = this.config.operations.alertRecipients ?? [];
    const provider = this.mail.providerMode;
    if (recipients.length === 0) {
      return { status: 'not_configured', at: null, recipients: 0, provider, error: null };
    }
    try {
      const result = await this.mail.sendOperationalAlert(recipients, content);
      return {
        status: result.status,
        at: new Date().toISOString(),
        recipients: result.recipients,
        provider: result.provider,
        error: result.status === 'failed' ? 'mail_delivery_failed' : null,
      };
    } catch {
      return {
        status: 'failed',
        at: new Date().toISOString(),
        recipients: recipients.length,
        provider,
        error: 'mail_delivery_failed',
      };
    }
  }

  private async writeAudit(
    action: AuditActionName,
    alert: OperationalAlert,
    actor: { userId: string; role: UserRole } | null,
    metadata: Record<string, unknown>,
  ): Promise<AuditDeliveryOutcome> {
    let recorded = false;
    try {
      recorded = await this.audit.record({
        action,
        actor,
        resourceType: 'operational_alert',
        resourceId: alert.id,
        metadata,
      });
    } catch {
      recorded = false;
    }
    return recorded
      ? { status: 'recorded', at: new Date().toISOString(), error: null }
      : { status: 'failed', at: null, error: 'audit_write_failed' };
  }

  /** A delivery-failed audit event and log line, written whenever possible. */
  private async reportFailure(alert: OperationalAlert, attempt: AlertDeliveryAttempt): Promise<void> {
    const errors = [attempt.portal.error, attempt.email.error, attempt.audit.error].filter(
      (code): code is AlertDeliveryErrorCode => code !== null && code !== 'no_eligible_administrators',
    );
    const facts = {
      deliveryEvent: attempt.event,
      alertId: alert.id,
      severity: attempt.severity,
      metric: alert.metric,
      correlationId: attempt.correlationId,
      errors,
      ...this.channelSummary(attempt),
    };
    this.logger.warn({ event: OPERATIONAL_ALERT_LOG_EVENTS.deliveryFailed, ...facts });
    await this.writeAudit(OPERATIONAL_ALERT_AUDIT_ACTIONS.deliveryFailed, alert, null, facts);
  }

  private logFacts(content: OperationalAlertMail): Record<string, unknown> {
    const { event: _event, recommendedAction: _action, ...facts } = content;
    return facts;
  }

  private channelSummary(attempt: AlertDeliveryAttempt): Record<string, unknown> {
    return {
      portal: {
        status: attempt.portal.status,
        recipients: attempt.portal.recipients,
        error: attempt.portal.error,
      },
      email: {
        status: attempt.email.status,
        recipients: attempt.email.recipients,
        provider: attempt.email.provider,
        error: attempt.email.error,
      },
      audit: attempt.audit.status,
    };
  }

  /**
   * Appends the attempt and applies the state change under a row lock, re-reading
   * the stored metadata so a concurrent acknowledgement's history entry is not
   * lost. Only lastNotifiedAt and deliveryMetadata are written, never the
   * acknowledgement or status columns.
   */
  private async persist(
    alert: OperationalAlert,
    attempt: AlertDeliveryAttempt,
    patch: StatePatch,
  ): Promise<void> {
    await this.alerts.manager.transaction(async (manager) => {
      const repo = manager.getRepository(OperationalAlert);
      const fresh = await repo.findOne({
        where: { id: alert.id },
        lock: { mode: 'pessimistic_write' },
      });
      const current = readDeliveryMetadata(fresh ? fresh.deliveryMetadata : alert.deliveryMetadata);
      const next: AlertDeliveryMetadata = {
        version: 1,
        notifiedSeverity: patch.notifiedSeverity ?? current.notifiedSeverity,
        lastReminderAt: patch.lastReminderAt ?? current.lastReminderAt,
        lastAttempt: attempt,
        history: [attempt, ...current.history].slice(0, ALERT_DELIVERY_HISTORY_LIMIT),
      };
      const changes: Pick<OperationalAlert, 'deliveryMetadata'> &
        Partial<Pick<OperationalAlert, 'lastNotifiedAt'>> = {
        deliveryMetadata: next as unknown as Record<string, unknown>,
      };
      if (patch.lastNotifiedAt) changes.lastNotifiedAt = patch.lastNotifiedAt;
      await repo.update(alert.id, changes as QueryDeepPartialEntity<OperationalAlert>);
      Object.assign(alert, changes);
    });
  }
}
