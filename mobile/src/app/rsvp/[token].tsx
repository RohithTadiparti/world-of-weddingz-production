import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarBlank, CheckCircle, EnvelopeSimpleOpen, MapPin, Users, XCircle } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { hhmm, shortDate } from '@/lib/format';
import type { RsvpStatus } from '@/lib/rsvp';
import { Textarea } from '@/components/form';
import { Alert, Body, Button, Caption, Card, EmptyState, Field, Loading, Screen } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

interface WeddingEvent {
  name: string;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  venueAddress: string | null;
  city: string | null;
}

interface RsvpView {
  /** 'wedding' for the one invitation to the events this guest is asked to; absent on an older per-event link. */
  kind?: 'wedding';
  coupleNames?: string | null;
  events?: WeddingEvent[];
  guestName: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  status: RsvpStatus;
  respondedAt: string | null;
  attendingCount: number | null;
  declineReason: string | null;
  invitedPartySize: number | null;
}

function when(e: WeddingEvent): string {
  if (!e.eventDate) return 'Date to be announced';
  const time = e.startTime ? ` · ${hhmm(e.startTime)}${e.endTime ? `–${hhmm(e.endTime)}` : ''}` : '';
  return `${shortDate(e.eventDate)}${time}`;
}

const statusOf = (err: unknown) => (err as { response?: { status?: number } })?.response?.status;

/**
 * The invitation a guest opens from their personal link.
 *
 * Public: guests are not platform users, and the server identifies the one
 * invite from the token alone (`GET`/`PUT /events/rsvp/:token`).
 */
