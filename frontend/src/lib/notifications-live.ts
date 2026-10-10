import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './api';
import { socketOrigin } from './socket-origin';
import { useAuth } from '../store/auth';

/**
 * The queries a new or read notification can make stale.
 *
 * The badge and the feed, and the screens notifications are usually about: a
 * vendor's booking queue and counts while a booking is in progress (row 22), a
 * listing's verification status (row 11) and the Support page's cases.
 */
export const NOTIFICATION_DRIVEN_QUERIES: readonly string[] = [
  'notifications',
  'unread-count',
  'incoming-bookings',
  'incoming-counts',
  'bookings',
  'vendor-me',
  'verification-me',
  'support-cases',
  'verification-cases',
];

export function refreshNotificationDriven(qc: QueryClient): void {
  for (const key of NOTIFICATION_DRIVEN_QUERIES) void qc.invalidateQueries({ queryKey: [key] });
}

/**
 * Marks a notification read the way opening it should (rows 21b and 22).
 *
 * A notification about a subject reads every update about that subject — the
 * feed folds them into one row, and leaving the older ones unread kept the
 * badge above zero after the reader had seen them. The count is refreshed
 * straight away rather than on the next poll.
 */
export async function markOpened(
  qc: QueryClient,
  n: { id: string; targetId: string | null; isRead: boolean },
): Promise<void> {
  try {
    if (n.targetId) await api.put(`/notifications/targets/${n.targetId}/read`, {});
    else if (!n.isRead) await api.put(`/notifications/${n.id}/read`, {});
  } finally {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['unread-count'] });
  }
}

/**
 * Listens on the notifications socket and refreshes what it makes stale.
 *
 * The server only says "something changed"; the content is always refetched
 * through the authorised endpoints. Polling stays on underneath, so a dropped
 * socket costs at most one poll interval.
 */
export function useNotificationsLive(enabled: boolean): void {
  const qc = useQueryClient();
  const token = useAuth((state) => state.accessToken);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    const socket = io(`${socketOrigin()}/notifications`, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 2000,
      timeout: 5000,
    });
    const refresh = () => refreshNotificationDriven(qc);
    socket.on('notifications:changed', refresh);
    socket.on('connect', refresh);
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [enabled, token, qc]);
}
