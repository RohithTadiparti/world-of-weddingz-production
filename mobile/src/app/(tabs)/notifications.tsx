import { FlatList, Pressable, RefreshControl, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight, Heart, Users, FileText, CalendarBlank, Bell, Sparkle, ChatCircle, Briefcase, SealCheck, ClipboardText } from 'phosphor-react-native';
import { Image } from 'expo-image';

import { HeartBackdrop } from '@/components/heart-field';
import { api } from '@/lib/api';
import { routeFor } from '@/lib/notification-route';
import { formatDate } from '@/shared/dates';
import { describe, type Notification } from '@/shared/notification-copy';
import { Permission, can, canAny } from '@/shared/permissions';
import { Body, Caption, Loading, SectionTitle } from '@/components/ui';
import { NotificationBell } from '@/components/home/notification-bell';
import { selectPermissions, useAuth } from '@/store/auth';
import { radius, rgb, space, useTheme } from '@/theme';
import { ProfileSilhouette } from '@/components/profile-silhouette';
import { typeface } from '@/theme/fonts';

function getNotificationIcon(type: string, theme: any, isRead: boolean) {
  const color = isRead ? rgb(theme.ink[400]) : rgb(theme.brand);
  const weight = 'fill';
  if (type.startsWith('match_interest') || type.includes('liked')) return <Heart size={20} color={color} weight={weight} />;
  if (type.startsWith('match_')) return <Users size={20} color={color} weight={weight} />;
  if (type.startsWith('booking_')) return <Briefcase size={20} color={color} weight={weight} />;
  if (type.startsWith('event_')) return <CalendarBlank size={20} color={color} weight={weight} />;
  if (type.startsWith('verification_')) return <SealCheck size={20} color={color} weight={weight} />;
  if (type.startsWith('new_message') || type === 'chat') return <ChatCircle size={20} color={color} weight={weight} />;
  if (type === 'task_reminder') return <ClipboardText size={20} color={color} weight={weight} />;
  return <FileText size={20} color={color} weight={weight} />;
}

function photoOf(item: Notification): string | null {
  const payload = item.payload || {};
  const photoUrl = payload.photoUrl || payload.counterpartImage || payload.image;
  return typeof photoUrl === 'string' && photoUrl ? photoUrl : null;
}

/** Whether the avatar slot shows a person; otherwise it already shows the type icon. */
function showsPerson(item: Notification): boolean {
  return (
    Boolean(photoOf(item)) ||
    item.type.startsWith('match_interest') ||
    item.type === 'new_message' ||
    item.type.includes('liked')
  );
}

function getAvatarOrIcon(item: Notification, theme: any) {
  const payload = item.payload || {};
  const photoUrl = photoOf(item);
  const gender = payload.gender as string | undefined;

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: rgb(theme.surfaceSunken) }}
        contentFit="cover"
      />
    );
  }

  // If it's a person-related notification but no photo, show silhouette
  if (item.type.startsWith('match_interest') || item.type === 'new_message' || item.type.includes('liked')) {
    return <ProfileSilhouette gender={gender} style={{ width: 48, height: 48, borderRadius: radius.md }} />;
  }

  // System/Event notification fallback
  let IconCmp = FileText;
  if (item.type.startsWith('event_')) IconCmp = CalendarBlank;
  else if (item.type.startsWith('match_')) IconCmp = Users;
  else if (item.type.startsWith('booking_')) IconCmp = Briefcase;

  return (
    <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center' }}>
      <IconCmp size={24} color={rgb(theme.brandStrong)} weight="regular" />
    </View>
  );
}

