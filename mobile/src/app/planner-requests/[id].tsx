import { useCallback, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CalendarBlank,
  CheckCircle,
  ClipboardText,
  CurrencyInr,
  EnvelopeSimple,
  FileText,
  Heart,
  ImageSquare,
  MapPin,
  NotePencil,
  Users,
  X,
  XCircle,
} from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import {
  budgetRange,
  guestRange,
  requestActions,
  serviceLabel,
  type PlannerRequestDetail,
} from '@/lib/planner-requests';
import { formatDate, formatDateTime } from '@/shared/dates';
import { Divider } from '@/components/chrome';
import { BookingChat } from '@/components/bookings/chat';
import { QuotationForm } from '@/components/bookings/quotation';
import {
  AvailabilityPill,
  Avatar,
  Lightbox,
  StatusBadge,
  StatusTrail,
} from '@/components/planner-requests/parts';
import { PromptSheet } from '@/components/prompt';
import { reachable } from '@/components/uploader';
import { Alert, Body, Button, Caption, Card, EmptyState, Loading, Screen, SectionTitle } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

type DetailTab = 'details' | 'conversation' | 'activity';

const QUOTE_STAGE: Record<NonNullable<PlannerRequestDetail['quotation']>['stage'], string> = {
  sent: 'Waiting on the couple',
  requoted: 'Revised offer waiting on the couple',
  accepted: 'Accepted by the couple',
  declined: 'Declined — the couple asked for a new price',
  withdrawn: 'Withdrawn by you',
  expired: 'Expired before the couple answered',
  superseded: 'Replaced by a newer offer',
};

/**
 * One planner request in full, after the web client's request detail.
 *
 * Who is asking, the wedding they described, the services they ticked and the
 * photos they sent; then the three things a planner can do about it, offered
 * by `requestActions` so the phone and the site never disagree about what is
 * possible. Accepting does not set a price — the quotation does — so the
 * quotation form opens straight after. The couple's phone number is absent on
 * purpose: the API does not send it.
 */
