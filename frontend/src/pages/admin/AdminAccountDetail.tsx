import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, CaretDown } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import {
  BOOKING_STATUS_LABEL,
  CASE_STATUS_LABEL,
  VERIFICATION_LABEL,
  type ProfileLifecycle,
  LIFECYCLE_LABEL,
} from '../../lib/permissions';
import {
  BUSINESS_STATUS_LABEL,
  bookingAmountLabel,
  humanize,
  labelFrom,
  milestoneLabel,
  paymentStatusLabel,
  roleLabel,
} from '../../lib/labels';
import { EmptyState, Loading } from '../../components/ui/Feedback';

/**
 * One account and everything hanging off it, as a dedicated page (EZ1-I171,
 * EZ1-I172).
 *
 * The same drill-down for agents, their clients, vendors, wedding planners and
 * verification officers — they are all user accounts, and `/admin/accounts/:id`
 * already returns the profiles, businesses, bookings, cases, payments,
 * matchmaking, agency book and officer workload for any of them. This page
 * renders whichever of those the account actually has, and links every related
 * account and booking through to its own detail page. No data is invented: a
 * section with nothing behind it is not shown.
 */

type Kind = 'agent' | 'client' | 'vendor' | 'planner' | 'officer';

const KIND: Record<Kind, { title: string; listRoute: string; listLabel: string }> = {
  agent: { title: 'Agent', listRoute: '/admin/agents', listLabel: 'Agents' },
  client: { title: 'Client', listRoute: '/admin/users', listLabel: 'Users' },
  vendor: { title: 'Vendor', listRoute: '/admin/vendors', listLabel: 'Vendors' },
  planner: { title: 'Wedding planner', listRoute: '/admin/planners', listLabel: 'Wedding Planners' },
  officer: {
    title: 'Verification officer',
    listRoute: '/admin/officers',
    listLabel: 'Verification Officers',
  },
};

interface AccountUser {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  managedByAgentId: string | null;
  phone: string | null;
  createdAt: string;
}

