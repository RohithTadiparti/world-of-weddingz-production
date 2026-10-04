import { useState } from 'react';
import { Alert as NativeAlert, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import {
  LIFECYCLE,
  PAYMENT_LABEL,
  QUOTATION_STAGE_LABEL,
  QUOTATION_STAGE_TONE,
  progressIndex,
  type QuotationStage,
  type QuotationSummary,
} from '@/lib/bookings';
import { dateTime, money } from '@/lib/format';
import { formatDate } from '@/shared/dates';
import { MILESTONE_LABEL } from '@/shared/permissions';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { Alert, Button, Caption, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * A booking's price, negotiation and money, from `GET /bookings/:id/summary`
 * (EZ1-I264, EZ1-I265). The same read the web portal draws, so the two cannot
 * disagree.
 *
 * The customer's budget, the accepted quotation, the add-ons agreed since and
 * the total they add up to are separate lines; every offer stays in the history
 * with what became of it; and the money is broken down the way Accounts counts
 * it.
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
    validUntil: string | null;
    /** What the price is made of, line by line. */
    lines?: { description: string; amount: number | string }[] | null;
    /** What a dispute is argued from, so it is shown with the offer it belongs to. */
    terms?: string | null;
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

/** A payment in one of these states has not actually been collected. */
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

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: space(1.5),
        paddingTop: space(2),
        borderTopWidth: 1,
        borderTopColor: rgb(theme.border),
      }}
    >
      <SectionTitle>{title}</SectionTitle>
      {children}
    </View>
  );
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
      <Caption tone="muted">
        {status === 'disputed' ? 'Under investigation — off the usual path' : 'Cancelled'}
      </Caption>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`Step ${current + 1} of ${LIFECYCLE.length}: ${LIFECYCLE[current]}`}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}
    >
      {LIFECYCLE.map((step, i) => (
        <Badge key={step} tone={i < current ? 'positive' : i === current ? 'brand' : 'neutral'}>
          {i < current ? `✓ ${step}` : step}
        </Badge>
      ))}
    </View>
  );
}

export function PriceBreakdown({ summary }: { summary: BookingSummaryData }) {
  const { price, currency } = summary;
  return (
    <Section title="Price">
      <DetailGrid>
        <DetailRow label="Customer budget">
          {price.budget ? money(price.budget, currency) : 'Not given'}
        </DetailRow>
        {price.quoted || !price.listedPrice ? (
          <DetailRow label="Accepted quotation">
            {price.quoted ? money(price.quoted, currency) : 'Not agreed yet'}
          </DetailRow>
        ) : (
          <DetailRow label="Agreed price">
            {`${money(price.base ?? price.grandTotal, currency)} (listed price, no quotation)`}
          </DetailRow>
        )}
        <DetailRow label="Add-ons agreed">
          {`${price.addonsAgreed > 0 ? `${money(price.addonsTotal, currency)} (${price.addonsAgreed})` : 'None'}${
            price.addonsAwaiting > 0 ? ` · ${price.addonsAwaiting} awaiting an answer` : ''
          }`}
        </DetailRow>
        {/* A request has no price until a quotation is accepted; "INR 0" read
            as free, not as not-yet-priced. */}
        <DetailRow label="Grand total">
          {Number(price.grandTotal) > 0
            ? money(price.grandTotal, currency)
            : summary.quotation
              ? `Not agreed yet · latest quote ${money(summary.quotation.amount, currency)}`
              : 'Not priced yet'}
        </DetailRow>
      </DetailGrid>
    </Section>
  );
}

export function QuotationHistory({ summary }: { summary: BookingSummaryData }) {
  if (summary.quotations.length === 0) return null;
  return (
    <Section title="Quotation history">
      {summary.quotations.map((q, index) => (
        <View key={q.id} style={{ gap: space(0.5) }}>
          {index > 0 ? <Divider /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) }}>
            <Caption style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
              {money(q.amount, q.currency)}
            </Caption>
            <Badge tone={QUOTATION_STAGE_TONE[q.stage]}>{QUOTATION_STAGE_LABEL[q.stage]}</Badge>
          </View>
          <Caption tone="faint">
            {`Sent ${dateTime(q.createdAt)}${q.respondedAt ? ` · answered ${dateTime(q.respondedAt)}` : ''}`}
          </Caption>
          {q.validUntil ? (
            <Caption tone="faint">{`Valid until ${formatDate(q.validUntil)}`}</Caption>
          ) : null}
          {q.responseNote ? <Caption>{`Customer: ${q.responseNote}`}</Caption> : null}
          {(q.lines ?? []).map((line, i) => (
            <View key={`${q.id}-line-${i}`} style={{ flexDirection: 'row', gap: space(2) }}>
              <Caption style={{ flex: 1 }}>{line.description}</Caption>
              <Caption style={{ fontVariant: ['tabular-nums'] }}>
                {money(line.amount, q.currency)}
              </Caption>
            </View>
          ))}
          {q.notes ? <Caption tone="muted">{q.notes}</Caption> : null}
          {q.terms ? (
            <Caption>
              <Caption tone="faint">Terms: </Caption>
              {q.terms}
            </Caption>
          ) : null}
        </View>
      ))}
    </Section>
  );
}

