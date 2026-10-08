import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../../lib/api';
import { MOBILE_10_PATTERN } from '../../lib/permissions';
import { BUSINESS_STATUS_LABEL, labelFrom, milestoneLabel, paymentStatusLabel } from '../../lib/labels';
import {
  AllBookings,
  Directory,
} from '../../components/AdminConsole';
import ReviewModeration from '../../components/ReviewModeration';
import CatalogAdmin from '../../components/CatalogAdmin';
import AdminReportsDashboard from '../../components/AdminReportsDashboard';
import { Loading, EmptyState } from '../../components/ui/Feedback';

/*
 * The dedicated module pages of the Admin Portal (EZ1-I153).
 *
 * Each is a thin wrapper around a section component that already existed inside
 * the combined /admin console; the move is from one component's `section` state
 * to a real route apiece. Nothing here duplicates a data source — every page
 * reads the same /admin endpoints the old console did.
 */

/**
 * The matrimonial users — brides, grooms and family stewards — as one tab each
 * (EZ1-I192).
 *
 * Vendors, planners, agents and officers are user accounts too, but each has
 * its own page; this screen is only the people the platform matches. The old
 * "Any role" dropdown let all of them leak in, so it is gone: the tab fixes the
 * role, and its badge carries the live count for that role (unfiltered by the
 * search below it). The list, its email search and its status filter are the
 * shared Directory, told to hide its now-redundant role select.
 */
