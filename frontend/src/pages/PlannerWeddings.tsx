import { ReactNode, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarBlank,
  CalendarCheck,
  CheckSquare,
  MagnifyingGlass,
  MapPin,
  Storefront,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { daysAway, formatDate } from '../lib/dates';
import { EmptyState, Loading } from '../components/ui/Feedback';

type Status = 'active' | 'upcoming' | 'completed';

interface Wedding {
  userId: string;
  name: string;
  bride: string | null;
  groom: string | null;
  weddingDate: string | null;
  derivedWeddingDate?: string | null;
  location: string | null;
  events: number;
  tasks: { total: number; done: number };
  bookings: { total: number; confirmed: number; pending: number };
  status: Status;
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  active: { label: 'In Progress', tone: 'pill-positive' },
  upcoming: { label: 'Upcoming', tone: 'pill-caution' },
  completed: { label: 'Completed', tone: 'pill-neutral' },
};

const FILTERS = ['all', 'active', 'upcoming', 'completed'] as const;

/**
 * The planner's project register: one card per confirmed engagement.
 *
 * Only weddings the planner is engaged on appear — requests live under My
 * Clients › Requests, and payments in Bookings and Accounts — so this page
 * answers one question: how is each wedding I am running coming along? Every
 * card opens the same ownership-checked workspace My Clients uses.
 */
export default function PlannerWeddings() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const requestedStatus = searchParams.get('status');
  const status: 'all' | Status =
    requestedStatus === 'active' || requestedStatus === 'upcoming' || requestedStatus === 'completed'
      ? requestedStatus
      : 'all';

  const { data, isPending, isError } = useQuery<{ clients: Wedding[] }>({
    queryKey: ['planner-clients'],
    queryFn: async () => (await api.get('/planner/clients')).data,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const weddings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.clients ?? [])
      .filter((w) => status === 'all' || w.status === status)
      .filter((w) => {
        if (!needle) return true;
        const date = w.weddingDate ?? w.derivedWeddingDate;
        // The date is searchable as stored and as shown ("15 Dec 2026").
        return [w.name, w.bride, w.groom, w.location, date, date && formatDate(date)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const left = a.weddingDate ?? a.derivedWeddingDate ?? '9999-12-31';
        const right = b.weddingDate ?? b.derivedWeddingDate ?? '9999-12-31';
        return left.localeCompare(right);
      });
  }, [data?.clients, query, status]);

  const count = (key: 'all' | Status) =>
    key === 'all'
      ? (data?.clients.length ?? 0)
      : (data?.clients ?? []).filter((w) => w.status === key).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">My Weddings</h1>
        <p className="page-subtitle">
          Every confirmed planning engagement in one place. Open a wedding to coordinate its events,
          vendors, tasks and shared plan.
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 flex-1 sm:max-w-md">
          <span className="sr-only">Search weddings</span>
          <MagnifyingGlass
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={17}
            aria-hidden
          />
          <input
            className="input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, couple, date or city"
          />
        </label>
        <div className="flex flex-wrap gap-1" aria-label="Filter weddings by status">
          {FILTERS.map((key) => (
            <Link
              key={key}
              to={key === 'all' ? '/weddings' : `/weddings?status=${key}`}
              aria-current={status === key ? 'page' : undefined}
              className={status === key ? 'btn btn-sm' : 'btn-outline btn-sm'}
            >
              {key === 'all' ? 'All' : STATUS[key].label} ({count(key)})
            </Link>
          ))}
        </div>
      </div>

      {isPending ? (
        <Loading rows={5} />
      ) : isError ? (
        <p className="alert-critical">Your weddings could not be loaded. Please try again.</p>
      ) : weddings.length === 0 ? (
        <div className="card">
          <EmptyState icon={CalendarCheck} title={query ? 'No weddings match' : 'No weddings found'}>
            {query
              ? 'Try a different name, date or city.'
              : 'A wedding appears here once a couple has agreed your quotation and the engagement is confirmed.'}
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {weddings.map((wedding) => (
            <WeddingCard key={wedding.userId} wedding={wedding} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeddingCard({ wedding }: { wedding: Wedding }) {
  const date = wedding.weddingDate ?? wedding.derivedWeddingDate ?? null;
  const days = daysAway(date);
  const couple = [wedding.bride, wedding.groom].filter(Boolean).join(' & ');
  const pending = Math.max(0, wedding.tasks.total - wedding.tasks.done);
  const progress = wedding.tasks.total
    ? Math.round((wedding.tasks.done / wedding.tasks.total) * 100)
    : 0;
  const when =
    days === null
      ? null
      : days > 1
        ? `in ${days} days`
        : days === 1
          ? 'tomorrow'
          : days === 0
            ? 'today'
            : null;

  return (
    <Link
      to={`/my-clients/${wedding.userId}`}
      aria-label={`Open the wedding workspace for ${couple || wedding.name}`}
      className="card group flex flex-col gap-4 transition-[box-shadow,border-color] hover:border-brand/40 hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {/* Who, where, and where it stands. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-serif text-[1.5rem] leading-tight text-gray-900">
            {couple || wedding.name}
          </p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-600">
            {couple && <span className="truncate">Client: {wedding.name}</span>}
            <span className="flex items-center gap-1">
              <MapPin size={14} className="text-brand" aria-hidden />
              {wedding.location ?? 'Location not set'}
            </span>
          </p>
        </div>
        <span className={`${STATUS[wedding.status].tone} shrink-0`}>{STATUS[wedding.status].label}</span>
      </div>

      {/* The day itself. */}
      <div className="flex items-center gap-3 rounded-[--radius-md] bg-brand-soft/50 px-3 py-2.5">
        <CalendarBlank size={20} className="shrink-0 text-brand" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">Wedding date</p>
          <p className="font-medium text-gray-900">
            {formatDate(date, 'Not set')}
            {when && <span className="ml-2 text-sm font-normal text-brand-strong">· {when}</span>}
          </p>
        </div>
      </div>

      {/* The three numbers a planner checks first. */}
      <dl className="grid grid-cols-3 gap-2">
        <Stat icon={<CalendarCheck size={18} aria-hidden />} label="Events" value={wedding.events} />
        <Stat
          icon={<Storefront size={18} aria-hidden />}
          label="Confirmed vendors"
          value={wedding.bookings.confirmed}
          hint={wedding.bookings.pending > 0 ? `${wedding.bookings.pending} pending` : undefined}
        />
        <Stat
          icon={<CheckSquare size={18} aria-hidden />}
          label="Pending tasks"
          value={pending}
          tone={pending > 0 ? 'text-caution-fg' : undefined}
        />
      </dl>

      {/* How far the plan has got, by tasks done. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="text-gray-600">Planning progress</span>
          <span className="font-medium tabular-nums text-gray-900">
            {progress}%
            <span className="ml-1.5 text-xs font-normal text-gray-500">
              {wedding.tasks.total
                ? `${wedding.tasks.done} of ${wedding.tasks.total} tasks`
                : 'no tasks yet'}
            </span>
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Planning progress"
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <span className="mt-auto flex items-center justify-end gap-1.5 border-t border-gray-200 pt-3 text-sm font-medium text-brand-strong">
        Open Wedding Workspace
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[--radius-md] border border-gray-200 px-3 py-2">
      <dt className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className="text-gray-400">{icon}</span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className={`mt-0.5 font-serif text-2xl leading-none ${tone ?? 'text-gray-900'}`}>{value}</dd>
      {hint && <dd className="mt-1 text-[0.6875rem] text-gray-500">{hint}</dd>}
    </div>
  );
}