export default function Notifications() {
  const theme = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  const permissions = useAuth(selectPermissions);

  const canReadIncoming = can(permissions, Permission.BOOKING_READ_INCOMING);
  const canVerify = canAny(permissions, [
    Permission.VERIFICATION_PROCESS,
    Permission.VERIFICATION_ALLOCATE,
  ]);

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data as Notification[],
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const items = data ?? [];


  const header = (
    <View style={{ gap: space(4), paddingHorizontal: space(4), paddingTop: space(6), paddingBottom: space(4) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={[typeface({ fontSize: 28, fontWeight: '700' }), { color: rgb(theme.brandStrong), letterSpacing: -0.5 }]}>
            WOW
          </Text>
          <Text style={[typeface({ fontSize: 12, fontWeight: '500' }), { color: rgb(theme.brandStrong), opacity: 0.8 }]}>
            Where Families Find Forever
          </Text>
        </View>
        <NotificationBell />
      </View>
    </View>
  );

  if (isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
        {header}
        <View style={{ padding: space(4) }}>
          <Loading rows={4} />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6), gap: space(4) }}>
          <SectionTitle>Unable to load notifications</SectionTitle>
          <Body tone="muted">Please try again.</Body>
          <Pressable
            accessibilityRole="button"
            onPress={() => refetch()}
            style={({ pressed }) => [
              {
                backgroundColor: rgb(theme.brand),
                paddingVertical: space(2),
                paddingHorizontal: space(4),
                borderRadius: radius.md,
              },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[typeface({ fontWeight: '600' }), { color: '#fff' }]}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
      {header}

      <View style={{ flex: 1, backgroundColor: rgb(theme.surface), borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 }}>
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingBottom: space(12) }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={rgb(theme.ink[400])} />
          }
          ListHeaderComponent={
            <View style={{ padding: space(4), paddingBottom: space(2), flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <SectionTitle style={{ fontSize: 18, color: rgb(theme.ink[900]) }}>Notifications</SectionTitle>
              {items.some(n => !n.isRead) ? (
                <Pressable onPress={() => markAll.mutate()} hitSlop={8} accessibilityRole="button">
                  <Caption tone="brand">Mark all as read</Caption>
                </Pressable>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={{ padding: space(6), alignItems: 'center', justifyContent: 'center', gap: space(2) }}>
              <SectionTitle>No notifications yet</SectionTitle>
              <Body tone="muted" style={{ textAlign: 'center' }}>We'll let you know when something important happens.</Body>
            </View>
          }
          renderItem={({ item, index }) => {
            const route = routeFor(item, { canVerify, canReadIncoming });
            const isLast = index === items.length - 1;

            // Try to extract bold name from description if possible (e.g. "Priya Sharma liked your profile")
            const desc = describe(item) || 'Something has changed on your account.';
            const payload = item.payload || {};
            // clientName is the buyer: a title for the seller, the reader's own name for the buyer.
            let title =
              (payload.counterpartName as string) ||
              (payload.subjectName as string) ||
              (canReadIncoming ? (payload.clientName as string) : '') ||
              '';
            let restDesc = desc;

            if (title && desc.startsWith(title)) {
              restDesc = desc.substring(title.length).trim();
            } else if (!title) {
              // Simple heuristic to split first few words as title for system notifications
              const parts = desc.split(/([.!])/);
              if (parts.length > 1) {
                title = parts[0] + (parts[1] || '');
                restDesc = parts.slice(2).join('').trim();
              } else {
                title = desc;
                restDesc = '';
              }
            }

            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (!item.isRead) markRead.mutate(item.id);
                  if (route) router.push(route);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: space(3),
                    paddingHorizontal: space(4),
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: rgb(theme.border),
                    backgroundColor: item.isRead ? rgb(theme.surface) : rgb(theme.surfaceSunken)
                  },
                  pressed && { opacity: 0.7 }
                ]}
              >
                {showsPerson(item) ? (
                  <View style={{ width: 32, alignItems: 'center', justifyContent: 'center', marginRight: space(2) }}>
                    {getNotificationIcon(item.type, theme, item.isRead)}
                  </View>
                ) : null}

                <View style={{ marginRight: space(3) }}>
                  {getAvatarOrIcon(item, theme)}
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  {title ? (
                    <Text style={[typeface({ fontWeight: '700', fontSize: 14 }), { color: rgb(theme.ink[900]) }]}>
                      {title}
                    </Text>
                  ) : null}
                  {restDesc ? (
                    <Text style={[typeface({ fontWeight: '400', fontSize: 14 }), { color: item.isRead ? rgb(theme.ink[500]) : rgb(theme.ink[700]) }]}>
                      {restDesc}
                    </Text>
                  ) : null}
                  <Caption tone="faint" style={{ marginTop: 2 }}>{formatDate(item.createdAt)}</Caption>
                </View>

                {route ? (
                  <View style={{ paddingLeft: space(2) }}>
                    <CaretRight size={16} color={rgb(theme.ink[400])} />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}