const USER_TABS = [
  { role: 'bride', label: 'Brides' },
  { role: 'groom', label: 'Grooms' },
  { role: 'family', label: 'Family' },
] as const;

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || USER_TABS[0].role;
  const setRole = (r: string) => {
    const p = new URLSearchParams(params);
    p.set('role', r);
    setParams(p, { replace: true });
  };

  // One badge count per role, straight from the directory's own total so a role
  // that gains a user sees its tab move. Kept apart from the list query below,
  // whose total narrows with the email and status filters.
  const { data: counts } = useQuery<Record<string, number>>({
    queryKey: ['admin-user-counts'],
    queryFn: async () => {
      const entries = await Promise.all(
        USER_TABS.map(
          async (t) =>
            [
              t.role,
              (await api.get('/admin/directory', { params: { limit: 1, role: t.role } })).data.meta
                .total as number,
            ] as const,
        ),
      );
      return Object.fromEntries(entries);
    },
  });

  const active = USER_TABS.find((t) => t.role === role) ?? USER_TABS[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Users</h1>
        <p className="page-subtitle">
          Brides, grooms and families — the people the platform matches. Vendors, planners,
          agents and officers each have their own page.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {USER_TABS.map((t) => {
          const isActive = t.role === role;
          return (
            <button
              key={t.role}
              onClick={() => setRole(t.role)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand text-brand-fg shadow-btn'
                  : 'bg-surface text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`rounded-sm px-1.5 text-xs tabular-nums ${
                  isActive ? 'bg-white/25 text-brand-fg' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {counts?.[t.role] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <Directory
        key={role}
        title={active.label}
        initialRole={role}
        roles={[role]}
        hideRoleFilter
        detailBase="/admin/clients"
        agentId={params.get('agentId') ?? undefined}
      />
    </div>
  );
}

const AGENCY_DETAIL_LABEL: Record<string, string> = {
  contactPhone: 'contact number',
  address: 'address',
  startDate: 'start date',
};

/** The words for a registration detail an agency left blank. */
const agencyDetailLabel = (field: string) => AGENCY_DETAIL_LABEL[field] ?? field;

/** The masthead every admin screen opens with, so directory pages match the rest. */
function Masthead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{children}</p>
    </div>
  );
}

export function AdminAgents() {
  return <RoleDirectory role="agent" title="Agents" noun="agents" detailBase="/admin/agents" description="Agencies acting for families, and where each stands on approval." />;
}

/**
 * The provider-account counterpart to the vendor business directory. Agents
 * and planners do not have a one-to-many business record to list, so their
 * source of truth is the account directory itself. Keeping this specialised
 * presentation here means all four operational directories answer the same
 * questions: how many, what state, can I find one, and where do I open it.
 */
interface RoleDirectoryRow {
  id: string;
  /** Masked by the server (ISS-11); the detail page has the audited reveal. */
  email: string | null;
  phone?: string | null;
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
}

const ROLE_DIRECTORY_PAGE_SIZE = 25;

function RoleDirectory({
  role,
  title,
  noun,
  detailBase,
  description,
}: {
  role: 'agent' | 'planner';
  title: string;
  noun: string;
  detailBase: string;
  description: string;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') ?? 'all';
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const active = filter === 'active' ? 'true' : filter === 'suspended' ? 'false' : undefined;

  const change = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    next.delete('page');
    setParams(next, { replace: true });
  };
  const setPage = (value: number) => {
    const next = new URLSearchParams(params);
    if (value > 1) next.set('page', String(value));
    else next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError } = useQuery<{
    data: RoleDirectoryRow[];
    meta: { total: number; totalPages: number };
  }>({
    queryKey: ['admin-role-directory', role, filter, search, page],
    queryFn: async () =>
      (await api.get('/admin/directory', {
        params: { role, limit: ROLE_DIRECTORY_PAGE_SIZE, page, q: search || undefined, active },
      })).data,
    refetchInterval: 60000,
  });
  const all = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-role-directory-count', role, 'all'],
    queryFn: async () => (await api.get('/admin/directory', { params: { role, limit: 1 } })).data,
    refetchInterval: 60000,
  });
  const enabled = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-role-directory-count', role, 'active'],
    queryFn: async () => (await api.get('/admin/directory', { params: { role, active: 'true', limit: 1 } })).data,
    refetchInterval: 60000,
  });
  const suspended = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-role-directory-count', role, 'suspended'],
    queryFn: async () => (await api.get('/admin/directory', { params: { role, active: 'false', limit: 1 } })).data,
    refetchInterval: 60000,
  });
  const counts = { all: all.data?.meta.total ?? 0, active: enabled.data?.meta.total ?? 0, suspended: suspended.data?.meta.total ?? 0 };
  const cards = [
    { key: 'all', label: `All ${title}`, value: counts.all, tone: 'bg-brand-soft text-brand-strong' },
    { key: 'active', label: 'Active', value: counts.active, tone: 'bg-positive-bg text-positive-fg' },
    { key: 'suspended', label: 'Suspended', value: counts.suspended, tone: 'bg-critical-bg text-critical-fg' },
  ];
  const loadingCounts = all.isLoading || enabled.isLoading || suspended.isLoading;
  const rows = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <Masthead title={title}>{description}</Masthead>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <button key={card.key} type="button" onClick={() => change({ status: card.key === 'all' ? undefined : card.key })}
            className={`card text-left transition-shadow hover:shadow-pop focus-visible:ring-2 focus-visible:ring-brand ${filter === card.key ? 'ring-2 ring-brand' : ''}`}>
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${card.tone}`}>{card.label}</span>
            <span className="mt-3 block text-2xl font-semibold tabular-nums text-gray-900">{loadingCounts ? 'â€”' : card.value}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
          <div>
            <h2 className="section-title">{title} accounts</h2>
            <p className="text-xs text-gray-500">{data?.meta.total ?? 0} {noun} from the backend</p>
          </div>
          <input className="input w-full sm:w-80" placeholder="Search by email or mobile" value={search}
            onChange={(event) => change({ q: event.target.value || undefined })} aria-label={`Search ${noun} by email or mobile`} />
        </div>
        {isLoading ? <Loading rows={5} /> : isError ? (
          <p className="p-6 text-sm text-critical-fg">The {noun} directory could not be loaded. Try again.</p>
        ) : rows.length === 0 ? (
          <EmptyState title={`No ${noun} match`}><span>Try a different status, email or mobile number.</span></EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr>
                <th className="px-4 py-3">Name / Email</th><th className="px-4 py-3">Account Status</th><th className="px-4 py-3">Identity</th><th className="px-4 py-3">Joined Date</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((account) => <tr key={account.id} onClick={() => navigate(`${detailBase}/${account.id}`)} className="cursor-pointer transition-colors hover:bg-brand-soft/30 focus-within:bg-brand-soft/30">
                  <td className="px-4 py-3"><Link className="block font-medium text-gray-900 hover:text-brand-strong focus-visible:underline" to={`${detailBase}/${account.id}`}>{account.email ?? account.phone ?? 'No email on file'}</Link><span className="block font-mono text-[11px] text-gray-400">#{account.id.slice(0, 8)}</span></td>
                  <td className="px-4 py-3"><StatusPill active={account.isActive} /></td>
                  <td className="px-4 py-3"><span className={`pill ${account.isVerified ? 'bg-positive-bg text-positive-fg' : 'bg-caution-bg text-caution-fg'}`}>{account.isVerified ? 'Verified' : 'Not verified'}</span></td>
                  <td className="px-4 py-3 text-gray-600">{new Date(account.createdAt).toLocaleDateString()}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-3 text-sm">
          <button type="button" className="btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-gray-500">Page {page} of {totalPages}</span>
          <button type="button" className="btn-outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </div>
    </div>
  );
}

export function AdminVendors() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') ?? 'all';
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setFilter = (status: string) => {
    const next = new URLSearchParams(params);
    next.set('status', status);
    next.delete('page');
    setParams(next, { replace: true });
  };
  const setPage = (value: number) => {
    const next = new URLSearchParams(params);
    if (value > 1) next.set('page', String(value));
    else next.delete('page');
    setParams(next, { replace: true });
  };

  /*
   * Filtered and paged by the server. Filtering one loaded page of businesses
   * against one loaded page of accounts silently dropped every business whose
   * owner fell outside that page once there were more than a page of either.
   */
  const filterParams: Record<string, string> =
    filter === 'active'
      ? { active: 'true' }
      : filter === 'suspended'
        ? { active: 'false' }
        : filter === 'draft' || filter === 'rejected'
          ? { status: filter }
          : {};
  const { data: businesses, isLoading: businessesLoading } = useQuery<{
    data: VendorBusinessRow[];
    meta: { total: number; totalPages: number };
  }>({
    queryKey: ['admin-vendor-businesses', search, filter, page],
    queryFn: async () =>
      (
        await api.get('/admin/businesses', {
          params: { limit: VENDORS_PAGE_SIZE, page, q: search || undefined, ...filterParams },
        })
      ).data,
    refetchInterval: 60000,
  });
  const rows = businesses?.data ?? [];
  const totalPages = businesses?.meta.totalPages ?? 1;

  const counts = useVendorCounts();
  const cards = [
    { key: 'all', label: 'All Vendors', value: counts.all, tone: 'bg-brand-soft text-brand-strong' },
    { key: 'active', label: 'Active', value: counts.active, tone: 'bg-positive-bg text-positive-fg' },
    { key: 'draft', label: 'Draft', value: counts.draft, tone: 'bg-caution-bg text-caution-fg' },
    { key: 'rejected', label: 'Rejected', value: counts.rejected, tone: 'bg-critical-bg text-critical-fg' },
    { key: 'suspended', label: 'Suspended', value: counts.suspended, tone: 'bg-gray-100 text-gray-700' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Vendors</h1>
        <p className="page-subtitle">Manage vendor accounts, businesses, verification and activity.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setFilter(card.key)}
            className={`card text-left transition-shadow hover:shadow-pop ${filter === card.key ? 'ring-2 ring-brand' : ''}`}
          >
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${card.tone}`}>{card.label}</span>
            <span className="mt-3 block text-2xl font-semibold tabular-nums text-gray-900">
              {counts.loading ? '—' : card.value}
            </span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
          <div>
            <h2 className="section-title">Vendor Accounts</h2>
            <p className="text-xs text-gray-500">{businesses?.meta.total ?? 0} businesses from the backend</p>
          </div>
          <input
            className="input w-full sm:w-80"
            placeholder="Search by business name, owner email or mobile"
            value={search}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('q', event.target.value);
              else next.delete('q');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          />
        </div>

        {businessesLoading ? <Loading rows={5} /> : rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No vendors match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name / Email</th>
                  <th className="px-4 py-3">Business Name</th>
                  <th className="px-4 py-3">Categories</th>
                  <th className="px-4 py-3">Account Status</th>
                  <th className="px-4 py-3">Verification Status</th>
                  <th className="px-4 py-3">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((business) => {
                  const account = business.owner;
                  return (
                    <tr key={business.id} className="hover:bg-brand-soft/30">
                      <td className="px-4 py-3">
                        <Link className="block font-medium text-gray-900 hover:text-brand-strong" to={`/admin/vendors/${business.ownerUserId}`}>
                          {account?.email ?? 'Unknown account'}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link className="font-medium text-brand-strong hover:underline" to={`/admin/businesses/${business.id}`}>
                          {business.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{business.categories?.join(', ') || business.category || '—'}</td>
                      <td className="px-4 py-3"><StatusPill active={account?.isActive !== false} /></td>
                      <td className="px-4 py-3"><span className="pill bg-gray-100 text-gray-700">{labelFrom(BUSINESS_STATUS_LABEL, business.status)}</span></td>
                      <td className="px-4 py-3 text-gray-600">{new Date(account?.createdAt ?? business.createdAt).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-3 text-sm">
            <button type="button" className="btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn-outline"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const VENDORS_PAGE_SIZE = 25;

interface VendorBusinessRow {
  id: string;
  ownerUserId: string;
  name: string;
  category: string;
  categories?: string[];
  status: string;
  createdAt: string;
  /** The owning vendor account, named by the server on each row. */
  owner: { email: string | null; isActive: boolean; createdAt: string } | null;
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`pill ${active ? 'bg-positive-bg text-positive-fg' : 'bg-critical-bg text-critical-fg'}`}>{active ? 'Active' : 'Suspended'}</span>;
}

function useVendorCounts() {
  const all = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-vendor-count', 'all'],
    queryFn: async () => (await api.get('/admin/businesses', { params: { limit: 1 } })).data,
    refetchInterval: 60000,
  });
  const draft = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-vendor-count', 'draft'],
    queryFn: async () => (await api.get('/admin/businesses', { params: { limit: 1, status: 'draft' } })).data,
    refetchInterval: 60000,
  });
  const rejected = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-vendor-count', 'rejected'],
    queryFn: async () => (await api.get('/admin/businesses', { params: { limit: 1, status: 'rejected' } })).data,
    refetchInterval: 60000,
  });
  const active = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-vendor-count', 'active'],
    // Counted the same way the Active and Suspended filters list them: by
    // business, on the state of the owning account.
    queryFn: async () => (await api.get('/admin/businesses', { params: { limit: 1, active: 'true' } })).data,
    refetchInterval: 60000,
  });
  const suspended = useQuery<{ meta: { total: number } }>({
    queryKey: ['admin-vendor-count', 'suspended'],
    queryFn: async () => (await api.get('/admin/businesses', { params: { limit: 1, active: 'false' } })).data,
    refetchInterval: 60000,
  });
  return {
    all: all.data?.meta.total ?? 0,
    draft: draft.data?.meta.total ?? 0,
    rejected: rejected.data?.meta.total ?? 0,
    active: active.data?.meta.total ?? 0,
    suspended: suspended.data?.meta.total ?? 0,
    loading: all.isLoading || draft.isLoading || rejected.isLoading || active.isLoading || suspended.isLoading,
  };
}

