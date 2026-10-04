import { memo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import {
  HEARTS,
  HEART_CELL_W,
  HEART_PATH,
  HEART_STOPS,
  HEART_VIEWBOX_H,
} from '@/shared/heart-field';
import { rgb, useTheme } from '@/theme';

/**
 * The matrimony home template's field of struck-gold heart outlines, the same
 * pattern the web app draws behind every page. Fills its parent, sits behind
 * everything in it, and takes no touches.
 *
 * A phone shows three of the pattern's nine columns: the whole 1440-wide
 * field squeezed onto a phone draws each heart a few pixels across.
 */
const PHONE_W = 3 * HEART_CELL_W;
const PHONE_HEARTS = HEARTS.filter((h) => h.x < PHONE_W);

export const HeartField = memo(function HeartField() {
  const theme = useTheme();
  const gold = { gold: theme.gold, 'gold-lit': theme.goldLit, 'gold-deep': theme.goldDeep };
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: 0.5, pointerEvents: 'none' }]}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${PHONE_W} ${HEART_VIEWBOX_H}`}
        preserveAspectRatio="xMinYMin slice"
      >
        <Defs>
          <LinearGradient id="wow-heart-leaf" x1="0%" y1="0%" x2="72%" y2="100%">
            {HEART_STOPS.map(([offset, token]) => (
              <Stop key={offset} offset={offset} stopColor={rgb(gold[token])} />
            ))}
          </LinearGradient>
        </Defs>
        {PHONE_HEARTS.map((h, i) => (
          <Path
            key={i}
            d={HEART_PATH}
            transform={h.transform}
            fill="none"
            stroke="url(#wow-heart-leaf)"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
});

/** The ivory ground with the heart field on it, for a whole screen. */
export function HeartBackdrop({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: rgb(theme.canvas) }, style]}>
      <HeartField />
      {children}
    </View>
  );
}
