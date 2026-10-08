import { Link } from 'react-router-dom';
import { formatDateTime } from '../../../lib/dates';
import {
  ALERT_STATUS_LABEL,
  FRESHNESS_LABEL,
  FRESHNESS_PILL,
  STATUS_LABEL,
  STATUS_PILL,
  STATUS_REASON_LABEL,
  formatMeasurement,
  formatNumber,
  metricLabel,
  type CapacityMetricStatus,
  type OperationsStatus,
} from '../../../lib/infrastructure';

/**
 * Capacity, one card per metric, exactly as the latest snapshot stored it.
 *
 * The status pill is the server's: a metric with no value, or with a value
 * from a stale snapshot, is "Unknown" in neutral grey. Nothing on this panel
 * is green unless the server said ok about a fresh value.
 */
export default function CapacityStatus({ status }: { status: OperationsStatus }) {
  const { snapshot, staleness } = status;
  return (
    <section aria-labelledby="capacity-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="capacity-heading" className="section-title">
            Capacity
          </h2>
          <p className="section-subtitle">
            Collected every {staleness.collectionIntervalMinutes} minutes. A snapshot whose period began more than{' '}
            {staleness.staleAfterMinutes} minutes ago is stale, and its metrics are reported as unknown.
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span>Overall</span>
          <span className={STATUS_PILL[status.overallStatus]} data-testid="overall-status">
            {STATUS_LABEL[status.overallStatus]}
          </span>
        </p>
      </div>

      {!snapshot ? (
        <div className="alert-caution" role="status" data-state="empty">
          No capacity snapshot has been collected yet, so every metric is unknown.
        </div>
      ) : (
        <p className="text-sm text-gray-600" data-testid="snapshot-meta">
          Snapshot period {formatDateTime(snapshot.periodStart)} · written {formatDateTime(snapshot.collectedAt)} ·{' '}
          {formatNumber(snapshot.ageMinutes)} minutes old ·{' '}
          <span className={FRESHNESS_PILL[snapshot.freshness]}>{FRESHNESS_LABEL[snapshot.freshness]}</span>
        </p>
      )}
      {snapshot?.freshness === 'stale' && (
        <div className="alert-caution" role="status" data-state="stale">
          The latest snapshot is stale. Its values are shown for reference only and are not evaluated against thresholds.
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {status.metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} />
        ))}
      </ul>
    </section>
  );
}

function MetricCard({ metric }: { metric: CapacityMetricStatus }) {
  const { thresholds } = metric;
  const notMeasured = metric.statusReason === 'not_measured';
  return (
    <li className="card space-y-3" data-metric={metric.key} data-status={metric.status}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-800">{metricLabel(metric.key)}</h3>
        <span className="flex flex-wrap justify-end gap-1.5">
          {metric.estimate && (
            <span className="pill-caution" data-testid="metric-estimate">
              Configured estimate
            </span>
          )}
          <span className={STATUS_PILL[metric.status]}>{STATUS_LABEL[metric.status]}</span>
        </span>
      </div>
      {notMeasured ? (
        <p className="text-2xl font-semibold text-gray-900" data-testid="metric-value">
          Not measured
        </p>
      ) : (
        <p className="text-2xl font-semibold tabular-nums text-gray-900" data-testid="metric-value">
          {formatMeasurement(metric.value, metric.unit)}
          {metric.estimate && <span className="ml-2 text-sm font-normal text-gray-600">(configured estimate)</span>}
        </p>
      )}
      {notMeasured && (
        <p className="text-xs text-gray-600" data-testid="placeholder-value">
          Configured placeholder value: {formatMeasurement(metric.value, metric.unit)}
        </p>
      )}
      {metric.statusReason && <p className="text-xs text-gray-600">{STATUS_REASON_LABEL[metric.statusReason]}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500">Warning at</dt>
        <dd className="tabular-nums text-gray-800">
          {thresholds ? formatMeasurement(thresholds.warning, thresholds.unit) : 'Not configured'}
        </dd>
        <dt className="text-gray-500">Critical at</dt>
        <dd className="tabular-nums text-gray-800">
          {thresholds ? formatMeasurement(thresholds.critical, thresholds.unit) : 'Not configured'}
        </dd>
        <dt className="text-gray-500">Unit</dt>
        <dd className="text-gray-800">{metric.unit ?? 'None stored'}</dd>
        <dt className="text-gray-500">Source</dt>
        <dd className="text-gray-800">{metric.source ?? 'None stored'}</dd>
        {metric.windowMinutes !== null && (
          <>
            <dt className="text-gray-500">Window</dt>
            <dd className="text-gray-800">{formatNumber(metric.windowMinutes)} minutes</dd>
          </>
        )}
        <dt className="text-gray-500">Collected</dt>
        <dd className="text-gray-800">{formatDateTime(metric.collectedAt, 'Never')}</dd>
        <dt className="text-gray-500">Freshness</dt>
        <dd>
          <span className={FRESHNESS_PILL[metric.freshness]}>{FRESHNESS_LABEL[metric.freshness]}</span>
        </dd>
        <dt className="text-gray-500">Alert</dt>
        <dd className="text-gray-800">
          {metric.alert.state === 'none' || !metric.alert.alertId ? (
            'None'
          ) : (
            <Link className="text-brand underline-offset-2 hover:underline" to={`/admin/infrastructure?alert=${metric.alert.alertId}`}>
              {ALERT_STATUS_LABEL[metric.alert.state]}
              {metric.alert.severity ? ` (${metric.alert.severity})` : ''}
            </Link>
          )}
        </dd>
      </dl>
    </li>
  );
}
