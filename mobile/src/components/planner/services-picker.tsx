import { Pressable, StyleSheet, View } from 'react-native';
import {
  AirplaneTilt,
  Buildings,
  CalendarCheck,
  Camera,
  Car,
  Check,
  ClipboardText,
  Clock,
  Confetti,
  EnvelopeSimple,
  Flower,
  ForkKnife,
  ListChecks,
  MusicNotes,
  PaintBrush,
  Sparkle,
  UsersThree,
  Wallet,
} from 'phosphor-react-native';

import { plannerServiceLabel } from '@/shared/planner-profile';
import { rgb, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * The services a couple can tick before sending a request.
 *
 * Two columns of square tiles rather than a list of checkboxes: sixteen rows
 * of text is a page of scrolling on a phone, and a tile with an icon is
 * recognised before it is read. Each tile is still a checkbox to a screen
 * reader, with its state announced.
 */

type Icon = typeof Check;

const SERVICE_ICONS: Partial<Record<string, Icon>> = {
  full_planning: ClipboardText,
  partial_planning: ListChecks,
  day_of_coordination: Clock,
  destination_wedding: AirplaneTilt,
  venue_management: Buildings,
  decoration: Flower,
  catering: ForkKnife,
  photography: Camera,
  makeup: PaintBrush,
  entertainment: MusicNotes,
  transportation: Car,
  guest_management: UsersThree,
  invitations: EnvelopeSimple,
  budget_management: Wallet,
  timeline_management: CalendarCheck,
  event_planning: Confetti,
};

export function ServicesPicker({
  options,
  selected,
  onToggle,
}: {
  /** Service keys, in the order they are shown. */
  options: readonly string[];
  selected: readonly string[];
  onToggle: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space(1) }}>
      {options.map((key) => {
        const on = selected.includes(key);
        const Glyph = SERVICE_ICONS[key] ?? Sparkle;
        const label = plannerServiceLabel(key);
        return (
          <View key={key} style={{ width: '50%', padding: space(1) }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={label}
              onPress={() => onToggle(key)}
              style={({ pressed }) => [
                {
                  flex: 1,
                  minHeight: 64,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space(2),
                  padding: space(2.5),
                  borderWidth: on ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: rgb(on ? theme.brand : theme.border),
                  backgroundColor: rgb(on ? theme.brandSoft : theme.surface),
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Glyph size={20} color={rgb(on ? theme.brand : theme.ink[500])} />
              <Txt
                style={{
                  flex: 1,
                  fontSize: 13,
                  lineHeight: 17,
                  fontWeight: on ? '600' : '400',
                  color: rgb(on ? theme.brandStrong : theme.ink[800]),
                }}
              >
                {label}
              </Txt>
              <View
                style={{
                  width: 18,
                  height: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: rgb(on ? theme.brand : theme.borderStrong),
                  backgroundColor: on ? rgb(theme.brand) : 'transparent',
                }}
              >
                {on ? <Check size={12} weight="bold" color={rgb(theme.brandFg)} /> : null}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