export function AdminPlanners() {
  return <RoleDirectory role="planner" title="Wedding Planners" noun="planners" detailBase="/admin/planners" description="Planners who run weddings end to end for the families here." />;
}

/**
 * The verification officers, as a roster an administrator can run (EZ1-I212).
 *
 * The old page was the generic account directory plus a two-line staff card —
 * enough to find an officer, not enough to manage one. This is the management
 * view the role needs: who covers where, whose account is live, who is online,
 * and the shape of each queue split into verifications and cases, with suspend
 * and reinstate on the row so a decision does not need a detour through the
 * detail page. Every number is the backend's own aggregate — the same ones the
 * allocator ranks on — so nothing here can quietly disagree with a visit that
 * was actually handed out.
 *
 * Availability (Available / On Leave / Unavailable) is a separate change
 * (EZ1-I210). Until its field lands the column reads "Available" for everyone
 * and its two other filters simply match nobody; both start working the day
 * the field arrives, with no further edit here.
 */
interface OfficerRow {
  id: string;
  email: string;
  name: string | null;
  city: string | null;
  isActive: boolean;
  availability: 'available' | 'on_leave' | 'unavailable';
  online: boolean;
  lastActiveAt: string | null;
  serviceAreas: { label: string; primary: boolean }[];
  verifications: { pending: number; inProgress: number; completed: number };
  cases: { pending: number; inProgress: number; completed: number };
  visitsCompleted: number;
  joinedAt: string;
}

