import { useEffect, useMemo, useState } from 'react';
import { Pressable, View, Image } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { CaretRight, MapPin, CalendarBlank, Clock, User } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { humanise, money, shortDate } from '@/lib/format';
import { categoryLabel } from '@/lib/wedding-plan';
import { Badge } from '@/components/chrome';
import { ProfileSilhouette } from '@/components/profile-silhouette';
import {
  Alert,
  Body,
  Caption,
  Card,
  EmptyState,
  Loading,
  Screen,
  PageSubtitle,
} from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type Tab = 'all' | 'upcoming' | 'completed' | 'cancelled';

export interface BuyerBooking {
  id: string;
  providerType?: 'vendor' | 'planner';
  providerId?: string;
  providerName?: string | null;
  providerImage?: string | null;
  serviceName?: string | null;
  offeringName?: string | null;
  status: string;
  eventDate?: string | null;
  startTime?: string | null;
  eventName?: string | null;
  city?: string | null;
  venue?: string | null;
  amount?: string | null;
  currency?: string | null;
  paymentStatus?: string | null;
  cancellationReason?: string | null;
  deliveredAt?: string | null;
  deliveryAcceptedAt?: string | null;
  deliveryNotes?: string | null;
  collectedMilestones?: string[];
  guests?: number | null;
  specialRequests?: string | null;
  /** Planner requests only: the services the couple ticked, as catalogue keys. */
  requestedServices?: string[];
  ratingAvg?: number;
  ratingCount?: number;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const COMPLETED = new Set(['completed', 'completed_pending_final_payment']);
const CANCELLED = new Set(['cancelled', 'disputed']);
const UPCOMING = new Set([
  'requested',
  'quotation_sent',
  'quotation_accepted',
  'payment_pending',
  'pending',
  'confirmed',
  'in_progress',
]);

export const BUYER_STATUS_LABEL: Record<string, string> = {
  requested: 'Request Sent',
  quotation_sent: 'Quotation Received',
  quotation_accepted: 'Vendor Reviewing',
  payment_pending: 'Payment Required',
  confirmed: 'Funds Secured',
  in_progress: 'In Progress',
  completed_pending_final_payment: 'Pending Final Payment',
  completed: 'Completed',
  disputed: 'Dispute Under Review',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function statusTone(status: string): 'positive' | 'caution' | 'critical' | 'neutral' | 'brand' {
  if (status === 'confirmed' || status === 'completed') return 'positive';
  if (status === 'requested') return 'caution';
  if (status === 'quotation_sent' || status === 'payment_pending' || status === 'in_progress' || status === 'completed_pending_final_payment') return 'brand';
  if (CANCELLED.has(status) || status === 'refunded') return 'critical';
  if (UPCOMING.has(status)) return 'caution';
  return 'neutral';
}

export default function PlanBookings() {
  const theme = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');

  const query = useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () =>
      (await api.get('/bookings', { params: { limit: 100 } })).data as
        | { data?: BuyerBooking[] }
        | BuyerBooking[],
    retry: false,
  });

