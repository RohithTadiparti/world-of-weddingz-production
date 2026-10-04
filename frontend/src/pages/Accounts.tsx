import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { MILESTONE_LABEL, Permission, can } from '../lib/permissions';
import { paymentStatusLabel } from '../lib/labels';
import { Loading } from '../components/ui/Feedback';
import PayoutAccount, { type PayoutAccountView } from '../components/PayoutAccount';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';

const maskAccountId = (value: string | null | undefined) => {
  if (!value) return 'Not configured';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
};

interface LedgerRow {
  paymentId: string;
  bookingId: string;
  milestone: string;
  status: string;
  amount: string;
  commissionAmount: string;
  payoutAmount: string;
  releasedAmount: string;
  availableAmount: string;
  confirmedAt: string | null;
  createdAt: string;
  /** Who the booking was for and what was sold, when the server names them. */
  clientName?: string | null;
  serviceName?: string | null;
  eventDate: string | null;
}

interface Earnings {
  heldInEscrow: string;
  /** Earned and owed, but not yet transferred — usually payout onboarding. */
  pendingPayout: string;
  released: string;
  refunded: string;
  commission: string;
  gross: string;
  currency: string;
  ledger: LedgerRow[];
}

const STATUS_STYLE: Record<string, string> = {
  initiated: 'bg-gray-100 text-gray-600',
  held_in_escrow: 'bg-amber-50 text-amber-800',
  disputed: 'bg-red-50 text-red-700',
  released: 'bg-emerald-50 text-emerald-800',
  refunded: 'bg-gray-100 text-gray-500',
  partially_settled: 'bg-sky-50 text-sky-800',
};

/**
 * The provider's money.
 *
 * Held and paid out are shown as separate figures because they answer different
 * questions: one is what the marketplace owes them, the other is what has
 * already reached their bank. Adding them together would flatter the balance
 * and mislead somebody deciding whether they can pay their own suppliers.
 */
