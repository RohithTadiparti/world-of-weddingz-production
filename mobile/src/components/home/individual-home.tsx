import { View, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import {
  Bell,
  MagnifyingGlass,
  ChatCircleDots,
  CalendarBlank,
  Heart,
  UserCircle,
  CaretRight
} from 'phosphor-react-native';

import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { ProfileSilhouette } from '@/components/profile-silhouette';
import { Body, Caption, Card, Loading, SectionTitle, Eyebrow } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';
import { ageText } from '@/lib/labels';

interface Completion {
  complete: boolean;
  percent: number;
  missing: string[];
}

interface WeddingEvent {
  id: string;
  name: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
}

interface PublicProfile {
  id: string;
  displayName: string;
  gender?: string;
  ageRange: string | null;
  age?: number | null;
  city?: string;
  photos: string[];
  verified: boolean;
  card?: {
    profession: string | null;
    occupationStatus: string | null;
  };
}

interface Suggestion {
  profile: PublicProfile;
  score?: number;
  shortlisted?: boolean;
  interaction?: string;
}

export function IndividualHome({ profileId }: { profileId: string | null }) {
  const router = useRouter();
  const theme = useTheme();
  const qc = useQueryClient();

  const live = { retry: false, refetchOnMount: 'always' as const, refetchInterval: 60_000 };

  const { data: me, isPending: loadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  const { data: photos } = useQuery({
    queryKey: ['biodata-photos', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/photos`)).data as { photos: string[] },
    retry: false,
  });

  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data as { unread: number },
    ...live,
  });

  const completion = useQuery({
    queryKey: ['biodata-completion', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/completion`)).data as Completion,
    retry: false,
  });

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events')).data,
    retry: false,
  });

  const recommendations = useQuery({
    queryKey: ['recommendations-matches'],
    queryFn: async () => (await api.get('/ai/recommendations/matches')).data as { data: Suggestion[] },
    enabled: Boolean(completion.data?.complete),
    retry: false,
  });

  const toggleShortlist = useMutation({
    mutationFn: async ({ id, isShortlisted }: { id: string; isShortlisted: boolean }) => {
      if (isShortlisted) {
        await api.delete(`/matches/shortlist/${id}`);
      } else {
        await api.put(`/matches/shortlist/${id}`, { note: null });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recommendations-matches'] });
      void qc.invalidateQueries({ queryKey: ['shortlist'] });
    },
  });

  const primaryPhoto = photos?.photos?.[0] ?? null;
  const firstName = me?.displayName?.split(' ')[0] ?? 'There';

  const rows: WeddingEvent[] = Array.isArray(events.data) ? events.data : (events.data?.data ?? []);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((row) => row.eventDate && row.eventDate >= today)
    .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))
    .slice(0, 3);

  const hour = new Date().getHours();
  const greetingText = hour < 12 ? 'Good Morning,' : hour < 17 ? 'Good Afternoon,' : 'Good Evening,';

  if (loadingMe) {
    return <Loading rows={4} />;
  }

  return (
    <View style={{ gap: space(6), paddingBottom: space(6) }}>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space(2) }}>
        <View>
          <Body style={{ fontSize: 24, fontWeight: '800', color: rgb(theme.brandStrong), letterSpacing: -0.5 }}>WOW</Body>
          <Caption tone="muted" style={{ fontSize: 10 }}>Where Families Find Forever</Caption>
        </View>
        <Pressable
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [
            { padding: space(2) },
            pressed && { opacity: 0.7 }
          ]}
        >
          <View>
            <Bell size={24} color={rgb(theme.brandStrong)} />
            {unread?.unread ? (
              <View style={{
                position: 'absolute',
                top: -4,
                right: -8,
                minWidth: 18,
                height: 18,
                borderRadius: radius.md,
                paddingHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: rgb(theme.criticalFg)
              }}>
                <Caption tone="onBrand" style={{ fontSize: 10, lineHeight: 14, fontWeight: '700' }}>
                  {unread.unread > 99 ? '99+' : unread.unread}
                </Caption>
              </View>
            ) : null}
          </View>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/profile')}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: space(3) },
          pressed && { opacity: 0.7 }
        ]}
      >
        <View style={{
          width: 50,
          height: 50,
          borderRadius: radius.md,
          overflow: 'hidden',
          backgroundColor: rgb(theme.surfaceSunken),
        }}>
          {primaryPhoto ? (
            <Image source={{ uri: primaryPhoto }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : (
            <ProfileSilhouette gender={me?.gender} style={{ width: '100%', height: '100%' }} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Body tone="muted" style={{ fontSize: 14 }}>{greetingText}</Body>
          <SectionTitle style={{ fontSize: 20 }}>{firstName}!</SectionTitle>
          <Caption tone="muted" style={{ marginTop: 2 }}>Let's find your perfect match today.</Caption>
        </View>
      </Pressable>


      <Pressable
        onPress={() => router.push('/matches')}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: rgb(theme.surface),
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: rgb(theme.border),
            borderRadius: radius.md,
            padding: space(3),
            gap: space(2),
          },
          pressed && { backgroundColor: rgb(theme.surfaceSunken) }
        ]}
      >
        <MagnifyingGlass size={18} color={rgb(theme.ink[400])} />
        <Body tone="muted" style={{ flex: 1 }}>Search by name, location, profession...</Body>
      </Pressable>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space(2) }}>
        <ActionIcon icon={UserCircle} label="Matches" onPress={() => router.push('/matches')} />
        <ActionIcon icon={ChatCircleDots} label="Messages" onPress={() => router.push('/chat')} />
        <ActionIcon icon={CalendarBlank} label="Events" onPress={() => router.push('/events')} />
        <ActionIcon icon={Heart} label="Shortlisted" onPress={() => router.push('/shortlisted')} />
      </View>

      <View style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>Recommended For You</SectionTitle>
          <Pressable onPress={() => router.push('/matches')}>
            <Caption style={{ color: rgb(theme.brand), fontWeight: '600' }}>See All</Caption>
          </Pressable>
        </View>

        {completion.isPending || (completion.data?.complete && recommendations.isPending) ? (
          <Loading rows={2} />
        ) : !completion.data?.complete || !recommendations.data?.data || recommendations.data.data.length === 0 ? (
          <Card style={{ alignItems: 'center', padding: space(6), gap: space(3) }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
              <MagnifyingGlass size={24} color={rgb(theme.brandStrong)} />
            </View>
            <View style={{ alignItems: 'center', gap: space(1) }}>
              <Body style={{ fontWeight: '600' }}>No recommendations yet</Body>
              <Caption tone="muted" style={{ textAlign: 'center' }}>
                Complete your profile to get better match recommendations.
              </Caption>
            </View>
            <Pressable
              onPress={() => router.push('/biodata')}
              style={{
                backgroundColor: rgb(theme.brand),
                paddingHorizontal: space(4),
                paddingVertical: space(2),
                borderRadius: radius.sm,
                marginTop: space(2)
              }}
            >
              <Body style={{ color: rgb(theme.surface), fontWeight: '600' }}>Complete Profile</Body>
            </Pressable>
          </Card>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(3), paddingRight: space(4) }}>
            {recommendations.data.data.map((rec) => (
              <RecommendationCard
                key={rec.profile.id}
                recommendation={rec}
                onPress={() =>
                  router.push({
                    pathname: '/match/[id]',
                    params: {
                      id: rec.profile.id,
                      score: String(Math.round(rec.score ?? 0)),
                      shortlisted: String(Boolean(rec.shortlisted)),
                      interaction: rec.interaction ?? 'none',
                    },
                  })
                }
                onToggleShortlist={() =>
                  toggleShortlist.mutate({
                    id: rec.profile.id,
                    isShortlisted: Boolean(rec.shortlisted),
                  })
                }
              />
            ))}
          </ScrollView>
        )}
      </View>


      <View style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>Upcoming Events</SectionTitle>
          <Pressable onPress={() => router.push('/events')}>
            <Caption style={{ color: rgb(theme.brand), fontWeight: '600' }}>See All</Caption>
          </Pressable>
        </View>

        {events.isPending ? (
          <Loading rows={2} />
        ) : upcoming.length === 0 ? (
          <Card style={{ alignItems: 'center', padding: space(4), gap: space(2), flexDirection: 'row' }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
              <CalendarBlank size={20} color={rgb(theme.brandStrong)} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>No upcoming events</Body>
              <Caption tone="muted">Events you're interested in will appear here.</Caption>
            </View>
          </Card>
        ) : (
          <Card style={{ gap: 0, padding: 0 }}>
            {upcoming.map((event, index) => {
              const dateObj = event.eventDate ? new Date(event.eventDate) : null;
              const day = dateObj ? dateObj.getDate() : '--';
              const month = dateObj ? dateObj.toLocaleString('default', { month: 'short' }).toUpperCase() : 'TBD';

              return (
                <Pressable
                  key={event.id}
                  onPress={() => router.push('/events')}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: space(3),
                      gap: space(3),
                      borderBottomWidth: index < upcoming.length - 1 ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor: rgb(theme.border)
                    },
                    pressed && { backgroundColor: rgb(theme.surfaceSunken) }
                  ]}
                >
                  <View style={{ alignItems: 'center', minWidth: 40 }}>
                    <SectionTitle style={{ color: rgb(theme.brand), fontSize: 20 }}>{day}</SectionTitle>
                    <Caption style={{ color: rgb(theme.brand), fontWeight: '600' }}>{month}</Caption>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body style={{ fontWeight: '600' }} numberOfLines={1}>{event.name}</Body>
                    <Caption tone="muted" numberOfLines={1}>
                      Venue: {[event.venue, event.city].filter(Boolean).join(', ') || 'To be decided'}
                    </Caption>
                  </View>
                  <CaretRight size={16} color={rgb(theme.ink[300])} />
                </Pressable>
              );
            })}
          </Card>
        )}
      </View>
    </View>
  );
}

