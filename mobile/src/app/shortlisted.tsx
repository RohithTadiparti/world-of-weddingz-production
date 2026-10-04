import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Heart } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { ProfileSilhouette } from '@/components/profile-silhouette';
import { ListScreen } from '@/components/layout';
import { Alert, Body, Caption } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';
import { ageText } from '@/lib/labels';

interface Profile {
  id: string;
  displayName: string;
  gender?: string | null;
  ageRange: string | null;
  age?: number | null;
  city?: string | null;
  photos: string[];
  card?: { profession: string | null };
}

interface Suggestion {
  profile: Profile;
  score: number;
  interaction?: string;
}

export default function Shortlisted() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['shortlist'],
    queryFn: async () => (await api.get('/matches/shortlist')).data as Suggestion[],
    retry: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/matches/shortlist/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shortlist'] });
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
    },
  });

  const rows = data ?? [];

  return (
    <ListScreen
      header={
        isError ? (
          <Alert tone="critical">{apiMessage(error, 'Shortlist could not be loaded.')}</Alert>
        ) : null
      }
      data={rows}
      keyExtractor={(row) => row.profile.id}
      loading={isPending}
      emptyTitle="No shortlisted profiles"
      emptyBody="Save profiles from Matches to find them here."
      onRefresh={() => void refetch()}
      refreshing={isRefetching}
      renderItem={(item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.profile.displayName}
          onPress={() =>
            router.push({
              pathname: '/match/[id]',
              params: {
                id: item.profile.id,
                score: String(Math.round(item.score)),
                shortlisted: 'true',
                interaction: item.interaction ?? 'none',
              },
            })
          }
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(3),
            paddingVertical: space(2),
          }}
        >
          {item.profile.photos?.[0] ? (
            <Image
              source={{ uri: item.profile.photos[0] }}
              style={{ width: 56, height: 56, borderRadius: radius.md }}
            />
          ) : (
            <ProfileSilhouette
              gender={item.profile.gender}
              style={{ width: 56, height: 56, borderRadius: radius.md }}
            />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Body style={{ fontWeight: '600' }}>{item.profile.displayName}</Body>
            <Caption tone="muted">
              {[ageText(item.profile.age, item.profile.ageRange), item.profile.city, item.profile.card?.profession]
                .filter(Boolean)
                .join(' · ')}
            </Caption>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove from shortlist"
            onPress={() => remove.mutate(item.profile.id)}
            hitSlop={8}
          >
            <Heart size={22} weight="fill" color={rgb(theme.brand)} />
          </Pressable>
        </Pressable>
      )}
    />
  );
}
