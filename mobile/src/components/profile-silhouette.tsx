import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  SILHOUETTES,
  SILHOUETTE_TONES,
  SILHOUETTE_VIEWBOX,
  silhouetteFor,
  type SilhouetteTone,
} from '@/shared/profile-silhouette';
import { rgb, useTheme, type Channels } from '@/theme';

/** `amount` of `a` mixed into `b`, so overlapping shapes stay flat. */
function mix(a: Channels, b: Channels, amount: number): Channels {
  const at = (i: 0 | 1 | 2) => Math.round(a[i] * amount + b[i] * (1 - amount));
  return [at(0), at(1), at(2)];
}

/**
 * The gendered stand-in for a person with no photograph: a groom, a bride, or
 * a neutral figure when gender is not recorded — the same art the web app
 * draws. Fills the box `style` sizes and rounds (square, 3:2 cover or a round
 * avatar) with the figure standing on the bottom edge. Decorative only.
 */
export const ProfileSilhouette = memo(function ProfileSilhouette({
  gender,
  style,
}: {
  gender?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const colour = (tone: SilhouetteTone) => {
    const { token, amount } = SILHOUETTE_TONES[tone];
    return rgb(mix(token === 'gold' ? theme.gold : theme.brand, theme.surfaceSunken, amount));
  };
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ pointerEvents: 'none', overflow: 'hidden', backgroundColor: rgb(theme.surfaceSunken) }, style]}
    >
      <Svg width="100%" height="100%" viewBox={SILHOUETTE_VIEWBOX} preserveAspectRatio="xMidYMax meet">
        {SILHOUETTES[silhouetteFor(gender)].map((s, i) =>
          s.stroke ? (
            <Path
              key={i}
              d={s.d}
              fill="none"
              stroke={colour(s.tone)}
              strokeWidth={s.stroke}
              strokeLinecap="round"
            />
          ) : (
            <Path key={i} d={s.d} fill={colour(s.tone)} />
          ),
        )}
      </Svg>
    </View>
  );
});
