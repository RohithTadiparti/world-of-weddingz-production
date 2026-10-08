import { useEffect, useRef } from 'react';
import { formatDateTime } from '../../../lib/dates';
import {
  ALERT_STATUS_LABEL,
  ALERT_STATUS_PILL,
  AUDIT_DELIVERY_LABEL,
  DELIVERY_EVENT_LABEL,
  EMAIL_DELIVERY_LABEL,
  PORTAL_DELIVERY_LABEL,
  SEVERITY_PILL,
  formatMeasurement,
  formatNumber,
  metricLabel,
  type DeliveryAttempt,
  type OperationalAlert,
} from '../../../lib/infrastructure';

/**
 * Operational alerts in the server's order: critical before warning, then the
 * most recently observed. Active and resolved alerts are separated without
 * re-sorting either group.
 *
 * `highlightId` comes from `?alert=:id`, the target of an operational alert
 * notification; that row is marked and scrolled into view.
 */
export default function OperationalAlerts({
  alerts,
  highlightId,
  onAcknowledge,
  pendingId,
  acknowledgeError,
}: {
  alerts: OperationalAlert[];
  highlightId: string | null;
  onAcknowledge: (id: string) => void;
  pendingId: string | null;
  acknowledgeError: { id: string; message: string } | null;
}) {
  const active = alerts.filter((alert) => alert.status !== 'resolved');
  const resolved = alerts.filter((alert) => alert.status === 'resolved');
  const highlightMissing = Boolean(highlightId) && !alerts.some((alert) => alert.id === highlightId);

  return (
    <section aria-labelledby="alerts-heading" className="space-y-4">
      <div>
        <h2 id="alerts-heading" className="section-title">
          Operational alerts
        </h2>
        <p className="section-subtitle">
          Critical first, then the most recently observed. Acknowledging records who picked an alert up; it changes nothing
          else.
        </p>
      </div>

      {highlightMissing && (
        <div className="alert-caution" role="status" data-state="highlight-missing">
          The alert from your notification is no longer in this list.
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="alert-neutral" role="status" data-state="empty">
          No operational alerts have been raised.
        </div>
      ) : (
        <>
          <AlertGroup
            title={`Active (${active.length})`}
            empty="No active alerts."
            alerts={active}
            highlightId={highlightId}
            onAcknowledge={onAcknowledge}
            pendingId={pendingId}
            acknowledgeError={acknowledgeError}
          />
          {resolved.length > 0 && (
            <AlertGroup
              title={`Resolved (${resolved.length})`}
              empty=""
              alerts={resolved}
              highlightId={highlightId}
              onAcknowledge={onAcknowledge}
              pendingId={pendingId}
              acknowledgeError={acknowledgeError}
            />
          )}
        </>
      )}
    </section>
  );
}

