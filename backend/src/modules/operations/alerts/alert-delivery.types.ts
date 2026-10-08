/**
 * Persisted, non-secret delivery state for an operational alert.
 *
 * Written by AlertDeliveryService (OPS-003) into
 * `operational_alerts.deliveryMetadata` and read unchanged by the
 * administrator Infrastructure API (UI-001). It never holds recipient
 * addresses, provider messages, credentials, tokens, cookies or request
 * bodies: only counts, statuses, timestamps and stable error codes.
 */
export type AlertDeliveryEvent = 'opened' | 'promoted' | 'reminder' | 'acknowledged' | 'resolved';

export type PortalDeliveryStatus = 'delivered' | 'failed' | 'skipped';

/**
 * `simulated` means the log/mock mail provider recorded the message; nothing
 * reached an inbox. `not_configured` means no operational recipients exist.
 */
export type EmailDeliveryStatus = 'sent' | 'simulated' | 'failed' | 'skipped' | 'not_configured';

export type AuditDeliveryStatus = 'recorded' | 'failed';

/** Stable, non-secret failure codes. Never a provider error message. */
export type AlertDeliveryErrorCode =
  | 'portal_delivery_failed'
  | 'mail_delivery_failed'
  | 'audit_write_failed'
  | 'no_eligible_administrators';

export interface PortalDeliveryOutcome {
  status: PortalDeliveryStatus;
  /** ISO-8601 time the channel finished, or null when it did not run. */
  at: string | null;
  /** Number of administrators notified. */
  recipients: number;
  error: AlertDeliveryErrorCode | null;
}

export interface EmailDeliveryOutcome {
  status: EmailDeliveryStatus;
  at: string | null;
  /** Number of configured operational recipients addressed. */
  recipients: number;
  /** Mail provider mode, for example `log` or `smtp`. */
  provider: string;
  error: AlertDeliveryErrorCode | null;
}

export interface AuditDeliveryOutcome {
  status: AuditDeliveryStatus;
  at: string | null;
  error: AlertDeliveryErrorCode | null;
}

export interface AlertDeliveryAttempt {
  event: AlertDeliveryEvent;
  /** ISO-8601 time of the attempt. */
  at: string;
  correlationId: string;
  severity: 'warning' | 'critical';
  portal: PortalDeliveryOutcome;
  email: EmailDeliveryOutcome;
  audit: AuditDeliveryOutcome;
}

export interface AlertDeliveryMetadata {
  version: 1;
  /** Highest severity already announced, so a promotion sends exactly once. */
  notifiedSeverity: 'warning' | 'critical' | null;
  /** ISO-8601 time of the last reminder sent, or null. */
  lastReminderAt: string | null;
  lastAttempt: AlertDeliveryAttempt | null;
  /** Newest first, at most ALERT_DELIVERY_HISTORY_LIMIT entries. */
  history: AlertDeliveryAttempt[];
}

export const ALERT_DELIVERY_HISTORY_LIMIT = 20;

export const EMPTY_ALERT_DELIVERY_METADATA: AlertDeliveryMetadata = {
  version: 1,
  notifiedSeverity: null,
  lastReminderAt: null,
  lastAttempt: null,
  history: [],
};

/** Stable audit action names for the operational alert lifecycle. */
export const OPERATIONAL_ALERT_AUDIT_ACTIONS = {
  opened: 'operations.alert_opened',
  promoted: 'operations.alert_promoted',
  reminded: 'operations.alert_reminded',
  acknowledged: 'operations.alert_acknowledged',
  resolved: 'operations.alert_resolved',
  deliveryFailed: 'operations.alert_delivery_failed',
} as const;

/** Stable structured-log event names for the operational alert lifecycle. */
export const OPERATIONAL_ALERT_LOG_EVENTS = {
  delivered: 'operational_alert.delivered',
  suppressed: 'operational_alert.suppressed',
  acknowledged: 'operational_alert.acknowledged',
  resolved: 'operational_alert.resolved',
  deliveryFailed: 'operational_alert.delivery_failed',
} as const;