export default function PlannerRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<DetailTab>('details');
  const [quoting, setQuoting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'positive' | 'critical'; text: string } | null>(null);

  const detail = useQuery({
    queryKey: ['planner-request', id],
    queryFn: async () => (await api.get(`/bookings/planner-requests/${id}`)).data as PlannerRequestDetail,
    enabled: Boolean(id),
    retry: false,
  });

  const refresh = useCallback(() => {
    for (const key of ['planner-request', 'planner-requests', 'planner-clients', 'planner-clients-summary']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
    void qc.invalidateQueries({ queryKey: ['booking-history', id] });
  }, [qc, id]);

  const accept = useMutation({
    mutationFn: async () =>
      (await api.put(`/bookings/planner-requests/${id}/accept`)).data as PlannerRequestDetail,
    onSuccess: (data) => {
      qc.setQueryData(['planner-request', id], data);
      refresh();
      setNotice({
        tone: 'positive',
        text: 'Request accepted. Send your quotation next so the couple can see your price.',
      });
      // The next step is the price, so it opens straight away.
      setQuoting(true);
    },
    onError: (err) => setNotice({ tone: 'critical', text: apiMessage(err, 'Could not accept it.') }),
  });

  const decline = useMutation({
    mutationFn: async (reason: string) =>
      api.put(`/bookings/${id}/cancel`, { reason: reason || undefined }),
    onSuccess: () => {
      setDeclining(false);
      refresh();
      setNotice({ tone: 'positive', text: 'Request declined. The couple has been told.' });
    },
    onError: (err) => {
      setDeclining(false);
      setNotice({ tone: 'critical', text: apiMessage(err, 'Could not decline it.') });
    },
  });

  if (detail.isLoading) {
    return (
      <Screen>
        <Loading rows={5} />
      </Screen>
    );
  }
  const r = detail.data;
  if (detail.isError || !r) {
    return (
      <Screen>
        <EmptyState title="Request not found">
          {apiMessage(detail.error, 'This request is not on your listing, or it no longer exists.')}
        </EmptyState>
        <Button label="Back to requests" variant="outline" onPress={() => router.back()} />
      </Screen>
    );
  }

  const actions = requestActions(r);
  const anyAction = actions.accept || Boolean(actions.quote) || actions.decline;

  return (
    <Screen onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
      <ClientHeader r={r} />
      <StatusTrail status={r.status} />

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Segments
        value={tab}
        onChange={setTab}
        options={[
          ['details', 'Request Details'],
          ['conversation', 'Conversation'],
          ['activity', 'Activity'],
        ]}
      />

      {tab === 'details' ? <Details r={r} /> : null}
      {tab === 'conversation' ? (
        <Card>
          <BookingChat bookingId={r.id} label="Message the couple" />
        </Card>
      ) : null}
      {tab === 'activity' ? <Activity bookingId={r.id} /> : null}

      {anyAction ? (
        <Card>
          <Row icon={ClipboardText} title="Request Actions" />
          <ActionButton
            tone="positive"
            icon={CheckCircle}
            title={r.status === 'new' ? 'Accept Request' : 'Accepted'}
            hint={r.status === 'new' ? 'Take it on, then quote' : 'You have taken this on'}
            disabled={!actions.accept}
            busy={accept.isPending}
            onPress={() => accept.mutate()}
          />
          <ActionButton
            tone="brand"
            icon={FileText}
            title={actions.quote === 'revise' ? 'Send Revised Quotation' : 'Send Quotation'}
            hint={
              r.status === 'requote_requested'
                ? 'The couple asked for a new price'
                : actions.quote === 'revise'
                  ? 'Replaces the offer they have'
                  : 'Send package and pricing'
            }
            disabled={!actions.quote}
            onPress={() => setQuoting(true)}
          />
          <ActionButton
            tone="critical"
            icon={XCircle}
            title="Decline Request"
            hint="Close this request"
            disabled={!actions.decline}
            busy={decline.isPending}
            onPress={() => setDeclining(true)}
          />
        </Card>
      ) : (
        <ClosedNote r={r} />
      )}

      <QuoteModal
        visible={quoting}
        r={r}
        revise={actions.quote === 'revise'}
        onClose={() => setQuoting(false)}
        onDone={() => {
          setQuoting(false);
          refresh();
          setNotice({
            tone: 'positive',
            text: 'Quotation sent. The couple can accept it or ask for a new price.',
          });
        }}
      />

      <PromptSheet
        visible={declining}
        title="Decline this request?"
        message={`${r.client.name ?? 'The couple'} will be told you cannot take their wedding on. This cannot be undone. A reason is optional and shown to the couple.`}
        placeholder="For example: already booked on that date"
        confirmLabel={decline.isPending ? 'Declining…' : 'Decline request'}
        onCancel={() => setDeclining(false)}
        onConfirm={(reason) => decline.mutate(reason.slice(0, 500))}
      />
    </Screen>
  );
}

// ------------------------------------------------------------------ header --