interface RelatedAccount {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface BookingRow {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  /** The newest offer on a request with no agreed amount yet. */
  quotation?: { amount: string; currency?: string; stage?: string } | null;
}

interface AgentDashboard {
  totalClients: number;
  matchesFixed: number;
  remainingClients: number;
  interestsReceived: number;
  interestsSent: number;
  escrow: string;
  issuesPending: number;
  issuesSolved: number;
  issuesEscalated: number;
  clients: { id: string; userId: string | null; displayName: string; profileCode: string; city: string | null; profileCompleted: boolean; lifecycle: string; createdAt: string }[];
  matches: InterestRow[];
  interestsReceivedRows: InterestRow[];
  interestsSentRows: InterestRow[];
  payments: EscrowRow[];
  pendingIssues: IssueRow[];
  solvedIssues: IssueRow[];
  escalatedIssues: IssueRow[];
}

interface InterestRow {
  id: string;
  fromProfileId: string;
  toProfileId: string;
  status: string;
  matchFixedState: string;
  matchFixedAt: string | null;
  createdAt: string;
}

interface EscrowRow {
  id: string;
  bookingId: string;
  amount: string;
  currency: string;
  status: string;
  milestone: string;
  providerRef: string | null;
  createdAt: string;
}

interface IssueRow {
  id: string;
  title: string;
  category: string | null;
  status: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface AccountDetail {
  user: AccountUser;
  profiles: { id: string; displayName: string; lifecycle: string; city: string | null }[];
  businesses: { id: string; name: string; category: string; status: string; isApproved: boolean }[];
  bookings: BookingRow[];
  providerBookings: (BookingRow & { buyerName: string | null; serviceName: string | null; amountPaid: string })[];
  plannerBusinesses: {
    id: string;
    name: string;
    city: string | null;
    isApproved: boolean;
    bio: string | null;
    servesCities: string[];
    packages: { name: string; price: number; includes?: string[] }[];
    yearsExperience: number;
    contactPerson: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    address: string | null;
    state: string | null;
    pincode: string | null;
    website: string | null;
    ratingAvg: number;
    ratingCount: number;
  }[];
  casesRaised: { id: string; title: string; status: string; createdAt: string }[];
  casesAssigned: { id: string; title: string; status: string; createdAt: string }[];
  verifications: { id: string; applicantType: string; status: string; createdAt: string }[];
  matchmaking: { sent: number; received: number; accepted: number; fixed: number } | null;
  payments: {
    total: string;
    inEscrow: string;
    released: string;
    refunded: string;
    history: { id: string; amount: string; status: string; milestone: string; createdAt: string }[];
  };
  agency: { clients: RelatedAccount[]; charges: { id: string; amount: string; status: string; createdAt: string }[] } | null;
  agentDashboard: AgentDashboard | null;
  officer: {
    assigned: number;
    open: number;
    overdue: number;
    queue: { id: string; applicantType: string; status: string; createdAt: string }[];
    serviceAreas: { id: string; label: string; city: string | null; state: string | null; primary: boolean }[];
    decisions: {
      id: string;
      applicantType: string;
      status: string;
      decidedAt: string | null;
      createdAt: string;
    }[];
  } | null;
  metrics: {
    provider: { bookings: number; inEscrow: string; released: string };
    agent: { clients: number; bookings: number } | null;
    officer: Record<string, number> | null;
  };
}

interface VendorActivity {
  at: string;
  kind: string;
  summary: string;
  resourceType: string;
  resourceId: string;
}

const money = (v: string) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

export function buildSummaryCards(kind: Kind, data: AccountDetail, accountId: string) {
  const providerId = data.businesses[0]?.id ?? data.plannerBusinesses[0]?.id;

  if (kind === 'agent') {
    return [
      { label: 'Total clients', value: data.metrics.agent?.clients ?? 0, to: `/admin/users?role=bride&agentId=${accountId}` },
      { label: 'Bookings placed', value: data.metrics.agent?.bookings ?? 0, to: `/admin/bookings?userId=${accountId}` },
      { label: 'Interests sent', value: data.matchmaking?.sent ?? 0, to: undefined },
      { label: 'Matches fixed', value: data.matchmaking?.fixed ?? 0, to: undefined },
    ];
  }

  if (kind === 'officer') {
    const queue = data.officer?.queue ?? [];
    const decisions = data.officer?.decisions ?? [];
    const inProgress = queue.filter((v) => v.status === 'in_progress').length;
    const completed = decisions.length;
    const solved = data.casesAssigned.filter((c) => ['resolved', 'closed'].includes(c.status)).length;
    return [
      { label: 'Assigned verifications', value: data.officer?.assigned ?? 0, to: `/verification?officerUserId=${accountId}` },
      { label: 'Completed verifications', value: completed, to: `/verification?officerUserId=${accountId}&status=approved` },
      { label: 'In progress', value: inProgress, to: `/verification?officerUserId=${accountId}&status=in_progress` },
      { label: 'Missed / overdue', value: data.officer?.overdue ?? 0, to: `/verification?officerUserId=${accountId}` },
      { label: 'Cases assigned', value: data.casesAssigned.length, to: `/admin/support?tab=cases&assignee=${accountId}` },
      { label: 'Cases solved', value: solved, to: `/admin/support?tab=cases&assignee=${accountId}` },
    ];
  }

  return [
    { label: 'Total bookings', value: data.metrics.provider.bookings, to: providerId ? `/admin/bookings?providerId=${providerId}` : undefined },
    { label: 'Amount in escrow', value: money(data.metrics.provider.inEscrow), to: providerId ? `/admin/payments?providerId=${providerId}` : undefined },
    { label: 'Amount released', value: money(data.metrics.provider.released), to: providerId ? `/admin/payments?providerId=${providerId}` : undefined },
    { label: 'Recent payments', value: data.payments.history.length, to: undefined },
  ];
}

export default function AdminAccountDetail({ kind }: { kind: Kind }) {
  const { id, vendorId, agentId, plannerId, officerId, clientId } = useParams();
  const accountId = id ?? vendorId ?? agentId ?? plannerId ?? officerId ?? clientId ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = KIND[kind];
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error } = useQuery<AccountDetail>({
    queryKey: ['admin-account-detail', accountId],
    queryFn: async () => (await api.get(`/admin/accounts/${accountId}`)).data,
    // The agent dashboard is operational data. Poll while the detail page is
    // open so assignments, matches and case actions are reflected without an
    // administrator needing to reload it.
    refetchInterval: kind === 'agent' ? 15_000 : false,
    retry: false,
  });