export default function Accounts() {
  const navigate = useNavigate();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  /*
   * A planner is a provider too, and took bookings, and was shown the figure
   * this page calls "Owed to you -- waiting on a payout account to send it
   * to" with no control anywhere that could supply one. The column and the
   * read had always existed; only the way in was missing, so every completed
   * planner booking stayed at PENDING_PAYOUT (council round 2).
   */
  const isPlanner = can(permissions, Permission.PLANNER_LISTING_MANAGE);
  const { activeId } = useBusinesses();

  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Earnings>({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data,
  });

  // The provider's payout account lives here now, not in My Business (EZ1-I100).
  const payoutEndpoint = isPlanner
    ? '/wedding-planners/me/payout-account'
    : activeId
      ? `/vendors/${activeId}/payout-account`
      : null;
  const { data: payout } = useQuery<PayoutAccountView | null>({
    queryKey: ['payout-account', isPlanner ? 'planner' : activeId],
    enabled: ((isVendor && Boolean(activeId)) || isPlanner) && Boolean(payoutEndpoint),
    queryFn: async () => (await api.get<PayoutAccountView>(payoutEndpoint as string)).data,
    retry: false,
  });
  const payoutActive = payout?.status === 'active';
  const [releasing, setReleasing] = useState<string | null>(null);
  const [releaseNotice, setReleaseNotice] = useState('');

  async function releasePayment(row: LedgerRow) {
    setReleasing(row.paymentId);
    setReleaseNotice('');
    try {
      const { data: result } = await api.put<{ released: number; notReleased: string[] }>(
        `/bookings/${row.bookingId}/release-payout?milestone=${encodeURIComponent(row.milestone)}`,
      );
      setReleaseNotice(
        result.released > 0
          ? 'Payment released to your payout account.'
          : result.notReleased[0] ?? 'Nothing was released. It may already be on its way.',
      );
      await qc.invalidateQueries({ queryKey: ['earnings'] });
    } catch (err) {
      setReleaseNotice(apiMessage(err, 'That payment could not be released.'));
    } finally {
      setReleasing(null);
    }
  }

  const money = (value: string) =>
    `${data?.currency === 'INR' ? '₹' : ''}${Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
    })}`;

  const eligibleRows = useMemo(
    () => (data?.ledger ?? []).filter((row) => row.status === 'pending_payout'),
    [data?.ledger],
  );
  const escrowRows = useMemo(
    () => (data?.ledger ?? []).filter((row) => ['held_in_escrow', 'disputed'].includes(row.status)),
    [data?.ledger],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Accounts</h1>
        <p className="page-subtitle">
          Every rupee that has moved through your bookings, and where it currently sits.
        </p>
      </div>

      {((isVendor && activeId) || isPlanner) && payoutEndpoint && (
        <PayoutAccount endpoint={payoutEndpoint} view={payout ?? null} />
      )}

      {isLoading && <Loading rows={3} />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Figure label="Total earned" value={money(data.gross)} tone="text-brand-700" note="Gross bookings revenue" />
            <Figure label="Escrow" value={money(data.heldInEscrow)} tone="text-amber-700" note="Currently on hold" />
            <Figure label="Available for payout" value={money(data.pendingPayout)} tone="text-sky-700" note="Eligible for transfer" />
            <Figure label="Paid" value={money(data.released)} tone="text-emerald-700" note="Already released" />
            <Figure label="Commission" value={money(data.commission)} tone="text-gray-700" note="Deducted from payouts" />
            <Figure label="Refunded" value={money(data.refunded)} tone="text-gray-700" note="Returned to the customer" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="card space-y-3 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="section-title">Eligible payouts</h2>
                <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700">
                  Available: {money(data.pendingPayout)}
                </span>
              </div>
              {releaseNotice && (
                <p className="rounded-sm bg-sky-50 p-2 text-sm text-sky-800">{releaseNotice}</p>
              )}
              {eligibleRows.length === 0 ? (
                <div className="py-4 text-center text-sm text-gray-500">No milestones are currently eligible for release.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-2">Booking ID</th>
                        <th className="pb-2">Customer</th>
                        <th className="pb-2">Service</th>
                        <th className="pb-2">Event date</th>
                        <th className="pb-2">Milestone</th>
                        <th className="pb-2 text-right">Total amount</th>
                        <th className="pb-2 text-right">Released</th>
                        <th className="pb-2 text-right">Available</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {eligibleRows.map((row) => (
                        <tr key={row.paymentId}>
                          <td className="py-3 font-mono text-xs text-gray-700">{row.bookingId.slice(0, 8)}</td>
                          <td className="py-3 text-gray-700">{row.clientName ?? 'Customer'}</td>
                          <td className="py-3 text-gray-700">{row.serviceName ?? 'Booking'}</td>
                          <td className="py-3 text-gray-700">{row.eventDate ? new Date(row.eventDate).toLocaleDateString() : '—'}</td>
                          <td className="py-3">{MILESTONE_LABEL[row.milestone] ?? row.milestone}</td>
                          <td className="py-3 text-right">{money(row.amount)}</td>
                          <td className="py-3 text-right">{money(row.releasedAmount)}</td>
                          <td className="py-3 text-right font-medium">{money(row.availableAmount)}</td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              className="btn whitespace-nowrap disabled:cursor-not-allowed disabled:bg-slate-200"
                              disabled={releasing !== null || !payoutActive}
                              title={payoutActive ? undefined : 'Set up an active payout account first'}
                              onClick={() => void releasePayment(row)}
                            >
                              {releasing === row.paymentId ? 'Releasing…' : 'Release Payment'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="section-title">Payout account</h2>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${payoutActive ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}
                >
                  {payoutActive
                    ? 'Active'
                    : payout?.status === 'pending_verification'
                      ? 'Pending verification'
                      : 'Not configured'}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-medium text-slate-900">Linked account</div>
                <div className="mt-1 font-mono">{maskAccountId(payout?.payoutAccountId ?? null)}</div>
                <div className="mt-2 text-xs text-slate-500">
                  {payoutActive
                    ? 'Released payments are transferred to this account.'
                    : payout?.status === 'pending_verification'
                      ? 'Your bank details are waiting to be verified. Payouts are held until then.'
                      : 'Add a payout account to allow transfers from escrow.'}
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-gray-900">Escrow</h2>
              <span className="text-xs text-gray-400">Only eligible milestones can move to available for payout</span>
            </div>
            {escrowRows.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No escrow is currently pending release.</div>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="pb-2">Booking</th>
                    <th className="pb-2">Customer</th>
                    <th className="pb-2">Milestone</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Expected release</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {escrowRows.map((row) => (
                    <tr key={row.paymentId}>
                      <td className="py-2 font-mono text-xs text-gray-700">{row.bookingId.slice(0, 8)}</td>
                      <td className="py-2 text-gray-700">{row.clientName ?? 'Customer'}</td>
                      <td className="py-2">{MILESTONE_LABEL[row.milestone] ?? row.milestone}</td>
                      <td className="py-2 text-right font-medium">{money(row.payoutAmount)}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-1 text-xs ${row.status === 'disputed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                          {paymentStatusLabel(row.status, 'provider')}
                        </span>
                      </td>
                      <td className="py-2 text-gray-600">{row.confirmedAt ? new Date(row.confirmedAt).toLocaleDateString() : 'Awaiting confirmation'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card overflow-x-auto">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-gray-900">Ledger</h2>
              <span className="text-xs text-gray-400">Select a row for full transaction details</span>
            </div>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Booking</th>
                  <th className="pb-2">Instalment</th>
                  <th className="pb-2 text-right">Charged</th>
                  <th className="pb-2 text-right">Commission</th>
                  <th className="pb-2 text-right">Your share</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.ledger.map((row) => (
                  <tr
                    key={row.paymentId}
                    onClick={() => navigate(`/accounts/transactions/${row.paymentId}`)}
                    className="cursor-pointer hover:bg-surface-sunken"
                    title="Open transaction details"
                  >
                    <td className="py-2 text-gray-600">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    {/* Who and what the money was for, with the reference
                        underneath for anyone matching it against a statement. */}
                    <td className="py-2">
                      <span className="block text-gray-900">
                        {[row.clientName, row.serviceName].filter(Boolean).join(' · ') ||
                          'Booking'}
                      </span>
                      <span className="font-mono text-xs text-brand-strong hover:underline">
                        {row.bookingId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="py-2">{MILESTONE_LABEL[row.milestone] ?? row.milestone}</td>
                    <td className="py-2 text-right">{money(row.amount)}</td>
                    <td className="py-2 text-right text-gray-500">
                      −{money(row.commissionAmount)}
                    </td>
                    <td className="py-2 text-right font-medium">{money(row.payoutAmount)}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-sm px-2 py-1 text-xs ${
                          STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {paymentStatusLabel(row.status, 'provider')}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.ledger.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-gray-400">
                      No payments yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note: string;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone ?? 'text-gray-900'}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </div>
  );
}
