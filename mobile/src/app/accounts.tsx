import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';

const maskAccountId = (value: string | null | undefined) => {
  if (!value) return 'Not configured';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
};

import { api, apiMessage } from '@/lib/api';
import { rupeesExact, shortDate } from '@/lib/format';
import { isPlannerAccount } from '@/lib/planner-listing';
import { MILESTONE_LABEL, Permission, can } from '@/shared/permissions';
import { Badge, Divider, StatTile, TileGrid, type Tone } from '@/components/chrome';
import { PayoutAccount, type PayoutAccountView } from '@/components/accounts/payout-account';
import { ListScreen } from '@/components/layout';
import { BusinessSwitcher } from '@/components/business/switcher';
import { Body, Button, Caption, Card, PageSubtitle, SectionTitle } from '@/components/ui';
import { selectPermissions, useAuth } from '@/store/auth';
import { useBusinesses } from '@/store/business';
import { rgb, space, useTheme } from '@/theme';

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
  eventDate: string | null;
  /** Who and what the payment was for, when the server names them. */
  clientName?: string | null;
  serviceName?: string | null;
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

const STATUS_LABEL: Record<string, string> = {
  initiated: 'Starting',
  held_in_escrow: 'In escrow',
  disputed: 'Frozen: case open',
  released: 'Paid out',
  pending_payout: 'Owed to you',
  refunded: 'Refunded',
  partially_settled: 'Part settled',
};

const STATUS_TONE: Record<string, Tone> = {
  initiated: 'neutral',
  held_in_escrow: 'caution',
  disputed: 'critical',
  released: 'positive',
  refunded: 'neutral',
  partially_settled: 'brand',
};

/**
 * The provider's money.
 *
 * Held and paid out are shown as separate figures because they answer different
 * questions: one is what the marketplace owes them, the other is what has
 * already reached their bank. Adding them together would flatter the balance
 * and mislead somebody deciding whether they can pay their own suppliers.
 *
 * The web page renders the ledger as a seven-column table with a horizontal
 * scroll. That does not survive a phone at any font size worth reading, so each
 * payment is a card instead — the same seven facts, stacked, with the figure
 * that matters set largest.
 *
 * Every figure here is a way in rather than an ornament (EZ1-I253). A summary
 * card filters the ledger to the payments it counts, so "Held in escrow" can be
 * read as a list of what is held and not only as a total; a payment opens in
 * full, down to the gateway reference and the instalment it belongs to.
 */
/** What the ledger heading reads as while a summary card is holding it open. */
const CARD_TITLE: Record<string, string> = {
  released: 'Paid out to you',
  held_in_escrow: 'Held in escrow',
  pending_payout: 'Owed to you',
  commission: 'Payments commission was taken from',
  refunded: 'Refunded',
};

/** Which payments each summary card is the total of. */
const CARD_STATUSES: Record<string, string[]> = {
  // Mirrors earnings() on the server, which is where each total is summed. A
  // payment a case settled in part counts as paid out.
  released: ['released', 'partially_settled'],
  held_in_escrow: ['held_in_escrow', 'disputed'],
  pending_payout: ['pending_payout'],
  // Commission is taken from a payment once it is owed or paid out, so the rows
  // behind the card are those, not only the released ones.
  commission: ['released', 'pending_payout', 'partially_settled'],
  refunded: ['refunded'],
};