function AlertGroup({
  title,
  empty,
  alerts,
  ...row
}: {
  title: string;
  empty: string;
  alerts: OperationalAlert[];
  highlightId: string | null;
  onAcknowledge: (id: string) => void;
  pendingId: string | null;
  acknowledgeError: { id: string; message: string } | null;
}) {
  return (
    <div className="space-y-2">
      <h3 className="eyebrow">{title}</h3>
      {alerts.length === 0 ? (
        <p className="text-sm text-gray-600">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} {...row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  highlightId,
  onAcknowledge,
  pendingId,
  acknowledgeError,
}: {
  alert: OperationalAlert;
  highlightId: string | null;
  onAcknowledge: (id: string) => void;
  pendingId: string | null;
  acknowledgeError: { id: string; message: string } | null;
}) {
  const highlighted = alert.id === highlightId;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlighted]);
  const pending = pendingId === alert.id;

  return (
    <li
      ref={ref}
      id={`alert-${alert.id}`}
      data-alert-id={alert.id}
      data-status={alert.status}
      data-severity={alert.severity}
      data-highlighted={highlighted ? 'true' : undefined}
      aria-current={highlighted ? 'true' : undefined}
      className={`card space-y-3 ${highlighted ? 'border-brand ring-2 ring-brand/40' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className={SEVERITY_PILL[alert.severity]}>{alert.severity === 'critical' ? 'Critical' : 'Warning'}</span>
            <span className={ALERT_STATUS_PILL[alert.status]}>{ALERT_STATUS_LABEL[alert.status]}</span>
            {highlighted && <span className="pill-brand">From your notification</span>}
          </p>
          <h4 className="text-[0.9375rem] font-medium text-gray-900">{metricLabel(alert.metric)}</h4>
        </div>
        {alert.status === 'open' && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onAcknowledge(alert.id)}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Acknowledging' : 'Acknowledge'}
          </button>
        )}
      </div>

      {acknowledgeError?.id === alert.id && (
        <div className="alert-critical" role="alert">
          {acknowledgeError.message}
        </div>
      )}

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-gray-500">Observed</dt>
        <dd className="tabular-nums text-gray-900">{formatMeasurement(alert.observedValue, alert.unit)}</dd>
        <dt className="text-gray-500">Threshold</dt>
        <dd className="tabular-nums text-gray-900">{formatMeasurement(alert.thresholdValue, alert.unit)}</dd>
        <dt className="text-gray-500">Unit</dt>
        <dd className="text-gray-900">{alert.unit}</dd>
        <dt className="text-gray-500">Source</dt>
        <dd className="text-gray-900">{alert.source}</dd>
        <dt className="text-gray-500">First observed</dt>
        <dd className="text-gray-900">{formatDateTime(alert.firstObservedAt)}</dd>
        <dt className="text-gray-500">Last observed</dt>
        <dd className="text-gray-900">{formatDateTime(alert.lastObservedAt)}</dd>
        <dt className="text-gray-500">Acknowledged</dt>
        <dd className="text-gray-900" data-testid="acknowledgement">
          {alert.acknowledgedAt
            ? `${formatDateTime(alert.acknowledgedAt)} by ${alert.acknowledgedBy ?? 'an unrecorded actor'}`
            : 'Not acknowledged'}
        </dd>
        {alert.resolvedAt && (
          <>
            <dt className="text-gray-500">Resolved</dt>
            <dd className="text-gray-900">{formatDateTime(alert.resolvedAt)}</dd>
          </>
        )}
      </dl>

      <Delivery alert={alert} />
    </li>
  );
}

function Delivery({ alert }: { alert: OperationalAlert }) {
  const { delivery } = alert;
  if (!delivery.recorded || !delivery.lastAttempt) {
    return (
      <p className="text-xs text-gray-600" data-testid="delivery">
        No delivery has been recorded for this alert yet.
      </p>
    );
  }
  return (
    <div className="space-y-1 text-xs" data-testid="delivery">
      <p className="text-gray-500">
        Last delivery: {DELIVERY_EVENT_LABEL[delivery.lastAttempt.event ?? ''] ?? 'Unrecorded event'}
        {delivery.lastAttempt.at ? ` at ${formatDateTime(delivery.lastAttempt.at)}` : ''}
        {delivery.lastReminderAt ? ` · last reminder ${formatDateTime(delivery.lastReminderAt)}` : ''}
        {delivery.history.length > 0 ? ` · ${formatNumber(delivery.history.length)} attempts recorded` : ''}
      </p>
      <ChannelList attempt={delivery.lastAttempt} />
    </div>
  );
}

function ChannelList({ attempt }: { attempt: DeliveryAttempt }) {
  const { portal, email, audit } = attempt;
  const recipients = (n: number | null, noun: string) =>
    n === null ? '' : ` to ${formatNumber(n)} ${noun}${n === 1 ? '' : 's'}`;
  return (
    <ul className="flex flex-wrap gap-2">
      <li className={portal.status === 'failed' ? 'pill-critical' : 'pill-neutral'} data-channel="portal">
        {portal.status ? PORTAL_DELIVERY_LABEL[portal.status] : 'Portal state unrecorded'}
        {portal.status === 'delivered' ? recipients(portal.recipients, 'administrator') : ''}
        {portal.error ? ` (${portal.error})` : ''}
      </li>
      <li
        className={email.status === 'failed' ? 'pill-critical' : email.status === 'simulated' ? 'pill-caution' : 'pill-neutral'}
        data-channel="email"
      >
        {email.status ? EMAIL_DELIVERY_LABEL[email.status] : 'Email state unrecorded'}
        {email.status === 'sent' || email.status === 'simulated' ? recipients(email.recipients, 'recipient') : ''}
        {email.provider ? ` · provider ${email.provider}` : ''}
        {email.error ? ` (${email.error})` : ''}
      </li>
      <li className={audit.status === 'failed' ? 'pill-critical' : 'pill-neutral'} data-channel="audit">
        {audit.status ? AUDIT_DELIVERY_LABEL[audit.status] : 'Audit state unrecorded'}
        {audit.error ? ` (${audit.error})` : ''}
      </li>
    </ul>
  );
}
