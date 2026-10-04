import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';

import { api, apiMessage } from '@/lib/api';
import { ProfileSilhouette } from '@/components/profile-silhouette';
import { ListScreen } from '@/components/layout';
import { Alert, Body, Caption } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';
import { ageText } from '@/lib/labels';

interface BlockedInterest {
  id: string;
  counterpart: {
    id: string;
    displayName: string;
    city: string | null;
    ageRange: string | null;
    age?: number | null;
    gender: string | null;
    photos?: string[];
    photoUrl?: string | null;
  };
}

interface Board {
  blocked: BlockedInterest[];
}

export default function BlockedProfiles() {
  const theme = useTheme();
  const router = useRouter();

  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['interest-board'],
    queryFn: async () => (await api.get('/matches/interests')).data as Board,
    retry: false,
  });

  const rows = data?.blocked ?? [];

  return (
    <ListScreen
      header={
        isError ? (
          <Alert tone="critical">{apiMessage(error, 'Blocked profiles could not be loaded.')}</Alert>
        ) : (
          <Caption tone="muted">
            A matchmaking block is permanent. These profiles will not appear in your suggestions.
          </Caption>
        )
      }
      data={rows}
      keyExtractor={(row) => row.id}
      loading={isPending}
      emptyTitle="No blocked profiles"
      emptyBody="Profiles you block from Interests appear here."
      onRefresh={() => void refetch()}
      refreshing={isRefetching}
      renderItem={(item) => {
        const photo = item.counterpart.photos?.[0] ?? item.counterpart.photoUrl ?? null;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.counterpart.displayName}
            onPress={() =>
              router.push({ pathname: '/match/[id]', params: { id: item.counterpart.id } })
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space(3),
              paddingVertical: space(2),
            }}
          >
            {photo ? (
              <Image source={{ uri: photo }} style={{ width: 56, height: 56, borderRadius: radius.md }} />
            ) : (
              <ProfileSilhouette
                gender={item.counterpart.gender}
                style={{ width: 56, height: 56, borderRadius: radius.md }}
              />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontWeight: '600' }}>{item.counterpart.displayName}</Body>
              <Caption tone="muted">
                {[ageText(item.counterpart.age, item.counterpart.ageRange), item.counterpart.city].filter(Boolean).join(' · ')}
              </Caption>
            </View>
            <Caption style={{ color: rgb(theme.criticalFg), fontWeight: '600' }}>Blocked</Caption>
          </Pressable>
        );
      }}
    />
  );
}