export function PaymentBreakdown({ summary }: { summary: BookingSummaryData }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState(false);
  const { currency, delivery } = summary;
  const p = summary.payments;

  // Released automatically once the balance is in and the delivery is signed
  // off; the button is for money that was already held before that existed.
  const canRelease =
    summary.status === 'completed' &&
    Number(p.heldInEscrow) > 0 &&
    (!delivery.deliveredAt || Boolean(delivery.deliveryAcceptedAt));

  function handleRelease() {
    NativeAlert.alert(
      'Release payout',
      'Are you sure you want to release this payout to your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Release', style: 'destructive', onPress: () => void release() }
      ]
    );
  }

  async function release() {
    if (releasing) return;
    setError('');
    setReleasing(true);
    try {
      await api.put(`/bookings/${summary.bookingId}/settle`);
      for (const key of [
        'booking-summary',
        'booking-history',
        'incoming-bookings',
        'earnings',
        'escrow',
        'my-bookings',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      void qc.invalidateQueries({ queryKey: ['booking-summary', summary.bookingId] });
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
        <Caption tone="faint">The instalments are set once the customer accepts a quotation.</Caption>
      </Section>
    );
  }

  return (
    <Section title="Payment">
      {/* The instalments, separately: an advance that has cleared and a
          balance that has not are two different facts about the same job. */}
      {summary.instalments.map((row) => (
        <View key={row.milestone} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <Caption style={{ flex: 1 }} numberOfLines={1}>
            {MILESTONE_LABEL[row.milestone] ?? row.milestone.replace(/_/g, ' ')}
          </Caption>
          <Caption style={{ fontVariant: ['tabular-nums'] }}>{money(row.amount, currency)}</Caption>
          <Caption tone={row.status && !UNPAID.includes(row.status) ? 'brand' : 'faint'}>
            {row.status ? (PAYMENT_LABEL[row.status] ?? row.status.replace(/_/g, ' ')) : 'Not due yet'}
          </Caption>
        </View>
      ))}
      <DetailGrid>
        <DetailRow label="Paid">{money(p.paid, currency)}</DetailRow>
        <DetailRow label="Pending">{money(p.pending, currency)}</DetailRow>
        <DetailRow label="Held in escrow">{money(p.heldInEscrow, currency)}</DetailRow>
        <DetailRow label="Released to you">{money(p.released, currency)}</DetailRow>
        {Number(p.pendingPayout) > 0 ? (
          <DetailRow label="Owed to you">{money(p.pendingPayout, currency)}</DetailRow>
        ) : null}
        {Number(p.refunded) > 0 ? (
          <DetailRow label="Refunded">{money(p.refunded, currency)}</DetailRow>
        ) : null}
        <DetailRow label="Platform commission">{money(p.commission, currency)}</DetailRow>
        <DetailRow label="Your earnings">{money(p.vendorEarnings, currency)}</DetailRow>
      </DetailGrid>
      {summary.projected ? (
        <Caption tone="faint">
          {`On the full ${money(summary.price.grandTotal, currency)}: commission ${money(
            summary.projected.commission,
            currency,
          )}, your earnings ${money(summary.projected.vendorEarnings, currency)}.`}
        </Caption>
      ) : null}
      {delivery.deliveredAt ? (
        <Caption tone="faint">
          {`Delivered ${dateTime(delivery.deliveredAt)} · ${
            delivery.deliveryAcceptedAt
              ? `confirmed by the customer ${dateTime(delivery.deliveryAcceptedAt)}`
              : 'waiting for the customer to confirm'
          }`}
        </Caption>
      ) : null}
      {/* What the provider said they handed over — a gallery link, a note —
          which is what the customer reads before confirming. */}
      {delivery.deliveryNotes ? (
        <Caption>
          <Caption tone="faint">What was delivered: </Caption>
          {delivery.deliveryNotes}
        </Caption>
      ) : null}
      {canRelease ? (
        <Button
          label={releasing ? 'Releasing…' : 'Release payout'}
          small
          busy={releasing}
          disabled={releasing}
          onPress={handleRelease}
        />
      ) : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}
    </Section>
  );
}
