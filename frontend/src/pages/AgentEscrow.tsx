import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, MagnifyingGlass, Vault, Warning, ArrowCounterClockwise } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { paymentStatusLabel } from '../lib/labels';

interface Summary {
  total: string;
  pending: string;
  released: string;
  refunded: string;
  currency: string;
}

interface EscrowRow {
  id: string;
  clientName: string;
  clientId: string;
  bookingId: string;
  provider: string | null;
  service: string;
  bookingAmount: string | null;
  escrowAmount: string;
  status: string;
  paymentDate: string;
  releaseDate: string | null;
  refundDate: string | null;
  referenceId: string;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Response {
  summary: Summary;
  data: EscrowRow[];
}

const STATUS_STYLE: Record<string, string> = {
  held_in_escrow: 'bg-amber-50 text-amber-800',
  disputed: 'bg-red-50 text-red-700',
  released: 'bg-emerald-50 text-emerald-800',
  pending_payout: 'bg-sky-50 text-sky-800',
  refunded: 'bg-gray-100 text-gray-600',
  partially_settled: 'bg-cyan-50 text-cyan-800',
};

const FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['released', 'Released'],
  ['refunded', 'Refunded'],
] as const;

export default function AgentEscrow() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const status = params.get('status') ?? 'all';
  const { data, isLoading, isError, error } = useQuery<Response>({
    queryKey: ['agent-escrow', status, params.get('search') ?? ''],
    queryFn: async () => (await api.get('/agents/escrow', { params: { status, search: params.get('search') ?? undefined } })).data,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const money = (value: string, currency = data?.summary.currency ?? 'INR') =>
    `${currency === 'INR' ? '₹' : ''}${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const setStatus = (next: string) => setParams(next === 'all' ? {} : { status: next, ...(search ? { search } : {}) });
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setParams({ ...(status !== 'all' ? { status } : {}), ...(search ? { search } : {}) });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Agent Escrow</h1>
        <p className="page-subtitle">Escrow transactions for your assigned clients and their bookings.</p>
      </header>

      {data && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total escrow" value={money(data.summary.total)} icon={Vault} gradient="from-caution-bg to-brand-50" onClick={() => setStatus('all')} />
        <SummaryCard label="Pending escrow" value={money(data.summary.pending)} icon={Warning} gradient="from-positive-bg to-surface" onClick={() => setStatus('pending')} />
        <SummaryCard label="Released escrow" value={money(data.summary.released)} icon={CheckCircle} gradient="from-positive-bg to-brand-50" onClick={() => setStatus('released')} />
        <SummaryCard label="Refunded escrow" value={money(data.summary.refunded)} icon={ArrowCounterClockwise} gradient="from-rose-50 to-surface" onClick={() => setStatus('refunded')} />
      </div>}

      <div className="card space-y-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => (
            <button key={value} className={status === value ? 'btn btn-sm' : 'btn-outline btn-sm'} onClick={() => setStatus(value)}>{label}</button>
          ))}
        </div>
        <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="agent-escrow-search">Search escrow</label>
          <div className="relative min-w-[min(100%,20rem)] flex-1">
            <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <input id="agent-escrow-search" className="input w-full pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Client, client ID, booking, provider or transaction" />
          </div>
          <button className="btn" type="submit">Search</button>
        </form>
      </div>

      {isLoading && <Loading rows={5} />}
      {isError && <p className="alert-critical">{apiMessage(error, 'Escrow could not be loaded.')}</p>}
      {data && data.data.length === 0 && <div className="card"><EmptyState icon={Vault} title="No escrow transactions">No escrow records match this filter.</EmptyState></div>}
      {data && data.data.length > 0 && <div className="overflow-hidden rounded-lg border border-gray-200 bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-surface-sunken text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-4 py-3">Client</th><th className="px-4 py-3">Booking</th><th className="px-4 py-3">Provider / service</th><th className="px-4 py-3">Amounts</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Reference</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((row) => <tr key={row.id} className="transition-colors hover:bg-brand-soft/20">
                <td className="px-4 py-3"><p className="font-medium text-gray-900">{row.clientName}</p><p className="text-xs text-gray-500">{row.clientId}</p></td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.bookingId}</td>
                <td className="px-4 py-3"><p className="font-medium text-gray-800">{row.provider ?? 'Provider unavailable'}</p><p className="text-xs text-gray-500">{row.service}</p></td>
                <td className="px-4 py-3"><p className="font-medium text-gray-900">{money(row.escrowAmount)}</p><p className="text-xs text-gray-500">Booking {row.bookingAmount ? money(row.bookingAmount) : 'not stated'}</p></td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{paymentStatusLabel(row.status, 'buyer')}</span></td>
                <td className="px-4 py-3 text-xs text-gray-500"><p>Paid {new Date(row.paymentDate).toLocaleDateString()}</p>{row.releaseDate && <p>Released {new Date(row.releaseDate).toLocaleDateString()}</p>}{row.refundDate && <p>Refunded {new Date(row.refundDate).toLocaleDateString()}</p>}</td>
                <td className="max-w-[14rem] px-4 py-3"><p className="truncate font-mono text-xs text-gray-600" title={row.referenceId}>{row.referenceId}</p>{row.remarks && <p className="truncate text-xs text-gray-500" title={row.remarks}>{row.remarks}</p>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, gradient, onClick }: { label: string; value: string; icon: any; gradient: string; onClick: () => void }) {
  return <button onClick={onClick} className={`group rounded-lg border border-gray-200 bg-gradient-to-br ${gradient} p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-card`}><span className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-gray-600">{label}</span><Icon size={20} weight="duotone" className="text-brand-dark" aria-hidden /></span><span className="mt-2 block font-mono text-2xl text-gray-900">{value}</span></button>;
}