const OFFICER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'available', label: 'Available' },
  { key: 'on_leave', label: 'On Leave' },
  { key: 'unavailable', label: 'Unavailable' },
] as const;

type OfficerFilter = (typeof OFFICER_FILTERS)[number]['key'];

const officerMatches = (o: OfficerRow, f: OfficerFilter): boolean => {
  switch (f) {
    case 'active':
      return o.isActive;
    case 'suspended':
      return !o.isActive;
    case 'available':
      return o.availability === 'available';
    case 'on_leave':
      return o.availability === 'on_leave';
    case 'unavailable':
      return o.availability === 'unavailable';
    default:
      return true;
  }
};

const AVAILABILITY_META: Record<OfficerRow['availability'], { label: string; tone: string }> = {
  available: { label: 'Available', tone: 'bg-positive-bg text-positive-fg' },
  on_leave: { label: 'On Leave', tone: 'bg-caution-bg text-caution-fg' },
  unavailable: { label: 'Unavailable', tone: 'bg-gray-100 text-gray-500' },
};

/** Compact "when were they last seen" — the question presence answers. */
function lastActiveLabel(iso: string | null): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** verifications/cases as one "pending · in progress · done" cluster. */
function QueueCounts({ q }: { q: OfficerRow['verifications'] }) {
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-gray-600">
      <span className="text-caution-fg" title="Pending">
        {q.pending}
      </span>
      {' · '}
      <span className="text-brand-strong" title="In progress">
        {q.inProgress}
      </span>
      {' · '}
      <span className="text-positive-fg" title="Completed">
        {q.completed}
      </span>
    </span>
  );
}

/**
 * Creating an officer, on the page that manages them.
 *
 * This lived on the Verification screen, which is the queue of visits -- so
 * making a new member of staff meant opening a work queue and finding a form
 * at the bottom of a tab (EZ1-I223). Verification is for verification work;
 * this page is for the people who do it, and account creation belongs with the
 * people. Same endpoint as before.
 */
/**
 * Which places an officer covers, editable where the officer is managed.
 *
 * Moved here with the roster (EZ1-I223). This is the only surface that can set
 * an officer's coverage -- the account detail page shows it read-only -- so it
 * travelled rather than being deleted with the tab that used to hold it.
 */
