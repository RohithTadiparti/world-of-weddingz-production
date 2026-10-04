import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarBlank, MapPin, UsersThree } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { humanise, shortDate } from '@/lib/format';
import { EVENT_STATUS_LABEL, clockTime } from '@/lib/labels';
import { todayIso } from '@/shared/dates';
import { Badge, StatTile, TileGrid } from '@/components/chrome';
import { TimeField } from '@/components/form';
import { WowCalendar } from '@/components/common/WowCalendar';
import { ListScreen } from '@/components/layout';
import {
  Alert,
  Button,
  Caption,
  Card,
  Field,
  PageSubtitle,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * The wedding's own days (EZ1-I261).
 *
 * A wedding is not one event: it is a mehendi, a haldi, a reception and the
 * ceremony itself, each with its own day, venue and guest list, and every
 * booking on this platform hangs off one of them. The app could show a vendor
 * the event a booking was for and gave the couple no way to create or read one.
 *
 * There is no invitation per event: a guest gets one wedding invitation that
 * lists every event here, sent from the guest list.
 */
interface WeddingEvent {
  id: string;
  name: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string | null;
  city: string | null;
  expectedGuests: number | null;
  status: string;
  category: string | null;
}

interface Summary {
  total: number;
  upcoming: number;
  completed: number;
  cancelled: number;
}

export default function Events() {
  const theme = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['events'],
    // No paging parameters: the endpoint takes none, and refused `limit` with a
    // 400, so this screen always said "No events yet".
    queryFn: async () => (await api.get('/events')).data,
    retry: false,
  });

  const { data: summary } = useQuery({
    queryKey: ['events-summary'],
    queryFn: async () => (await api.get('/events/summary')).data as Summary,
    retry: false,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['events'] });
    void qc.invalidateQueries({ queryKey: ['events-summary'] });
    void qc.invalidateQueries({ queryKey: ['wedding-dashboard'] });
  };

  const remove = useMutation({
    mutationFn: async (eventId: string) => api.delete(`/events/${eventId}`),
    onSuccess: () => {
      setError('');
      setNotice('Event removed.');
      setConfirmingId(null);
      refresh();
    },
    onError: (err) => {
      setNotice('');
      setError(apiMessage(err, 'That event could not be removed.'));
      setConfirmingId(null);
    },
  });

  // A plain array, not the paged envelope.
  const rows: WeddingEvent[] = Array.isArray(data) ? data : (data?.data ?? []);

  return (
    <ListScreen
      header={
        <>
          <PageSubtitle>
            Every day of the wedding, with its own date, venue and guests. Bookings hang off these.
          </PageSubtitle>

          {notice ? <Alert tone="positive">{notice}</Alert> : null}
          {error ? <Alert tone="critical">{error}</Alert> : null}

          {summary ? (
            <TileGrid>
              <StatTile label="All events" value={summary.total} />
              <StatTile label="Upcoming" value={summary.upcoming} tone="brand" />
              <StatTile label="Completed" value={summary.completed} tone="positive" />
              <StatTile label="Cancelled" value={summary.cancelled} />
            </TileGrid>
          ) : null}

          <Button
            label={creating ? 'Cancel' : 'Add an event'}
            variant={creating ? 'outline' : 'primary'}
            onPress={() => setCreating((open) => !open)}
          />
          {rows.length > 0 ? (
            <Button label="Invite guests" variant="outline" onPress={() => router.push('/plan/guests')} />
          ) : null}
          {rows.length > 0 ? (
            <Caption tone="muted">
              Each guest gets one invitation that lists every event below.
            </Caption>
          ) : null}

          {creating ? (
            <EventForm
              onCancel={() => setCreating(false)}
              onSaved={() => {
                setCreating(false);
                setError('');
                setNotice('Added. Vendors can be booked against it now.');
                refresh();
              }}
              onError={setError}
            />
          ) : null}
        </>
      }
      data={rows}
      keyExtractor={(row) => row.id}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle="No events yet"
      emptyBody="Add the mehendi, the reception, the ceremony — whichever days you are planning."
      renderItem={(row) =>
        editingId === row.id ? (
          <EventForm
            event={row}
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              setError('');
              setNotice('Saved.');
              refresh();
            }}
            onError={setError}
          />
        ) : (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <SectionTitle style={{ flex: 1 }} numberOfLines={2}>
              {row.name}
            </SectionTitle>
            <Badge tone={row.status === 'cancelled' ? 'critical' : 'brand'}>
              {EVENT_STATUS_LABEL[row.status] ?? humanise(row.status)}
            </Badge>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
            <Fact icon={<CalendarBlank size={14} color={rgb(theme.ink[400])} />}>
              {[shortDate(row.eventDate), clockTime(row.startTime)].filter(Boolean).join(' · ')}
            </Fact>
            {row.venue || row.city ? (
              <Fact icon={<MapPin size={14} color={rgb(theme.ink[400])} />}>
                {[row.venue, row.city].filter(Boolean).join(', ')}
              </Fact>
            ) : null}
            {row.expectedGuests ? (
              <Fact icon={<UsersThree size={14} color={rgb(theme.ink[400])} />}>
                {`${row.expectedGuests} guests`}
              </Fact>
            ) : null}
          </View>

          <View style={{ gap: space(2) }}>
            {confirmingId === row.id ? (
              <View style={{ gap: space(2) }}>
                <Caption tone="critical">
                  Remove {row.name}? It comes off every guest's invitation.
                </Caption>
                <View style={{ flexDirection: 'row', gap: space(2) }}>
                  <Button
                    label="Cancel"
                    variant="ghost"
                    small
                    style={{ flex: 1 }}
                    disabled={remove.isPending}
                    onPress={() => setConfirmingId(null)}
                  />
                  <Button
                    label="Remove Event"
                    variant="primary"
                    small
                    style={{ flex: 1, backgroundColor: rgb(theme.criticalBg) }}
                    busy={remove.isPending && remove.variables === row.id}
                    onPress={() => remove.mutate(row.id)}
                  />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button
                  label="Edit"
                  variant="outline"
                  small
                  style={{ flex: 1 }}
                  onPress={() => {
                    setNotice('');
                    setEditingId(row.id);
                  }}
                />
                <Button
                  label="Remove"
                  variant="ghost"
                  small
                  style={{ flex: 1 }}
                  onPress={() => {
                    setNotice('');
                    setError('');
                    setConfirmingId(row.id);
                  }}
                />
              </View>
            )}
          </View>
        </Card>
        )
      }
    />
  );
}