  const { data: activity = [] } = useQuery<VendorActivity[]>({
    queryKey: ['admin-vendor-activity', id],
    queryFn: async () => (await api.get('/admin/activity', { params: { limit: 100 } })).data,
    enabled: Boolean(data && kind === 'vendor'),
    refetchInterval: 60000,
  });

  // Suspend or reinstate — an admin management action the backend already
  // exposes at PUT /admin/users/:id/status, surfaced here so a drill-down ends
  // in a decision rather than a dead end (EZ1-I188).
  async function setActive(active: boolean) {
    if (!window.confirm(active ? 'Reinstate this account?' : 'Suspend this account?')) return;
    setActionError('');
    setBusy(true);
    try {
      await api.put(`/admin/users/${accountId}/status`, { isActive: active });
      for (const k of ['admin-account-detail', 'analytics', 'audit'])
        qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      setActionError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleAdminAction(action: 'suspend' | 'deactivate' | 'delete') {
    const label = action === 'delete' ? 'delete this account' : action === 'deactivate' ? 'deactivate this account' : 'suspend this account';
    const prompt = action === 'delete'
      ? `This is a destructive admin action. Type in the account email to confirm deletion for ${name}.`
      : `Are you sure you want to ${label}?`;

    if (!window.confirm(prompt)) return;

    if (action === 'delete') {
      setActionError('Delete account is not available in the current backend workflow. The account should be suspended or deactivated instead.');
      return;
    }

    setActive(false);
  }

  const back = (
    <button
      onClick={() => navigate(meta.listRoute)}
      className="btn-ghost btn-sm -ml-2 text-gray-500"
    >
      <CaretLeft size={15} aria-hidden /> Back to {meta.listLabel}
    </button>
  );

  if (isLoading) return <Loading rows={6} />;
  if (error || !data)
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title={`${meta.title} not found`}>
          {apiMessage(error, 'That record could not be opened.')}
        </EmptyState>
      </div>
    );

  const { user } = data;
  const name = data.profiles[0]?.displayName || user.email;
  const businessName = data.businesses[0]?.name ?? data.plannerBusinesses[0]?.name ?? 'No business recorded';
  const portalLabel =
    kind === 'vendor' ? 'Vendor Portal' :
    kind === 'agent' ? 'Agent Portal' :
    kind === 'planner' ? 'Wedding Planner Portal' :
    kind === 'officer' ? 'Verification Officer Portal' :
    'Account Portal';
  const adminAccountActions = [
    {
      label: user.isActive ? 'Suspend account' : 'Reinstate account',
      action: () => setActive(!user.isActive),
      tone: 'default',
      disabled: busy,
    },
    {
      label: 'Deactivate account',
      action: () => handleAdminAction('deactivate'),
      tone: 'default',
      disabled: busy || !user.isActive,
    },
    {
      label: 'Delete account',
      action: () => handleAdminAction('delete'),
      tone: 'danger',
      disabled: busy,
    },
  ];

  const metricCards = buildSummaryCards(kind, data, accountId);
  const activityIds = new Set([
    user.id,
    ...data.businesses.map((business) => business.id),
    ...data.providerBookings.map((booking) => booking.id),
    ...data.bookings.map((booking) => booking.id),
    ...data.payments.history.map((payment) => payment.id),
    ...data.verifications.map((verification) => verification.id),
    ...data.casesRaised.map((supportCase) => supportCase.id),
  ]);
  const vendorActivity = activity.filter((item) => activityIds.has(item.resourceId));

  return (
    <div className="space-y-5">
      {back}

      <div className="card overflow-hidden border border-brand/10 bg-gradient-to-br from-brand-soft via-surface to-surface-raised shadow-lifted">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="inline-flex items-center rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-strong">
            ADMIN VIEW • READ ONLY
          </span>
          <span className="text-xs uppercase tracking-[0.18em] text-gray-500">{portalLabel}</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{meta.title}</p>
            <h1 className="page-title mt-1 truncate text-[2rem] leading-tight">{name}</h1>
            <p className="mt-1 text-base font-medium text-gray-700">{businessName}</p>
            <div className="mt-3 space-y-1 text-sm text-gray-600">
              <p>{user.email}</p>
              <p>{user.phone ?? 'Phone not provided'}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <span className={`pill ${user.isActive ? 'bg-positive-bg text-positive-fg' : 'bg-critical-bg text-critical-fg'}`}>
                {user.isActive ? 'Active' : 'Suspended'}
              </span>
              <span className={`pill ${user.isVerified ? 'bg-positive-bg text-positive-fg' : 'bg-gray-100 text-gray-500'}`}>
                {user.isVerified ? 'Verified' : 'Unverified'}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {data.profiles[0] && (
                <Link className="btn btn-sm" to={`/admin/profiles/${data.profiles[0].id}`}>
                  View full profile
                </Link>
              )}
              <ActionsMenu>
                <button
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-brand-soft/40 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => setActive(!user.isActive)}
                >
                  {user.isActive ? 'Suspend account' : 'Reinstate account'}
                </button>
                <button
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-brand-soft/40 disabled:opacity-50"
                  disabled={busy || !user.isActive}
                  onClick={() => handleAdminAction('deactivate')}
                >
                  Deactivate account
                </button>
                <button
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => handleAdminAction('delete')}
                >
                  Delete account
                </button>
              </ActionsMenu>
            </div>
          </div>
        </div>
        {actionError && <p className="alert-critical mt-3">{actionError}</p>}
      </div>

