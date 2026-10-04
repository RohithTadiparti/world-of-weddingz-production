import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/dates';
import { MILESTONE_LABEL } from '../lib/permissions';
import { paymentStatusLabel } from '../lib/labels';
import {
  PROGRESS_STEPS,
  QUOTATION_STAGE_LABEL,
  QUOTATION_STAGE_TONE,
  progressIndex,
  type QuotationStage,
  type QuotationSummary,
} from '../lib/booking-progress';

/**
 * A booking's price, negotiation and money, from `GET /bookings/:id/summary`
 * (EZ1-I264, EZ1-I265).
 *
 * The customer's budget, the quotation that was accepted, the add-ons agreed
 * since and the total they add up to are kept on separate lines, because they
 * are different facts and a single "Price" hid three of them. Every offer stays
 * in the history with what became of it, and the money is broken down the way
 * the Accounts page counts it.
 */
export interface BookingSummaryData {
  bookingId: string;
  status: string;
  currency: string;
  price: {
    budget: string | null;
    quoted: string | null;
    /** Agreed at a listed price rather than through a quotation. */
    listedPrice?: boolean;
    base: string | null;
    addonsTotal: string;
    addonsAgreed: number;
    addonsAwaiting: number;
    grandTotal: string;
  };
  quotation: QuotationSummary | null;
  quotations: {
    id: string;
    amount: string;
    currency: string;
    stage: QuotationStage;
    notes: string | null;
    terms: string | null;
    validUntil: string | null;
    /** The priced lines the offer was made of, when the server sends them. */
    lines?: { description: string; amount: number | string }[];
    responseNote: string | null;
    respondedAt: string | null;
    createdAt: string;
  }[];
  payments: Record<
    | 'total'
    | 'paid'
    | 'pending'
    | 'heldInEscrow'
    | 'pendingPayout'
    | 'released'
    | 'refunded'
    | 'commission'
    | 'vendorEarnings',
    string
  >;
  projected: { commission: string; vendorEarnings: string } | null;
  instalments: { milestone: string; amount: string; status: string | null }[];
  delivery: { deliveredAt: string | null; deliveryNotes: string | null; deliveryAcceptedAt: string | null };
}

const UNPAID = ['initiated', 'failed', 'refunded'];

export function useBookingSummary(bookingId: string) {
  return useQuery({
    queryKey: ['booking-summary', bookingId],
    queryFn: async () => (await api.get(`/bookings/${bookingId}/summary`)).data as BookingSummaryData,
    retry: false,
    // Payments and add-ons are moved by the customer too; nothing pushes those.
    refetchInterval: 30_000,
  });
}

/** Where the job is on its way from request to completion. */
export function BookingProgress({
  status,
  quotation,
}: {
  status: string;
  quotation?: QuotationSummary | null;
}) {
  const current = progressIndex(status, quotation);
  if (current === null) {
    return (
      <p className="text-gray-500">
        {status === 'disputed' ? 'Under investigation — off the usual path' : 'Cancelled'}
      </p>
    );
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Booking progress">
      {PROGRESS_STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-1.5">
          <span
            aria-current={i === current ? 'step' : undefined}
            className={
              i === current
                ? 'rounded-sm bg-brand px-2 py-0.5 font-medium text-brand-fg'
                : i < current
                  ? 'text-positive-fg'
                  : 'text-gray-400'
            }
          >
            {i < current ? `✓ ${step}` : step}
          </span>
          {i < PROGRESS_STEPS.length - 1 && <span aria-hidden className="text-gray-300">&rarr;</span>}
        </li>
      ))}
    </ol>
  );
}

export function PriceBreakdown({ summary }: { summary: BookingSummaryData }) {
  const { price } = summary;
  const money = moneyIn(summary.currency);
  return (
    <Section title="Price">
      <Row label="Customer budget">{price.budget ? money(price.budget) : 'Not given'}</Row>
      {price.quoted || !price.listedPrice ? (
        <Row label="Accepted quotation">{price.quoted ? money(price.quoted) : 'Not agreed yet'}</Row>
      ) : (
        <Row label="Agreed price">{`${money(price.base ?? price.grandTotal)} (listed price, no quotation)`}</Row>
      )}
      <Row label="Add-ons agreed">
        {price.addonsAgreed > 0 ? `${money(price.addonsTotal)} (${price.addonsAgreed})` : 'None'}
        {price.addonsAwaiting > 0 && (
          <span className="text-gray-400"> · {price.addonsAwaiting} awaiting an answer</span>
        )}
      </Row>
      {/* A request has no price until a quotation is accepted; "INR 0" read as
          free, not as not-yet-priced. */}
      <Row label="Grand total">
        {Number(price.grandTotal) > 0 ? (
          <span className="font-medium">{money(price.grandTotal)}</span>
        ) : summary.quotation ? (
          `Not agreed yet · latest quote ${money(summary.quotation.amount)}`
        ) : (
          'Not priced yet'
        )}
      </Row>
    </Section>
  );
}

