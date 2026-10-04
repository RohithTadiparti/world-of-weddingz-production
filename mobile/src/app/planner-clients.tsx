import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank, CalendarCheck, CheckSquare, MapPin, Storefront, Tray } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { daysAway, formatDate } from '@/shared/dates';
import { Badge, DetailGrid, DetailRow, FilterChips, type Tone } from '@/components/chrome';
import { Alert, Body, Button, Caption, Card, EmptyState, Field, Loading, PageSubtitle, PageTitle, Screen, SectionTitle } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

type Status = 'active' | 'upcoming' | 'completed';

type Client = {
  userId: string;
  planId: string;
  name: string;
  bride: string | null;
  groom: string | null;
  weddingDate: string | null;
  derivedWeddingDate: string | null;
  location: string | null;
  events: number;
  tasks: { total: number; done: number };
  bookings: { total: number; confirmed: number; pending: number };
  status: Status;
};

type ClientDetail = {
  client: { name: string; bride: string | null; groom: string | null; city: string | null; status: string };
  wedding: { weddingDate: string | null; countdown?: { days?: number | null } | null; functions: number; venues: string[]; cities: string[] };
  guests: { invited?: number; confirmed?: number; total?: number } | null;
  budget: { total?: string | number | null; committed?: string | number | null } | null;
  events: { id: string; name: string; date: string | null; venue: string | null; city: string | null; status: string }[];
  tasks: { id: string; title: string; category: string; dueDate: string | null; status: string }[];
  vendors: { bookingId: string; name: string; service: string | null; status: string; eventDate: string | null; amount: string | number; currency: string }[];
};

/** The web's My Weddings words and pill families. */
const STATUS: Record<Status, { label: string; tone: Tone }> = {
  active: { label: 'In Progress', tone: 'positive' },
  upcoming: { label: 'Upcoming', tone: 'caution' },
  completed: { label: 'Completed', tone: 'neutral' },
};

const FILTERS = ['all', 'active', 'upcoming', 'completed'] as const;

function rupees(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? `₹${numeric.toLocaleString('en-IN')}` : '—';
}

/**
 * The planner's My Weddings: one card per confirmed engagement, and the
 * planner's working book behind each one — not the couple's own planning tab.
 *
 * The cards follow the web redesign: who and where, the day and how far off it
 * is, the three numbers a planner checks first, and how far the plan has got by
 * tasks done. Requests are not weddings yet and live under Planner Requests;
 * payments live in Bookings and Accounts, so there is no payment filter here.
 *
 * Opening a card shows the scoped view the API already returns and authorises
 * against the engagement, so the device renders that canonical record rather
 * than attempting to join wedding data itself. `?client=` opens one directly,
 * which is how an agreed request hands over to its wedding.
 */
export default function PlannerClients() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ client?: string }>();
  const [selected, setSelected] = useState<string | null>(params.client ?? null);
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const [query, setQuery] = useState('');
  const clients = useQuery({
    queryKey: ['planner-clients'],
    queryFn: async () => (await api.get('/planner/clients')).data as { clients: Client[]; requests?: unknown[] },
    refetchOnMount: 'always',
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ['planner-client', selected],
    queryFn: async () => (await api.get(`/planner/clients/${selected}`)).data as ClientDetail,
    enabled: Boolean(selected),
  });

  const all = useMemo(() => clients.data?.clients ?? [], [clients.data?.clients]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter((w) => status === 'all' || w.status === status)
      .filter((w) => {
        if (!needle) return true;
        const date = w.weddingDate ?? w.derivedWeddingDate;
        // The date is searchable as stored and as shown ("15 Dec 2026").
        return [w.name, w.bride, w.groom, w.location, date, date && formatDate(date)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((a, b) =>
        (a.weddingDate ?? a.derivedWeddingDate ?? '9999-12-31').localeCompare(
          b.weddingDate ?? b.derivedWeddingDate ?? '9999-12-31',
        ),
      );
  }, [all, query, status]);
  const waiting = clients.data?.requests?.length ?? 0;

  if (selected) {
    return <ClientWedding detail={detail.data} loading={detail.isLoading} onBack={() => setSelected(null)} />;
  }

  return (
    <Screen onRefresh={() => void clients.refetch()} refreshing={clients.isRefetching}>
      <View style={{ gap: space(1), marginTop: space(2) }}>
        <PageTitle>My Weddings</PageTitle>
        <PageSubtitle>
          Every confirmed planning engagement in one place. Open a wedding to coordinate its events,
          vendors, tasks and shared plan.
        </PageSubtitle>
      </View>

      {/* Requests are the step before a wedding: said here, opened elsewhere. */}
      {waiting > 0 ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <Tray size={22} color={rgb(theme.brand)} />
          <Body style={{ flex: 1 }}>
            {waiting} request{waiting === 1 ? '' : 's'} waiting on you
          </Body>
          <Button label="Review" small onPress={() => router.push('/planner-requests')} />
        </Card>
      ) : (
        <Button label="Planner requests" variant="ghost" small onPress={() => router.push('/planner-requests')} />
      )}

      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Search customer, couple, date or city"
        autoCorrect={false}
      />
      {/* "All" is a filter of its own, so pressing the active chip keeps it. */}
      <FilterChips
        options={FILTERS.map((key) => ({
          key,
          label: key === 'all' ? 'All' : STATUS[key].label,
          count: clients.isLoading ? undefined : key === 'all' ? all.length : all.filter((w) => w.status === key).length,
        }))}
        value={status}
        onChange={(key) => {
          if (key) setStatus(key as (typeof FILTERS)[number]);
        }}
      />

      {clients.isLoading ? (
        <Loading rows={3} />
      ) : clients.isError ? (
        <Alert tone="critical">Your weddings could not be loaded. Please try again.</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={query ? 'No weddings match' : 'No weddings found'}>
          {query
            ? 'Try a different name, date or city.'
            : 'A wedding appears here once a couple has agreed your quotation and the engagement is confirmed.'}
        </EmptyState>
      ) : (
        rows.map((wedding) => (
          <WeddingCard key={wedding.planId} wedding={wedding} onOpen={() => setSelected(wedding.userId)} />
        ))
      )}
    </Screen>
  );
}

