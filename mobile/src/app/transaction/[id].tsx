import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { dateTime, moneyExact, shortDate } from '@/lib/format';
import { clockTime } from '@/lib/labels';
import { BOOKING_STATUS_LABEL, MILESTONE_LABEL } from '@/shared/permissions';
import { Badge, DetailGrid, DetailRow, Divider, StatTile, TileGrid, type Tone } from '@/components/chrome';
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * One of the provider's own transactions, in full.
 *
 * The Accounts ledger answers "what moved, and where it sits". This answers
 * "on which booking, for what, and how far each instalment has got" — the
 * question a vendor actually has when a figure looks wrong, and one they could
 * previously only get by ringing somebody (EZ1-I253).
 *
 * The web page of the same name is the model, field for field: the chain from
 * booking to payout, the gateway references an operator needs to reconcile
 * against, and every instalment on the booking rather than only this one. It is
 * one `/bookings/transactions/:id` read, scoped on the server to the provider's
 * own bookings.
 *
 * Nothing here is computed in the app beyond laying the server's own figures
 * out. There are no defaults standing in for money.
 */
interface Payment {
  id: string;
  milestone: string;
  status: string;
  amount: string;
  commissionAmount: string;
  payoutAmount: string;
  currency: string;
  method: string;
  provider: string;
  providerRef: string | null;
  payoutRef: string | null;
  payoutNote: string | null;
  providerStatus: string | null;
  webhookVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TransactionDetail {
  payment: Payment;
  booking: {
    id: string;
    status: string;
    amount: string;
    currency: string;
    eventDate: string | null;
    createdAt: string;
    /** What the booking says about the day — from its event, its form or the wedding. */
    eventName?: string | null;
    venue?: string | null;
    city?: string | null;
    guests?: number | null;
  };
  customer: { id: string; name: string | null; email: string; phone: string | null; city: string | null } | null;
  service: { id: string | null; name: string | null; offering: string | null; quantity: number | null; total: string };
  event: {
    id: string;
    name: string;
    venue: string | null;
    city: string | null;
    eventDate: string | null;
    startTime: string | null;
  } | null;
  payments: Payment[];
  summary: { total: string; held: string; released: string; refunded: string; commission: string; payout: string };
}

export const STATUS_LABEL: Record<string, string> = {
  initiated: 'Starting',
  held_in_escrow: 'In escrow',
  disputed: 'Frozen: case open',
  released: 'Paid out',
  pending_payout: 'Owed to you',
  refunded: 'Refunded',
  partially_settled: 'Part settled',
  failed: 'Failed',
};

export const STATUS_TONE: Record<string, Tone> = {
  initiated: 'neutral',
  held_in_escrow: 'caution',
  disputed: 'critical',
  released: 'positive',
  pending_payout: 'caution',
  refunded: 'neutral',
  partially_settled: 'brand',
  failed: 'critical',
};

export default function Transaction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data, isPending, error } = useQuery<TransactionDetail>({
    queryKey: ['accounts-transaction', id],
    queryFn: async () => (await api.get(`/bookings/transactions/${id}`)).data,
    enabled: Boolean(id),
    retry: false,
  });

  if (isPending) {
    return (
      <Screen>
        <Loading rows={5} />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <EmptyState title="Transaction not found">
          {apiMessage(error, 'That transaction could not be opened.')}
        </EmptyState>
      </Screen>
    );
  }

  const { payment, booking, customer, service, event, payments, summary } = data;
  // Money in the payment's own currency. Every figure was printed in rupees
  // whatever the record said.
  const ccy = payment.currency || booking.currency || 'INR';
  const cash = (value: string | number | null | undefined, currency = ccy) =>
    moneyExact(value, currency);
  // The event the booking hangs off, or what the booking says about the day
  // when it is not linked to one.
  const eventName = event?.name ?? booking.eventName ?? null;
  const venue = event?.venue ?? booking.venue ?? null;
  const city = event?.city ?? booking.city ?? null;
  const guests = booking.guests ?? null;
  const eventDate = event?.eventDate ?? booking.eventDate ?? null;
  const starts = clockTime(event?.startTime);
  const instalment = (milestone: string) =>
    payments.find((row) => row.milestone === milestone)?.amount ?? null;

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <PageSubtitle>
          {MILESTONE_LABEL[payment.milestone] ?? payment.milestone} · {dateTime(payment.createdAt)}
        </PageSubtitle>
        <View style={{ flexDirection: 'row' }}>
          <Badge tone={STATUS_TONE[payment.status] ?? 'neutral'}>
            {STATUS_LABEL[payment.status] ?? payment.status.replace(/_/g, ' ')}
          </Badge>
        </View>
      </View>

      {/*
        The chain, said once and in order: this is the thing a vendor is trying
        to follow when they open a payment, and a page of labelled figures does
        not say which figure came out of which.
      */}
      {/* A refunded or failed payment owes nobody a payout, and a chain ending
          in "Your payout" beside "nothing is owed on it" contradicts itself. */}
      {payment.status === 'refunded' || payment.status === 'failed' ? null : (
        <Chain payment={payment} />
      )}

      <Card>
        <SectionTitle>Transaction</SectionTitle>
        <DetailGrid>
          <DetailRow label="Transaction ID">{payment.id}</DetailRow>
          <DetailRow label="Instalment">
            {MILESTONE_LABEL[payment.milestone] ?? payment.milestone}
          </DetailRow>
          <DetailRow label="Charged">{cash(payment.amount)}</DetailRow>
          <DetailRow label="Platform commission">
            −{cash(payment.commissionAmount)}
          </DetailRow>
          <DetailRow label="Your share">{cash(payment.payoutAmount)}</DetailRow>
          <DetailRow label="Method">{payment.method.replace(/_/g, ' ')}</DetailRow>
          <DetailRow label="Paid at">{dateTime(payment.createdAt)}</DetailRow>
          <DetailRow label="Last updated">{dateTime(payment.updatedAt)}</DetailRow>
        </DetailGrid>
      </Card>

      <Card>
        <SectionTitle>Booking</SectionTitle>
        <DetailGrid>
          <DetailRow label="Booking ID">{booking.id}</DetailRow>
          <DetailRow label="Booking status">
            {BOOKING_STATUS_LABEL[booking.status] ?? booking.status.replace(/_/g, ' ')}
          </DetailRow>
          <DetailRow label="Booking total">{cash(booking.amount)}</DetailRow>
          <DetailRow label="Booked on">{shortDate(booking.createdAt)}</DetailRow>
          {booking.eventDate ? (
            <DetailRow label="Event date">{shortDate(booking.eventDate)}</DetailRow>
          ) : null}
        </DetailGrid>
        <Button
          label="Open this booking"
          variant="outline"
          small
          onPress={() => router.push({ pathname: '/bookings', params: { booking: booking.id } })}
        />
      </Card>

      <Card>
        <SectionTitle>Customer</SectionTitle>
        {customer ? (
          <DetailGrid>
            <DetailRow label="Customer">{customer.name ?? customer.email}</DetailRow>
            <DetailRow label="Email">{customer.email}</DetailRow>
            <DetailRow label="Mobile">{customer.phone ?? '—'}</DetailRow>
            {customer.city ? <DetailRow label="City">{customer.city}</DetailRow> : null}
          </DetailGrid>
        ) : (
          <Caption tone="faint">Customer record missing.</Caption>
        )}
      </Card>

      <Card>
        <SectionTitle>Service</SectionTitle>
        <DetailGrid>
          <DetailRow label="Service">{service.name ?? 'No service chosen'}</DetailRow>
          <DetailRow label="Package">{service.offering ?? 'No package'}</DetailRow>
          {service.quantity ? (
            <DetailRow label="Quantity">{String(service.quantity)}</DetailRow>
          ) : null}
          <DetailRow label="Booking total">{cash(service.total)}</DetailRow>
          {eventName ? <DetailRow label="Event">{eventName}</DetailRow> : null}
          {venue ? <DetailRow label="Venue">{venue}</DetailRow> : null}
          {city ? <DetailRow label="City">{city}</DetailRow> : null}
          {guests ? <DetailRow label="Guests">{String(guests)}</DetailRow> : null}
          {eventDate ? <DetailRow label="Event date">{shortDate(eventDate)}</DetailRow> : null}
          {starts ? <DetailRow label="Starts">{starts}</DetailRow> : null}
        </DetailGrid>
      </Card>

      {/* Every instalment on this booking, separately: the advance that has
          cleared and the balance that has not are different facts. */}
      <Card>
        <SectionTitle>Instalments</SectionTitle>
        <TileGrid>
          <StatTile label="Booking total" value={cash(summary.total)} />
          <StatTile label="Advance" value={cash(instalment('advance'))} />
          <StatTile label="Second" value={cash(instalment('second'))} />
          <StatTile label="Balance" value={cash(instalment('final'))} />
          <StatTile label="Held in escrow" value={cash(summary.held)} tone="caution" />
          <StatTile label="Released" value={cash(summary.released)} tone="positive" />
          <StatTile label="Your payout" value={cash(summary.payout)} tone="positive" />
          <StatTile label="Refunded" value={cash(summary.refunded)} />
          <StatTile label="Commission" value={cash(summary.commission)} />
        </TileGrid>
      </Card>

      <Card>
        <SectionTitle>Payment timeline</SectionTitle>
        {payments.length === 0 ? (
          <Caption tone="faint">No payments recorded.</Caption>
        ) : (
          payments.map((row, index) => (
            <View key={row.id} style={{ gap: space(1) }}>
              {index > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                <Body style={{ flex: 1 }}>
                  {MILESTONE_LABEL[row.milestone] ?? row.milestone}
                  {row.id === payment.id ? ' · this one' : ''}
                </Body>
                <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                  {STATUS_LABEL[row.status] ?? row.status.replace(/_/g, ' ')}
                </Badge>
              </View>
              <Caption tone="faint">
                {[
                  dateTime(row.createdAt),
                  cash(row.amount, row.currency),
                  `your share ${cash(row.payoutAmount, row.currency)}`,
                ].join(' · ')}
              </Caption>
            </View>
          ))
        )}
      </Card>

      {/*
        The references an operator reconciles against. Last, because a vendor
        reads them once a year and a support desk reads them every time.
      */}
      <Card>
        <SectionTitle>Gateway and payout</SectionTitle>
        <DetailGrid>
          <DetailRow label="Gateway">{payment.provider || '—'}</DetailRow>
          <DetailRow label="Gateway reference">{payment.providerRef ?? '—'}</DetailRow>
          <DetailRow label="Gateway status">{payment.providerStatus ?? '—'}</DetailRow>
          <DetailRow label="Payout reference">{payment.payoutRef ?? '—'}</DetailRow>
          <DetailRow label="Confirmed by the gateway">
            {payment.webhookVerifiedAt ? dateTime(payment.webhookVerifiedAt) : '—'}
          </DetailRow>
        </DetailGrid>
        {payment.payoutNote ? (
          <Caption>
            <Caption tone="faint">Payout note: </Caption>
            {payment.payoutNote}
          </Caption>
        ) : null}
        {payment.status === 'disputed' ? (
          <Caption tone="critical">
            This money is frozen by an open case. It moves on a recorded settlement decision and not
            before.
          </Caption>
        ) : null}
        {payment.status === 'refunded' ? (
          <Caption tone="muted">Returned to the customer. Nothing is owed to you on it.</Caption>
        ) : null}
      </Card>
    </Screen>
  );
}

/** Booking → Payment → Instalment → Commission → Your payout, with the figures. */
function Chain({ payment }: { payment: Payment }) {
  const theme = useTheme();
  const cash = (value: string) => moneyExact(value, payment.currency);
  const steps = [
    { label: 'Charged', value: cash(payment.amount) },
    { label: MILESTONE_LABEL[payment.milestone] ?? payment.milestone, value: null },
    { label: 'Commission', value: `−${cash(payment.commissionAmount)}` },
    { label: 'Your payout', value: cash(payment.payoutAmount) },
  ];

  return (
    <Card style={{ gap: space(1.5) }}>
      {steps.map((step, index) => (
        <View
          key={step.label}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}
        >
          <CaretRight
            size={12}
            color={rgb(index === steps.length - 1 ? theme.brandStrong : theme.ink[400])}
          />
          <Caption style={{ flex: 1 }}>{step.label}</Caption>
          {step.value ? (
            <Body
              style={{
                fontVariant: ['tabular-nums'],
                fontWeight: index === steps.length - 1 ? '600' : '400',
              }}
            >
              {step.value}
            </Body>
          ) : null}
        </View>
      ))}
    </Card>
  );
}
