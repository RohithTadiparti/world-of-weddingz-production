import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  CurrencyInr,
  MapPin,
  WarningCircle,
  X,
  XCircle,
} from 'phosphor-react-native';

import {
  STATUS_LABEL,
  STATUS_TONE,
  budgetRange,
  initials,
  receivedAgo,
  type PlannerRequestCard,
  type PlannerRequestDetail,
  type PlannerRequestStatus,
} from '@/lib/planner-requests';
import { formatDate } from '@/shared/dates';
import { Badge } from '@/components/chrome';
import { reachable } from '@/components/uploader';
import { Caption, Card } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * The pieces the planner's request list and request detail share, after the
 * web client's PlannerRequests page: the couple's face (or initials), the card
 * a request is opened from, the date's availability, the trail from received
 * to quoted, and the full-size viewer for the couple's reference photos.
 */

/** The couple's photo, or their initials on the brand's soft ground. */
export function Avatar({
  name,
  photo,
  size = 56,
}: {
  name: string | null;
  photo: string | null;
  size?: number;
}) {
  const theme = useTheme();
  const frame: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: rgb(theme.brandSoft),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
  if (photo) {
    return (
      <View style={frame}>
        <Image
          source={{ uri: reachable(photo) }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  return (
    <View style={frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Txt serif style={{ fontSize: size * 0.36, color: rgb(theme.brandStrong) }}>
        {initials(name)}
      </Txt>
    </View>
  );
}

export function StatusBadge({ status }: { status: PlannerRequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** One line of a card: a small grey icon and its value. */
export function IconLine({
  icon: Icon,
  children,
  style,
}: {
  icon: typeof MapPin;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), minWidth: 0 }, style]}>
      <Icon size={14} color={rgb(theme.ink[400])} />
      <Caption numberOfLines={1} style={{ flexShrink: 1 }}>
        {children}
      </Caption>
    </View>
  );
}

/** A request in the list: who, their day, where, what money, and how long ago. */
export function RequestCard({
  request: r,
  onPress,
}: {
  request: PlannerRequestCard;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the request from ${r.client.name ?? 'a couple'}, ${STATUS_LABEL[r.status]}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.75 }]}
    >
      <Card style={{ flexDirection: 'row', gap: space(3) }}>
        <Avatar name={r.client.name} photo={r.client.photo} />
        <View style={{ flex: 1, minWidth: 0, gap: space(1) }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <Txt serif numberOfLines={1} style={{ flex: 1, fontSize: 20, lineHeight: 24, color: rgb(theme.ink[900]) }}>
              {r.client.name ?? 'A couple'}
            </Txt>
            <StatusBadge status={r.status} />
          </View>
          <IconLine icon={CalendarBlank}>{formatDate(r.weddingDate, 'Date not set')}</IconLine>
          <IconLine icon={MapPin}>{r.location ?? 'Place not set'}</IconLine>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <IconLine icon={CurrencyInr} style={{ flex: 1 }}>
              {budgetRange(r.budgetMin, r.budgetMax, 'Budget not shared')}
            </IconLine>
            <Caption tone="faint">{receivedAgo(r.receivedAt)}</Caption>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/** Whether the planner is free on the couple's date, by their own calendar. */
export function AvailabilityPill({
  availability: a,
}: {
  availability: PlannerRequestDetail['availability'];
}) {
  const theme = useTheme();
  const pill = (tone: 'positive' | 'critical' | 'caution' | 'neutral', Icon: typeof MapPin | null, text: string) => {
    const colours = {
      positive: [theme.positiveBg, theme.positiveFg],
      critical: [theme.criticalBg, theme.criticalFg],
      caution: [theme.cautionBg, theme.cautionFg],
      neutral: [theme.surfaceSunken, theme.ink[600]],
    }[tone];
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(1),
          alignSelf: 'flex-start',
          backgroundColor: rgb(colours[0]),
          borderRadius: radius.md,
          paddingHorizontal: space(2),
          paddingVertical: space(1),
        }}
      >
        {Icon ? <Icon size={14} color={rgb(colours[1])} /> : null}
        <Txt style={{ fontSize: 12, fontWeight: '500', color: rgb(colours[1]) }}>{text}</Txt>
      </View>
    );
  };
  switch (a.state) {
    case 'available':
      return pill('positive', CheckCircle, `Available${a.openings > 1 ? ` · ${a.openings} openings` : ''}`);
    case 'booked':
      return pill('critical', XCircle, `Already booked${a.otherBookings > 1 ? ` (${a.otherBookings})` : ''}`);
    case 'unpublished':
      // No opening published on that date: not a refusal, but worth a look.
      return pill('caution', WarningCircle, 'Not on your calendar');
    case 'past':
      return pill('neutral', null, 'Date has passed');
    default:
      return null;
  }
}

