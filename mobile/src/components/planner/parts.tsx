import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CaretRight, SealCheck, Star } from 'phosphor-react-native';

import { Caption, Card, Eyebrow, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * The small pieces every planner screen is built from: a titled section, a
 * tag, the verified mark and a row of stars. Kept together because each is a
 * few lines, and a file per chip is a directory nobody can find anything in.
 */

/**
 * One section of the profile: an eyebrow, a title, an optional action on the
 * right ("View all") and the body. A card, so the sections read as separate
 * things on the ivory ground rather than one long column of text.
 */
export function PlannerSection({
  eyebrow,
  title,
  action,
  onAction,
  children,
}: {
  eyebrow?: string;
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={{ padding: space(4), gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2) }}>
        <View style={{ flex: 1, gap: space(1) }}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <SectionTitle style={{ fontSize: 18 }}>{title}</SectionTitle>
        </View>
        {action && onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action}, ${title}`}
            onPress={onAction}
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), minHeight: 32 }}
          >
            <Caption tone="brand" style={{ fontWeight: '600' }}>
              {action}
            </Caption>
            <CaretRight size={14} color={rgb(theme.brandStrong)} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

/** A tag: a wedding type, a city. Squared, like every surface in the app. */
export function Chip({ label, icon }: { label: string; icon?: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(1.5),
        paddingHorizontal: space(3),
        paddingVertical: space(1.5),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.rose[200]),
        backgroundColor: rgb(theme.brandSoft),
      }}
    >
      {icon}
      <Txt style={{ fontSize: 13, color: rgb(theme.brandStrong), fontWeight: '500' }}>{label}</Txt>
    </View>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>{children}</View>;
}

/** The web profile's `pill-brand` "Verified": every listed planner is approved. */
export function VerifiedBadge() {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel="Verified planner"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(1),
        paddingHorizontal: space(2),
        paddingVertical: space(0.5),
        backgroundColor: rgb(theme.brandSoft),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.rose[200]),
      }}
    >
      <SealCheck size={13} weight="fill" color={rgb(theme.brand)} />
      <Txt style={{ fontSize: 12, fontWeight: '600', color: rgb(theme.brandStrong) }}>Verified</Txt>
    </View>
  );
}

/** Five stars, filled to the nearest whole one. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const theme = useTheme();
  const full = Math.round(Number(value) || 0);
  return (
    <View style={{ flexDirection: 'row', gap: 1 }} accessibilityLabel={`${full} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          weight={n <= full ? 'fill' : 'regular'}
          color={rgb(n <= full ? theme.gold : theme.ink[300])}
        />
      ))}
    </View>
  );
}
