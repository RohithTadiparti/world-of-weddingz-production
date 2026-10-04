import { type ComponentType } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  CalendarBlank,
  CaretRight,
  Heart,
  Receipt,
  type IconProps,
} from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import {
  categoryLabel,
  fetchPlans,
  fetchWeddingDashboard,
  type WeddingDashboard,
} from '@/lib/wedding-plan';
import { NotificationBell } from '@/components/home/notification-bell';
import { Badge } from '@/components/chrome';
import {
  Body,
  Caption,
  Card,
  EmptyState,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';
import { Txt } from '@/theme/fonts';

type Action = {
  title: string;
  hint: string;
  icon: ComponentType<IconProps>;
  to: string;
};

const ACTIONS: Action[] = [
  { title: 'Vendors', hint: 'Find trusted vendors', icon: Briefcase, to: '/vendors' },
  { title: 'Hire a Planner', hint: 'Get expert guidance', icon: Heart, to: '/planners' },
  { title: 'Events', hint: 'Create and track events', icon: CalendarBlank, to: '/events' },
  { title: 'Bookings', hint: 'Manage your bookings', icon: Receipt, to: '/plan/bookings' },
];

export default function PlanHome() {
  const theme = useTheme();
  const router = useRouter();

  const dashboard = useQuery({
    queryKey: ['wedding-dashboard'],
    queryFn: fetchWeddingDashboard,
    retry: false,
  });
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    retry: false,
  });
  const bookings = useQuery({
    queryKey: ['my-bookings', 'upcoming'],
    queryFn: async () =>
      (await api.get('/bookings', { params: { limit: 5 } })).data as
        | { data?: BookingRow[] }
        | BookingRow[],
    retry: false,
  });

  if (dashboard.isPending || plans.isPending) {
    return (
      <Screen>
        <Loading rows={5} />
      </Screen>
    );
  }

  if (dashboard.error || plans.error) {
    return (
      <Screen>
        <EmptyState title="Your plan could not be loaded">
          {apiMessage(dashboard.error ?? plans.error, 'Please try again shortly.')}
        </EmptyState>
      </Screen>
    );
  }

  const data = dashboard.data as WeddingDashboard;
  const plan = plans.data?.[0];
  const percent = data.journey.total ? data.journey.percent : null;
  const location =
    data.upcoming.find((e) => e.venue)?.venue ??
    data.upcoming[0]?.venue ??
    null;
  const guestCount = data.guests.onList;
  const bookingRows: BookingRow[] = Array.isArray(bookings.data)
    ? bookings.data
    : (bookings.data?.data ?? []);
  const upcomingBookings = bookingRows
    .filter((b) => b.status !== 'cancelled' && b.status !== 'completed')
    .slice(0, 3);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt serif style={{ fontSize: 30, fontWeight: '600', color: rgb(theme.brand) }}>
          WOW
        </Txt>
        <NotificationBell />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open my wedding plan"
        onPress={() =>
          router.push({
            pathname: '/plan/[id]',
            params: { id: plan?.id ?? 'new' },
          })
        }
      >
        <Card style={{ gap: space(3), borderRadius: radius.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTitle>My Wedding Plan</SectionTitle>
            {plan ? (
              <Caption tone="brand" style={{ fontWeight: '600' }}>
                View <CaretRight size={12} color={rgb(theme.brandStrong)} />
              </Caption>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
            <ProgressRing percent={percent} />
            <View style={{ flex: 1, gap: space(1.5) }}>
              <Fact label="Wedding Day" value={data.countdown.weddingDate ? shortDate(data.countdown.weddingDate) : 'Not set'} />
              <Fact label="Location" value={location ?? 'Not set'} />
              <Fact label="Guest Count" value={guestCount ? `${guestCount} Guests` : 'Not set'} />
            </View>
          </View>
        </Card>
      </Pressable>

      <View style={{ gap: space(2) }}>
        <SectionTitle>Quick Actions</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {ACTIONS.map((action) => (
            <Pressable
              key={action.title}
              onPress={() => router.push(action.to as never)}
              style={{ width: '48.5%' }}
            >
              <Card style={{ minHeight: 96, padding: space(3), borderRadius: radius.md, gap: space(1) }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: rgb(theme.brandSoft),
                  }}
                >
                  <action.icon size={18} color={rgb(theme.brandStrong)} />
                </View>
                <Body style={{ fontWeight: '700', fontSize: 14 }}>{action.title}</Body>
                <Caption tone="faint" numberOfLines={1}>
                  {action.hint}
                </Caption>
              </Card>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>Upcoming Events</SectionTitle>
          <Pressable onPress={() => router.push('/events')}>
            <Caption tone="brand" style={{ fontWeight: '600' }}>
              See All
            </Caption>
          </Pressable>
        </View>
        {data.upcoming.length === 0 ? (
          <Card>
            <Caption tone="muted">No upcoming events yet. Add one from Events.</Caption>
          </Card>
        ) : (
          data.upcoming.slice(0, 3).map((event) => (
            <Pressable
              key={event.id}
              onPress={() => router.push('/events')}
            >
              <Card style={{ gap: space(1), borderRadius: radius.md }}>
                <Body style={{ fontWeight: '700' }}>{event.name}</Body>
                <Caption tone="muted">
                  {[shortDate(event.eventDate), event.venue].filter(Boolean).join(' · ')}
                </Caption>
                <Caption tone="brand">{event.daysAway === 0 ? 'Today' : `${event.daysAway} days away`}</Caption>
              </Card>
            </Pressable>
          ))
        )}
      </View>

      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>Upcoming Bookings</SectionTitle>
          <Pressable onPress={() => router.push('/plan/bookings')}>
            <Caption tone="brand" style={{ fontWeight: '600' }}>
              See All
            </Caption>
          </Pressable>
        </View>
        {bookings.isPending ? (
          <Loading rows={1} />
        ) : upcomingBookings.length === 0 ? (
          <Card>
            <Caption tone="muted">No bookings yet. Request one from a vendor or planner.</Caption>
          </Card>
        ) : (
          upcomingBookings.map((row) => (
            <Pressable
              key={row.id}
              onPress={() =>
                router.push({ pathname: '/plan/bookings', params: { highlight: row.id } })
              }
            >
              <Card style={{ gap: space(1), borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                  <Body style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                    {row.providerName ?? row.serviceName ?? 'Booking'}
                  </Body>
                  <Badge tone={row.status === 'confirmed' ? 'positive' : 'caution'}>
                    {categoryLabel(row.status)}
                  </Badge>
                </View>
                <Caption tone="muted">
                  {[row.serviceName, row.eventDate ? shortDate(row.eventDate) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Caption>
              </Card>
            </Pressable>
          ))
        )}
      </View>

      {!plan ? (
        <EmptyState title="Start your wedding plan">
          Tap My Wedding Plan above to set your wedding date and open the full plan.
        </EmptyState>
      ) : null}

      <Pressable onPress={() => router.push('/plan/more')} style={{ alignItems: 'center', paddingVertical: space(2) }}>
        <Caption tone="brand" style={{ fontWeight: '600' }}>
          Plan settings & more
        </Caption>
      </Pressable>
    </Screen>
  );
}

interface BookingRow {
  id: string;
  providerName?: string | null;
  serviceName?: string | null;
  status: string;
  eventDate?: string | null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Caption tone="faint" style={{ fontSize: 11 }}>
        {label}
      </Caption>
      <Caption style={{ fontWeight: '600' }} numberOfLines={1}>
        {value}
      </Caption>
    </View>
  );
}

function ProgressRing({ percent }: { percent: number | null }) {
  const theme = useTheme();
  const clamped = Math.min(100, Math.max(0, percent ?? 0));
  return (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: radius.md,
        borderWidth: 8,
        borderColor: rgb(theme.brandSoft),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: rgb(theme.surface),
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: 88,
          height: 88,
          borderRadius: radius.md,
          borderWidth: 8,
          borderColor: 'transparent',
          borderTopColor: rgb(theme.brand),
          borderRightColor: clamped >= 50 ? rgb(theme.brand) : 'transparent',
          transform: [{ rotate: `${(clamped / 100) * 360 - 90}deg` }],
        }}
      />
      <Txt style={{ fontSize: percent === null ? 11 : 18, fontWeight: '700', color: rgb(theme.brandStrong) }}>
        {percent === null ? 'Not started' : `${clamped}%`}
      </Txt>
      <Caption tone="faint" style={{ fontSize: 10 }}>
        Progress
      </Caption>
    </View>
  );
}