/** Where the request is on its way from received to agreed. */
export function StatusTrail({ status }: { status: PlannerRequestStatus }) {
  const theme = useTheme();
  if (status === 'declined' || status === 'closed') return null;
  const steps = ['Received', 'Accepted', status === 'requote_requested' ? 'Re-quote asked' : 'Quoted'];
  const reached = status === 'new' ? 0 : status === 'accepted' ? 1 : 2;
  return (
    <View
      accessibilityLabel={`Request progress: ${steps[reached]}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}
    >
      {steps.map((label, i) => {
        const done = i <= reached;
        return (
          <View
            key={label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), flex: i < steps.length - 1 ? 1 : 0 }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: done ? rgb(theme.brand) : 'transparent',
                borderWidth: done ? 0 : 1,
                borderColor: rgb(theme.borderStrong),
              }}
            >
              <Txt style={{ fontSize: 11, color: done ? rgb(theme.brandFg) : rgb(theme.ink[500]) }}>
                {i + 1}
              </Txt>
            </View>
            <Caption
              numberOfLines={1}
              tone={done ? 'default' : 'faint'}
              style={done ? { fontWeight: '600' } : undefined}
            >
              {label}
            </Caption>
            {i < steps.length - 1 ? (
              <View
                style={{
                  flex: 1,
                  height: 1,
                  minWidth: space(2),
                  backgroundColor: rgb(i < reached ? theme.brand : theme.border),
                }}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A reference photo at full size, with the others a swipe away.
 *
 * A paging list rather than one image and two arrows alone, because on a phone
 * the gesture is the expected way through a set of photographs; the arrows stay
 * for the person who does not know to swipe, and "Open original" hands the file
 * to the system viewer for zooming.
 */
export function Lightbox({
  urls,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const list = useRef<FlatList<string>>(null);
  const [ready, setReady] = useState(false);
  const many = urls.length > 1;
  const visible = index !== null;

  // Follows an arrow press; a swipe has already moved the list itself.
  useEffect(() => {
    if (visible && ready) list.current?.scrollToIndex({ index: index ?? 0, animated: true });
  }, [index, visible, ready]);

  useEffect(() => {
    if (!visible) setReady(false);
  }, [visible]);

  const go = (step: number) => onIndex(((index ?? 0) + step + urls.length) % urls.length);

  const round: ViewStyle = {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: rgba(theme.scrim, 0.92) }}>
        {visible ? (
          <FlatList
            ref={list}
            data={urls}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(url) => url}
            initialScrollIndex={index ?? 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onLayout={() => setReady(true)}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== index) onIndex(next);
            }}
            renderItem={({ item, index: i }) => (
              <View style={{ width, height, justifyContent: 'center', alignItems: 'center' }}>
                <Image
                  source={{ uri: reachable(item) }}
                  style={{ width, height: height * 0.78 }}
                  contentFit="contain"
                  transition={150}
                  accessibilityLabel={`Reference image ${i + 1} of ${urls.length}`}
                />
              </View>
            )}
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => [
            round,
            { position: 'absolute', top: insets.top + space(3), right: space(4) },
            pressed && { opacity: 0.7 },
          ]}
        >
          <X size={22} color="#fff" />
        </Pressable>

        {many ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous image"
              onPress={() => go(-1)}
              style={({ pressed }) => [
                round,
                { position: 'absolute', left: space(3), top: height / 2 - 22 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <CaretLeft size={24} color="#fff" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next image"
              onPress={() => go(1)}
              style={({ pressed }) => [
                round,
                { position: 'absolute', right: space(3), top: height / 2 - 22 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <CaretRight size={24} color="#fff" />
            </Pressable>
          </>
        ) : null}

        <View
          style={{
            position: 'absolute',
            bottom: insets.bottom + space(5),
            left: 0,
            right: 0,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: space(4),
          }}
        >
          <Txt style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
            {(index ?? 0) + 1} / {urls.length}
          </Txt>
          <Pressable
            accessibilityRole="link"
            hitSlop={10}
            onPress={() => {
              const url = urls[index ?? 0];
              if (url) void Linking.openURL(reachable(url));
            }}
          >
            <Txt style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', textDecorationLine: 'underline' }}>
              Open original
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