function ActionIcon({ icon: Icon, label, onPress }: { icon: any, label: string, onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { alignItems: 'center', gap: space(1.5) },
        pressed && { opacity: 0.7 }
      ]}
    >
      <View style={{
        width: 56,
        height: 56,
        borderRadius: radius.md,
        backgroundColor: rgb(theme.surface),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.border),
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: rgb(theme.ink[900]),
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2
      }}>
        <Icon size={24} color={rgb(theme.brandStrong)} />
      </View>
      <Caption style={{ fontWeight: '500' }}>{label}</Caption>
    </Pressable>
  );
}

function RecommendationCard({ recommendation, onPress, onToggleShortlist }: { recommendation: Suggestion, onPress: () => void, onToggleShortlist: () => void }) {
  const theme = useTheme();
  const p = recommendation.profile;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 140,
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.md,
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.border),
        },
        pressed && { opacity: 0.8 }
      ]}
    >
      <View style={{ width: '100%', height: 140, backgroundColor: rgb(theme.surfaceSunken) }}>
        {p.photos && p.photos.length > 0 ? (
          <Image source={{ uri: p.photos[0] }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <ProfileSilhouette style={{ width: '100%', height: '100%' }} />
        )}
      </View>
      <View style={{ padding: space(2), gap: space(0.5) }}>
        <Body style={{ fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{p.displayName}</Body>
        <Caption tone="muted" style={{ fontSize: 11 }} numberOfLines={1}>
          {ageText(p.age, p.ageRange) ?? 'Unknown age'} • {p.city || 'Unknown city'}
        </Caption>
        <Caption tone="muted" style={{ fontSize: 11 }} numberOfLines={1}>
          {p.card?.profession || p.card?.occupationStatus || 'Unknown profession'}
        </Caption>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space(1) }}>
          {p.verified ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: rgb(theme.positiveBg), paddingHorizontal: 4, paddingVertical: 2, borderRadius: radius.md }}>
              <Caption style={{ color: rgb(theme.positiveFg), fontSize: 10, fontWeight: '600' }}>Verified</Caption>
            </View>
          ) : <View />}
          <Pressable
            onPress={onToggleShortlist}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => [pressed && { opacity: 0.5 }]}
          >
            <Heart size={16} weight={recommendation.shortlisted ? "fill" : "regular"} color={recommendation.shortlisted ? rgb(theme.brand) : rgb(theme.ink[400])} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}
