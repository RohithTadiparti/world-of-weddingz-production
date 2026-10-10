import { useMemo, useState } from 'react';
import { View, Pressable, Image, Share, Linking } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Chat, MapPin, ShareNetwork, CheckCircle, Clock, CalendarBlank } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { shortDate, money, dateTime } from '@/lib/format';
import { categoryLabel } from '@/lib/wedding-plan';
import { BuyerMoneyPanel } from '@/components/bookings/buyer-money';
import { BookingChat } from '@/components/bookings/chat';
import { RequestedServices } from '@/components/bookings/requested-services';
import { NegotiationHistory, useBookingSummary } from '@/components/bookings/summary';
import { pricingModelLabel } from '@/shared/booking-rules';
import { BuyerBooking, BUYER_STATUS_LABEL } from '../bookings';
import { Body, Caption, Card, EmptyState, Loading, Screen, Button, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

/**
 * One booking in full, for the couple (row 19): status, vendor, service and
 * how it is priced, date and time, venue, pricing, payments and escrow, the
 * timeline, the reference images, and the conversation with the vendor --
 * which opens for both sides once the advance is paid.
 */
export default function BookingDetails() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [chatOpen, setChatOpen] = useState(false);

  const query = useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () =>
      (await api.get('/bookings', { params: { limit: 100 } })).data as
        | { data?: BuyerBooking[] }
        | BuyerBooking[],
    retry: false,
  });

  const row = useMemo(() => {
    const list: BuyerBooking[] = Array.isArray(query.data) ? query.data : (query.data?.data ?? []);
    return list.find((b) => b.id === id);
  }, [query.data, id]);

  const summary = useBookingSummary(id ?? '');
  const timeline = useQuery({
    queryKey: ['booking-history', id],
    queryFn: async () =>
      (await api.get(`/bookings/${id}/history`)).data as {
        at: string;
        label: string;
        detail: string | null;
      }[],
    enabled: Boolean(id),
    retry: false,
  });

  const qc = useQueryClient();
  const refresh = () => {
    for (const key of [
      'my-bookings',
      'buyer-quotations',
      'buyer-milestones',
      'escrow',
      'booking-summary',
      'booking-history',
      'booking-chat-state',
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  if (query.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Booking Details' }} />
        <Loading rows={4} />
      </Screen>
    );
  }

  if (query.error || !row) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Booking Details' }} />
        <EmptyState title="Booking not found">
          {apiMessage(query.error, 'We could not find this booking.')}
        </EmptyState>
      </Screen>
    );
  }

  const currency = row.currency ?? 'INR';
  const venue = [row.eventVenue ?? row.venue, row.eventCity ?? row.city].filter(Boolean).join(', ');
  const payments = summary.data?.payments;
  const pricing =
    Number(row.amount ?? 0) > 0
      ? `${money(row.amount, currency)} agreed`
      : row.quotation
        ? `Quoted ${money(row.quotation.amount, row.quotation.currency ?? currency)}`
        : 'Not priced yet';

  return (
    <Screen onRefresh={refresh} refreshing={query.isRefetching}>
      <Stack.Screen options={{ title: 'Booking Details' }} />

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: space(4) }}>
        {row.providerImage ? (
          <Image source={{ uri: row.providerImage }} style={{ width: '100%', height: 160 }} />
        ) : null}
        <View style={{ padding: space(3), gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <SectionTitle numberOfLines={1}>{row.providerName ?? 'Provider'}</SectionTitle>
              <Caption tone="muted" numberOfLines={2}>
                {row.providerType ? categoryLabel(row.providerType) : 'Service'}
                {row.serviceName ? ` • ${row.serviceName}` : ''}
              </Caption>
            </View>
            <Button
              label={row.providerType === 'planner' ? 'View Planner' : 'View Vendor'}
              variant="outline"
              small
              onPress={() => {
                if (row.providerType === 'planner' && row.providerId) {
                  router.push({ pathname: '/planners/[id]', params: { id: row.providerId } });
                } else if (row.providerId) {
                  router.push({ pathname: '/vendors/[id]', params: { id: row.providerId } });
                }
              }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              paddingTop: space(2),
              borderTopWidth: 1,
              borderTopColor: rgb(theme.border),
            }}
          >
            <Action icon={<Chat size={20} color={rgb(theme.brand)} />} label="Message" onPress={() => setChatOpen(true)} />
            <Action
              icon={<MapPin size={20} color={rgb(theme.brand)} />}
              label="Location"
              disabled={!venue}
              onPress={() =>
                void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`)
              }
            />
            <Action
              icon={<ShareNetwork size={20} color={rgb(theme.brand)} />}
              label="Share"
              onPress={() => void Share.share({ message: `My booking with ${row.providerName ?? 'a vendor'}` })}
            />
          </View>
        </View>
      </Card>

      <Card style={{ marginBottom: space(4), gap: space(2) }}>
        <Body style={{ fontWeight: '700' }}>Booking information</Body>
        <InfoRow label="Status" value={BUYER_STATUS_LABEL[row.status] || row.status} icon={<Clock size={16} color={rgb(theme.brand)} />} />
        <InfoRow label="Vendor" value={row.providerName ?? 'Provider'} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        <InfoRow
          label="Service"
          value={
            [row.serviceName, row.offeringName].filter(Boolean).join(' · ') +
              (pricingModelLabel(row.pricingModel) ? ` (${pricingModelLabel(row.pricingModel)})` : '') || '-'
          }
          icon={<CheckCircle size={16} color={rgb(theme.brand)} />}
        />
        <InfoRow
          label="Date"
          value={row.eventDate ? `${shortDate(row.eventDate)}${row.requestedTime ? ` · ${row.requestedTime}` : ''}` : '-'}
          icon={<CalendarBlank size={16} color={rgb(theme.brand)} />}
        />
        <InfoRow label="Venue" value={venue || '-'} icon={<MapPin size={16} color={rgb(theme.brand)} />} />
        {row.eventName ? <InfoRow label="Event" value={row.eventName} icon={<CalendarBlank size={16} color={rgb(theme.brand)} />} /> : null}
        {row.expectedGuests ? (
          <InfoRow label="Guests" value={String(row.expectedGuests)} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        ) : null}
        <InfoRow label="Pricing" value={pricing} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        {Number(row.expectedBudget ?? 0) > 0 ? (
          <InfoRow label="Your budget" value={money(row.expectedBudget, currency)} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        ) : null}
        <InfoRow
          label="Payments"
          value={payments ? `Paid ${money(payments.paid, currency)} · pending ${money(payments.pending, currency)}` : '-'}
          icon={<CheckCircle size={16} color={rgb(theme.brand)} />}
        />
        <InfoRow
          label="Escrow"
          value={
            payments
              ? Number(payments.heldInEscrow) > 0
                ? `${money(payments.heldInEscrow, currency)} held`
                : Number(payments.released) > 0
                  ? 'Released to the provider'
                  : 'Nothing held'
              : '-'
          }
          icon={<CheckCircle size={16} color={rgb(theme.brand)} />}
        />
        {row.requirements ? (
          <InfoRow label="Your request" value={row.requirements} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        ) : null}
        <RequestedServices services={row.requestedServices} />
      </Card>

      {(row.referenceImages?.length ?? 0) > 0 ? (
        <Card style={{ marginBottom: space(4), gap: space(2) }}>
          <Body style={{ fontWeight: '700' }}>Reference images</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {(row.referenceImages ?? []).map((url) => (
              <Pressable key={url} onPress={() => void Linking.openURL(url)}>
                <Image source={{ uri: url }} style={{ width: 96, height: 72, borderRadius: radius.sm }} />
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {summary.data ? (
        <View style={{ marginBottom: space(4) }}>
          <NegotiationHistory summary={summary.data} viewer="customer" />
        </View>
      ) : null}

      <BuyerMoneyPanel booking={row} />

      {(timeline.data?.length ?? 0) > 0 ? (
        <Card style={{ marginTop: space(4), gap: space(1.5) }}>
          <Body style={{ fontWeight: '700' }}>Booking timeline</Body>
          {(timeline.data ?? []).map((e, i) => (
            <View key={`${e.at}-${i}`} style={{ gap: 2 }}>
              <Caption style={{ fontWeight: '600' }}>{e.label}</Caption>
              <Caption tone="faint">{[dateTime(e.at), e.detail].filter(Boolean).join(' · ')}</Caption>
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={{ marginTop: space(4) }}>
        <BookingChat bookingId={row.id} label="Message the vendor" defaultOpen={chatOpen} />
      </Card>
    </Screen>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={{ alignItems: 'center', gap: 4, opacity: disabled ? 0.4 : 1 }}
      onPress={onPress}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: rgb(theme.brandSoft),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <Caption>{label}</Caption>
    </Pressable>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: space(1) }}>
      <View style={{ width: 120, flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        {icon}
        <Caption tone="muted">{label}</Caption>
      </View>
      <Body style={{ flex: 1, fontWeight: '500' }}>{value}</Body>
    </View>
  );
}
