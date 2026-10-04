import { useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CaretRight,
  FacebookLogo,
  Globe,
  Images,
  InstagramLogo,
  Link as LinkIcon,
  LinkedinLogo,
  MapPin,
  PinterestLogo,
  Play,
  WhatsappLogo,
  X,
  XLogo,
  YoutubeLogo,
} from 'phosphor-react-native';

import { Body, Caption } from '@/components/ui';
import { videoThumbnail, weddingCover, type PlannerWedding } from '@/shared/planner-profile';
import { httpsHost, listingSocialLinks, socialLinkName } from '@/shared/social-links';
import { rgb, rgba, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

import { openVideo, type PlannerProfile } from './data';

/**
 * The picture-led pieces of a planner's profile: a wedding's card, a video's
 * still with its play mark, a full-screen photo viewer, and the planner's own
 * links.
 */

/** A portfolio wedding as a card: its cover, the couple, where it was. */
export function WeddingCard({
  wedding,
  width,
  onPress,
}: {
  wedding: PlannerWedding;
  width: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const cover = weddingCover(wedding);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${wedding.title}${wedding.location ? `, ${wedding.location}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width,
          backgroundColor: rgb(theme.surface),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.border),
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={{ width, height: width * 0.72, backgroundColor: rgb(theme.surfaceSunken) }}>
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Images size={28} color={rgb(theme.ink[300])} />
          </View>
        )}
        {wedding.photos.length > 0 ? (
          <View
            style={{
              position: 'absolute',
              right: space(2),
              bottom: space(2),
              flexDirection: 'row',
              alignItems: 'center',
              gap: space(1),
              paddingHorizontal: space(2),
              paddingVertical: space(0.5),
              backgroundColor: rgba(theme.scrim, 0.6),
            }}
          >
            <Images size={12} color="#fff" />
            <Txt style={{ fontSize: 11, color: '#fff' }}>{wedding.photos.length}</Txt>
          </View>
        ) : null}
      </View>
      <View style={{ padding: space(3), gap: space(1) }}>
        <Body numberOfLines={1} style={{ fontWeight: '600' }}>
          {wedding.title}
        </Body>
        {wedding.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
            <MapPin size={12} color={rgb(theme.ink[400])} />
            <Caption numberOfLines={1} style={{ flex: 1 }}>
              {wedding.location}
            </Caption>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A video as a still with a play mark. YouTube publishes a still for every
 * video; anything else (Vimeo, an uploaded file) gets a plain ground with the
 * same mark, so the tile still reads as something to play.
 */
export function VideoTile({
  url,
  width,
  label = 'Play video',
}: {
  url: string;
  width: number;
  label?: string;
}) {
  const theme = useTheme();
  const still = videoThumbnail(url);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => openVideo(url)}
      style={({ pressed }) => [
        { width, height: (width * 9) / 16, backgroundColor: rgb(theme.ink[900]) },
        pressed && { opacity: 0.85 },
      ]}
    >
      {still ? (
        <Image source={{ uri: still }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : null}
      <View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: rgba(theme.scrim, still ? 0.25 : 0),
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: rgba(theme.scrim, 0.6),
          }}
        >
          <Play size={24} weight="fill" color="#fff" />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Photos one at a time, full screen, swiped between.
 *
 * A modal over the page rather than a route of its own: there is nothing in
 * it worth an address, and closing it lands exactly where the grid was.
 */
export function PhotoViewer({
  photos,
  index,
  onClose,
}: {
  photos: string[];
  /** The photo to open on, or null when the viewer is closed. */
  index: number | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index ?? 0);
  // Reset to the tapped photo whenever the viewer is opened on a new one;
  // adjusted while rendering rather than in an effect, so the counter never
  // shows the previous photo's number for a frame.
  const [openedOn, setOpenedOn] = useState(index);
  if (index !== openedOn) {
    setOpenedOn(index);
    if (index !== null) setCurrent(index);
  }

  return (
    <Modal visible={index !== null} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {index !== null ? (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(uri, i) => `${i}-${uri}`}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <Image source={{ uri: item }} style={{ width, height }} resizeMode="contain" />
              </View>
            )}
          />
        ) : null}
        <View
          style={{
            position: 'absolute',
            top: insets.top + space(2),
            left: space(4),
            right: space(4),
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Txt style={{ flex: 1, color: '#fff', fontSize: 14 }}>
            {current + 1} / {photos.length}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photos"
            onPress={onClose}
            hitSlop={10}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
          >
            <X size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const SOCIAL_ICONS: Partial<Record<string, typeof Globe>> = {
  instagram: InstagramLogo,
  youtube: YoutubeLogo,
  facebook: FacebookLogo,
  pinterest: PinterestLogo,
  x: XLogo,
  linkedin: LinkedinLogo,
  whatsapp: WhatsappLogo,
  website: Globe,
  other: LinkIcon,
};

/** Whether the planner gave any link worth a Connect section. */
export function hasConnectLinks(planner: PlannerProfile): boolean {
  return listingSocialLinks(planner).length > 0;
}

/** The links the planner provided, each opening in its own app or the browser. */
export function ConnectLinks({ planner }: { planner: PlannerProfile }) {
  const theme = useTheme();
  const links = listingSocialLinks(planner);
  return (
    <View>
      {links.map((link, i) => {
        const Icon = SOCIAL_ICONS[link.platform] ?? LinkIcon;
        const name = socialLinkName(link);
        const host = httpsHost(link.url)?.replace(/^www\./, '');
        return (
          <Pressable
            key={`${link.platform}-${link.url}`}
            accessibilityRole="link"
            accessibilityLabel={`Open ${name}${host ? `, ${host}` : ''}`}
            onPress={() => void Linking.openURL(link.url).catch(() => undefined)}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                paddingVertical: space(3),
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: rgb(theme.border),
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            <View
              style={{
                width: 36,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: rgb(theme.brandSoft),
              }}
            >
              <Icon size={20} color={rgb(theme.brand)} />
            </View>
            <View style={{ flex: 1 }}>
              <Body>{name}</Body>
              {host ? <Caption tone="faint">{host}</Caption> : null}
            </View>
            <CaretRight size={16} color={rgb(theme.ink[400])} />
          </Pressable>
        );
      })}
    </View>
  );
}
