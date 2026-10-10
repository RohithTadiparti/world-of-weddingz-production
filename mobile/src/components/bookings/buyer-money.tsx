import { useRef, useState } from 'react';
import { Alert, Pressable, View, ScrollView } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, LockKey, ShieldCheck, CheckCircle, Info } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { PAYMENT_LABEL, PAYMENT_TONE } from '@/lib/bookings';
import { money, shortDate } from '@/lib/format';
import { MILESTONE_LABEL, Permission, can } from '@/shared/permissions';
import { selectPermissions, useAuth } from '@/store/auth';
import { BUYER_PAYMENT_STATUS_LABEL } from '@/app/escrow';
import { deliveryDecision } from '@/shared/booking-rules';
import { Badge } from '@/components/chrome';
import { Alert as UiAlert, Body, Button, Caption, Field, Card } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';
import { Txt } from '@/theme/fonts';

type MilestoneKey = 'advance' | 'second' | 'final';

const PAYABLE_AT: Record<MilestoneKey, string[]> = {
  advance: ['payment_pending'],
  second: ['in_progress'],
  final: ['completed_pending_final_payment'],
};

const WAITING_ON: Record<MilestoneKey, string> = {
  advance: 'Waiting on the provider to accept the job',
  second: 'Due once they start the work',
  final: 'Due once they mark it delivered',
};

const CANCELABLE = new Set([
  'requested',
  'quotation_sent',
  'quotation_accepted',
  'payment_pending',
  'pending',
  'confirmed',
  'in_progress',
]);

const DISPUTABLE = new Set([
  'confirmed',
  'in_progress',
  'completed_pending_final_payment',
  'completed',
]);

const METHOD_LABEL: Record<string, string> = {
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net banking',
  cash: 'Cash',
};

interface MilestoneRow {
  milestone: MilestoneKey;
  amount: string;
  status: string | null;
  paymentId: string | null;
}

interface MilestonesPayload {
  bookingId: string;
  total: string;
  currency: string;
  milestones: MilestoneRow[];
}

interface QuotationRow {
  id: string;
  amount: string;
  currency: string;
  status: string;
  notes: string | null;
  terms?: string | null;
  lines?: { description: string; amount: number }[] | null;
  validUntil?: string | null;
}

const QUOTE_STATUS_LABEL: Record<string, string> = {
  sent: 'Awaiting your answer',
  accepted: 'Accepted',
  rejected: 'Re-quote asked',
  expired: 'Expired',
  superseded: 'Replaced',
  withdrawn: 'Withdrawn',
};

interface EscrowRecord {
  bookingId: string;
  currency: string;
  heldInEscrow: string;
  released: string;
  refunded: string;
  payments?: { amount: string; status: string }[];
}

