import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Caption, SectionTitle } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: rgba(theme.scrim, 0.45) }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View
          style={{
            backgroundColor: rgb(theme.surface),
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingTop: space(3),
            paddingBottom: insets.bottom + space(4),
            maxHeight: '90%',
          }}
        >
          <View style={{ alignItems: 'center', marginBottom: space(4) }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: radius.md,
                backgroundColor: rgb(theme.borderStrong),
              }}
            />
          </View>
          <View style={{ paddingHorizontal: space(4), marginBottom: space(3) }}>
            <SectionTitle style={{ marginBottom: space(1) }}>{title}</SectionTitle>
            {subtitle ? <Caption tone="faint">{subtitle}</Caption> : null}
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
