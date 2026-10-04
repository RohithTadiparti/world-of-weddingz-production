import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { CaretRight } from 'phosphor-react-native';
import { Body, Caption, Card } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

interface ProfileCompletionCardProps {
  percent: number;
  hideAction?: boolean;
}

export function ProfileCompletionCard({ percent, hideAction }: ProfileCompletionCardProps) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
      <View style={{
        width: 64,
        height: 64,
        borderRadius: radius.md,
        borderWidth: 4,
        borderColor: rgb(theme.brandSoft),
        borderTopColor: rgb(theme.brand),
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Body style={{ fontWeight: '700', color: rgb(theme.brand) }}>{percent}%</Body>
      </View>
      <View style={{ flex: 1, gap: space(2) }}>
        <View>
          <Body style={{ fontWeight: '600' }}>Complete your profile</Body>
          <Caption tone="muted">Get more relevant matches</Caption>
        </View>
        {!hideAction ? (
          <Pressable
            onPress={() => router.push('/biodata')}
            style={{
              backgroundColor: rgb(theme.brand),
              paddingHorizontal: space(3),
              paddingVertical: space(1.5),
              borderRadius: radius.sm,
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: space(1)
            }}
          >
            <Caption style={{ color: rgb(theme.surface), fontWeight: '600' }}>Complete Profile</Caption>
            <CaretRight size={12} color={rgb(theme.surface)} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
