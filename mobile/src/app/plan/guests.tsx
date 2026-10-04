import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert as NativeAlert, Linking, Pressable, Share, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import {
  Copy,
  DotsThreeVertical,
  EnvelopeSimple,
  MagnifyingGlass,
  Minus,
  PaperPlaneTilt,
  Phone,
  Plus,
  ShareNetwork,
  WhatsappLogo,
} from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { rsvpBadge, rsvpLink, whatsappUrl, type RsvpStatus } from '@/lib/rsvp';
import { Badge, FilterChips } from '@/components/chrome';
import { CheckRow, Textarea } from '@/components/form';
import { Alert, Body, Button, Caption, Card, EmptyState, Field, Loading, Screen } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type RelationFilter = 'all' | 'family' | 'friends' | 'work' | 'others';

/** A row of `GET /events/guests`, carrying the guest's one wedding invitation. */
interface Guest {
  id: string;
  name: string;
  contact?: string | null;
  phone?: string | null;
  partySize?: number | null;
  relation?: string | null;
  notes?: string | null;
  /** Null until the wedding invitation is sent. */
  rsvpStatus?: RsvpStatus | null;
  respondedAt?: string | null;
  attendingCount?: number | null;
  declineReason?: string | null;
  /** The events this guest is invited to: what their wedding invitation covers. */
  invitedEventIds?: string[];
}

/** A row of `GET /events`, as much as choosing what an invitation covers needs. */
interface WeddingEventRow {
  id: string;
  name: string;
  eventDate?: string | null;
  status?: string | null;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'form'; guest?: Guest }
  | { kind: 'choose'; guest: Guest }
  | { kind: 'sent'; guest: Guest; link: string };

const RELATION_CHIPS: { key: RelationFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'family', label: 'Family' },
  { key: 'friends', label: 'Friends' },
  { key: 'work', label: 'Work' },
  { key: 'others', label: 'Others' },
];