function WeddingCard({ wedding, onOpen }: { wedding: Client; onOpen: () => void }) {
  const theme = useTheme();
  const date = wedding.weddingDate ?? wedding.derivedWeddingDate ?? null;
  const days = daysAway(date);
  const couple = [wedding.bride, wedding.groom].filter(Boolean).join(' & ');
  const pending = Math.max(0, wedding.tasks.total - wedding.tasks.done);
  const progress = wedding.tasks.total ? Math.round((wedding.tasks.done / wedding.tasks.total) * 100) : 0;
  const when =
    days === null ? null : days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : null;

  // The whole card opens the workspace; the line at the foot says so.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the wedding workspace for ${couple || wedding.name}`}
      onPress={onOpen}
      style={({ pressed }) => [pressed && { opacity: 0.75 }]}
    >
      <Card>
        {/* Who, where, and where it stands. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
          <View style={{ flex: 1, minWidth: 0, gap: space(1) }}>
            <Txt serif numberOfLines={1} style={{ fontSize: 22, lineHeight: 26, color: rgb(theme.ink[900]) }}>
              {couple || wedding.name}
            </Txt>
            {couple ? <Caption numberOfLines={1}>Client: {wedding.name}</Caption> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
              <MapPin size={14} color={rgb(theme.brand)} />
              <Caption numberOfLines={1} style={{ flexShrink: 1 }}>
                {wedding.location ?? 'Location not set'}
              </Caption>
            </View>
          </View>
          <Badge tone={STATUS[wedding.status].tone}>{STATUS[wedding.status].label}</Badge>
        </View>

        {/* The day itself. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(3),
            backgroundColor: rgba(theme.brandSoft, 0.7),
            borderRadius: radius.md,
            paddingHorizontal: space(3),
            paddingVertical: space(2.5),
          }}
        >
          <CalendarBlank size={20} color={rgb(theme.brand)} />
          <View style={{ flex: 1, gap: space(0.5) }}>
            <Caption tone="faint" style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              Wedding date
            </Caption>
            <Body style={{ fontWeight: '600' }}>
              {formatDate(date, 'Not set')}
              {when ? <Txt style={{ fontWeight: '400', color: rgb(theme.brandStrong) }}> · {when}</Txt> : null}
            </Body>
          </View>
        </View>

        {/* The three numbers a planner checks first. */}
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Stat icon={CalendarCheck} label="Events" value={wedding.events} />
          <Stat
            icon={Storefront}
            label="Confirmed vendors"
            value={wedding.bookings.confirmed}
            hint={wedding.bookings.pending > 0 ? `${wedding.bookings.pending} pending` : undefined}
          />
          <Stat
            icon={CheckSquare}
            label="Pending tasks"
            value={pending}
            colour={pending > 0 ? rgb(theme.cautionFg) : undefined}
          />
        </View>

        {/* How far the plan has got, by tasks done. */}
        <View style={{ gap: space(1.5) }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space(2) }}>
            <Caption>Planning progress</Caption>
            <Caption tone="default" style={{ fontVariant: ['tabular-nums'] }}>
              <Txt style={{ fontWeight: '600' }}>{progress}%</Txt>
              <Txt style={{ color: rgb(theme.ink[400]) }}>
                {'  '}
                {wedding.tasks.total ? `${wedding.tasks.done} of ${wedding.tasks.total} tasks` : 'no tasks yet'}
              </Txt>
            </Caption>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Planning progress"
            accessibilityValue={{ min: 0, max: 100, now: progress }}
            style={{ height: 8, borderRadius: radius.md, overflow: 'hidden', backgroundColor: rgb(theme.surfaceSunken) }}
          >
            <View style={{ height: '100%', width: `${progress}%`, borderRadius: radius.md, backgroundColor: rgb(theme.brand) }} />
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: space(1.5),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: rgb(theme.border),
            paddingTop: space(3),
          }}
        >
          <Caption tone="brand" style={{ fontWeight: '600' }}>
            Open Wedding Workspace
          </Caption>
          <ArrowRight size={16} color={rgb(theme.brandStrong)} />
        </View>
      </Card>
    </Pressable>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  colour,
}: {
  icon: typeof CalendarBlank;
  label: string;
  value: number;
  hint?: string;
  colour?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        gap: space(1),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.border),
        borderRadius: radius.md,
        paddingHorizontal: space(2.5),
        paddingVertical: space(2),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
        <Icon size={14} color={rgb(theme.ink[400])} />
        <Caption tone="faint" numberOfLines={2} style={{ flexShrink: 1, fontSize: 11, lineHeight: 14 }}>
          {label}
        </Caption>
      </View>
      <Txt serif style={{ fontSize: 26, lineHeight: 28, color: colour ?? rgb(theme.ink[900]) }}>
        {value}
      </Txt>
      {hint ? <Caption tone="faint" style={{ fontSize: 11 }}>{hint}</Caption> : null}
    </View>
  );
}