export default function Accounts() {
  const router = useRouter();
  const permissions = useAuth(selectPermissions);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  /*
   * A planner is a provider too, with one listing addressed as `me`. Without
   * this a planner was told money was owed, waiting on a payout account, with
   * no control anywhere that could supply one — the same gap the web page
   * closed (council round 2).
   */
  const isPlanner = isPlannerAccount(permissions);
  const { activeId } = useBusinesses();
  // Null is every payment, which is what somebody arriving at the page wants.
  const [card, setCard] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data, isPending, isFetching, refetch } = useQuery<Earnings>({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data,
  });

  // The provider's payout account lives here, not in My Business.
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

  const ledger = useMemo(() => {
    const wanted = card ? CARD_STATUSES[card] : null;
    return (data?.ledger ?? []).filter((row) => !wanted || wanted.includes(row.status));
  }, [data?.ledger, card]);
  const eligibleRows = useMemo(
    () => (data?.ledger ?? []).filter((row) => row.status === 'pending_payout'),
    [data?.ledger],
  );
  const escrowRows = useMemo(
    () => (data?.ledger ?? []).filter((row) => ['held_in_escrow', 'disputed'].includes(row.status)),
    [data?.ledger],
  );

  const toggle = (key: string) => () => setCard((current) => (current === key ? null : key));

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1) }}>
            <PageSubtitle>
              Every rupee that has moved through your bookings, and where it currently sits.
            </PageSubtitle>
          </View>

          <BusinessSwitcher />

          {((isVendor && activeId) || isPlanner) && payoutEndpoint ? (
            <PayoutAccount endpoint={payoutEndpoint} view={payout ?? null} />
          ) : null}

          {data && (
            <TileGrid>
              <StatTile
                label="Total earned"
                value={rupeesExact(data.gross)}
                hint="Gross bookings revenue"
                tone="brand"
                active={card === 'released'}
                onPress={toggle('released')}
              />
              <StatTile
                label="Escrow"
                value={rupeesExact(data.heldInEscrow)}
                hint="Currently on hold"
                tone="caution"
                active={card === 'held_in_escrow'}
                onPress={toggle('held_in_escrow')}
              />
              <StatTile
                label="Available for payout"
                value={rupeesExact(data.pendingPayout)}
                hint="Eligible for transfer"
                tone="brand"
                active={card === 'pending_payout'}
                onPress={toggle('pending_payout')}
              />
              <StatTile
                label="Paid"
                value={rupeesExact(data.released)}
                hint="Already released"
                tone="positive"
                active={card === 'released'}
                onPress={toggle('released')}
              />
              <StatTile
                label="Commission"
                value={rupeesExact(data.commission)}
                hint="Deducted from payouts"
                active={card === 'commission'}
                onPress={toggle('commission')}
              />
              <StatTile
                label="Refunded"
                value={rupeesExact(data.refunded)}
                hint="Returned to customer"
                active={card === 'refunded'}
                onPress={toggle('refunded')}
              />
            </TileGrid>
          )}

          {data ? (
            <View style={{ gap: space(2) }}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
                  <SectionTitle>Eligible payouts</SectionTitle>
                  <Badge tone="brand">Available {rupeesExact(data.pendingPayout)}</Badge>
                </View>
                {eligibleRows.length === 0 ? (
                  <Caption tone="faint">No milestones are currently eligible for release.</Caption>
                ) : (
                  <View style={{ gap: space(2) }}>
                    {eligibleRows.map((row) => (
                      <EligiblePayoutCard
                        key={row.paymentId}
                        row={row}
                        payoutActive={payout?.status === 'active'}
                        onReleased={() => void queryClient.invalidateQueries({ queryKey: ['earnings'] })}
                      />
                    ))}
                  </View>
                )}
              </Card>

              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
                  <SectionTitle>Payout account</SectionTitle>
                  <Badge tone={payout?.status === 'active' ? 'positive' : 'caution'}>
                    {payout?.status === 'active'
                      ? 'Active'
                      : payout?.status === 'pending_verification'
                        ? 'Pending verification'
                        : 'Not configured'}
                  </Badge>
                </View>
                <Body tone="muted">Linked account</Body>
                <Body style={{ fontFamily: 'monospace' }}>{maskAccountId(payout?.payoutAccountId ?? null)}</Body>
              </Card>
            </View>
          ) : null}

          {escrowRows.length > 0 ? (
            <Card>
              <SectionTitle>Escrow</SectionTitle>
              <View style={{ gap: space(2) }}>
                {escrowRows.map((row) => (
                  <View key={row.paymentId} style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', paddingTop: space(2) }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                      <Body>{MILESTONE_LABEL[row.milestone] ?? row.milestone}</Body>
                      <Badge tone={row.status === 'disputed' ? 'critical' : 'caution'}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </View>
                    <Caption tone="faint">
                      {row.clientName ?? 'Customer'} · {row.bookingId.slice(0, 8)}
                    </Caption>
                    <View style={{ marginTop: space(1), gap: space(0.5) }}>
                      <Line label="Amount" value={rupeesExact(row.payoutAmount)} strong />
                      <Line label="Expected release" value={row.confirmedAt ? shortDate(row.confirmedAt) : 'Awaiting confirmation'} />
                    </View>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          <View style={{ gap: space(1) }}>
            <Body style={{ fontWeight: '600' }}>
              {card ? `${CARD_TITLE[card] ?? 'Ledger'} (${ledger.length})` : 'Ledger'}
            </Body>
            <Caption tone="faint">
              {card
                ? 'The payments behind that figure. Press the card again for all of them.'
                : 'Every instalment, and what your share of it was. Press one for the whole payment.'}
            </Caption>
          </View>
        </>
      }
      data={ledger}
      keyExtractor={(row) => row.paymentId}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle={card ? 'Nothing in that group' : 'No payments yet'}
      emptyBody={
        card ? undefined : 'Money appears here once a booking has been paid for.'
      }
      renderItem={(row) => (
        <LedgerCard
          row={row}
          onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: row.paymentId } })}
        />
      )}
    />
  );
}

