import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Eye, EyeSlash } from 'phosphor-react-native';

import { radius, rgb, rgba, space, useTheme, type Theme } from '@/theme';
import { Txt, typeface } from '@/theme/fonts';
import { HeartBackdrop } from '@/components/heart-field';

/**
 * The primitives, matching the component layer in the web app's index.css.
 *
 * Same names as the classes there — btn, btn-outline, btn-ghost, input, card,
 * page-title, section-title — so that a change of mind about what a button
 * looks like is one edit per app rather than an audit of every screen.
 *
 * Typography matches the web too: the matrimony home template's Karla for
 * text and Cormorant Garamond for page titles, loaded as native fonts at
 * start-up (see theme/fonts).
 */

// ------------------------------------------------------------------ text --

type TextTone = 'default' | 'muted' | 'faint' | 'brand' | 'critical' | 'onBrand';

function toneColour(theme: Theme, tone: TextTone): string {
  switch (tone) {
    case 'muted':
      return rgb(theme.ink[500]);
    case 'faint':
      return rgb(theme.ink[400]);
    case 'brand':
      return rgb(theme.brandStrong);
    case 'critical':
      return rgb(theme.criticalFg);
    case 'onBrand':
      return rgb(theme.brandFg);
    default:
      return rgb(theme.ink[800]);
  }
}