  const qc = useQueryClient();
  const refresh = () => {
    for (const key of ['my-bookings', 'buyer-quotations', 'buyer-milestones', 'escrow']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const allRows: BuyerBooking[] = Array.isArray(query.data)
    ? query.data
    : (query.data?.data ?? []);

  const counts = {
    all: allRows.length,
    upcoming: allRows.filter(r => UPCOMING.has(r.status)).length,
    completed: allRows.filter(r => COMPLETED.has(r.status)).length,
    cancelled: allRows.filter(r => CANCELLED.has(r.status)).length,
  };

  const rows = useMemo(() => {
    return allRows.filter((row) => {
      if (tab === 'all') return true;
      if (tab === 'completed') return COMPLETED.has(row.status);
      if (tab === 'cancelled') return CANCELLED.has(row.status);
      return UPCOMING.has(row.status);
    });
  }, [allRows, tab]);

  return (
    <Screen onRefresh={refresh} refreshing={query.isRefetching}>
      <Stack.Screen options={{ title: 'Bookings' }} />
      <PageSubtitle style={{ marginBottom: space(4) }}>
        Manage your vendor and planner bookings, payments and delivery in one place.
      </PageSubtitle>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginBottom: space(4) }}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={{
                paddingHorizontal: space(3),
                paddingVertical: space(2),
                borderRadius: 20,
                borderWidth: 1,
                borderColor: active ? rgb(theme.brand) : 'transparent',
                backgroundColor: active ? rgb(theme.brandSoft) : rgb(theme.surfaceSunken),
              }}
            >
              <Caption
                style={{
                  color: active ? rgb(theme.brandFg) : rgb(theme.ink[700]),
                  fontWeight: '600',
                }}
              >
                {item.label} {counts[item.key] > 0 ? `(${counts[item.key]})` : ''}
              </Caption>
            </Pressable>
          );
        })}
      </View>

      {query.isPending ? (
        <Loading rows={3} />
      ) : query.error ? (
        <Alert tone="critical">{apiMessage(query.error, 'Bookings could not be loaded.')}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title="No bookings yet">
          Request a booking from a vendor or planner listing.
        </EmptyState>
      ) : (
        <View style={{ gap: space(3) }}>
          {rows.map((row) => {
            return (
              <Pressable
                key={row.id}
                onPress={() => router.push({ pathname: '/plan/booking/[id]', params: { id: row.id } })}
              >
                <Card style={{ padding: space(3), borderRadius: radius.md, gap: space(3) }}>
                  <View style={{ flexDirection: 'row', gap: space(3) }}>
                    {row.providerImage ? (
                      <Image source={{ uri: row.providerImage }} style={{ width: 64, height: 64, borderRadius: radius.md }} />
                    ) : (
                      <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: rgb(theme.surfaceSunken), alignItems: 'center', justifyContent: 'center' }}>
                         <User size={24} color={rgb(theme.ink[400])} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body style={{ fontWeight: '700' }} numberOfLines={1}>
                        {row.providerName ?? 'Booking'}
                      </Body>
                      <Caption tone="muted" numberOfLines={1}>
                        {[row.serviceName, row.providerType ? categoryLabel(row.providerType) : null].filter(Boolean).join(' • ')}
                      </Caption>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), marginTop: 2 }}>
                         <CalendarBlank size={12} color={rgb(theme.ink[600])} />
                         <Caption tone="muted">{row.eventDate ? shortDate(row.eventDate) : 'Date TBD'}</Caption>
                         {row.startTime ? (
                           <>
                             <Clock size={12} color={rgb(theme.ink[600])} style={{ marginLeft: space(1) }} />
                             <Caption tone="muted">{row.startTime}</Caption>
                           </>
                         ) : null}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), marginTop: 2 }}>
                         <MapPin size={12} color={rgb(theme.ink[600])} />
                         <Caption tone="muted" numberOfLines={1}>{row.city || row.venue || 'Location TBD'}</Caption>
                      </View>
                    </View>
                    <CaretRight size={20} color={rgb(theme.ink[400])} style={{ alignSelf: 'center' }} />
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space(2), borderTopWidth: 1, borderTopColor: rgb(theme.border) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                      <Badge tone={statusTone(row.status)}>
                        {BUYER_STATUS_LABEL[row.status] ?? humanise(row.status)}
                      </Badge>
                      {row.status === 'requested' && <Caption tone="muted">Awaiting quotation from vendor</Caption>}
                      {row.status === 'quotation_sent' && <Caption tone="muted">Review and accept the quotation</Caption>}
                      {row.status === 'payment_pending' && <Caption tone="muted">Advance payment is due</Caption>}
                      {row.status === 'completed_pending_final_payment' && <Caption tone="muted">Final payment is due</Caption>}
                    </View>
                    {Number(row.amount) > 0 ? (
                      <Body style={{ fontWeight: '700' }}>{money(row.amount!, row.currency ?? 'INR')}</Body>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

