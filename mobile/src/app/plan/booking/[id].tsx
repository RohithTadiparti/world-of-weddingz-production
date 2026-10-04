import { useMemo, useState, useEffect } from 'react';
import { View, ScrollView, Pressable, Image, Share, Linking } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Chat, MapPin, ShareNetwork, DotsThreeVertical, CheckCircle, Clock, CalendarBlank } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { shortDate, money } from '@/lib/format';
import { categoryLabel } from '@/lib/wedding-plan';
import { BuyerMoneyPanel } from '@/components/bookings/buyer-money';
import { BookingChat } from '@/components/bookings/chat';
import { RequestedServices } from '@/components/bookings/requested-services';
import { BuyerBooking, BUYER_STATUS_LABEL } from '../bookings';
import {
  Alert,
  Body,
  Caption,
  Card,
  EmptyState,
  Loading,
  Screen,
  Button,
  SectionTitle
} from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

export default function BookingDetails() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () =>
      (await api.get('/bookings', { params: { limit: 100 } })).data as
        | { data?: BuyerBooking[] }
        | BuyerBooking[],
    retry: false,
  });

  const row = useMemo(() => {
    const list: BuyerBooking[] = Array.isArray(query.data)
      ? query.data
      : (query.data?.data ?? []);
    return list.find((b) => b.id === id);
  }, [query.data, id]);

  const qc = useQueryClient();
  const refresh = () => {
    for (const key of ['my-bookings', 'buyer-quotations', 'buyer-milestones', 'escrow']) {
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

  const steps = [
    { key: 'requested', label: 'Request\nSent' },
    { key: 'quotation_accepted', label: 'Vendor\nReviewing' },
    { key: 'quotation_sent', label: 'Quotation' },
    { key: 'payment_pending', label: 'Payment' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'completed', label: 'Completed' },
  ];

  const getStepIndex = (status: string) => {
    if (status === 'requested') return 0;
    if (status === 'quotation_accepted') return 1;
    if (status === 'quotation_sent') return 2;
    if (status === 'payment_pending') return 3;
    if (status === 'confirmed' || status === 'in_progress') return 4;
    if (status === 'completed' || status === 'completed_pending_final_payment') return 5;
    return -1;
  };

  const currentStepIndex = getStepIndex(row.status);

  return (
    <Screen onRefresh={refresh} refreshing={query.isRefetching}>
      <Stack.Screen 
        options={{ 
          title: 'Booking Details',
          headerRight: () => (
            <Pressable onPress={() => {}}>
              <DotsThreeVertical size={24} color={rgb(theme.ink[900])} />
            </Pressable>
          )
        }} 
      />

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: space(4) }}>
        {row.providerImage ? (
          <Image source={{ uri: row.providerImage }} style={{ width: '100%', height: 160 }} />
        ) : (
          <View style={{ width: '100%', height: 160, backgroundColor: rgb(theme.surfaceSunken) }} />
        )}
        
        <View style={{ padding: space(3), gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <SectionTitle numberOfLines={1}>{row.providerName ?? 'Provider'}</SectionTitle>
              <Caption tone="muted" numberOfLines={1}>
                {row.providerType ? categoryLabel(row.providerType) : 'Service'} • {row.serviceName}
              </Caption>
              {(row.ratingAvg !== undefined && row.ratingAvg !== null) && (
                <Caption tone="muted">
                  ⭐ {Number(row.ratingAvg).toFixed(1)} ({row.ratingCount} reviews)
                </Caption>
              )}
            </View>
            <Button 
              label={row.providerType === 'planner' ? 'View Planner' : 'View Vendor'} 
              variant="outline" 
              small 
              onPress={() => {
                if (row.providerType === 'planner' && row.providerId) {
                  router.push({ pathname: '/planners/[id]', params: { id: row.providerId } });
                } else if (row.providerType === 'vendor' && row.providerId) {
                  router.push({ pathname: '/vendors/[id]', params: { id: row.providerId } });
                }
              }} 
            />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingTop: space(2), borderTopWidth: 1, borderTopColor: rgb(theme.border) }}>
            <Pressable style={{ alignItems: 'center', gap: 4 }} onPress={() => {}}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
                <Phone size={20} color={rgb(theme.brand)} />
              </View>
              <Caption>Call</Caption>
            </Pressable>
            <Pressable 
              style={{ alignItems: 'center', gap: 4 }} 
              onPress={() => {
                router.push({ pathname: '/plan/bookings', params: { highlight: row.id } });
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
                <Chat size={20} color={rgb(theme.brand)} />
              </View>
              <Caption>Message</Caption>
            </Pressable>
            <Pressable style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
                <MapPin size={20} color={rgb(theme.brand)} />
              </View>
              <Caption>Location</Caption>
            </Pressable>
            <Pressable style={{ alignItems: 'center', gap: 4 }} onPress={() => void Share.share({ message: `Check out this booking with ${row.providerName}` })}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
                <ShareNetwork size={20} color={rgb(theme.brand)} />
              </View>
              <Caption>Share</Caption>
            </Pressable>
          </View>
        </View>
      </Card>

      <Card style={{ marginBottom: space(4), gap: space(2) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(1) }}>
          <Body style={{ fontWeight: '700' }}>Booking Information</Body>
          <Caption tone="brand" style={{ fontWeight: '600' }}>Edit Request</Caption>
        </View>
        <InfoRow label="Service" value={row.serviceName || row.offeringName || '-'} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        <InfoRow label="Event Date" value={row.eventDate ? shortDate(row.eventDate) : '-'} icon={<CalendarBlank size={16} color={rgb(theme.brand)} />} />
        <InfoRow label="Time" value={row.startTime || '-'} icon={<Clock size={16} color={rgb(theme.brand)} />} />
        <InfoRow label="Guests (Expected)" value={row.guests?.toString() || '-'} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        <InfoRow label="Location" value={row.city || row.venue || '-'} icon={<MapPin size={16} color={rgb(theme.brand)} />} />
        <InfoRow label="Special Requests" value={row.specialRequests || '-'} icon={<CheckCircle size={16} color={rgb(theme.brand)} />} />
        <RequestedServices services={row.requestedServices} />
      </Card>

      <Card style={{ marginBottom: space(4), gap: space(3) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
            <Clock size={16} color={rgb(theme.brand)} />
          </View>
          <Body style={{ fontWeight: '700', flex: 1 }}>Booking Status</Body>
          <View style={{ backgroundColor: rgb(theme.surfaceSunken), paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
            <Caption tone="brand" style={{ fontWeight: '600' }}>{BUYER_STATUS_LABEL[row.status] || row.status}</Caption>
          </View>
        </View>
        <Caption tone="muted">
          {row.status === 'requested' && 'Your booking request has been sent to the vendor. They will review availability and send a quotation soon.'}
          {row.status === 'quotation_sent' && 'Review the quotation and accept or reject it.'}
          {row.status === 'payment_pending' && 'Accept the quotation to fund your booking.'}
          {row.status === 'confirmed' && 'Your payment is securely held in escrow.'}
        </Caption>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space(2), paddingHorizontal: space(2) }}>
          {steps.map((step, idx) => {
            const active = currentStepIndex >= idx;
            return (
              <View key={step.key} style={{ alignItems: 'center', flex: 1 }}>
                <View style={{ 
                  width: 24, height: 24, borderRadius: 12, 
                  backgroundColor: active ? rgb(theme.brand) : rgb(theme.surfaceSunken),
                  alignItems: 'center', justifyContent: 'center', zIndex: 2
                }}>
                  {active && <CheckCircle size={14} color={rgb(theme.brandFg)} weight="fill" />}
                </View>
                <Caption style={{ textAlign: 'center', fontSize: 10, marginTop: 4, color: active ? rgb(theme.ink[900]) : rgb(theme.ink[400]) }}>
                  {step.label}
                </Caption>
              </View>
            );
          })}
        </View>
      </Card>

      <BuyerMoneyPanel booking={row} />

      <BookingChat bookingId={row.id} label="Message the vendor" />
    </Screen>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingVertical: space(1) }}>
      <View style={{ width: 140, flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        {icon}
        <Caption tone="muted">{label}</Caption>
      </View>
      <Body style={{ flex: 1, fontWeight: '500' }}>{value}</Body>
    </View>
  );
}