function ClientHeader({ r }: { r: PlannerRequestDetail }) {
  const theme = useTheme();
  return (
    <Card>
      <Caption tone="faint" style={{ fontVariant: ['tabular-nums'] }}>
        Request #{r.requestNumber}
      </Caption>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <Avatar name={r.client.name} photo={r.client.photo} size={72} />
        <View style={{ flex: 1, minWidth: 0, gap: space(1.5) }}>
          <Txt serif style={{ fontSize: 26, lineHeight: 30, color: rgb(theme.ink[900]) }}>
            {r.client.name ?? 'A couple'}
          </Txt>
          <View style={{ flexDirection: 'row' }}>
            <StatusBadge status={r.status} />
          </View>
        </View>
      </View>
      <View style={{ gap: space(1.5) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <MapPin size={16} color={rgb(theme.brand)} />
          <Body>{r.client.city ?? r.location ?? 'City not shared'}</Body>
        </View>
        {r.client.email ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Email ${r.client.email}`}
            onPress={() => void Linking.openURL(`mailto:${r.client.email}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}
          >
            <EnvelopeSimple size={16} color={rgb(theme.brand)} />
            <Body numberOfLines={1} style={{ flexShrink: 1, textDecorationLine: 'underline' }}>
              {r.client.email}
            </Body>
          </Pressable>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: rgba(theme.brandSoft, 0.8),
          borderRadius: radius.md,
          paddingHorizontal: space(3),
          paddingVertical: space(2.5),
          gap: space(0.5),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
          <CalendarBlank size={16} color={rgb(theme.brandStrong)} />
          <Caption tone="brand" style={{ fontWeight: '600' }}>
            Request received
          </Caption>
        </View>
        <Body>{formatDateTime(r.receivedAt)}</Body>
        {r.acceptedAt ? <Caption tone="faint">Accepted {formatDateTime(r.acceptedAt)}</Caption> : null}
      </View>
    </Card>
  );
}

// ----------------------------------------------------------------- details --

function Details({ r }: { r: PlannerRequestDetail }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [viewing, setViewing] = useState<number | null>(null);
  // Three to a row inside the card's padding and the screen's.
  const thumb = Math.floor((width - space(8) - space(6) - space(4)) / 3);

  return (
    <>
      <Card>
        <Row icon={Heart} title="Wedding Details" />
        <Fact label="Preferred wedding date" icon={CalendarBlank}>
          <Body>{formatDate(r.weddingDate, 'Not set')}</Body>
          <AvailabilityPill availability={r.availability} />
        </Fact>
        <Fact label="Wedding location" icon={MapPin}>
          <Body>{r.location ?? 'Not shared'}</Body>
        </Fact>
        <Divider />
        <Fact label="Expected guest count" icon={Users}>
          <Body>{guestRange(r.guestCountMin, r.guestCountMax)}</Body>
        </Fact>
        <Fact label="Budget range" icon={CurrencyInr}>
          <Body>{budgetRange(r.budgetMin, r.budgetMax)}</Body>
        </Fact>
        <Fact label="Wedding type" icon={Heart}>
          <Body>{r.weddingType ? `${r.weddingType} wedding` : 'Not shared'}</Body>
        </Fact>
        <View style={{ gap: space(1.5) }}>
          <Caption tone="faint">Additional requirements</Caption>
          <View
            style={{
              flexDirection: 'row',
              gap: space(2.5),
              backgroundColor: rgb(theme.surfaceSunken),
              borderRadius: radius.md,
              padding: space(3),
            }}
          >
            <NotePencil size={18} color={rgb(theme.ink[500])} />
            <Body style={{ flex: 1 }}>
              {r.requirements?.trim() || r.notes?.trim() || 'Nothing further from the couple.'}
            </Body>
          </View>
        </View>
      </Card>

      <Card>
        <Row icon={ClipboardText} title={`Selected Services (${r.services.length})`} />
        {r.services.length === 0 ? (
          <Caption>
            The couple did not pick specific services. Treat it as a general request for wedding
            planning.
          </Caption>
        ) : (
          r.services.map((s) => (
            <View
              key={s}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: rgba(theme.brand, 0.2),
                backgroundColor: rgba(theme.brandSoft, 0.6),
                paddingHorizontal: space(3),
                paddingVertical: space(2.5),
              }}
            >
              <CheckCircle size={18} weight="fill" color={rgb(theme.brand)} />
              <Body style={{ flex: 1 }}>{serviceLabel(s)}</Body>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Row
          icon={ImageSquare}
          title="Reference Images"
          aside={
            r.referenceImages.length > 0
              ? `${r.referenceImages.length} attachment${r.referenceImages.length === 1 ? '' : 's'}`
              : undefined
          }
        />
        {r.referenceImages.length === 0 ? (
          <Caption>No inspiration images were attached.</Caption>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {r.referenceImages.map((url, i) => (
              <Pressable
                key={url}
                accessibilityRole="imagebutton"
                accessibilityLabel={`View reference image ${i + 1} full size`}
                onPress={() => setViewing(i)}
                style={({ pressed }) => [pressed && { opacity: 0.75 }]}
              >
                <Image
                  source={{ uri: reachable(url) }}
                  style={{
                    width: thumb,
                    height: thumb,
                    borderRadius: radius.md,
                    backgroundColor: rgb(theme.surfaceSunken),
                  }}
                  contentFit="cover"
                  transition={150}
                />
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      {r.quotation ? <QuotationSummary q={r.quotation} /> : null}

      <Lightbox
        urls={r.referenceImages}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />
    </>
  );
}

function QuotationSummary({ q }: { q: NonNullable<PlannerRequestDetail['quotation']> }) {
  const theme = useTheme();
  return (
    <Card>
      <Row icon={FileText} title="Your Quotation" />
      <View style={{ gap: space(0.5) }}>
        <Txt serif style={{ fontSize: 26, lineHeight: 30, color: rgb(theme.ink[900]) }}>
          ₹{Number(q.amount).toLocaleString('en-IN')}
        </Txt>
        <Caption tone="faint">
          Sent {formatDateTime(q.sentAt)}
          {q.count > 1 ? ` · offer ${q.count}` : ''}
        </Caption>
      </View>
      <Body>{QUOTE_STAGE[q.stage]}</Body>
      {q.responseNote ? (
        <View style={{ backgroundColor: rgb(theme.surfaceSunken), borderRadius: radius.md, padding: space(3) }}>
          <Body>“{q.responseNote}”</Body>
        </View>
      ) : null}
    </Card>
  );
}

/** Why there is nothing left to do here, and where the job went. */
function ClosedNote({ r }: { r: PlannerRequestDetail }) {
  const router = useRouter();
  if (r.status === 'declined' || r.status === 'closed') {
    return (
      <Card>
        <Body tone="muted">
          {r.status === 'declined' ? 'You declined this request' : 'This request is closed'}
          {r.cancelledAt ? ` on ${formatDate(r.cancelledAt)}` : ''}.
          {r.cancellationReason ? ` Reason: ${r.cancellationReason}` : ''}
        </Body>
      </Card>
    );
  }
  return (
    <>
      <Alert tone="positive">
        The couple agreed your price of ₹{Number(r.amount).toLocaleString('en-IN')}. The wedding now
        continues from My Weddings.
      </Alert>
      <Button
        label="Open the wedding"
        variant="outline"
        onPress={() => router.push({ pathname: '/planner-clients', params: { client: r.client.userId } })}
      />
    </>
  );
}

function Activity({ bookingId }: { bookingId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['booking-history', bookingId],
    queryFn: async () =>
      (await api.get(`/bookings/${bookingId}/history`)).data as {
        at: string;
        label: string;
        detail: string | null;
      }[],
    retry: false,
  });
  if (isLoading) return <Loading rows={2} />;
  return (
    <Card>
      {data.length === 0 ? (
        <Caption>Nothing has happened yet.</Caption>
      ) : (
        data.map((e, i) => (
          <View key={`${e.at}-${i}`} style={{ gap: space(0.5) }}>
            {i > 0 ? <Divider /> : null}
            <Body style={{ fontWeight: '600' }}>{e.label}</Body>
            {e.detail ? <Caption>{e.detail}</Caption> : null}
            <Caption tone="faint">{formatDateTime(e.at)}</Caption>
          </View>
        ))
      )}
    </Card>
  );
}

// ----------------------------------------------------------------- quoting --

/**
 * The quotation form, full height over the request.
 *
 * Its own page sheet rather than the bottom sheet the prompts use: the form is
 * taller than a phone with its breakdown, and the bottom sheet does not scroll.
 * The line above it repeats what the couple asked for, so the planner prices
 * the request without closing the form to look.
 */
function QuoteModal({
  visible,
  r,
  revise,
  onClose,
  onDone,
}: {
  visible: boolean;
  r: PlannerRequestDetail;
  revise: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(3),
            paddingHorizontal: space(4),
            paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + space(4),
            paddingBottom: space(2),
          }}
        >
          <SectionTitle style={{ flex: 1 }}>
            {revise ? 'Send a revised quotation' : 'Send a quotation'}
          </SectionTitle>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
            <X size={22} color={rgb(theme.ink[700])} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: space(4), paddingBottom: insets.bottom + space(8), gap: space(3) }}
          keyboardShouldPersistTaps="handled"
        >
          <Caption>
            For {r.client.name ?? 'the couple'}
            {r.weddingDate ? `, ${formatDate(r.weddingDate)}` : ''}. They asked for{' '}
            {r.services.length > 0 ? r.services.map(serviceLabel).join(', ') : 'wedding planning'}; budget{' '}
            {budgetRange(r.budgetMin, r.budgetMax).toLowerCase()}.
          </Caption>
          <QuotationForm bookingId={r.id} onDone={onDone} onCancel={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ------------------------------------------------------------------ pieces --

/** A card's heading: the brand icon, the title, and a quiet note on the right. */
function Row({ icon: Icon, title, aside }: { icon: typeof Heart; title: string; aside?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
      <Icon size={20} color={rgb(theme.brand)} />
      <Txt serif style={{ flex: 1, fontSize: 21, lineHeight: 26, color: rgb(theme.ink[900]) }}>
        {title}
      </Txt>
      {aside ? <Caption tone="faint">{aside}</Caption> : null}
    </View>
  );
}

function Fact({ label, icon: Icon, children }: { label: string; icon: typeof Heart; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(1) }}>
      <Caption tone="faint">{label}</Caption>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2.5) }}>
        <View style={{ paddingTop: 2 }}>
          <Icon size={18} color={rgb(theme.ink[500])} />
        </View>
        <View style={{ flex: 1, gap: space(1.5) }}>{children}</View>
      </View>
    </View>
  );
}

/** The web's three-way switch over the request: details, talk, history. */
function Segments<K extends string>({
  value,
  onChange,
  options,
}: {
  value: K;
  onChange: (key: K) => void;
  options: [K, string][];
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: space(1),
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.md,
        padding: space(1),
      }}
    >
      {options.map(([key, label]) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              {
                flex: 1,
                minHeight: 38,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.sm,
                paddingHorizontal: space(1),
                backgroundColor: active ? rgb(theme.brand) : 'transparent',
              },
              pressed && !active && { opacity: 0.7 },
            ]}
          >
            <Txt
              numberOfLines={1}
              style={{ fontSize: 13, fontWeight: active ? '600' : '500', color: active ? rgb(theme.brandFg) : rgb(theme.ink[700]) }}
            >
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function ActionButton({
  tone,
  icon: Icon,
  title,
  hint,
  disabled,
  busy,
  onPress,
}: {
  tone: 'positive' | 'brand' | 'critical';
  icon: typeof Heart;
  title: string;
  hint: string;
  disabled: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fills = {
    positive: { bg: rgb(theme.positiveFg), fg: '#fff', border: 'transparent' },
    brand: { bg: rgb(theme.brand), fg: rgb(theme.brandFg), border: 'transparent' },
    critical: { bg: rgb(theme.surface), fg: rgb(theme.criticalFg), border: rgba(theme.criticalFg, 0.5) },
  }[tone];
  const off = disabled || Boolean(busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityHint={hint}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          minHeight: 56,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: fills.border,
          backgroundColor: fills.bg,
          paddingHorizontal: space(4),
          paddingVertical: space(3),
        },
        pressed && { opacity: 0.8 },
        off && { opacity: 0.45 },
      ]}
    >
      <Icon size={26} weight="light" color={fills.fg} />
      <View style={{ flex: 1, gap: space(0.5) }}>
        <Txt style={{ fontSize: 15, fontWeight: '600', color: fills.fg }}>
          {busy ? 'Working…' : title}
        </Txt>
        <Txt style={{ fontSize: 12, color: fills.fg, opacity: 0.85 }}>{hint}</Txt>
      </View>
    </Pressable>
  );
}