function ServiceAreas({ officerId }: { officerId: string }) {
  const qc = useQueryClient();
  const [failed, setFailed] = useState('');

  /** Runs a coverage change, surfacing whatever the server refused. */
  const onRun = async (fn: () => Promise<unknown>) => {
    setFailed('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['admin-officers'] });
    } catch (err) {
      setFailed(apiMessage(err, 'That change was rejected.'));
    }
  };
  const [adding, setAdding] = useState(false);
  const [place, setPlace] = useState('');
  const [scope, setScope] = useState<'city' | 'state'>('city');
  const [primary, setPrimary] = useState(true);

  const { data: areas = [] } = useQuery<
    { id: string; label: string; city: string | null; state: string | null; primary: boolean }[]
  >({
    queryKey: ['officer-areas', officerId],
    queryFn: async () => (await api.get(`/verification/officers/${officerId}/areas`)).data,
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['officer-areas', officerId] });

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      {failed && <p className="mb-1 text-xs text-critical-fg">{failed}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {areas.map((a) => (
          <span
            key={a.id}
            className={`flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs ${
              a.primary ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-600'
            }`}
            title={a.state && !a.city ? 'Whole state' : a.primary ? 'Primary area' : 'Will travel'}
          >
            {a.label}
            {a.state && !a.city ? ' (state)' : ''}
            <button
              type="button"
              className="text-gray-400 hover:text-red-600"
              onClick={() =>
                onRun(async () => {
                  await api.delete(`/verification/areas/${a.id}`);
                  await refresh();
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        {areas.length === 0 && (
          <span className="text-xs text-amber-700">
            Covers nowhere, only allocated when nobody else fits
          </span>
        )}
        <button
          type="button"
          className="text-xs text-brand underline"
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'cancel' : '+ area'}
        </button>
      </div>

      {adding && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!place.trim()) return;
            void onRun(async () => {
              await api.post(`/verification/officers/${officerId}/areas`, {
                [scope]: place.trim(),
                primary,
              });
              await refresh();
              setPlace('');
              setAdding(false);
            });
          }}
        >
          <select
            className="input w-28 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'city' | 'state')}
          >
            <option value="city">City</option>
            <option value="state">State</option>
          </select>
          <input
            className="input w-44 text-sm"
            placeholder={scope === 'city' ? 'Hyderabad' : 'Telangana'}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
            />
            Primary
          </label>
          <button className="btn-outline text-sm">Add</button>
        </form>
      )}
    </div>
  );
}

function CreateOfficer() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  /*
   * CreateOfficerDto requires a mobile number and this form never collected
   * one, so every submission 400'd and no verification officer could be
   * created at all -- the only route by which the persona exists (EZ1-I234,
   * confirmed by the council review).
   */
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Only ever set on an environment where mail is not delivered (EZ1-I234).
  const [devPassword, setDevPassword] = useState('');

  async function create() {
    setError('');
    setDone('');
    setBusy(true);
    try {
      const created = (
        await api.post('/verification/officers', {
          email,
          name,
          phone,
          region: region || undefined,
        })
      ).data as { devPassword?: string };
      /*
       * The API hands back the temporary password only when mail is running
       * in `log` mode, where nothing is actually delivered. Discarding it and
       * saying "credentials are on the way" left the administrator with an
       * account nobody could sign into and no way to find out the password
       * (EZ1-I234). In a real deployment the field is absent and the message
       * is the accurate one.
       */
      setDevPassword(created?.devPassword ?? '');
      setDone(
        created?.devPassword
          ? 'Officer created. Email is not being delivered on this environment, so hand them the temporary password below.'
          : 'Officer created. Their credentials are on the way.',
      );
      setName('');
      setEmail('');
      setPhone('');
      setRegion('');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['admin-officers'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    } catch (err) {
      setError(apiMessage(err, 'That officer could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" onClick={() => setOpen(true)}>
            Create officer
          </button>
          {done && <p className="text-sm text-positive-fg">{done}</p>}
        </div>
        {devPassword && (
          <div className="card border-amber-200 bg-amber-50">
            <p className="text-sm font-medium text-amber-900">Temporary password</p>
            <p className="mt-1 font-mono text-lg text-amber-950">{devPassword}</p>
            <p className="mt-1 text-xs text-amber-900">
              Shown because this environment writes email to a log instead of sending it. Give it to
              the officer directly — they are made to replace it on first sign-in. It is not shown
              again once you leave this page.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="section-title">Add a verification officer</h2>
        <p className="text-sm text-gray-600">
          There is no sign-up for this role. The account is created here and the credentials are
          emailed; the officer replaces the password on first sign-in.
        </p>
      </div>
      {error && <p className="alert-critical">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input"
          placeholder="Mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          className="input"
          placeholder="Area covered"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn"
          disabled={busy || !email || name.trim().length < 2 || !MOBILE_10_PATTERN.test(phone)}
          onClick={create}
        >
          {busy ? 'Creating…' : 'Create officer'}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AdminOfficers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<OfficerFilter>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  /*
   * Searched by the server (ISS-11): emails arrive masked, so only the server
   * can match the stored address or mobile number. It also matches the name,
   * id and coverage labels this page used to filter on itself. The filter
   * counts describe the searched set, as on the other directories.
   */
  const needle = search.trim();
  const { data, isLoading } = useQuery<OfficerRow[]>({
    queryKey: ['admin-officers', needle],
    queryFn: async () =>
      (await api.get('/admin/officers', { params: { q: needle || undefined } })).data,
    placeholderData: keepPreviousData,
  });

  const officers = data ?? [];
  const count = (f: OfficerFilter) => officers.filter((o) => officerMatches(o, f)).length;
  const shown = officers.filter((o) => officerMatches(o, filter));

  async function setActive(id: string, active: boolean) {
    if (!window.confirm(active ? 'Reinstate this officer?' : 'Suspend this officer?')) return;
    setError('');
    setBusyId(id);
    try {
      await api.put(`/admin/users/${id}/status`, { isActive: active });
      for (const k of ['admin-officers', 'analytics', 'audit']) qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Verification Officers</h1>
        <p className="page-subtitle">
          The field team that goes to an address and writes down what they saw. Who covers where,
          who is free, and what each is carrying — open the row for the full record.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <CreateOfficer />

      <div className="flex flex-wrap gap-2">
        {OFFICER_FILTERS.map((f) => {
          const isActive = f.key === filter;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand text-brand-fg shadow-btn'
                  : 'bg-surface text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`rounded-sm px-1.5 text-xs tabular-nums ${
                  isActive ? 'bg-white/25 text-brand-fg' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {count(f.key)}
              </span>
            </button>
          );
        })}
      </div>

      <label className="block sm:max-w-sm">
        <span className="sr-only">Search verification officers</span>
        <input
          className="input w-full"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, mobile, ID or coverage"
        />
      </label>

      <div className="card overflow-x-auto p-0">
        {isLoading && <Loading rows={5} className="p-5" />}
        {!isLoading && shown.length === 0 && (
          <EmptyState title="No officers here">
            No verification officer matches this filter.
          </EmptyState>
        )}
        {!isLoading && shown.length > 0 && (
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">Coverage</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Presence</th>
                <th className="px-4 py-3">Verifications</th>
                <th className="px-4 py-3">Cases</th>
                <th className="px-4 py-3 text-right">Visits</th>
                <th className="px-4 py-3 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((o) => {
                const avail = AVAILABILITY_META[o.availability];
                return (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/admin/officers/${o.id}`)}
                    className="cursor-pointer transition-colors hover:bg-brand-soft/40"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-medium text-gray-900">{o.name ?? o.email}</span>
                      <span className="block truncate text-xs text-gray-500">{o.email}</span>
                      <span className="block font-mono text-[11px] text-gray-400">
                        #{o.id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {o.serviceAreas.length === 0 ? (
                        <span className="text-xs text-gray-400">No areas set</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {o.serviceAreas.slice(0, 3).map((a, i) => (
                            <span
                              key={`${a.label}-${i}`}
                              className={`rounded-sm px-2 py-0.5 text-xs ${
                                a.primary
                                  ? 'bg-brand-soft text-brand-strong'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {a.label}
                            </span>
                          ))}
                          {o.serviceAreas.length > 3 && (
                            <span className="text-xs text-gray-400">
                              +{o.serviceAreas.length - 3}
                            </span>
                          )}
                        </span>
                      )}
                      {/* Editable here, because this is the page that manages
                          officers (EZ1-I223). The click guard keeps adding an
                          area from also opening the officer's record. */}
                      <ServiceAreas officerId={o.id} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`pill ${
                          o.isActive
                            ? 'bg-positive-bg text-positive-fg'
                            : 'bg-critical-bg text-critical-fg'
                        }`}
                      >
                        {o.isActive ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${avail.tone}`}>{avail.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-600">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            o.online ? 'bg-emerald-500' : 'bg-gray-300'
                          }`}
                          aria-hidden
                        />
                        {o.online ? 'Online' : lastActiveLabel(o.lastActiveAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <QueueCounts q={o.verifications} />
                    </td>
                    <td className="px-4 py-3">
                      <QueueCounts q={o.cases} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {o.visitsCompleted}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-ghost btn-sm"
                        disabled={busyId === o.id}
                        onClick={() => setActive(o.id, !o.isActive)}
                      >
                        {o.isActive ? 'Suspend' : 'Reinstate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Queue counts read pending · in progress · completed. Availability arrives with the officer
        leave feature (EZ1-I210); until then every officer shows as Available.
      </p>
    </div>
  );
}

export function AdminBookings() {
  const [params] = useSearchParams();
  return <AllBookings initialStatus={params.get('status') ?? ''} />;
}

/**
 * Services and catalog, on one screen (EZ1-I174).
 *
 * They were two nav items for one job: a service and the packages under it are
 * created and managed together. CatalogAdmin already holds the whole hierarchy
 * — categories, the services in each, and every service's booking attributes —
 * so the merge is a single nav entry pointing at it, not a new component.
 */
export function AdminServicesCatalog() {
  return (
    <div className="space-y-4">
      <Masthead title="Services & Catalog">
        The categories, services and questions vendors list against. Configuration, not code.
      </Masthead>
      <CatalogAdmin />
    </div>
  );
}

export function AdminReports() {
  return <AdminReportsDashboard />;
}

/**
 * The approval queues, gathered onto one screen (EZ1-I153).
 *
 * Agencies first: an approved agent can build real accounts for other people,
 * so it is the highest-leverage approval on the platform. Review moderation
 * rides along because it is the same act — the administrator deciding what
 * reaches buyers — and a queue of three does not deserve a route of its own.
 */
export function AdminApprovals() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const q = <T,>(key: string, url: string) =>
    useQuery({
      queryKey: [key],
      queryFn: async () => (await api.get(url)).data as T,
      retry: false,
    });

  const { data: pendingVendors } = q<{ id: string; name: string; category: string; city?: string }[]>(
    'pending-vendors',
    '/admin/vendors/pending',
  );
  const { data: pendingPlanners } = q<{ id: string; agencyName: string; city?: string }[]>(
    'pending-planners',
    '/admin/planners/pending',
  );
  const { data: pendingAgents } = q<
    {
      id: string;
      agencyName: string;
      city?: string;
      registrationNumber: string | null;
      contactPhone: string | null;
      about: string | null;
      /** Optional registration details left blank; the agency is listed regardless. */
      missingDetails?: string[];
    }[]
  >('pending-agents', '/admin/agents/pending');
  // Refused agencies are no longer "awaiting approval" (ISS-10); they are
  // listed apart so a decision can still be reconsidered.
  const { data: rejectedAgents } = q<
    { id: string; agencyName: string; city?: string; rejectionReason: string | null }[]
  >('rejected-agents', '/admin/agents/rejected');

  async function act(url: string, keys: string[], body?: unknown) {
    setError('');
    try {
      await api.put(url, body ?? undefined);
      for (const k of [...keys, 'analytics', 'audit']) qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Approvals</h1>
      {error && <p className="alert-critical">{error}</p>}

      <div className="card">
        <h2 className="section-title mb-1">Agencies awaiting approval</h2>
        <p className="mb-3 text-sm text-gray-500">
          An approved agent can build profiles for people who have not joined and invite them to
          create accounts. Check the registration details before approving.
        </p>
        {(pendingAgents ?? []).map((a) => (
          <div key={a.id} className="border-b py-3 last:border-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{a.agencyName}</p>
                <p className="text-sm text-gray-500">
                  {[a.city, a.registrationNumber, a.contactPhone].filter(Boolean).join(' · ') ||
                    'No further details supplied'}
                </p>
                {a.about && <p className="mt-1 text-sm text-gray-600">{a.about}</p>}
                {a.missingDetails && a.missingDetails.length > 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    Incomplete registration: no {a.missingDetails.map(agencyDetailLabel).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => act(`/admin/agents/${a.id}/approve`, ['pending-agents'])}
                >
                  Approve
                </button>
                <button
                  className="btn-outline"
                  onClick={() => setRejecting(rejecting === a.id ? null : a.id)}
                >
                  Reject
                </button>
              </div>
            </div>
            {rejecting === a.id && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="flex-1">
                  <label className="label">Reason (sent to the agency)</label>
                  <input
                    className="input"
                    minLength={5}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <button
                  className="btn-outline"
                  onClick={async () => {
                    await act(`/admin/agents/${a.id}/reject`, ['pending-agents', 'rejected-agents'], {
                      reason,
                    });
                    setRejecting(null);
                    setReason('');
                  }}
                >
                  Send rejection
                </button>
              </div>
            )}
          </div>
        ))}
        {!pendingAgents?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      {(rejectedAgents?.length ?? 0) > 0 && (
        <details className="card">
          <summary className="section-title cursor-pointer">
            Rejected agencies ({rejectedAgents?.length})
          </summary>
          <p className="mb-3 mt-1 text-sm text-gray-500">
            Told why and waiting to resubmit, so not counted as pending. Resubmitting returns an
            agency to the list above; approve here only to reverse a rejection.
          </p>
          {(rejectedAgents ?? []).map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-0"
            >
              <div>
                <p className="font-medium">
                  {a.agencyName}
                  {a.city ? `, ${a.city}` : ''}
                </p>
                {a.rejectionReason && (
                  <p className="text-sm text-gray-500">Reason given: {a.rejectionReason}</p>
                )}
              </div>
              <button
                className="btn-outline"
                onClick={() => act(`/admin/agents/${a.id}/approve`, ['pending-agents', 'rejected-agents'])}
              >
                Approve instead
              </button>
            </div>
          ))}
        </details>
      )}

      <div className="card">
        <h2 className="section-title mb-2">Vendors awaiting approval</h2>
        {(pendingVendors ?? []).map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between border-b py-2 text-sm last:border-0"
          >
            <span>
              {v.name} ({v.category}){v.city ? `, ${v.city}` : ''}
            </span>
            <button
              className="btn-outline"
              onClick={() => act(`/admin/vendors/${v.id}/approve`, ['pending-vendors'])}
            >
              Approve
            </button>
          </div>
        ))}
        {!pendingVendors?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      <div className="card">
        <h2 className="section-title mb-2">Wedding planners awaiting approval</h2>
        {(pendingPlanners ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between border-b py-2 text-sm last:border-0"
          >
            <span>
              {p.agencyName}
              {p.city ? `, ${p.city}` : ''}
            </span>
            <button
              className="btn-outline"
              onClick={() => act(`/admin/planners/${p.id}/approve`, ['pending-planners'])}
            >
              Approve
            </button>
          </div>
        ))}
        {!pendingPlanners?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      <ReviewModeration />
      {/* Planner reviews are a table of their own, so they are a queue of their
          own — with the planner, rating and search filters the vendor endpoint
          does not take (EZ1-I244). */}
      <ReviewModeration kind="planner" />
    </div>
  );
}

/** The audit trail page, made readable (EZ1-I204). Lives in its own file. */
export { default as AdminAuditLogs } from './AdminAuditLogs';

interface Transaction {
  paymentId: string;
  bookingId: string;
  milestone: string;
  status: string;
  amount: string;
  payoutAmount: string;
  createdAt: string;
  buyerName: string | null;
  providerName: string | null;
  providerType: string | null;
}

const TXN_STATUS_STYLE: Record<string, string> = {
  held_in_escrow: 'bg-amber-50 text-amber-800',
  released: 'bg-emerald-50 text-emerald-800',
  disputed: 'bg-red-50 text-red-700',
  refunded: 'bg-gray-100 text-gray-500',
  pending_payout: 'bg-sky-50 text-sky-800',
  partially_settled: 'bg-sky-50 text-sky-800',
};

/**
 * The admin Payments/Transactions page: where the money is (escrow position)
 * and every payment that made it up. The status filter seeds from the URL, so
 * the dashboard's "Held in escrow" card lands here already filtered.
 */
export function AdminPayments() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(params.get('status') ?? '');

  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/admin/analytics')).data,
    retry: false,
  });
  const escrow: Record<string, string> | undefined = analytics?.escrow?.bookings;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions', status],
    queryFn: async () =>
      (await api.get('/admin/transactions', { params: { limit: 50, status: status || undefined } }))
        .data as { data: Transaction[]; total: number },
  });

  const money = (v?: string) =>
    `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <Masthead title="Payments">Every transaction, and where the money in escrow stands.</Masthead>
      {escrow && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <EscrowStat label="Held in escrow" value={money(escrow.held)} tone="text-amber-700" />
          <EscrowStat label="Frozen (disputed)" value={money(escrow.disputed)} tone="text-red-700" />
          <EscrowStat label="Released" value={money(escrow.released)} tone="text-emerald-700" />
          <EscrowStat label="Commission" value={money(escrow.commission)} />
          <EscrowStat label="Refunded" value={money(escrow.refunded)} />
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Transactions</h2>
          <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {['held_in_escrow', 'released', 'disputed', 'refunded', 'pending_payout', 'partially_settled', 'failed'].map(
              (value) => (
                <option key={value} value={value}>
                  {paymentStatusLabel(value, 'admin')}
                </option>
              ),
            )}
          </select>
        </div>
        {isLoading && <Loading rows={4} />}
        {!isLoading && (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken text-left text-xs uppercase tracking-wide text-gray-500 [&>th]:px-2 [&>th]:py-2.5">
                <th className="pb-2">Date</th>
                <th className="pb-2">Booking</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Provider</th>
                <th className="pb-2">Instalment</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">Payout</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((t) => (
                <tr
                  key={t.paymentId}
                  onClick={() => navigate(`/admin/payments/${t.paymentId}`)}
                  className="cursor-pointer hover:bg-surface-sunken"
                >
                  <td className="py-2 text-gray-600">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 font-mono text-xs text-gray-500">{t.bookingId.slice(0, 8)}</td>
                  <td className="py-2">{t.buyerName ?? '—'}</td>
                  <td className="py-2">
                    {t.providerName ?? (t.providerType === 'planner' ? 'Wedding planner' : '—')}
                  </td>
                  <td className="py-2">{milestoneLabel(t.milestone)}</td>
                  <td className="py-2 text-right">{money(t.amount)}</td>
                  <td className="py-2 text-right text-gray-600">{money(t.payoutAmount)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-sm px-2 py-1 text-xs ${
                        TXN_STATUS_STYLE[t.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {paymentStatusLabel(t.status, 'admin')}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gray-400">
                    No transactions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EscrowStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

/**
 * A module named in the portal (EZ1-I153) whose own backend does not exist yet.
 *
 * The route is real and access-gated like the rest, but it says so honestly
 * rather than filling the screen with invented or duplicated data.
 */
export function AdminComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="space-y-4">
      <h1 className="page-title">{title}</h1>
      <EmptyState title="Not built yet">{note}</EmptyState>
    </div>
  );
}
