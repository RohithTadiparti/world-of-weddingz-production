import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { api, apiMessage } from '@/lib/api';
import { MILESTONE_LABEL } from '@/shared/permissions';
import { humanise, shortDate } from '@/lib/format';
import { Badge } from '@/components/chrome';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

interface EscrowPayment {
  paymentId: string;
  milestone: string;
  status: string;
  amount: string;
  method: string;
  reference: string | null;
  payoutRef: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EscrowRecord {
  bookingId: string;
  providerType: 'vendor' | 'planner';
  providerName: string;
  serviceName: string | null;
  eventDate: string | null;
  bookingAmount: string;
  currency: string;
  status: string;
  heldInEscrow: string;
  released: string;
  refunded: string;
  payments: EscrowPayment[];
}

interface Escrow {
  currency: string;
  heldInEscrow: string;
  released: string;
  refunded: string;
  records: EscrowRecord[];
}

export const BUYER_PAYMENT_STATUS_LABEL: Record<string, string> = {
  initiated: 'Payment required',
  held_in_escrow: 'Funds secured',
  disputed: 'Dispute under review',
  pending_payout: 'Awaiting payout/release',
  released: 'Funds released',
  refunded: 'Funds refunded',
  partially_settled: 'Partially released',
  failed: 'Payment failed',
};

function paymentStatusLabel(status: string) {
  return BUYER_PAYMENT_STATUS_LABEL[status] ?? humanise(status);
}

function statusTone(status: string): 'neutral' | 'brand' | 'positive' | 'caution' | 'critical' {
  switch (status) {
    case 'held_in_escrow':
      return 'caution';
    case 'disputed':
    case 'failed':
      return 'critical';
    case 'pending_payout':
    case 'released':
      return 'positive';
    case 'partially_settled':
      return 'brand';
    default:
      return 'neutral';
  }
}

function paymentWhenLabel(p: EscrowPayment) {
  if (p.status === 'failed') {
    return `Failed ${new Date(p.updatedAt || p.createdAt).toLocaleString()}`;
  }
  if (p.status === 'initiated') {
    return `Started ${new Date(p.createdAt).toLocaleString()}`;
  }
  const recorded = `Recorded ${new Date(p.createdAt).toLocaleString()}`;
  const updated =
    p.updatedAt && p.updatedAt !== p.createdAt
      ? ` · updated ${new Date(p.updatedAt).toLocaleString()}`
      : '';
  const cash = p.method === 'cash' ? ' · paid in cash (not held in escrow)' : '';
  return `${recorded}${updated}${cash}`;
}

export default function EscrowScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isPending, isError, error, refetch, isRefetching } = useQuery<Escrow>({
    queryKey: ['escrow'],
    queryFn: async () => (await api.get('/bookings/escrow')).data as Escrow,
    retry: false,
  });

  const money = (value: string, currency = data?.currency ?? 'INR') => {
    const formatted = Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    return currency === 'INR' ? `₹${formatted}` : `${currency} ${formatted}`;
  };

  return (
    <Screen onRefresh={() => void refetch()} refreshing={isRefetching}>
      <View>
        <PageTitle>Escrow</PageTitle>
        <PageSubtitle>
          Money you have paid into your bookings, held safely until the work is done. Pay
          instalments from Bookings.
        </PageSubtitle>
      </View>

      {isPending ? (
        <Loading rows={3} />
      ) : isError ? (
        <View style={{ gap: space(2) }}>
          <Alert tone="critical">{apiMessage(error, 'Your escrow could not be loaded.')}</Alert>
          <Button label="Try again" small onPress={() => void refetch()} />
        </View>
      ) : data ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            <Card style={{ flex: 1, minWidth: 140 }}>
              <Caption tone="muted" style={{ textTransform: 'uppercase' }}>
                Held in escrow
              </Caption>
              <Txt style={{ fontSize: 24, fontWeight: '600', color: rgb(theme.cautionFg) }}>
                {money(data.heldInEscrow)}
              </Txt>
              <Caption tone="muted">Held safe until work is signed off</Caption>
            </Card>
            <Card style={{ flex: 1, minWidth: 140 }}>
              <Caption tone="muted" style={{ textTransform: 'uppercase' }}>
                Released to provider
              </Caption>
              <Txt style={{ fontSize: 24, fontWeight: '600', color: rgb(theme.positiveFg) }}>
                {money(data.released)}
              </Txt>
              <Caption tone="muted">Left escrow once work was done</Caption>
            </Card>
            <Card style={{ flex: 1, minWidth: 140 }}>
              <Caption tone="muted" style={{ textTransform: 'uppercase' }}>
                Refunded to you
              </Caption>
              <Txt style={{ fontSize: 24, fontWeight: '600' }}>{money(data.refunded)}</Txt>
              <Caption tone="muted">Returned on cancellation</Caption>
            </Card>
          </View>

          {data.records.length === 0 ? (
            <View style={{ gap: space(2) }}>
              <EmptyState title="No escrow transactions">
                Once you pay an instalment on a booking, the money is held here in escrow until the
                provider completes the work.
              </EmptyState>
              <Button
                label="Go to Bookings"
                small
                onPress={() => router.push('/plan/bookings')}
              />
            </View>
          ) : (
            <View style={{ gap: space(3) }}>
              {data.records.map((r) => {
                const expanded = expandedId === r.bookingId;
                return (
                  <Card key={r.bookingId} style={{ gap: space(3) }}>
                    <Pressable onPress={() => setExpandedId(expanded ? null : r.bookingId)}>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: space(2),
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Body style={{ fontWeight: '700' }}>{r.providerName}</Body>
                          <Caption tone="muted">
                            {[
                              r.serviceName ??
                                (r.providerType === 'planner'
                                  ? 'Wedding planning'
                                  : 'Vendor service'),
                              r.providerType === 'planner' ? 'Wedding planner' : 'Vendor',
                              Number(r.bookingAmount) > 0
                                ? money(r.bookingAmount, r.currency)
                                : null,
                              r.eventDate ? shortDate(r.eventDate) : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Caption>
                        </View>
                        <Badge tone={statusTone(r.status)}>
                          {paymentStatusLabel(r.status)}
                        </Badge>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          gap: space(3),
                          marginTop: space(2),
                        }}
                      >
                        {Number(r.heldInEscrow) > 0 ? (
                          <Caption>
                            In escrow{' '}
                            <Txt style={{ fontWeight: '600', color: rgb(theme.cautionFg) }}>
                              {money(r.heldInEscrow, r.currency)}
                            </Txt>
                          </Caption>
                        ) : null}
                        {Number(r.released) > 0 ? (
                          <Caption>
                            Released{' '}
                            <Txt style={{ fontWeight: '600', color: rgb(theme.positiveFg) }}>
                              {money(r.released, r.currency)}
                            </Txt>
                          </Caption>
                        ) : null}
                        {Number(r.refunded) > 0 ? (
                          <Caption>
                            Refunded{' '}
                            <Txt style={{ fontWeight: '600' }}>
                              {money(r.refunded, r.currency)}
                            </Txt>
                          </Caption>
                        ) : null}
                      </View>
                    </Pressable>

                    {expanded ? (
                      <View
                        style={{
                          paddingTop: space(3),
                          borderTopWidth: 1,
                          borderTopColor: rgb(theme.border),
                          gap: space(3),
                        }}
                      >
                        <SectionTitle style={{ fontSize: 14 }}>Escrow timeline</SectionTitle>
                        <View
                          style={{
                            paddingLeft: space(3),
                            borderLeftWidth: 2,
                            borderLeftColor: rgb(theme.border),
                            gap: space(4),
                          }}
                        >
                          {r.payments.map((p) => (
                            <View key={p.paymentId} style={{ gap: space(0.5) }}>
                              <View
                                style={{
                                  flexDirection: 'row',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <Body style={{ fontWeight: '600' }}>
                                  {MILESTONE_LABEL[p.milestone] ?? p.milestone}
                                  <Txt
                                    style={{ fontWeight: '400', color: rgb(theme.ink[500]) }}
                                  >
                                    {'  '}
                                    {money(p.amount, r.currency)}
                                  </Txt>
                                </Body>
                                <Badge tone={statusTone(p.status)}>
                                  {paymentStatusLabel(p.status)}
                                </Badge>
                              </View>
                              <Caption tone="muted">{paymentWhenLabel(p)}</Caption>
                              <Caption tone="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                Booking {r.bookingId}
                              </Caption>
                              <Caption tone="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                Payment {p.paymentId}
                              </Caption>
                              {p.reference || p.payoutRef ? (
                                <Caption
                                  tone="muted"
                                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                                >
                                  {[
                                    p.reference ? `Ref ${p.reference}` : null,
                                    p.payoutRef ? `Payout ${p.payoutRef}` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </Caption>
                              ) : null}
                            </View>
                          ))}
                        </View>
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/plan/bookings',
                              params: { highlight: r.bookingId },
                            })
                          }
                        >
                          <Caption tone="brand" style={{ fontWeight: '600' }}>
                            View booking
                          </Caption>
                        </Pressable>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}