function LedgerCard({ row, onPress }: { row: LedgerRow; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Card>
      {/*
        The whole head of the card opens the payment. The buttons below it —
        settling a stuck payout — stay their own targets, which is why this is
        not a pressable wrapped round the entire card.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${MILESTONE_LABEL[row.milestone] ?? row.milestone}, open this payment`}
        onPress={onPress}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
          pressed && { opacity: 0.6 },
        ]}
      >
        <View style={{ flex: 1, gap: space(0.5) }}>
          <Body>{MILESTONE_LABEL[row.milestone] ?? row.milestone}</Body>
          {/* Who and what, when the server names them. A truncated booking id
              told a provider nothing they could act on. */}
          <Caption tone="faint" numberOfLines={2}>
            {[row.clientName, row.serviceName, shortDate(row.createdAt)].filter(Boolean).join(' · ')}
          </Caption>
        </View>
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
          {STATUS_LABEL[row.status] ?? row.status}
        </Badge>
        <CaretRight size={14} color={rgb(theme.ink[400])} />
      </Pressable>

      <Divider />

      <View style={{ gap: space(1) }}>
        <Line label="Charged" value={rupeesExact(row.amount)} />
        <Line label="Commission" value={`−${rupeesExact(row.commissionAmount)}`} muted />
        <Line label="Your share" value={rupeesExact(row.payoutAmount)} strong />
      </View>

      {row.confirmedAt ? (
        <Caption tone="faint" style={{ color: rgb(theme.ink[400]) }}>
          Confirmed {shortDate(row.confirmedAt)}
        </Caption>
      ) : null}
    </Card>
  );
}

function EligiblePayoutCard({
  row,
  payoutActive,
  onReleased,
}: {
  row: LedgerRow;
  payoutActive: boolean;
  onReleased: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: result } = await api.put<{ released: number; notReleased: string[] }>(
        `/bookings/${row.bookingId}/release-payout?milestone=${encodeURIComponent(row.milestone)}`,
      );
      if (result.released === 0) {
        setError(result.notReleased[0] ?? 'Nothing was released. It may already be on its way.');
      }
      onReleased();
    } catch (err) {
      setError(apiMessage(err, 'That payment could not be released.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space(1) }}>
      <Body>{MILESTONE_LABEL[row.milestone] ?? row.milestone}</Body>
      <Caption tone="faint">{row.clientName ?? 'Customer'} · {row.bookingId.slice(0, 8)}</Caption>
      <Line label="Service" value={row.serviceName ?? 'Booking'} />
      <Line label="Event date" value={row.eventDate ? shortDate(row.eventDate) : '—'} />
      <Line label="Total amount" value={rupeesExact(row.amount)} />
      <Line label="Released" value={rupeesExact(row.releasedAmount)} />
      <Line label="Available" value={rupeesExact(row.availableAmount)} strong />
      <Button
        label={busy ? 'Releasing…' : 'Release Payment'}
        disabled={busy || !payoutActive}
        busy={busy}
        onPress={() => void release()}
      />
      {!payoutActive ? (
        <Caption tone="faint">Released once your payout account is active.</Caption>
      ) : null}
      {error ? <Caption tone="critical">{error}</Caption> : null}
    </View>
  );
}

function Line({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3) }}>
      <Caption tone="faint">{label}</Caption>
      {strong ? (
        <Body style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Body>
      ) : (
        <Caption
          tone={muted ? 'faint' : 'default'}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {value}
        </Caption>
      )}
    </View>
  );
}