function Fact({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
      {icon}
      <Caption>{children}</Caption>
    </View>
  );
}

/**
 * A day of the wedding, new or amended.
 *
 * The name is the only thing demanded. A family adding "Reception" three months
 * out does not yet know the venue, and a form that insists on one is a form
 * they close.
 */
function EventForm({
  event,
  onCancel,
  onSaved,
  onError,
}: {
  event?: WeddingEvent;
  onCancel: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: event?.name ?? '',
    eventDate: event?.eventDate?.slice(0, 10) ?? '',
    startTime: event?.startTime?.slice(0, 5) ?? '',
    venue: event?.venue ?? '',
    city: event?.city ?? '',
    expectedGuests: event?.expectedGuests ? String(event.expectedGuests) : '',
  });

  const create = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        eventDate: form.eventDate || null,
        startTime: form.startTime || null,
        venue: form.venue.trim() || null,
        city: form.city.trim() || null,
        expectedGuests: form.expectedGuests ? Number(form.expectedGuests) : null,
      };
      if (event) await api.put(`/events/${event.id}`, body);
      else await api.post('/events', body);
    },
    onSuccess: onSaved,
    onError: (err) =>
      onError(apiMessage(err, event ? 'That event could not be saved.' : 'That event could not be added.')),
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <Field
        label="What is it?"
        value={form.name}
        onChangeText={set('name')}
        placeholder="Reception, Mehendi, Wedding ceremony"
      />
      {/* A wedding is planned, not recorded: the day being added has not
          happened yet. */}
      <WowCalendar label="Day" value={form.eventDate} onChange={set('eventDate')} minimumDate={todayIso()} />
      <TimeField label="Starts" value={form.startTime} onChange={set('startTime')} />
      <Field label="Venue" value={form.venue} onChangeText={set('venue')} />
      <Field label="City" value={form.city} onChangeText={set('city')} />
      <Field
        label="Guests expected"
        value={form.expectedGuests}
        onChangeText={set('expectedGuests')}
        keyboardType="number-pad"
        maxLength={5}
      />
      <View style={{ gap: space(2) }}>
        <Button
          label={event ? 'Save changes' : 'Add the event'}
          busy={create.isPending}
          disabled={!form.name.trim()}
          onPress={() => create.mutate()}
        />
        <Button label="Cancel" variant="outline" onPress={onCancel} />
      </View>
    </Card>
  );
}
