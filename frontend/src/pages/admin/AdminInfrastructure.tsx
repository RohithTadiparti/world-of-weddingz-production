import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/ui/Feedback';
import CapacityStatus from '../../components/admin/infrastructure/CapacityStatus';
import OperationalAlerts from '../../components/admin/infrastructure/OperationalAlerts';
import MigrationReadiness from '../../components/admin/infrastructure/MigrationReadiness';
import { SectionState } from '../../components/admin/infrastructure/SectionState';
import { apiMessage } from '../../lib/api-errors';
import {
  INFRASTRUCTURE_QUERY_KEYS,
  acknowledgeAlert,
  fetchMigrationReadiness,
  fetchOperationalAlerts,
  fetchOperationsStatus,
} from '../../lib/infrastructure';
import { Permission, can } from '../../lib/permissions';
import { usePermissions } from '../../store/auth';

/**
 * The administrator Infrastructure page (UI-001): capacity, operational
 * alerts and AWS migration readiness, each exactly as the server persisted
 * and evaluated it. Every section has its own loading, refused and failed
 * state, so one failing endpoint never makes another section look healthy.
 */
export default function AdminInfrastructure() {
  const permissions = usePermissions();
  const allowed = can(permissions, Permission.ADMIN_INFRASTRUCTURE_READ);

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Infrastructure" />
        <div className="alert-critical" role="alert" data-state="forbidden">
          Your account does not have permission to view infrastructure. It needs admin:infrastructure:read.
        </div>
      </div>
    );
  }
  return <InfrastructureSections />;
}

function InfrastructureSections() {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const highlightId = params.get('alert');

  const status = useQuery({
    queryKey: INFRASTRUCTURE_QUERY_KEYS.status,
    queryFn: fetchOperationsStatus,
    retry: false,
    refetchInterval: 60_000,
  });
  const alerts = useQuery({
    queryKey: INFRASTRUCTURE_QUERY_KEYS.alerts,
    queryFn: fetchOperationalAlerts,
    retry: false,
    refetchInterval: 60_000,
  });
  const readiness = useQuery({
    queryKey: INFRASTRUCTURE_QUERY_KEYS.readiness,
    queryFn: fetchMigrationReadiness,
    retry: false,
  });

  const [acknowledgeError, setAcknowledgeError] = useState<{ id: string; message: string } | null>(null);
  const acknowledge = useMutation({
    mutationFn: (id: string) => acknowledgeAlert(client, id),
    onMutate: () => setAcknowledgeError(null),
    onError: (error, id) => setAcknowledgeError({ id, message: apiMessage(error, 'The alert could not be acknowledged.') }),
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Infrastructure">
        Capacity, operational alerts and migration readiness, exactly as measured. Missing or stale data is shown as unknown.
      </PageHeader>

      <SectionState
        label="capacity status"
        isLoading={status.isPending}
        error={status.error}
        onRetry={() => void status.refetch()}
      >
        {status.data && <CapacityStatus status={status.data} />}
      </SectionState>

      <SectionState
        label="operational alerts"
        isLoading={alerts.isPending}
        error={alerts.error}
        onRetry={() => void alerts.refetch()}
      >
        {alerts.data && (
          <OperationalAlerts
            alerts={alerts.data.data}
            highlightId={highlightId}
            onAcknowledge={(id) => acknowledge.mutate(id)}
            pendingId={acknowledge.isPending ? (acknowledge.variables ?? null) : null}
            acknowledgeError={acknowledgeError}
          />
        )}
      </SectionState>

      <SectionState
        label="migration readiness"
        isLoading={readiness.isPending}
        error={readiness.error}
        onRetry={() => void readiness.refetch()}
      >
        {readiness.data && <MigrationReadiness readiness={readiness.data} />}
      </SectionState>
    </div>
  );
}
