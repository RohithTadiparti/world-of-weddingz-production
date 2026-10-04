import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import {
  Karla_300Light,
  Karla_400Regular,
  Karla_500Medium,
  Karla_600SemiBold,
  Karla_700Bold,
} from '@expo-google-fonts/karla';
import {
  CormorantGaramond_300Light,
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';

/**
 * The matrimony home template's two faces, the same pair the web app sets:
 * Karla for text, Cormorant Garamond for page titles.
 *
 * React Native has no font weights for a loaded face — each weight is its own
 * family — so a style's `fontWeight` is read here and turned into the family
 * that draws it. Screens keep writing `fontWeight: '600'` and get Karla
 * SemiBold rather than a synthesised bold of Karla Regular.
 */
export const FONT_ASSETS = {
  Karla_300Light,
  Karla_400Regular,
  Karla_500Medium,
  Karla_600SemiBold,
  Karla_700Bold,
  CormorantGaramond_300Light,
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
};

type Face = 'sans' | 'serif';

const FAMILY: Record<Face, Record<string, string>> = {
  sans: {
    '300': 'Karla_300Light',
    '400': 'Karla_400Regular',
    '500': 'Karla_500Medium',
    '600': 'Karla_600SemiBold',
    '700': 'Karla_700Bold',
  },
  serif: {
    '300': 'CormorantGaramond_300Light',
    '400': 'CormorantGaramond_400Regular',
    '500': 'CormorantGaramond_500Medium',
    '600': 'CormorantGaramond_600SemiBold',
    '700': 'CormorantGaramond_700Bold',
  },
};

/** A text style with its weight turned into the family that draws it. */
export function typeface(style: StyleProp<TextStyle>, face: Face = 'sans'): TextStyle {
  const flat: TextStyle = { ...(StyleSheet.flatten(style) ?? {}) };
  // An explicit family is a deliberate choice (an icon font, a code field).
  if (flat.fontFamily) return flat;
  const raw = String(flat.fontWeight ?? '400');
  const weight = raw === 'bold' ? '700' : raw === 'normal' ? '400' : raw;
  const step = Math.min(700, Math.max(300, Math.round(Number(weight) / 100) * 100 || 400));
  delete flat.fontWeight;
  return { ...flat, fontFamily: FAMILY[face][String(step)] };
}

/** `Text` in the house faces. `serif` is for page titles and nothing smaller. */
export function Txt({ serif = false, style, ...props }: TextProps & { serif?: boolean }) {
  return <Text {...props} style={typeface(style, serif ? 'serif' : 'sans')} />;
}