interface TxtProps {
  children: ReactNode;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/** A page's own name. One per screen, and never inside a card. */
export function PageTitle({ children, style }: TxtProps) {
  const theme = useTheme();
  return (
    <Txt
      serif
      style={[
        {
          fontSize: 32,
          lineHeight: 36,
          fontWeight: '400',
          color: rgb(theme.brand),
          // A plate of the ground, so the heart field never runs behind it.
          alignSelf: 'flex-start',
          backgroundColor: rgb(theme.canvas),
        },
        style,
      ]}
    >
      {children}
    </Txt>
  );
}

/** The line under a page title. Measured, because a subtitle that runs the
 *  full width of a phone is a paragraph pretending to be a caption. */
export function PageSubtitle({ children, style }: TxtProps) {
  const theme = useTheme();
  return (
    <Txt
      style={[
        {
          fontSize: 15,
          lineHeight: 22,
          color: rgb(theme.ink[500]),
          alignSelf: 'flex-start',
          backgroundColor: rgb(theme.canvas),
        },
        style,
      ]}
    >
      {children}
    </Txt>
  );
}

export function SectionTitle({ children, style, numberOfLines }: TxtProps) {
  const theme = useTheme();
  return (
    <Txt
      numberOfLines={numberOfLines}
      style={[
        { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: rgb(theme.ink[900]) },
        style,
      ]}
    >
      {children}
    </Txt>
  );
}

export function Body({ children, tone = 'default', style, numberOfLines }: TxtProps) {
  const theme = useTheme();
  return (
    <Txt
      numberOfLines={numberOfLines}
      style={[{ fontSize: 15, lineHeight: 21, color: toneColour(theme, tone) }, style]}
    >
      {children}
    </Txt>
  );
}

export function Caption({ children, tone = 'muted', style, numberOfLines }: TxtProps) {
  const theme = useTheme();
  return (
    <Txt
      numberOfLines={numberOfLines}
      style={[{ fontSize: 13, lineHeight: 18, color: toneColour(theme, tone) }, style]}
    >
      {children}
    </Txt>
  );
}

/** An eyebrow: uppercase, tracked, and never a heading in disguise. */
export function Eyebrow({ children, style }: TxtProps) {
  const theme = useTheme();
  return (
    <Txt
      style={[
        {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 2.4,
          textTransform: 'uppercase',
          color: rgb(theme.ink[500]),
        },
        style,
      ]}
    >
      {children}
    </Txt>
  );
}

// --------------------------------------------------------------- surfaces --

export function Screen({ children, scroll = true, onRefresh, refreshing = false }: { children: ReactNode; scroll?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const style = { flex: 1 };
  // The bottom pad clears the tab bar's own inset; without it the last card in
  // a list sits under the bar and looks like the list was cut off.
  const content = { padding: space(4), paddingBottom: insets.bottom + space(6), gap: space(4) };

  // On the template's ground: ivory under its field of gold hearts.
  if (!scroll) {
    return (
      <HeartBackdrop>
        <View style={[style, content]}>{children}</View>
      </HeartBackdrop>
    );
  }
  
  const { RefreshControl } = require('react-native');
  return (
    <HeartBackdrop>
      <ScrollView 
        style={style} 
        contentContainerStyle={content} 
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </HeartBackdrop>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: rgb(theme.surface),
          borderColor: rgb(theme.border),
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: space(3),
          gap: space(3),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- actions --

type ButtonVariant = 'primary' | 'outline' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  small?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  small = false,
  disabled = false,
  busy = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const off = disabled || busy;

  const base: ViewStyle = {
    borderRadius: radius.md,
    paddingVertical: small ? space(2) : space(3),
    paddingHorizontal: small ? space(3) : space(4),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space(2),
    borderWidth: variant === 'outline' ? StyleSheet.hairlineWidth : 0,
    // A minimum height rather than padding alone: 44pt is the smallest target
    // a thumb hits reliably, and it is not negotiable on the small variant.
    minHeight: small ? 36 : 46,
  };

  const fills: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: rgb(theme.brand) },
    outline: { borderColor: rgb(theme.borderStrong), backgroundColor: 'transparent' },
    ghost: { backgroundColor: 'transparent' },
  };

  const labels: Record<ButtonVariant, string> = {
    primary: rgb(theme.brandFg),
    outline: rgb(theme.ink[800]),
    ghost: rgb(theme.brandStrong),
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        fills[variant],
        // Press feedback rather than a hover state: there is no pointer here,
        // and a control that never acknowledges a tap reads as broken.
        pressed && { opacity: 0.75 },
        off && { opacity: 0.45 },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={labels[variant]} />}
      <Txt
        style={{
          fontSize: small ? 11 : 12,
          fontWeight: '500',
          letterSpacing: small ? 1.4 : 1.9,
          textTransform: 'uppercase',
          color: labels[variant],
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * The mark a required field's label carries, for a heading that is not a Field
 * (a section a form will not save without, like Portfolio). Nest it inside the
 * heading's text so it wraps with it.
 */
export function RequiredMark() {
  const theme = useTheme();
  return <Txt style={{ color: rgb(theme.criticalFg) }}> *</Txt>;
}

// ------------------------------------------------------------------ input --

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  showPasswordToggle?: boolean;
  /**
   * What is wrong with this field, in words.
   *
   * Field-level rather than a summary at the top of the form, matching the web
   * client: a list of complaints above a phone-height form names fields the
   * person then has to scroll to find, and the one they mistyped is the one
   * they cannot see.
   */
  error?: string;
  required?: boolean;
  autoFilled?: boolean;
}

export function Field({
  label,
  hint,
  error,
  required,
  autoFilled,
  style,
  showPasswordToggle = false,
  ...props
}: FieldProps) {
  const theme = useTheme();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const secureTextEntry = Boolean(props.secureTextEntry) && !passwordVisible;
  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
        <Txt style={{ fontSize: 13, fontWeight: '500', color: rgb(theme.ink[600]) }}>
          {label}
          {required ? <Txt style={{ color: rgb(theme.criticalFg) }}> *</Txt> : null}
        </Txt>
        {autoFilled && (
          <View style={{ backgroundColor: rgb(theme.positiveBg), paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, flexDirection: 'row', alignItems: 'center' }}>
            <Txt style={{ color: rgb(theme.positiveFg), fontSize: 10, fontWeight: '700' }}>AUTO-FILLED</Txt>
          </View>
        )}
      </View>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          placeholderTextColor={rgb(theme.ink[400])}
          style={typeface([
            {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: rgb(error ? theme.criticalFg : theme.border),
              backgroundColor: rgb(theme.surface),
              borderRadius: radius.sm,
              paddingHorizontal: space(3),
              ...(showPasswordToggle ? { paddingRight: space(12) } : {}),
              paddingVertical: space(3),
              fontSize: 16, // 16 or iOS zooms the field on focus.
              color: rgb(theme.ink[900]),
              minHeight: 46,
            },
            style,
          ])}
          {...props}
          secureTextEntry={props.secureTextEntry ? secureTextEntry : undefined}
        />
        {showPasswordToggle && props.secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            accessibilityState={{ selected: passwordVisible }}
            hitSlop={10}
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={{
              position: 'absolute',
              right: space(3),
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {passwordVisible ? (
              <Eye size={20} color={rgb(theme.ink[500])} />
            ) : (
              <EyeSlash size={20} color={rgb(theme.ink[500])} />
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {hint && !error ? <Caption tone="faint">{hint}</Caption> : null}
    </View>
  );
}

// --------------------------------------------------------------- feedback --

type AlertTone = 'critical' | 'positive' | 'caution';

export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  const theme = useTheme();
  const ground = { critical: theme.criticalBg, positive: theme.positiveBg, caution: theme.cautionBg };
  const ink = { critical: theme.criticalFg, positive: theme.positiveFg, caution: theme.cautionFg };
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: rgb(ground[tone]),
        borderRadius: radius.sm,
        padding: space(3),
      }}
    >
      <Txt style={{ fontSize: 14, lineHeight: 20, color: rgb(ink[tone]) }}>{children}</Txt>
    </View>
  );
}

/**
 * A skeleton rather than a spinner.
 *
 * A spinner says something is happening; a skeleton says what is about to
 * arrive, and the page does not jump when it does.
 */
export function Loading({ rows = 3 }: { rows?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(3) }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            height: 72,
            borderRadius: radius.lg,
            backgroundColor: rgba(theme.ink[300], theme.dark ? 0.18 : 0.35),
          }}
        />
      ))}
    </View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space(8), gap: space(2) }}>
      <SectionTitle style={{ textAlign: 'center' }}>{title}</SectionTitle>
      {children ? (
        <Body tone="muted" style={{ textAlign: 'center' }}>
          {children}
        </Body>
      ) : null}
    </Card>
  );
}