      {kind === 'agent' && data.agentDashboard && (
        <AgentDashboardCards dashboard={data.agentDashboard} />
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Section title={kind === 'vendor' ? 'Business overview' : kind === 'agent' ? 'Client book overview' : kind === 'planner' ? 'Wedding operations overview' : 'Verification workload overview'}>
          <Row label="Account ID">
            <span className="font-mono text-xs">{user.id.slice(0, 8)}</span>
          </Row>
          <Row label="Email">{user.email}</Row>
          <Row label="Mobile">{user.phone ?? '—'}</Row>
          <Row label="Role">{roleLabel(user.role)}</Row>
          <Row label="Registered">{formatDate(user.createdAt)}</Row>
          {user.managedByAgentId && (
            <Link className="btn-outline btn-sm mt-2" to={`/admin/agents/${user.managedByAgentId}`}>
              Managing agency
            </Link>
          )}
        </Section>

        <Section title="Admin actions">
          <div className="space-y-2">
            {adminAccountActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  action.tone === 'danger'
                    ? 'text-red-700 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-brand-soft/40'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={action.disabled}
                onClick={action.action}
              >
                {action.label}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className={`grid gap-3 sm:grid-cols-2 ${kind === 'officer' ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        {metricCards.map((card) => (
          card.to ? (
            <Link key={card.label} to={card.to} className="card transition-colors hover:border-brand hover:bg-brand-soft/30">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{card.value}</p>
              <p className="mt-1 text-xs text-brand-strong">View filtered records</p>
            </Link>
          ) : (
            <div key={card.label} className="card">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{card.value}</p>
            </div>
          )
        ))}
      </div>

      {kind === 'agent' && data.agentDashboard && (
        <AgentDashboardDetails dashboard={data.agentDashboard} />
      )}

      {kind === 'officer' && data.officer && (
        <section className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-title">Verification performance</h2>
            <span className="text-xs text-gray-500">All time</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Row label="Assigned vs completed">{data.officer.assigned} assigned / {data.officer.decisions.length} completed</Row>
            <Row label="Completion rate">
              {data.officer.assigned ? `${Math.round((data.officer.decisions.length / data.officer.assigned) * 100)}%` : '—'}
            </Row>
            <Row label="Coverage">{data.officer.serviceAreas.length ? data.officer.serviceAreas.map((a) => a.label).join(', ') : 'Not set'}</Row>
          </div>
        </section>
      )}

      {/* An agency's book: the accounts they brought on, each clickable (EZ1-I171). */}
      {data.agency && (
        <ListSection
          title="Assigned clients"
          empty="No clients yet."
          rows={data.agency.clients}
          render={(c) => (
            <Link
              key={c.id}
              to={`/admin/clients/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{c.email}</span>
                <span className="text-xs text-gray-500">
                  {roleLabel(c.role)} · joined {formatDate(c.createdAt)}
                </span>
              </span>
              <span className={`pill ${c.isActive ? 'bg-positive-bg text-positive-fg' : 'bg-critical-bg text-critical-fg'}`}>
                {c.isActive ? 'Active' : 'Suspended'}
              </span>
            </Link>
          )}
        />
      )}

