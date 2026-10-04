import { View } from 'react-native';

import { rgb, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * The application wordmark used in every native navigation header.
 *
 * Keeping the mark here means auth, every portal, and pushed detail screens
 * share the same size, colours, and spacing without each page owning a copy.
 */
export function WowHeaderLogo() {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="WOW, World of Weddingz"
      style={{ alignItems: 'flex-end', justifyContent: 'center', minHeight: 36 }}
    >
      <Txt
        serif
        style={{ fontSize: 22, lineHeight: 22, fontWeight: '600', color: rgb(theme.brandStrong) }}
      >
        WOW
      </Txt>
      <Txt
        numberOfLines={1}
        style={{ fontSize: 7, lineHeight: 9, letterSpacing: 0.6, color: rgb(theme.ink[500]) }}
      >
        WORLD OF WEDDINGZ
      </Txt>
    </View>
  );
}
