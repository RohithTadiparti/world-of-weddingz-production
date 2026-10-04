import { useState } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { CalendarBlank, MapPin } from 'phosphor-react-native';

import { apiMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { Body, Caption, EmptyState, Eyebrow, Loading, Screen } from '@/components/ui';
import { usePlannerProfile } from '@/components/planner/data';
import { PhotoViewer, VideoTile } from '@/components/planner/media';
import { PlannerSection } from '@/components/planner/parts';
import { weddingCover } from '@/shared/planner-profile';
import { rgb, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * One wedding from a planner's portfolio: the couple, where and when, the
 * events the planner ran, the photographs (opening full screen) and any films.
 * Read from the planner's own listing, which carries every wedding, so there is
 * no second request and nothing to fall out of step with the profile.
 */
export default function PlannerWeddingScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { id, weddingId } = useLocalSearchParams<{ id: string; weddingId: string }>();
  const query = usePlannerProfile(id);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  if (query.isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  const wedding = query.data?.weddings?.find((w) => w.id === weddingId);
  if (query.error || !query.data || !wedding) {
    return (
      <Screen>
        <EmptyState title="Wedding unavailable">
          {query.error
            ? apiMessage(query.error, 'Please try again shortly.')
            : 'This wedding is no longer in the planner\'s portfolio.'}
        </EmptyState>
      </Screen>
    );
  }

  const cover = weddingCover(wedding);
  // Screen gutter and the section card's padding, each side.
  const inner = width - space(16);
  const tile = (inner - space(2) * 2) / 3;

  return (
    <Screen>
      <Stack.Screen options={{ title: wedding.title }} />

      {cover ? (
        <Image
          source={{ uri: cover }}
          style={{ width: width - space(8), height: (width - space(8)) * 0.66 }}
          resizeMode="cover"
        />
      ) : null}

      <View style={{ gap: space(2) }}>
        <Eyebrow>{query.data.agencyName}</Eyebrow>
        <Txt serif style={{ fontSize: 30, lineHeight: 34, color: rgb(theme.brand) }}>
          {wedding.title}
        </Txt>
        {wedding.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
            <MapPin size={15} color={rgb(theme.ink[500])} />
            <Caption>{wedding.location}</Caption>
          </View>
        ) : null}
        {wedding.date ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
            <CalendarBlank size={15} color={rgb(theme.ink[500])} />
            <Caption>{shortDate(wedding.date)}</Caption>
          </View>
        ) : null}
        {wedding.description ? <Body style={{ marginTop: space(1) }}>{wedding.description}</Body> : null}
      </View>

      {wedding.events.length > 0 ? (
        <PlannerSection title="Events">
          {wedding.events.map((event, i) => (
            <View
              key={`${event.name}-${i}`}
              style={{
                gap: space(1),
                paddingTop: i === 0 ? 0 : space(3),
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: rgb(theme.border),
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: '600' }}>{event.name}</Body>
                {event.date ? <Caption tone="faint">{shortDate(event.date)}</Caption> : null}
              </View>
              {event.description ? <Caption>{event.description}</Caption> : null}
            </View>
          ))}
        </PlannerSection>
      ) : null}

      {wedding.photos.length > 0 ? (
        <PlannerSection title={`Photos (${wedding.photos.length})`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {wedding.photos.map((photo, i) => (
              <Pressable
                key={`${i}-${photo}`}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo ${i + 1} of ${wedding.photos.length}`}
                onPress={() => setPhotoIndex(i)}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <Image
                  source={{ uri: photo }}
                  style={{ width: tile, height: tile, backgroundColor: rgb(theme.surfaceSunken) }}
                />
              </Pressable>
            ))}
          </View>
        </PlannerSection>
      ) : null}

      {wedding.videos.length > 0 ? (
        <PlannerSection title="Videos">
          <View style={{ gap: space(3) }}>
            {wedding.videos.map((url, i) => (
              <VideoTile key={`${i}-${url}`} url={url} width={inner} label={`Play video ${i + 1}`} />
            ))}
          </View>
        </PlannerSection>
      ) : null}

      <PhotoViewer photos={wedding.photos} index={photoIndex} onClose={() => setPhotoIndex(null)} />
    </Screen>
  );
}