export function QuotationHistory({ summary }: { summary: BookingSummaryData }) {
  if (summary.quotations.length === 0) return null;
  const money = moneyIn(summary.currency);
  return (
    <Section title="Quotation history">
      <ol className="space-y-1.5 sm:col-span-2">
        {summary.quotations.map((q) => (
          <li key={q.id} className="rounded-sm bg-surface-sunken p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{money(q.amount)}</span>
              <span className={`rounded-sm px-2 py-0.5 ${QUOTATION_STAGE_TONE[q.stage]}`}>
                {QUOTATION_STAGE_LABEL[q.stage]}
              </span>
            </div>
            <p className="mt-0.5 text-gray-500">
              Sent {formatDateTime(q.createdAt)}
              {q.respondedAt ? ` · answered ${formatDateTime(q.respondedAt)}` : ''}
            </p>
            {q.responseNote && <p className="mt-0.5 text-gray-700">Customer: {q.responseNote}</p>}
            {q.notes && <p className="mt-0.5 text-gray-600">{q.notes}</p>}
            {/* What the offer was made of and on what terms — the same record
                the customer accepted or declined, not just its total. */}
            {(q.lines ?? []).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-gray-600">
                {(q.lines ?? []).map((line, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{line.description}</span>
                    <span className="font-mono">{money(line.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {q.terms && (
              <p className="mt-0.5 whitespace-pre-wrap text-gray-600">
                <span className="text-gray-400">Terms: </span>
                {q.terms}
              </p>
            )}
            {q.validUntil && (
              <p className="mt-0.5 text-gray-500">Valid until {formatDate(q.validUntil)}</p>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function PaymentBreakdown({ summary }: { summary: BookingSummaryData }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState(false);
  const money = moneyIn(summary.currency);
  const p = summary.payments;
  const { delivery } = summary;

  // Released automatically once the balance is in and the delivery is signed
  // off; the button is for money that was already held before that existed.
  const canRelease =
    summary.status === 'completed' &&
    Number(p.heldInEscrow) > 0 &&
    (!delivery.deliveredAt || Boolean(delivery.deliveryAcceptedAt));

  async function release() {
    setError('');
    setReleasing(true);
    try {
      await api.put(`/bookings/${summary.bookingId}/settle`);
      for (const key of ['booking-summary', 'booking-history', 'incoming-bookings', 'earnings']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      setError(apiMessage(err, 'The payout could not be released.'));
    } finally {
      setReleasing(false);
    }
  }

  // Nothing is payable before a price is agreed, so instalments and money rows
  // of INR 0 would only look like a booking that costs nothing.
  if (Number(summary.price.grandTotal) <= 0) {
    return (
      <Section title="Payment">
        <p className="text-gray-500 sm:col-span-2">
          The instalments are set once the customer accepts a quotation.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Payment">
      {summary.instalments.length > 0 && (
        <ul className="space-y-0.5 sm:col-span-2">
          {summary.instalments.map((row) => (
            <li key={row.milestone} className="flex items-center justify-between gap-2">
              <span className="text-gray-600">{MILESTONE_LABEL[row.milestone] ?? row.milestone}</span>
              <span className="font-mono">{money(row.amount)}</span>
              <span className={row.status && !UNPAID.includes(row.status) ? '' : 'text-gray-400'}>
                {row.status ? paymentStatusLabel(row.status, 'provider') : 'Not due yet'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Row label="Paid">{money(p.paid)}</Row>
      <Row label="Pending">{money(p.pending)}</Row>
      <Row label="Held in escrow">{money(p.heldInEscrow)}</Row>
      <Row label="Released to you">{money(p.released)}</Row>
      {Number(p.pendingPayout) > 0 && <Row label="Owed to you">{money(p.pendingPayout)}</Row>}
      {Number(p.refunded) > 0 && <Row label="Refunded">{money(p.refunded)}</Row>}
      <Row label="Platform commission">{money(p.commission)}</Row>
      <Row label="Your earnings">
        <span className="font-medium">{money(p.vendorEarnings)}</span>
      </Row>
      {summary.projected && (
        <p className="text-gray-500 sm:col-span-2">
          On the full {money(summary.price.grandTotal)}: commission {money(summary.projected.commission)},
          your earnings {money(summary.projected.vendorEarnings)}.
        </p>
      )}
      {delivery.deliveredAt && (
        <p className="text-gray-500 sm:col-span-2">
          Delivered {formatDateTime(delivery.deliveredAt)} ·{' '}
          {delivery.deliveryAcceptedAt
            ? `confirmed by the customer ${formatDateTime(delivery.deliveryAcceptedAt)}`
            : 'waiting for the customer to confirm'}
        </p>
      )}
      {/* What the provider recorded as handed over, the note the customer
          reads before accepting the delivery. */}
      {delivery.deliveryNotes && (
        <p className="whitespace-pre-wrap text-gray-600 sm:col-span-2">
          <span className="text-gray-400">Delivery notes: </span>
          {delivery.deliveryNotes}
        </p>
      )}
      {canRelease && (
        <div className="sm:col-span-2">
          <button type="button" className="btn btn-sm" disabled={releasing} onClick={release}>
            Release payout
          </button>
        </div>
      )}
      {error && <p className="alert-critical sm:col-span-2">{error}</p>}
    </Section>
  );
}

function moneyIn(currency: string) {
  return (value: string | number) => `${currency} ${Number(value || 0).toLocaleString('en-IN')}`;
}

/**
 * A titled block of facts, two columns where there is room for two.
 *
 * A plain grid rather than a definition list: these sections carry a paragraph
 * and an instalment table alongside their label/value pairs, and neither is
 * something a `dl` may contain.
 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h4>
      <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="min-w-0 break-words text-gray-800">{children}</span>
    </div>
  );
}
