import { formatMoney } from '../../../lib/labels';
import { STATUS_LABEL, STATUS_PILL, type MigrationReadiness as Readiness } from '../../../lib/infrastructure';

const PREREQUISITE_PILL = { met: 'pill-positive', unmet: 'pill-critical', unknown: 'pill-neutral' } as const;
const PREREQUISITE_LABEL = { met: 'Met', unmet: 'Not met', unknown: 'Unknown' } as const;

const REVENUE_STATUS_LABEL: Record<Readiness['revenue']['status'], string> = {
  unknown: 'Not measured',
  below_minimum: 'Below the minimum',
  minimum_met: 'Minimum met',
  preferred_met: 'Preferred target met',
};

/**
 * Whether an AWS migration could start, and every reason it cannot.
 *
 * Read-only by design (UI-001). The button exists so the blocked state is
 * visible where the action will live. It is always disabled here and has no
 * handler at all, and it lists every unmet prerequisite the server reports:
 * starting a migration belongs to MIG-001 behind AUTH-001 step-up.
 */
export default function MigrationReadiness({ readiness }: { readiness: Readiness }) {
  const { revenue, migration } = readiness;
  const unmet = readiness.prerequisites.filter((p) => p.status !== 'met');
  const blocked = !readiness.available || unmet.length > 0;

  return (
    <section aria-labelledby="migration-heading" className="card space-y-5">
      <div>
        <h2 id="migration-heading" className="section-title">
          AWS migration readiness
        </h2>
        <p className="section-subtitle">
          Migration is started by a person, never by a threshold. It stays unavailable until every prerequisite below is met.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[--radius-md] bg-surface-sunken px-4 py-3">
          <p className="text-xl font-semibold tabular-nums text-gray-900" data-testid="revenue-minimum">
            {formatMoney(revenue.minimumMonthlyNetInr)}
          </p>
          <p className="text-xs text-gray-500">Minimum monthly net revenue</p>
        </div>
        <div className="rounded-[--radius-md] bg-surface-sunken px-4 py-3">
          <p className="text-xl font-semibold tabular-nums text-gray-900" data-testid="revenue-preferred">
            {formatMoney(revenue.preferredMonthlyNetInr)}
          </p>
          <p className="text-xs text-gray-500">Preferred monthly net revenue</p>
        </div>
        <div className="rounded-[--radius-md] bg-surface-sunken px-4 py-3">
          <p className="text-xl font-semibold tabular-nums text-gray-900" data-testid="revenue-measured">
            {revenue.measuredMonthlyNetInr === null ? 'Unknown' : formatMoney(revenue.measuredMonthlyNetInr)}
          </p>
          <p className="text-xs text-gray-500">Measured monthly net revenue · {REVENUE_STATUS_LABEL[revenue.status]}</p>
        </div>
      </div>
      <p className="text-xs text-gray-600">{revenue.detail}</p>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-gray-500">Migration enabled</dt>
        <dd className="text-gray-900">{migration.enabled ? 'Yes' : 'No'}</dd>
        <dt className="text-gray-500">Executor</dt>
        <dd className="text-gray-900">{migration.executor}</dd>
        <dt className="text-gray-500">Dry run</dt>
        <dd className="text-gray-900">{migration.dryRun ? 'Yes' : 'No'}</dd>
        <dt className="text-gray-500">Read-only window</dt>
        <dd className="text-gray-900">{migration.readOnlyWindowMinutes} minutes at most</dd>
        <dt className="text-gray-500">Railway kept read-only for</dt>
        <dd className="text-gray-900">{migration.railwayRetentionHours} hours</dd>
        <dt className="text-gray-500">Capacity</dt>
        <dd className="flex items-center gap-2 text-gray-900">
          <span className={STATUS_PILL[readiness.capacity.overallStatus]}>{STATUS_LABEL[readiness.capacity.overallStatus]}</span>
          {readiness.capacity.unknownMetrics > 0 && (
            <span>
              {readiness.capacity.unknownMetrics} {readiness.capacity.unknownMetrics === 1 ? 'metric' : 'metrics'} unknown
            </span>
          )}
        </dd>
      </dl>

      <div className="space-y-2">
        <h3 className="eyebrow">Prerequisites</h3>
        <ul className="divide-y divide-gray-200">
          {readiness.prerequisites.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2" data-prerequisite={p.id} data-status={p.status}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{p.label}</p>
                <p className="text-xs text-gray-600">
                  {p.detail}
                  {p.owner ? ` Owner: ${p.owner}.` : ''}
                </p>
              </div>
              <span className={PREREQUISITE_PILL[p.status]}>{PREREQUISITE_LABEL[p.status]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          className="btn"
          disabled
          aria-disabled="true"
          aria-describedby="migration-blockers"
          data-testid="start-migration"
        >
          Start AWS migration
        </button>
        <div id="migration-blockers" className="text-sm text-gray-700">
          {blocked ? (
            <>
              <p>Unavailable until these are met:</p>
              <ul className="ml-5 list-disc">
                {unmet.map((p) => (
                  <li key={p.id}>{p.label}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>All listed prerequisites are met, but starting a migration is not available in this release.</p>
          )}
        </div>
      </div>
    </section>
  );
}