/** `released` on the record also counts money still waiting on its payout. */
function paidOut(record: EscrowRecord, status: string): number {
  return (record.payments ?? [])
    .filter((p) => p.status === status)
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

interface PaymentMethods {
  methods: string[];
  cash: { enabled: boolean; maxAmount: number };
}

export interface BuyerMoneyBooking {
  id: string;
  status: string;
  amount?: string | null;
  currency?: string | null;
  deliveredAt?: string | null;
  deliveryAcceptedAt?: string | null;
  deliveryNotes?: string | null;
}

function invalidateMoney(qc: ReturnType<typeof useQueryClient>, bookingId: string) {
  for (const key of [
    'my-bookings',
    'escrow',
    'booking-summary',
    'booking-history',
    'earnings',
    'incoming-bookings',
    'wedding-dashboard',
    'event-workspace',
    // The advance is what opens the booking's chat for both sides (row 18).
    'booking-chat-state',
    'booking-chat',
  ]) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
  void qc.invalidateQueries({ queryKey: ['buyer-milestones', bookingId] });
  void qc.invalidateQueries({ queryKey: ['buyer-quotations', bookingId] });
  void qc.invalidateQueries({ queryKey: ['booking-summary', bookingId] });
}

export function BuyerMoneyPanel({ booking, isDedicatedScreen }: { booking: BuyerMoneyBooking; isDedicatedScreen?: boolean }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const permissions = useAuth(selectPermissions);
  const canPay = can(permissions, Permission.BOOKING_PAY);
  const canRaiseCase = can(permissions, Permission.CASE_RAISE);

  const [method, setMethod] = useState('card');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [disputeTitle, setDisputeTitle] = useState('');
  const [disputeBody, setDisputeBody] = useState('');
  const payKeyRef = useRef<string | null>(null);
  const terminal = booking.status === 'cancelled' || booking.status === 'disputed';
  // Accept the delivery or raise an issue: one disables the other, and an open
  // issue blocks acceptance until it is resolved (row 21).
  const [accepting, setAccepting] = useState(false);
  const decision = deliveryDecision(booking, {
    canRaise: canRaiseCase,
    disputing: showDispute,
    accepting,
  });

  const methodsQuery = useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get('/payments/methods')).data as PaymentMethods,
    staleTime: 10 * 60_000,
    retry: false,
    enabled: canPay,
  });

  const milestonesQuery = useQuery({
    queryKey: ['buyer-milestones', booking.id],
    queryFn: async () =>
      (await api.get(`/bookings/${booking.id}/milestones`)).data as MilestonesPayload,
    retry: false,
  });

  const quotationsQuery = useQuery({
    queryKey: ['buyer-quotations', booking.id],
    queryFn: async () =>
      (await api.get(`/bookings/${booking.id}/quotations`)).data as QuotationRow[],
    retry: false,
  });

  // Refunded payments drop out of /milestones, so a closed booking's money is read from escrow.
  const escrowQuery = useQuery({
    queryKey: ['escrow'],
    queryFn: async () => (await api.get('/bookings/escrow')).data as { records: EscrowRecord[] },
    enabled: terminal,
    retry: false,
  });
  const escrowRecord = escrowQuery.data?.records.find((r) => r.bookingId === booking.id);

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => {
      setError('');
      setNotice('');
      return fn();
    },
    onSuccess: (result) => {
      invalidateMoney(qc, booking.id);
      setShowCancel(false);
      setCancelReason('');
      setShowDispute(false);
      setDisputeTitle('');
      setDisputeBody('');
      payKeyRef.current = null;
      const payment = (result as { data?: { payment?: { status?: string; amount?: string; method?: string } } })
        ?.data?.payment;
      if (payment?.status === 'held_in_escrow') {
        setNotice(
          `Payment confirmed. ${money(payment.amount ?? '0', booking.currency ?? 'INR')} is held in escrow.`,
        );
      } else if (payment?.status === 'released' && payment.method === 'cash') {
        setNotice('Cash payment recorded. It was not held in escrow.');
      } else if (payment?.status === 'failed') {
        setError('Payment failed. Nothing was held in escrow.');
      } else if (payment?.status === 'initiated') {
        setNotice('Payment is processing. Escrow will update when the payment is confirmed.');
      }
    },
    onError: (err) => {
      setError(apiMessage(err, 'That action could not be completed.'));
    },
  });

  const availableMethods = methodsQuery.data?.methods?.length
    ? methodsQuery.data.methods
    : ['card'];
  const activeMethod = availableMethods.includes(method) ? method : availableMethods[0]!;
  const milestones = milestonesQuery.data?.milestones ?? [];
  const currency = milestonesQuery.data?.currency ?? booking.currency ?? 'INR';
  const paid = new Set(
    milestones
      .filter((m) => m.status && m.status !== 'refunded' && m.status !== 'failed')
      .map((m) => m.milestone),
  );
  const nextDue = milestones.find((m) => !paid.has(m.milestone));
  const dueNow =
    nextDue && PAYABLE_AT[nextDue.milestone]?.includes(booking.status)
      ? nextDue.milestone
      : null;
  const liveQuote = (quotationsQuery.data ?? []).find((q) => q.status === 'sent');
  const busy = act.isPending;

  function run(fn: () => Promise<unknown>) {
    if (busy) return;
    act.mutate(fn);
  }

  function pay(milestone: MilestoneKey, amount: string) {
    if (busy || terminal) return;
    const cashCap = methodsQuery.data?.cash?.maxAmount;
    if (
      activeMethod === 'cash' &&
      cashCap != null &&
      Number.isFinite(cashCap) &&
      cashCap > 0 &&
      Number(amount) > cashCap
    ) {
      setError(
        `Cash is limited to ${currency} ${cashCap} per instalment because it is not held in escrow.`,
      );
      return;
    }
    const label = MILESTONE_LABEL[milestone] ?? milestone;
    const total = milestonesQuery.data?.total ?? booking.amount;
    Alert.alert(
      'Confirm payment',
      [
        total ? `Booking total ${money(total, currency)}.` : null,
        `Pay ${money(amount, currency)} for ${label} now via ${METHOD_LABEL[activeMethod] ?? activeMethod}?`,
        activeMethod === 'cash'
          ? 'Cash is not held in escrow.'
          : 'Online payment is held in escrow until delivery is accepted.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay Now',
          onPress: () => {
            if (!payKeyRef.current) {
              payKeyRef.current = `pay-${booking.id}-${milestone}-${Date.now()}`;
            }
            const key = payKeyRef.current;
            run(() =>
              api.put(
                `/bookings/${booking.id}/pay`,
                { milestone, method: activeMethod },
                { headers: { 'Idempotency-Key': key } },
              ),
            );
          },
        },
      ],
    );
  }

  return (
    <View style={{ gap: space(4) }}>
      {error ? <UiAlert tone="critical">{error}</UiAlert> : null}
      {notice ? <UiAlert tone="positive">{notice}</UiAlert> : null}

      {(quotationsQuery.data?.length ?? 0) > 0 ? (
        <View style={{ gap: space(2) }}>
          {(quotationsQuery.data ?? []).slice(0, 4).map((q) => (
            <Card
              key={q.id}
              style={{
                gap: space(3),
                padding: space(3),
                borderRadius: radius.md,
                backgroundColor: isDedicatedScreen ? rgb(theme.surface) : rgb(theme.surfaceSunken),
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                  <FileText size={20} color={rgb(theme.brand)} />
                  <Body style={{ fontWeight: '700' }}>Quotation</Body>
                </View>
                <Badge
                  tone={
                    q.status === 'accepted' ? 'positive' : q.status === 'sent' ? 'brand' : 'neutral'
                  }
                >
                  {QUOTE_STATUS_LABEL[q.status] ?? q.status.replace(/_/g, ' ')}
                </Badge>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: rgb(theme.border) }}>
                <Body style={{ fontSize: 24, fontWeight: '700' }}>{money(q.amount, q.currency)}</Body>
                <Button label="View Quotation" variant="ghost" small onPress={() => {}} />
              </View>
              
              {q.status === 'sent' && q.validUntil ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
                  <CheckCircle size={14} color={rgb(theme.ink[500])} />
                  <Caption tone="muted">Valid until {shortDate(q.validUntil)}</Caption>
                </View>
              ) : null}

              {liveQuote?.id === q.id && canPay && !terminal ? (
                <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(2) }}>
                  <Button
                    label="Accept Quotation"
                    style={{ flex: 1 }}
                    small
                    busy={busy}
                    disabled={busy}
                    onPress={() => run(() => api.put(`/bookings/quotations/${q.id}/accept`, {}))}
                  />
                  <Button
                    label="Reject Quotation"
                    variant="outline"
                    style={{ flex: 1 }}
                    small
                    busy={busy}
                    disabled={busy}
                    onPress={() => run(() => api.put(`/bookings/quotations/${q.id}/reject`, {}))}
                  />
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}

      <Card style={{ padding: space(3), gap: space(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <LockKey size={20} color={rgb(theme.brand)} />
            <Body style={{ fontWeight: '700' }}>Escrow & Milestones</Body>
          </View>
          {milestonesQuery.data?.total ? (
            <Badge tone={dueNow ? 'caution' : 'neutral'}>
              {dueNow ? 'Payment Pending' : 'Secured'}
            </Badge>
          ) : null}
        </View>

        {!terminal && booking.status !== 'completed' ? (
          <Caption tone="muted">
            Once you accept the quotation, payments are held securely in escrow and released as milestones are completed.
          </Caption>
        ) : null}

        {terminal ? (
          <View style={{ paddingVertical: space(2) }}>
            {escrowQuery.isPending ? (
              <Caption tone="muted">Loading payments…</Caption>
            ) : escrowQuery.isError ? (
              <UiAlert tone="critical">
                {apiMessage(escrowQuery.error, 'Payments could not be loaded.')}
              </UiAlert>
            ) : !escrowRecord ? (
              <Caption tone="muted">Nothing was paid on this booking.</Caption>
            ) : (
              <Caption>
                {[
                  Number(escrowRecord.refunded) > 0
                    ? `Refunded ${money(escrowRecord.refunded, escrowRecord.currency)}`
                    : null,
                  Number(escrowRecord.heldInEscrow) > 0
                    ? `Held ${money(escrowRecord.heldInEscrow, escrowRecord.currency)}`
                    : null,
                  paidOut(escrowRecord, 'pending_payout') > 0
                    ? `Awaiting payout ${money(paidOut(escrowRecord, 'pending_payout'), escrowRecord.currency)}`
                    : null,
                  paidOut(escrowRecord, 'released') > 0
                    ? `Released ${money(paidOut(escrowRecord, 'released'), escrowRecord.currency)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Nothing was paid on this booking.'}
              </Caption>
            )}
          </View>
        ) : milestonesQuery.isPending ? (
          <Caption tone="muted">Loading instalments…</Caption>
        ) : milestonesQuery.isError ? (
          <UiAlert tone="critical">
            {apiMessage(milestonesQuery.error, 'Instalments could not be loaded.')}
          </UiAlert>
        ) : Number(booking.amount ?? milestonesQuery.data?.total ?? 0) <= 0 ? (
          <Caption tone="muted">Instalments appear once you accept a quotation.</Caption>
        ) : (
          <View style={{ gap: space(3) }}>
            {milestonesQuery.data?.total ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingBottom: space(2), borderBottomWidth: 1, borderBottomColor: rgb(theme.border) }}>
                <Body style={{ fontWeight: '600' }}>Total Booking Amount</Body>
                <Body style={{ fontWeight: '700' }}>{money(milestonesQuery.data.total, currency)}</Body>
              </View>
            ) : null}
            
            {milestones.map((m, idx) => {
            const isDue = canPay && !terminal && dueNow === m.milestone;
            return (
              <View key={m.milestone} style={{ flexDirection: 'row', gap: space(3) }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ 
                    width: 24, height: 24, borderRadius: 12, 
                    backgroundColor: m.status ? rgb(theme.brand) : rgb(theme.surfaceSunken),
                    alignItems: 'center', justifyContent: 'center'
                  }}>
                    {m.status ? (
                      <CheckCircle size={14} color={rgb(theme.brandFg)} weight="fill" />
                    ) : (
                      <Caption style={{ fontSize: 10, fontWeight: '700', color: rgb(theme.ink[500]) }}>{idx + 1}</Caption>
                    )}
                  </View>
                  {idx !== milestones.length - 1 && (
                    <View style={{ width: 1, flex: 1, backgroundColor: rgb(theme.border), marginVertical: 4 }} />
                  )}
                </View>
                
                <View style={{ flex: 1, paddingBottom: idx !== milestones.length - 1 ? space(3) : 0, gap: space(1) }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View>
                      <Body style={{ fontWeight: '600' }}>
                        {MILESTONE_LABEL[m.milestone] ?? m.milestone}
                      </Body>
                      <Body style={{ fontWeight: '700', marginTop: 2 }}>{money(m.amount, currency)}</Body>
                    </View>
                    {m.status ? (
                      <Badge tone={PAYMENT_TONE[m.status] ?? 'neutral'}>
                        {BUYER_PAYMENT_STATUS_LABEL[m.status] ?? PAYMENT_LABEL[m.status] ?? m.status.replace(/_/g, ' ')}
                      </Badge>
                    ) : (
                      <Badge tone={isDue ? 'brand' : 'neutral'}>
                        {isDue ? 'Payment Required' : 'Pending'}
                      </Badge>
                    )}
                  </View>
                  
                  <Caption tone="muted" style={{ marginTop: 2 }}>
                    {!m.status && isDue
                      ? 'Pay to secure your booking in escrow.'
                      : !m.status && nextDue?.milestone === m.milestone
                        ? WAITING_ON[m.milestone]
                        : !m.status
                          ? `Will be available after ${idx === 1 ? 'first' : 'previous'} milestone.`
                          : m.status === 'failed'
                            ? 'Payment failed.'
                            : ''}
                  </Caption>

                  {isDue ? (
                    <View style={{ gap: space(2), marginTop: space(2) }}>
                      {availableMethods.length > 1 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
                          {availableMethods.map((mth) => {
                            const active = activeMethod === mth;
                            return (
                              <Pressable
                                key={mth}
                                disabled={busy}
                                onPress={() => setMethod(mth)}
                                style={{
                                  paddingHorizontal: space(2.5),
                                  paddingVertical: space(1),
                                  borderRadius: radius.md,
                                  borderWidth: 1,
                                  borderColor: active ? rgb(theme.brand) : rgb(theme.border),
                                  backgroundColor: active ? rgb(theme.brandSoft) : 'transparent',
                                }}
                              >
                                <Caption
                                  tone={active ? 'brand' : 'default'}
                                  style={{ fontWeight: '600' }}
                                >
                                  {METHOD_LABEL[mth] ?? mth}
                                </Caption>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                      
                      <Button
                        label={
                          busy
                            ? 'Processing…'
                            : m.status === 'failed' ? 'Try Again' : `Fund Escrow`
                        }
                        small
                        busy={busy}
                        disabled={busy}
                        onPress={() => pay(m.milestone, m.amount)}
                        style={{ alignSelf: 'flex-start', paddingHorizontal: space(4) }}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), backgroundColor: rgb(theme.brandSoft), padding: space(2), borderRadius: radius.md, marginTop: space(2) }}>
          <ShieldCheck size={20} color={rgb(theme.brand)} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600', color: rgb(theme.brandStrong) }}>Your Money is Safe</Body>
            <Caption style={{ color: rgb(theme.brandStrong), opacity: 0.8 }}>Payments are held in secure escrow and released to the vendor only when milestones are completed.</Caption>
          </View>
        </View>
      </Card>

      {decision.showAccept ? (
        <Card style={{ gap: space(1.5) }}>
          {booking.deliveryNotes ? (
            <Caption>
              <Caption tone="faint">What was delivered: </Caption>
              {booking.deliveryNotes}
            </Caption>
          ) : null}
          <Button
            label="Accept delivery"
            small
            busy={busy && accepting}
            disabled={busy || Boolean(decision.acceptDisabledReason)}
            onPress={() => {
              setAccepting(true);
              Alert.alert(
                'Accept delivery',
                'Confirm the work was delivered as agreed. Held escrow can then move to the provider.',
                [
                  { text: 'Not yet', style: 'cancel', onPress: () => setAccepting(false) },
                  {
                    text: 'Accept delivery',
                    onPress: () =>
                      run(async () => {
                        try {
                          return await api.put(`/bookings/${booking.id}/confirm-delivery`, {});
                        } finally {
                          setAccepting(false);
                        }
                      }),
                  },
                ],
              );
            }}
          />
          {decision.acceptDisabledReason ? (
            <Caption style={{ color: rgb(theme.cautionFg) }}>{decision.acceptDisabledReason}</Caption>
          ) : null}
          <Caption tone="muted">
            Confirming delivery lets held escrow move to the provider.
          </Caption>
        </Card>
      ) : null}

      {!terminal && CANCELABLE.has(booking.status) ? (
        <Card style={{ gap: space(1.5) }}>
          {!showCancel ? (
            <Button
              label="Cancel Booking"
              variant="outline"
              small
              disabled={busy}
              onPress={() => {
                setError('');
                setShowCancel(true);
              }}
            />
          ) : (
            <View style={{ gap: space(2) }}>
              <Caption tone="muted">
                {Number(booking.amount) > 0
                  ? 'Anything held in escrow is returned if the refund is confirmed. This cannot be undone.'
                  : 'The provider will be told you no longer need them.'}
              </Caption>
              <Field
                label="Reason (optional)"
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Let them know why"
                maxLength={500}
                editable={!busy}
              />
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button
                  label="Keep Booking"
                  variant="ghost"
                  small
                  disabled={busy}
                  onPress={() => setShowCancel(false)}
                />
                <Button
                  label="Confirm Cancellation"
                  small
                  busy={busy}
                  disabled={busy}
                  onPress={() =>
                    run(() =>
                      api.put(`/bookings/${booking.id}/cancel`, {
                        ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
                      }),
                    )
                  }
                />
              </View>
            </View>
          )}
        </Card>
      ) : null}

      {!terminal && decision.showRaise && DISPUTABLE.has(booking.status) ? (
        <Card style={{ gap: space(1.5) }}>
          {!showDispute ? (
            <>
              <Button
                label="Raise an Issue"
                variant="outline"
                small
                disabled={busy || Boolean(decision.raiseDisabledReason)}
                onPress={() => {
                  setError('');
                  setShowDispute(true);
                }}
              />
              {decision.raiseDisabledReason ? (
                <Caption tone="muted">{decision.raiseDisabledReason}</Caption>
              ) : null}
            </>
          ) : (
            <View style={{ gap: space(2) }}>
              <Caption tone="muted">
                {booking.status === 'completed'
                  ? 'You accepted delivery, so this money is already approved for payout. A case does not freeze it; an officer reviews the case and decides any refund.'
                  : 'Held escrow stays frozen until an officer settles the case.'}
              </Caption>
              <Field
                label="In one line"
                value={disputeTitle}
                onChangeText={setDisputeTitle}
                placeholder="What went wrong"
                maxLength={120}
                editable={!busy}
              />
              <Field
                label="Full story"
                value={disputeBody}
                onChangeText={setDisputeBody}
                placeholder="Describe what happened"
                multiline
                numberOfLines={4}
                style={{ minHeight: 88, textAlignVertical: 'top' }}
                editable={!busy}
              />
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button
                  label="Never mind"
                  variant="ghost"
                  small
                  disabled={busy}
                  onPress={() => setShowDispute(false)}
                />
                <Button
                  label="Submit Issue"
                  small
                  busy={busy}
                  disabled={
                    busy || disputeTitle.trim().length < 5 || disputeBody.trim().length < 10
                  }
                  onPress={() => {
                    if (disputeTitle.trim().length < 5 || disputeBody.trim().length < 10) {
                      Alert.alert(
                        'More detail needed',
                        'Add a short title and a fuller description before submitting.',
                      );
                      return;
                    }
                    run(() =>
                      api.post('/verification/cases', {
                        subjectType: 'booking',
                        subjectId: booking.id,
                        title: disputeTitle.trim(),
                        description: disputeBody.trim(),
                      }),
                    );
                  }}
                />
              </View>
            </View>
          )}
        </Card>
      ) : null}
    </View>
  );
}
