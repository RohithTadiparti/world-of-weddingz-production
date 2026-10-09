import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HardDrives } from '@phosphor-icons/react';
import {
  INFRASTRUCTURE_QUERY_KEYS,
  STATUS_LABEL,
  STATUS_PILL,
  fetchOperationsStatus,
  httpStatus,
} from '../../../lib/infrastructure';

/**
 * The Infrastructure tile on the admin dashboard. Rendered only for holders
 * of admin:infrastructure:read. A failed or missing read is "Unknown", in the
 * neutral colour, never a reassuring one.
 */
export default function InfrastructureSummary() {
  const { data, error, isPending } = useQuery({
    queryKey: INFRASTRUCTURE_QUERY_KEYS.status,
    queryFn: fetchOperationsStatus,
    retry: false,
  });
  const overall = data?.overallStatus ?? 'unknown';

  let detail: string;
  if (error) {
    detail = httpStatus(error) === 403 ? 'Not permitted to read capacity.' : 'Capacity status could not be loaded.';
  } else if (isPending) {
    detail = 'Loading capacity status';
  } else if (!data?.snapshot) {
    detail = 'No capacity snapshot collected yet.';
  } else {
    const { critical, warning, unknown } = data.counts;
    detail = `${critical} critical · ${warning} warning · ${unknown} unknown · snapshot ${data.snapshot.freshness}`;
  }

  return (
    <Link
      to="/admin/infrastructure"
      className="card group flex flex-wrap items-center justify-between gap-3 transition-colors duration-200 ease-out hover:border-brand focus-visible:border-brand"
      data-testid="infrastructure-summary"
    >
      <span className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-brand-soft text-brand-strong">
          <HardDrives size={22} weight="duotone" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-medium text-gray-900">Infrastructure</span>
          <span className="block text-xs text-gray-600">{detail}</span>
        </span>
      </span>
      <span className={error || isPending ? STATUS_PILL.unknown : STATUS_PILL[overall]}>
        {error || isPending ? STATUS_LABEL.unknown : STATUS_LABEL[overall]}
      </span>
    </Link>
  );
}
