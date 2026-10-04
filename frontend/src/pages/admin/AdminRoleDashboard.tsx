import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import Dashboard from '../Dashboard';
import { api } from '../../lib/api';
import { EmptyState, Loading } from '../../components/ui/Feedback';

export type AdminRole = 'agent' | 'vendor' | 'planner' | 'officer';

const ROLE_LABEL: Record<AdminRole, string> = {
  agent: 'Agent Portal',
  vendor: 'Vendor Portal',
  planner: 'Wedding Planner Portal',
  officer: 'Verification Officer Portal',
};

/**
 * The admin shell for an existing role portal. The dashboard below this point
 * is deliberately selected by role rather than recreated for administration.
 */
export default function AdminRoleDashboard({ role }: { role: AdminRole }) {
  const params = useParams();
  const userId = params.id ?? params.agentId ?? params.vendorId ?? params.plannerId ?? params.officerId ?? '';
  const account = useQuery<{ user: { email: string; isActive: boolean }; profiles: { displayName: string }[] }>({
    queryKey: ['admin-role-account', userId],
    queryFn: async () => (await api.get(`/admin/accounts/${userId}`)).data,
    enabled: Boolean(userId),
    retry: false,
  });

  if (account.isLoading) return <Loading rows={4} />;
  if (account.isError || !account.data) {
    return <EmptyState title="Account not found">The selected role portal could not be opened.</EmptyState>;
  }

  const name = account.data.profiles[0]?.displayName ?? account.data.user.email;

  return (
    <div className="space-y-5">
      <header className="rounded-lg border border-brand/20 bg-surface px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-strong">
              ADMIN VIEW • READ ONLY
            </p>
            <h1 className="page-title mt-1">{name}</h1>
            <p className="text-sm text-gray-500">{ROLE_LABEL[role]}</p>
          </div>
          <span className={`pill ${account.data.user.isActive ? 'bg-positive-bg text-positive-fg' : 'bg-critical-bg text-critical-fg'}`}>
            {account.data.user.isActive ? 'Active' : 'Suspended'}
          </span>
        </div>
      </header>

      <section aria-label={`${ROLE_LABEL[role]} read-only dashboard`} data-admin-view="read-only">
        <Dashboard adminUserId={userId} readOnly adminView roleOverride={role} />
      </section>
    </div>
  );
}