function bucketRelation(relation: string | null | undefined): Exclude<RelationFilter, 'all'> {
  const value = (relation ?? '').toLowerCase();
  if (!value) return 'others';
  if (/(family|uncle|aunt|cousin|parent|mother|father|brother|sister|in-law|relative)/.test(value)) {
    return 'family';
  }
  if (/(friend|college|school)/.test(value)) return 'friends';
  if (/(work|office|colleague|boss|client)/.test(value)) return 'work';
  return 'others';
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** What the invitation itself has done, from the fields the server keeps. */
function invitationLine(guest: Guest): string {
  if (!guest.rsvpStatus) return 'Invitation not sent';
  if (guest.rsvpStatus === 'attending') {
    return `Accepted ${shortDate(guest.respondedAt)}${guest.attendingCount ? ` · ${guest.attendingCount} attending` : ''}`;
  }
  if (guest.rsvpStatus === 'declined') {
    return `Declined ${shortDate(guest.respondedAt)}${guest.declineReason ? ` · "${guest.declineReason}"` : ''}`;
  }
  if (guest.rsvpStatus === 'maybe') return `Replied maybe ${shortDate(guest.respondedAt)}`;
  return 'Invitation sent · not yet answered';
}

export default function PlanGuests() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RelationFilter>('all');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const guests = useQuery({
    queryKey: ['guests'],
    queryFn: async () => (await api.get('/events/guests')).data as Guest[],
    // Replies arrive from guests' own links, not from this screen.
    refetchInterval: 20_000,
    retry: false,
  });
  // One invitation covers the events the host picks for that guest; there must
  // be at least one to pick.
  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events')).data,
    retry: false,
  });
  const eventRows = useMemo(
    () =>
      ((Array.isArray(events.data) ? events.data : (events.data?.data ?? [])) as WeddingEventRow[]).filter(
        (e) => e.status !== 'cancelled',
      ),
    [events.data],
  );
  const hasEvents = eventRows.length > 0;

  const refreshGuests = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['guests'] }),
        qc.invalidateQueries({ queryKey: ['guest-list'] }),
        qc.invalidateQueries({ queryKey: ['rsvp-guests'] }),
        qc.invalidateQueries({ queryKey: ['wedding-dashboard'] }),
      ]),
    [qc],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshGuests();
    }, [refreshGuests]),
  );

  const invite = useMutation({
    mutationFn: async ({ guest, eventIds }: { guest: Guest; eventIds: string[] }) =>
      (await api.post(`/events/guests/${guest.id}/invite`, { eventIds })).data as { rsvpUrl: string },
    onSuccess: async (data, { guest }) => {
      setError('');
      setMode({ kind: 'sent', guest, link: rsvpLink(data.rsvpUrl) });
      await refreshGuests();
    },
    onError: (err) => {
      setMode({ kind: 'list' });
      setError(apiMessage(err, 'The invitation could not be created.'));
    },
  });

  const override = useMutation({
    mutationFn: async ({ guestId, status }: { guestId: string; status: RsvpStatus }) =>
      api.put(`/events/guests/${guestId}/rsvp`, { status }),
    onSuccess: async () => {
      setError('');
      await refreshGuests();
    },
    onError: (err) => setError(apiMessage(err, 'That reply could not be recorded.')),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (guests.data ?? []).filter((guest) => {
      if (filter !== 'all' && bucketRelation(guest.relation) !== filter) return false;
      if (!q) return true;
      return (
        guest.name.toLowerCase().includes(q) ||
        (guest.relation ?? '').toLowerCase().includes(q) ||
        (guest.phone ?? '').includes(q) ||
        (guest.contact ?? '').toLowerCase().includes(q)
      );
    });
  }, [guests.data, search, filter]);

  if (mode.kind === 'form') {
    return (
      <GuestForm
        guest={mode.guest}
        canInvite={hasEvents && !mode.guest?.rsvpStatus}
        onCancel={() => setMode({ kind: 'list' })}
        onSaved={async (guest, send) => {
          await refreshGuests();
          if (send) setMode({ kind: 'choose', guest: { ...mode.guest, ...guest } });
          else {
            setNotice(mode.guest ? 'Guest updated.' : 'Guest added.');
            setMode({ kind: 'list' });
          }
        }}
      />
    );
  }

  if (mode.kind === 'choose') {
    return (
      <ChooseEvents
        guest={mode.guest}
        events={eventRows}
        busy={invite.isPending}
        onCancel={() => setMode({ kind: 'list' })}
        onSend={(eventIds) => invite.mutate({ guest: mode.guest, eventIds })}
      />
    );
  }

  if (mode.kind === 'sent') {
    return <InvitationSent {...mode} onDone={() => setMode({ kind: 'list' })} />;
  }

  const all = guests.data ?? [];
  const onList = all.length;
  const count = (status: RsvpStatus | null) => all.filter((g) => (g.rsvpStatus ?? null) === status).length;
  const notInvited = count(null);
  const maybe = count('maybe');

  return (
    <Screen onRefresh={() => void refreshGuests()} refreshing={guests.isRefetching}>
      <Caption tone="muted">
        Manage your wedding guests. Each guest gets one invitation covering the events you choose for them.
      </Caption>
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {!events.isPending && !hasEvents ? (
        <Card style={{ gap: space(2) }}>
          <Body style={{ fontWeight: '600' }}>Add your wedding events to send invitations</Body>
          <Caption tone="muted">
            The invitation lists the events you invite each guest to, with their date, time and venue.
          </Caption>
          <Button small variant="outline" label="Go to Events" onPress={() => router.push('/events')} />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <StatBox label="Total" value={onList} tone="brand" />
        <StatBox label="Confirmed" value={count('attending')} tone="positive" />
        <StatBox label="Pending" value={count('invited')} tone="caution" />
        <StatBox label="Declined" value={count('declined')} tone="critical" />
      </View>
      {notInvited > 0 || maybe > 0 ? (
        <Caption tone="muted">
          {[notInvited > 0 ? `${notInvited} not invited yet` : null, maybe ? `${maybe} maybe` : null]
            .filter(Boolean)
            .join(' · ')}
        </Caption>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.md,
          paddingLeft: space(3),
          borderWidth: 1,
          borderColor: rgb(theme.border),
        }}
      >
        <MagnifyingGlass size={18} color={rgb(theme.brand)} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search guests by name, phone or email"
          placeholderTextColor={rgb(theme.ink[400])}
          style={{ flex: 1, padding: space(3), color: rgb(theme.ink[900]) }}
        />
      </View>

      <FilterChips
        options={RELATION_CHIPS.map((chip) => ({
          key: chip.key,
          label: chip.label,
          count:
            chip.key === 'all'
              ? onList
              : (guests.data ?? []).filter((g) => bucketRelation(g.relation) === chip.key).length,
        }))}
        value={filter}
        onChange={(key) => setFilter((key as RelationFilter | null) ?? 'all')}
      />

      {guests.isPending ? (
        <Loading rows={3} />
      ) : guests.error ? (
        <Alert tone="critical">{apiMessage(guests.error, 'Guests could not be loaded.')}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={onList ? 'No guests match' : 'No guests yet'}>
          {onList ? 'Try another search or filter.' : 'Add family and friends to start your list.'}
        </EmptyState>
      ) : (
        rows.map((guest) => {
          const status = rsvpBadge(guest.rsvpStatus ?? undefined);
          const sending = invite.isPending && invite.variables?.guest.id === guest.id;
          return (
            <Card key={guest.id} style={{ gap: space(3) }}>
              <View style={{ flexDirection: 'row', gap: space(3) }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: rgb(theme.brandSoft),
                  }}
                >
                  <Body style={{ fontWeight: '700', color: rgb(theme.brandStrong) }}>{initials(guest.name)}</Body>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Body style={{ fontWeight: '600' }}>{guest.name}</Body>
                  <Caption tone="muted">
                    {[guest.relation || 'Guest', guest.partySize && guest.partySize > 1 ? `Party of ${guest.partySize}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Caption>
                  {guest.phone ? <Contact icon="phone" text={guest.phone} /> : null}
                  {guest.contact ? <Contact icon="email" text={guest.contact} /> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: space(1) }}>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {guest.rsvpStatus ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`More actions for ${guest.name}`}
                      hitSlop={8}
                      onPress={() =>
                        NativeAlert.alert(guest.name, 'Record a reply they gave you in person or by phone.', [
                          { text: 'Mark as Confirmed', onPress: () => override.mutate({ guestId: guest.id, status: 'attending' }) },
                          { text: 'Mark as Declined', onPress: () => override.mutate({ guestId: guest.id, status: 'declined' }) },
                          { text: 'Cancel', style: 'cancel' },
                        ])
                      }
                    >
                      <DotsThreeVertical size={20} weight="bold" color={rgb(theme.ink[500])} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {guest.notes ? <Caption tone="muted">{`Note: ${guest.notes}`}</Caption> : null}
              <Caption tone="faint">{hasEvents ? invitationLine(guest) : 'Add an event to invite'}</Caption>
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button
                  style={{ flex: 1 }}
                  small
                  variant="outline"
                  label="Edit"
                  onPress={() => {
                    setNotice('');
                    setMode({ kind: 'form', guest });
                  }}
                />
                {hasEvents ? (
                  <Button
                    style={{ flex: 2 }}
                    small
                    label={
                      !guest.rsvpStatus
                        ? 'Send Invitation'
                        : guest.rsvpStatus === 'invited'
                          ? 'Resend Invitation'
                          : 'Send New Link'
                    }
                    busy={sending}
                    disabled={invite.isPending && !sending}
                    onPress={() => {
                      setNotice('');
                      setMode({ kind: 'choose', guest });
                    }}
                  />
                ) : null}
              </View>
            </Card>
          );
        })
      )}

      <Button
        label="Add Guest"
        onPress={() => {
          setNotice('');
          setMode({ kind: 'form' });
        }}
      />
    </Screen>
  );
}

function Contact({ icon, text }: { icon: 'phone' | 'email'; text: string }) {
  const theme = useTheme();
  const Glyph = icon === 'phone' ? Phone : EnvelopeSimple;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
      <Glyph size={12} color={rgb(theme.ink[500])} />
      <Caption tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Caption>
    </View>
  );
}

const RELATION_PICKS = ['Family', 'Friends', 'Work'];

function GuestForm({
  guest,
  canInvite,
  onCancel,
  onSaved,
}: {
  guest?: Guest;
  canInvite: boolean;
  onCancel: () => void;
  onSaved: (guest: Guest, send: boolean) => void | Promise<void>;
}) {
  const theme = useTheme();
  const [name, setName] = useState(guest?.name ?? '');
  const [phone, setPhone] = useState((guest?.phone ?? '').replace(/^\+91/, ''));
  const [email, setEmail] = useState(guest?.contact ?? '');
  const [relation, setRelation] = useState(guest?.relation ?? '');
  const [partySize, setPartySize] = useState(guest?.partySize ?? 1);
  const [notes, setNotes] = useState(guest?.notes ?? '');
  const [send, setSend] = useState(!guest && canInvite);
  const [error, setError] = useState('');

  const digits = phone.replace(/\D/g, '');
  const phoneError = digits && !/^[6-9]\d{9}$/.test(digits) ? 'Enter a 10-digit Indian mobile number' : undefined;
  const emailError = email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Enter a valid email address' : undefined;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        phone: digits || null,
        contact: email.trim() || null,
        relation: relation.trim() || null,
        partySize,
        notes: notes.trim() || null,
      };
      return (guest ? await api.put(`/events/guests/${guest.id}`, body) : await api.post('/events/guests', body))
        .data as Guest;
    },
    onSuccess: (saved) => onSaved(saved, send && canInvite),
    onError: (err) => setError(apiMessage(err, 'That guest could not be saved.')),
  });

  return (
    <Screen>
      <Body style={{ fontSize: 20, fontWeight: '700', color: rgb(theme.brandStrong) }}>
        {guest ? 'Edit Guest' : 'Add Guest'}
      </Body>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Field label="Full Name *" value={name} onChangeText={setName} placeholder="Guest name" maxLength={120} />
      <Field
        label="Phone Number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="10-digit mobile number"
        error={phoneError}
      />
      <Field
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="name@example.com"
        maxLength={120}
        error={emailError}
      />
      <View style={{ gap: space(2) }}>
        <Field
          label="Relation"
          value={relation}
          onChangeText={setRelation}
          placeholder="Family, Friends, Work, Bride's uncle…"
          maxLength={60}
        />
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          {RELATION_PICKS.map((pick) => (
            <Button
              key={pick}
              small
              variant={relation === pick ? 'primary' : 'outline'}
              label={pick}
              onPress={() => setRelation(pick)}
            />
          ))}
        </View>
      </View>
      <View style={{ gap: space(1) }}>
        <Caption style={{ fontWeight: '600', color: rgb(theme.ink[800]) }}>Number of Guests</Caption>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <Stepper icon="minus" disabled={partySize <= 1} onPress={() => setPartySize((n) => n - 1)} />
          <Body style={{ minWidth: 32, textAlign: 'center', fontWeight: '700' }}>{partySize}</Body>
          <Stepper icon="plus" disabled={partySize >= 100} onPress={() => setPartySize((n) => n + 1)} />
        </View>
      </View>
      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={setNotes}
        rows={3}
        maxLength={1000}
        placeholder="Dietary needs, travel, seating… Only you see this."
      />
      {canInvite ? (
        <Card style={{ backgroundColor: rgb(theme.brandSoft) }}>
          <CheckRow
            label="Send RSVP link to this guest"
            hint="One personal link for the wedding. You choose which events it covers next."
            checked={send}
            onChange={setSend}
          />
        </Card>
      ) : null}
      <Button
        label={send && canInvite ? 'Save & Send Invitation' : guest ? 'Save Changes' : 'Save Guest'}
        busy={save.isPending}
        disabled={!name.trim() || Boolean(phoneError) || Boolean(emailError)}
        onPress={() => save.mutate()}
      />
      <Button label="Cancel" variant="outline" disabled={save.isPending} onPress={onCancel} />
    </Screen>
  );
}

/**
 * Which events this guest's invitation covers.
 *
 * Chosen per guest rather than every event by default: a reception-only guest
 * must not be shown the time and address of a private family function. Starts
 * from the events the guest is already invited to.
 */
function ChooseEvents({
  guest,
  events,
  busy,
  onCancel,
  onSend,
}: {
  guest: Guest;
  events: WeddingEventRow[];
  busy: boolean;
  onCancel: () => void;
  onSend: (eventIds: string[]) => void;
}) {
  const theme = useTheme();
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set((guest.invitedEventIds ?? []).filter((id) => events.some((e) => e.id === id))),
  );
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Screen>
      <Body style={{ fontSize: 20, fontWeight: '700', color: rgb(theme.brandStrong) }}>
        {`Invite ${guest.name} to`}
      </Body>
      <Caption tone="muted">
        Their invitation shows only the events you tick here, with the date, time and venue of each.
      </Caption>
      <Card style={{ gap: space(2) }}>
        {events.map((event) => (
          <CheckRow
            key={event.id}
            label={event.name}
            hint={event.eventDate ? shortDate(event.eventDate) : 'Date to be announced'}
            checked={chosen.has(event.id)}
            onChange={(on) => toggle(event.id, on)}
          />
        ))}
      </Card>
      <Button
        label={chosen.size === 0 ? 'Choose at least one event' : 'Send Invitation'}
        busy={busy}
        disabled={chosen.size === 0}
        onPress={() => onSend([...chosen])}
      />
      <Button label="Cancel" variant="outline" disabled={busy} onPress={onCancel} />
    </Screen>
  );
}

function Stepper({ icon, disabled, onPress }: { icon: 'minus' | 'plus'; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const Glyph = icon === 'minus' ? Minus : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === 'minus' ? 'Fewer guests' : 'More guests'}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: rgb(theme.border),
        backgroundColor: rgb(theme.surface),
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Glyph size={18} color={rgb(theme.brand)} />
    </Pressable>
  );
}

function InvitationSent({ guest, link, onDone }: { guest: Guest; link: string; onDone: () => void }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const message = `${guest.name}, you are invited to our wedding. See the events you are invited to and let us know if you can join us: ${link}`;

  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(6) }}>
        <View
          style={{
            width: 72,
            height: 72,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: rgb(theme.brandSoft),
          }}
        >
          <PaperPlaneTilt size={34} color={rgb(theme.brand)} />
        </View>
        <Body style={{ fontSize: 20, fontWeight: '700' }}>Invitation link created</Body>
        <Caption tone="muted" style={{ textAlign: 'center' }}>
          {`A unique RSVP link for the wedding, covering the events you chose, has been created for ${guest.name}.`}
          {guest.contact?.includes('@') ? ` It has also been emailed to ${guest.contact}.` : ''}
        </Caption>
      </Card>

      <Card style={{ gap: space(2) }}>
        <Caption style={{ fontWeight: '600', color: rgb(theme.ink[800]) }}>RSVP Link</Caption>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy link"
          onPress={async () => {
            await Clipboard.setStringAsync(link);
            setCopied(true);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(2),
            padding: space(3),
            borderWidth: 1,
            borderColor: rgb(theme.border),
            backgroundColor: rgb(theme.surfaceSunken),
          }}
        >
          <Caption numberOfLines={1} style={{ flex: 1 }}>
            {link}
          </Caption>
          <Copy size={18} color={rgb(theme.brand)} />
        </Pressable>
      </Card>

      <ShareRow
        icon={<WhatsappLogo size={22} color={rgb(theme.positiveFg)} />}
        label="Share via WhatsApp"
        onPress={() => void Linking.openURL(whatsappUrl(message, guest.phone))}
      />
      <ShareRow
        icon={<ShareNetwork size={22} color={rgb(theme.brand)} />}
        label="Share via Other Apps"
        onPress={() => void Share.share({ message })}
      />
      <ShareRow
        icon={<Copy size={22} color={rgb(theme.brand)} />}
        label={copied ? 'Link Copied' : 'Copy Link'}
        onPress={async () => {
          await Clipboard.setStringAsync(link);
          setCopied(true);
        }}
      />

      <Caption tone="muted">
        {`This link is only for ${guest.name}. When they respond, their status updates automatically. Sending a new link replaces this one.`}
      </Caption>

      <Button label="Done" onPress={onDone} />
    </Screen>
  );
}

function ShareRow({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {({ pressed }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), opacity: pressed ? 0.7 : 1 }}>
          {icon}
          <Body style={{ fontWeight: '600' }}>{label}</Body>
        </Card>
      )}
    </Pressable>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'brand' | 'positive' | 'caution' | 'critical';
}) {
  const theme = useTheme();
  const bg =
    tone === 'positive'
      ? theme.positiveBg
      : tone === 'caution'
        ? theme.cautionBg
        : tone === 'critical'
          ? theme.criticalBg
          : theme.brandSoft;
  const fg =
    tone === 'positive'
      ? theme.positiveFg
      : tone === 'caution'
        ? theme.cautionFg
        : tone === 'critical'
          ? theme.criticalFg
          : theme.brandStrong;
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: space(3),
        paddingHorizontal: space(2),
        borderRadius: radius.md,
        backgroundColor: rgb(bg),
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Caption style={{ color: rgb(fg) }} numberOfLines={1}>
        {label}
      </Caption>
      <Body style={{ fontWeight: '700', fontSize: 22, color: rgb(fg) }}>{value}</Body>
    </View>
  );
}