export default function GuestRsvp() {
  const theme = useTheme();
  const qc = useQueryClient();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [declining, setDeclining] = useState(false);
  const [changing, setChanging] = useState(false);
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const invitation = useQuery({
    queryKey: ['rsvp', token],
    queryFn: async () => (await api.get(`/events/rsvp/${encodeURIComponent(token)}`)).data as RsvpView,
    retry: false,
  });

  const respond = useMutation({
    mutationFn: async (body: { status: RsvpStatus; attendingCount?: number; declineReason?: string }) =>
      (await api.put(`/events/rsvp/${encodeURIComponent(token)}`, body)).data as RsvpView,
    onSuccess: (view) => {
      qc.setQueryData(['rsvp', token], view);
      setError('');
      setDeclining(false);
      setChanging(false);
    },
    onError: (err) =>
      setError(
        statusOf(err) === 400 || statusOf(err) === 404
          ? 'This invitation link is no longer valid. Ask your hosts for a new one.'
          : 'Your reply could not be sent. Check your connection and try again.',
      ),
  });

  if (invitation.isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (invitation.error || !invitation.data) {
    const code = statusOf(invitation.error);
    return (
      <Screen>
        <EmptyState
          title={
            code === 400 ? 'This invitation has expired' : code === 404 ? 'Invitation not found' : 'Invitation unavailable'
          }
        >
          {code === 400
            ? 'Ask your hosts to send you a new link.'
            : code === 404
              ? 'This link is not valid, or your hosts have sent you a newer one.'
              : 'We could not load your invitation. Check your connection and try again.'}
        </EmptyState>
        {code !== 400 && code !== 404 ? (
          <Button label="Try Again" variant="outline" onPress={() => void invitation.refetch()} />
        ) : null}
      </Screen>
    );
  }

  const view = invitation.data;
  const answered = view.status === 'attending' || view.status === 'declined';
  const party = view.invitedPartySize ?? 1;
  const attending = Number(count || party);

  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(6) }}>
        <View
          style={{
            width: 64,
            height: 64,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: rgb(theme.brandSoft),
          }}
        >
          <EnvelopeSimpleOpen size={32} color={rgb(theme.brand)} />
        </View>
        <Caption tone="brand" style={{ fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {"You're Invited"}
        </Caption>
        <Body style={{ fontSize: 26, lineHeight: 32, fontWeight: '700', color: rgb(theme.brandStrong), textAlign: 'center' }}>
          {view.eventName}
        </Body>
        <Caption tone="muted" style={{ textAlign: 'center' }}>
          {view.kind === 'wedding'
            ? `Dear ${view.guestName}, we would love you to join us for all our wedding celebrations.`
            : `Dear ${view.guestName}`}
        </Caption>
      </Card>

      {view.kind === 'wedding' ? (
        <Card style={{ gap: space(3) }}>
          <Body style={{ fontWeight: '700', color: rgb(theme.brandStrong) }}>Wedding Events</Body>
          {(view.events ?? []).length === 0 ? (
            <Caption tone="muted">Your hosts will share the event details soon.</Caption>
          ) : (
            view.events!.map((e, i) => {
              const place = [e.venue, e.venueAddress, e.city].filter(Boolean).join(', ');
              return (
                <View
                  key={`${e.name}-${i}`}
                  style={{
                    gap: space(1),
                    paddingTop: i ? space(3) : 0,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: rgb(theme.border),
                  }}
                >
                  <Body style={{ fontWeight: '600' }}>{e.name}</Body>
                  <Detail icon={<CalendarBlank size={18} color={rgb(theme.brand)} />} text={when(e)} />
                  {place ? <Detail icon={<MapPin size={18} color={rgb(theme.brand)} />} text={place} /> : null}
                </View>
              );
            })
          )}
        </Card>
      ) : (
        <Card style={{ gap: space(3) }}>
          <Detail icon={<CalendarBlank size={20} color={rgb(theme.brand)} />} text={shortDate(view.eventDate)} />
          {view.venue ? <Detail icon={<MapPin size={20} color={rgb(theme.brand)} />} text={view.venue} /> : null}
        </Card>
      )}

      <Card>
        <Detail
          icon={<Users size={20} color={rgb(theme.brand)} />}
          text={party > 1 ? `Invitation for ${party} people` : 'Invitation for 1 person'}
        />
      </Card>

      {error ? <Alert tone="critical">{error}</Alert> : null}

      {answered && !changing ? (
        <Card style={{ alignItems: 'center', gap: space(2), paddingVertical: space(5) }}>
          {view.status === 'attending' ? (
            <CheckCircle size={40} weight="fill" color={rgb(theme.positiveFg)} />
          ) : (
            <XCircle size={40} weight="fill" color={rgb(theme.criticalFg)} />
          )}
          <Body style={{ fontSize: 20, fontWeight: '700' }}>
            {view.status === 'attending' ? 'Invitation Accepted' : 'Invitation Declined'}
          </Body>
          <Caption tone="muted" style={{ textAlign: 'center' }}>
            {view.status === 'attending'
              ? `Thank you! We look forward to celebrating with you${view.attendingCount && view.attendingCount > 1 ? ` — all ${view.attendingCount} of you` : ''}.`
              : 'Thank you for letting us know.'}
          </Caption>
          <Button small variant="ghost" label="Change My Reply" onPress={() => setChanging(true)} />
        </Card>
      ) : declining ? (
        <Card style={{ gap: space(3) }}>
          <Textarea
            label="Reason (optional)"
            value={reason}
            onChange={setReason}
            maxLength={500}
            rows={3}
            placeholder="Only if you would like to tell your hosts"
          />
          <Button
            label="Decline Invitation"
            busy={respond.isPending}
            onPress={() => respond.mutate({ status: 'declined', ...(reason.trim() ? { declineReason: reason.trim() } : {}) })}
          />
          <Button label="Back" variant="outline" disabled={respond.isPending} onPress={() => setDeclining(false)} />
        </Card>
      ) : (
        <View style={{ gap: space(3) }}>
          {party > 1 ? (
            <Field
              label="How many of you are coming?"
              value={count}
              onChangeText={(v) => setCount(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              placeholder={String(party)}
              error={attending < 1 || attending > party ? `Between 1 and ${party}` : undefined}
            />
          ) : null}
          <Button
            label="Accept Invitation"
            busy={respond.isPending}
            disabled={attending < 1 || attending > party}
            onPress={() => respond.mutate({ status: 'attending', attendingCount: attending })}
          />
          <Button label="Decline Invitation" variant="outline" disabled={respond.isPending} onPress={() => setDeclining(true)} />
        </View>
      )}
    </Screen>
  );
}

function Detail({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      {icon}
      <Body style={{ flex: 1 }}>{text}</Body>
    </View>
  );
}
