import { isValidRequestId } from '../../../common/logging/request-id';
import {
  RedactedDeliveryAttempt,
  RedactedDeliveryState,
} from '../dto/operations.dto';
import { OperationalAlertSeverity } from '../entities/operational-alert.entity';
import {
  ALERT_DELIVERY_HISTORY_LIMIT,
  AlertDeliveryErrorCode,
  AlertDeliveryEvent,
  AuditDeliveryStatus,
  EmailDeliveryStatus,
  PortalDeliveryStatus,
} from './alert-delivery.types';

/**
 * Projects persisted `deliveryMetadata` onto the non-secret contract fields.
 *
 * The column is JSON written by another module, and OPS-002 rows hold `{}`.
 * Nothing is passed through by spreading: every field is read by name, checked
 * against the closed set of values the contract allows, and dropped (null)
 * otherwise. A recipient address, provider message or credential written by
 * mistake therefore never reaches the API, whatever key it sits under.
 */

const EVENTS: readonly AlertDeliveryEvent[] = ['opened', 'promoted', 'reminder', 'acknowledged', 'resolved'];
const SEVERITIES: readonly OperationalAlertSeverity[] = ['warning', 'critical'];
const PORTAL: readonly PortalDeliveryStatus[] = ['delivered', 'failed', 'skipped'];
const EMAIL: readonly EmailDeliveryStatus[] = ['sent', 'simulated', 'failed', 'skipped', 'not_configured'];
const AUDIT: readonly AuditDeliveryStatus[] = ['recorded', 'failed'];
const ERRORS: readonly AlertDeliveryErrorCode[] = [
  'portal_delivery_failed',
  'mail_delivery_failed',
  'audit_write_failed',
  'no_eligible_administrators',
];
/** Mail provider modes the canonical configuration can select. */
const MAIL_PROVIDERS = ['log', 'smtp'] as const;

type Json = Record<string, unknown>;

const record = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

const isoTime = (value: unknown): string | null => {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

export function redactDeliveryAttempt(value: unknown): RedactedDeliveryAttempt | null {
  const attempt = record(value);
  if (!attempt) return null;
  const portal = record(attempt.portal) ?? {};
  const email = record(attempt.email) ?? {};
  const audit = record(attempt.audit) ?? {};
  return {
    event: oneOf(EVENTS, attempt.event),
    at: isoTime(attempt.at),
    correlationId: isValidRequestId(attempt.correlationId) ? attempt.correlationId : null,
    severity: oneOf(SEVERITIES, attempt.severity),
    portal: {
      status: oneOf(PORTAL, portal.status),
      at: isoTime(portal.at),
      recipients: count(portal.recipients),
      error: oneOf(ERRORS, portal.error),
    },
    email: {
      status: oneOf(EMAIL, email.status),
      at: isoTime(email.at),
      recipients: count(email.recipients),
      provider: oneOf(MAIL_PROVIDERS, email.provider),
      error: oneOf(ERRORS, email.error),
    },
    audit: {
      status: oneOf(AUDIT, audit.status),
      at: isoTime(audit.at),
      error: oneOf(ERRORS, audit.error),
    },
  };
}

export function redactDeliveryState(
  metadata: unknown,
  lastNotifiedAt: Date | string | null,
): RedactedDeliveryState {
  const meta = record(metadata);
  const recorded = meta?.version === 1;
  const history = recorded && Array.isArray(meta.history)
    ? meta.history
        .slice(0, ALERT_DELIVERY_HISTORY_LIMIT)
        .map(redactDeliveryAttempt)
        .filter((attempt): attempt is RedactedDeliveryAttempt => attempt !== null)
    : [];
  return {
    recorded,
    notifiedSeverity: recorded ? oneOf(SEVERITIES, meta.notifiedSeverity) : null,
    lastReminderAt: recorded ? isoTime(meta.lastReminderAt) : null,
    lastNotifiedAt: isoTime(lastNotifiedAt),
    lastAttempt: recorded ? redactDeliveryAttempt(meta.lastAttempt) : null,
    history,
  };
}