      {data.profiles.length > 0 && (
        <ListSection
          title={kind === 'agent' ? 'Associated profiles' : 'Profiles'}
          empty="No profiles."
          rows={data.profiles}
          render={(p) => (
            <Link
              key={p.id}
              to={`/admin/profiles/${p.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="truncate text-sm font-medium text-gray-800">{p.displayName}</span>
              <span className="text-xs text-gray-500">
                {LIFECYCLE_LABEL[p.lifecycle as ProfileLifecycle] ?? humanize(p.lifecycle)}
                {p.city ? ` · ${p.city}` : ''}
              </span>
            </Link>
          )}
        />
      )}

      {data.businesses.length > 0 && (
        <ListSection
          title="Businesses"
          empty="No businesses."
          rows={data.businesses}
          render={(b) => (
            <Link
              key={b.id}
              to={`/admin/businesses/${b.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{b.name}</span>
                <span className="text-xs text-gray-500">{humanize(b.category)}</span>
              </span>
              <span className="pill bg-gray-100 text-gray-600">{labelFrom(BUSINESS_STATUS_LABEL, b.status)}</span>
            </Link>
          )}
        />
      )}

      {/* A planner's agency in full: coverage, contact and packages (EZ1-I188). */}
      {data.plannerBusinesses.map((b) => (
        <div key={b.id} className="card">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="section-title">{b.name}</h2>
              <p className="text-xs text-gray-500">
                {[b.city, b.state].filter(Boolean).join(', ') || 'Location not set'}
                {b.yearsExperience > 0 ? ` · ${b.yearsExperience} yrs experience` : ''}
              </p>
            </div>
            <span className={`pill ${b.isApproved ? 'bg-positive-bg text-positive-fg' : 'bg-caution-bg text-caution-fg'}`}>
              {b.isApproved ? 'Approved' : 'Pending approval'}
            </span>
          </div>
          {b.bio && <p className="mb-3 whitespace-pre-line text-sm text-gray-700">{b.bio}</p>}
          <div className="grid gap-1 sm:grid-cols-2">
            <Row label="Contact person">{b.contactPerson ?? '—'}</Row>
            <Row label="Phone">{b.contactPhone ?? '—'}</Row>
            <Row label="Email">{b.contactEmail ?? '—'}</Row>
            <Row label="Website">{b.website ?? '—'}</Row>
            <Row label="Address">{[b.address, b.pincode].filter(Boolean).join(' · ') || '—'}</Row>
            <Row label="Serves">{b.servesCities.length ? b.servesCities.join(', ') : '—'}</Row>
            <Row label="Rating">
              {b.ratingCount > 0 ? `${b.ratingAvg.toFixed(1)} (${b.ratingCount})` : 'No ratings'}
            </Row>
          </div>
          {b.packages.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                Packages
              </p>
              <div className="divide-y">
                {b.packages.map((pkg, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-gray-800">{pkg.name}</span>
                      {pkg.includes && pkg.includes.length > 0 && (
                        <span className="text-xs text-gray-500">{pkg.includes.join(', ')}</span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums text-gray-900">{money(String(pkg.price))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Bookings made *with* a vendor or planner — the list their page is about (EZ1-I172). */}
      {data.providerBookings.length > 0 && (
        <ListSection
          title="Bookings received"
          empty="None."
          rows={data.providerBookings}
          render={(b) => (
            <Link
              key={b.id}
              to={`/admin/bookings/${b.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {b.buyerName ?? 'Customer'}
                  {b.serviceName ? ` · ${b.serviceName}` : ''}
                </span>
                <span className="text-xs text-gray-500">
                  {formatDate(b.eventDate ?? b.createdAt)} · #{b.id.slice(0, 8)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {/* The latest quotation, or "Not yet priced" — never ₹0. */}
                <span className="text-sm font-medium tabular-nums text-gray-900">
                  {bookingAmountLabel(b)}
                </span>
                <span className="pill bg-brand-soft text-brand-strong">
                  {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                </span>
              </span>
            </Link>
          )}
        />
      )}

      {data.bookings.length > 0 && (
        <ListSection
          title="Bookings placed"
          empty="No bookings."
          rows={data.bookings}
          render={(b) => (
            <Link
              key={b.id}
              to={`/admin/bookings/${b.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium tabular-nums text-gray-900">
                  {bookingAmountLabel(b)}
                </span>
                <span className="text-xs text-gray-500">
                  {formatDate(b.eventDate ?? b.createdAt)} · #{b.id.slice(0, 8)}
                </span>
              </span>
              <span className="pill bg-brand-soft text-brand-strong">
                {BOOKING_STATUS_LABEL[b.status] ?? b.status}
              </span>
            </Link>
          )}
        />
      )}

      {(kind === 'officer' ? data.officer?.queue ?? [] : data.verifications).length > 0 && (
        <ListSection
          title={kind === 'officer' ? 'Assigned verification cases' : 'Verification'}
          empty="Nothing here."
          rows={kind === 'officer' ? data.officer?.queue ?? [] : data.verifications}
          render={(v) => (
            <div key={v.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-gray-800">
                {humanize(v.applicantType)} · #{v.id.slice(0, 8)}
              </span>
              <span className="pill bg-gray-100 text-gray-600">{labelFrom(VERIFICATION_LABEL, v.status)}</span>
            </div>
          )}
        />
      )}

      {/* Where an officer travels, and the visits they have decided (EZ1-I188). */}
      {kind === 'officer' && data.officer && (data.officer.serviceAreas.length > 0 || data.officer.decisions.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h2 className="section-title mb-2">Service areas</h2>
            {data.officer.serviceAreas.length === 0 ? (
              <p className="py-2 text-sm text-gray-400">No coverage recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.officer.serviceAreas.map((a) => (
                  <span
                    key={a.id}
                    className={`pill ${a.primary ? 'bg-brand-soft text-brand-strong' : 'bg-gray-100 text-gray-600'}`}
                  >
                    {a.label}
                    {a.primary ? '' : ' (backup)'}
                  </span>
                ))}
              </div>
            )}
          </div>
          <ListSection
            title="Decisions made"
            empty="No decisions recorded."
            rows={data.officer.decisions}
            render={(d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-gray-700">
                  {humanize(d.applicantType)} · {d.decidedAt ? formatDate(d.decidedAt) : formatDate(d.createdAt)}
                </span>
                <span className="pill bg-gray-100 text-gray-600">{labelFrom(VERIFICATION_LABEL, d.status)}</span>
              </div>
            )}
          />
        </div>
      )}

      {(data.casesRaised.length > 0 || data.casesAssigned.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.casesRaised.length > 0 && (
            <ListSection
              title="Cases raised"
              empty="None."
              rows={data.casesRaised}
              render={(c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm text-gray-800">{c.title}</span>
                  <span className="pill bg-gray-100 text-gray-600">{labelFrom(CASE_STATUS_LABEL, c.status)}</span>
                </div>
              )}
            />
          )}
          {data.casesAssigned.length > 0 && (
            <ListSection
              title="Cases assigned"
              empty="None."
              rows={data.casesAssigned}
              render={(c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm text-gray-800">{c.title}</span>
                  <span className="pill bg-gray-100 text-gray-600">{labelFrom(CASE_STATUS_LABEL, c.status)}</span>
                </div>
              )}
            />
          )}
        </div>
      )}

      {data.payments.history.length > 0 && (
        <ListSection
          title="Recent payments"
          empty="None."
          rows={data.payments.history}
          render={(p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-gray-600">
                {formatDate(p.createdAt)} · <span>{milestoneLabel(p.milestone)}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-medium tabular-nums text-gray-900">{money(p.amount)}</span>
                <span className="pill bg-gray-100 text-gray-600">{paymentStatusLabel(p.status, 'admin')}</span>
              </span>
            </div>
          )}
        />
      )}

      {kind === 'vendor' && (
        <ListSection
          title="Recent activity"
          empty="No recent activity recorded."
          rows={vendorActivity}
          render={(item) => (
            <div key={`${item.resourceType}-${item.resourceId}-${item.at}`} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-gray-800">{item.summary}</span>
              <span className="whitespace-nowrap text-xs text-gray-500">{new Date(item.at).toLocaleString()}</span>
            </div>
          )}
        />
      )}
    </div>
  );
}

function AgentDashboardCards({ dashboard }: { dashboard: AgentDashboard }) {
  const cards = [
    ['Total clients', String(dashboard.totalClients), 'agent-clients'],
    ['Matches fixed', String(dashboard.matchesFixed), 'agent-matches'],
    ['Remaining clients', String(dashboard.remainingClients), 'agent-remaining'],
    ['Interests received', String(dashboard.interestsReceived), 'agent-interests-received'],
    ['Interests sent', String(dashboard.interestsSent), 'agent-interests-sent'],
    ['Escrow', money(dashboard.escrow), 'agent-escrow'],
    ['Issues pending', String(dashboard.issuesPending), 'agent-issues-pending'],
    ['Issues solved', String(dashboard.issuesSolved), 'agent-issues-solved'],
    ['Issues escalated', String(dashboard.issuesEscalated), 'agent-issues-escalated'],
  ] as const;
  return (
    <section aria-label="Agent activity dashboard">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="section-title">Agent activity</h2>
        <p className="text-xs text-gray-500">Live totals — select a card to review records</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, target]) => (
          <a
            key={target}
            href={`#${target}`}
            className="card group block border border-transparent transition hover:border-brand-strong hover:bg-brand-soft/30 focus:outline-none focus:ring-2 focus:ring-brand-strong"
          >
            <span className="block text-sm font-medium text-gray-600">{label}</span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums text-gray-900">{value}</span>
            <span className="mt-2 block text-xs text-brand-strong group-hover:underline">View details →</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function AgentDashboardDetails({ dashboard }: { dashboard: AgentDashboard }) {
  const profile = (id: string) => `/admin/profiles/${id}`;
  const interestRow = (interest: InterestRow) => (
    <div key={interest.id} className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 text-gray-700">
        <Link className="font-medium text-brand-strong hover:underline" to={profile(interest.fromProfileId)}>Sender</Link>
        {' → '}
        <Link className="font-medium text-brand-strong hover:underline" to={profile(interest.toProfileId)}>Recipient</Link>
        <span className="block text-xs text-gray-500">{formatDate(interest.createdAt)}</span>
      </span>
      <span className="pill bg-gray-100 text-gray-600">{humanize(interest.status)}</span>
    </div>
  );
  const issueRow = (issue: IssueRow) => (
    <div key={issue.id} className="border-b border-gray-100 py-2 last:border-0">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium text-gray-800">{issue.title}</span>
        <span className="pill bg-gray-100 text-gray-600">{labelFrom(CASE_STATUS_LABEL, issue.status)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-gray-500">
        {issue.category ? `${humanize(issue.category)} · ` : ''}{issue.description}
      </p>
      <p className="mt-1 text-xs text-gray-400">#{issue.id.slice(0, 8)} · updated {formatDate(issue.updatedAt)}</p>
    </div>
  );
  return (
    <section className="space-y-4" aria-label="Agent activity details">
      <ListSection id="agent-clients" title="Agent clients" empty="No clients are assigned to this agent." rows={dashboard.clients}
        render={(client) => (
          <Link key={client.id} to={profile(client.id)} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-brand-soft/40">
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900">{client.displayName}</span><span className="text-xs text-gray-500">{client.profileCode}{client.city ? ` · ${client.city}` : ''} · assigned {formatDate(client.createdAt)}</span></span>
            <span className="pill bg-gray-100 text-gray-600">{client.profileCompleted ? 'Profile complete' : 'Profile incomplete'}</span>
          </Link>
        )}
      />
      <ListSection id="agent-matches" title="Matches fixed" empty="No matches have been fixed for this agent's clients." rows={dashboard.matches} render={interestRow} />
      <ListSection id="agent-remaining" title="Clients with match not fixed" empty="Every current client has a fixed match." rows={dashboard.clients.filter((client) => !dashboard.matches.some((match) => match.fromProfileId === client.id || match.toProfileId === client.id))}
        render={(client) => <Link key={client.id} to={profile(client.id)} className="block rounded-md px-2 py-2 text-sm font-medium text-brand-strong hover:bg-brand-soft/40 hover:underline">{client.displayName} <span className="font-normal text-gray-500">· {client.profileCode}</span></Link>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListSection id="agent-interests-received" title="Interests received" empty="No received interests." rows={dashboard.interestsReceivedRows} render={interestRow} />
        <ListSection id="agent-interests-sent" title="Interests sent" empty="No sent interests." rows={dashboard.interestsSentRows} render={interestRow} />
      </div>
      <ListSection id="agent-escrow" title="Escrow transactions" empty="No escrow transactions for this agent's clients." rows={dashboard.payments}
        render={(payment) => <Link key={payment.id} to={`/admin/bookings/${payment.bookingId}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-brand-soft/40"><span className="text-sm text-gray-700">{milestoneLabel(payment.milestone)} · #{payment.id.slice(0, 8)}<span className="block text-xs text-gray-500">{formatDate(payment.createdAt)} · {payment.providerRef ?? 'No reference'}</span></span><span className="text-right"><span className="block text-sm font-medium text-gray-900">{money(payment.amount)}</span><span className="text-xs text-gray-500">{paymentStatusLabel(payment.status, 'admin')}</span></span></Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <ListSection id="agent-issues-pending" title="Issues pending" empty="No pending issues." rows={dashboard.pendingIssues} render={issueRow} />
        <ListSection id="agent-issues-solved" title="Issues solved" empty="No solved issues." rows={dashboard.solvedIssues} render={issueRow} />
        <ListSection id="agent-issues-escalated" title="Issues escalated to admin" empty="No escalated issues." rows={dashboard.escalatedIssues} render={issueRow} />
      </div>
    </section>
  );
}

/**
 * A small actions dropdown for the account header (EZ1-I194).
 *
 * A full-screen transparent layer behind the panel closes it on an outside
 * click, and any click inside a menu item closes it too — so choosing an action
 * dismisses the menu.
 */
function ActionsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="btn-outline btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Actions <CaretDown size={14} aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-gray-200 bg-surface py-1 shadow-pop"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="section-title mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}

function ListSection<T>({
  id,
  title,
  rows,
  render,
  empty,
}: {
  id?: string;
  title: string;
  rows: T[];
  render: (row: T) => React.ReactNode;
  empty: string;
}) {
  return (
    <div id={id} className="card scroll-mt-5">
      <h2 className="section-title mb-1">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="divide-y">{rows.map(render)}</div>
      )}
    </div>
  );
}