function ClientWedding({ detail, loading, onBack }: { detail?: ClientDetail; loading: boolean; onBack: () => void }) {
  if (loading || !detail) return <Screen><Loading rows={4} /></Screen>;
  const completed = detail.tasks.filter((task) => task.status === 'done').length;
  const openTasks = detail.tasks.filter((task) => task.status !== 'done');
  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <ButtonRow label="Back to My Weddings" onPress={onBack} />
        <SectionTitle>{detail.client.name}</SectionTitle>
        {(detail.client.bride || detail.client.groom) ? <Caption tone="faint">{[detail.client.bride, detail.client.groom].filter(Boolean).join(' & ')}</Caption> : null}
      </View>
      <Card>
        <SectionTitle>Wedding at a glance</SectionTitle>
        <DetailGrid>
          <DetailRow label="Wedding date">{shortDate(detail.wedding.weddingDate)}</DetailRow>
          <DetailRow label="Functions">{String(detail.wedding.functions)}</DetailRow>
          <DetailRow label="City">{detail.wedding.cities.join(', ') || detail.client.city || 'Not set'}</DetailRow>
          <DetailRow label="Venues">{detail.wedding.venues.join(', ') || 'Not set'}</DetailRow>
          <DetailRow label="Guests">{String(detail.guests?.confirmed ?? detail.guests?.invited ?? detail.guests?.total ?? 0)}</DetailRow>
          <DetailRow label="Budget committed">{rupees(detail.budget?.committed)}</DetailRow>
        </DetailGrid>
      </Card>
      <Card>
        <SectionTitle>Tasks · {completed} of {detail.tasks.length} done</SectionTitle>
        {openTasks.length === 0 ? <Caption tone="faint">No outstanding tasks.</Caption> : openTasks.slice(0, 8).map((task) => (
          <View key={task.id} style={{ gap: space(0.5) }}><Body>{task.title}</Body><Caption tone="faint">{task.category}{task.dueDate ? ` · due ${shortDate(task.dueDate)}` : ''}</Caption></View>
        ))}
      </Card>
      <Card>
        <SectionTitle>Functions</SectionTitle>
        {detail.events.length === 0 ? <Caption tone="faint">No functions added yet.</Caption> : detail.events.map((event) => (
          <View key={event.id} style={{ gap: space(0.5) }}><Body>{event.name}</Body><Caption tone="faint">{[shortDate(event.date), event.venue, event.city].filter(Boolean).join(' · ')}</Caption></View>
        ))}
      </Card>
      <Card>
        <SectionTitle>Vendors arranged</SectionTitle>
        {detail.vendors.length === 0 ? <Caption tone="faint">No vendor bookings yet.</Caption> : detail.vendors.map((vendor) => (
          <View key={vendor.bookingId} style={{ gap: space(0.5) }}><Body>{vendor.name}{vendor.service ? ` · ${vendor.service}` : ''}</Body><Caption tone="faint">{[vendor.status.replace(/_/g, ' '), vendor.eventDate ? shortDate(vendor.eventDate) : null, rupees(vendor.amount)].filter(Boolean).join(' · ')}</Caption></View>
        ))}
      </Card>
    </Screen>
  );
}

function ButtonRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress}><Caption style={{ color: rgb(theme.brandStrong) }}>{label}</Caption></Pressable>;
}
