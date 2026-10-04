import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { api } from '@/lib/api';
import { Permission, can } from '@/shared/permissions';
import type { PlannerWedding } from '@/shared/planner-profile';
import type { SocialLink } from '@/shared/social-links';
import { selectPermissions, useAuth } from '@/store/auth';

/**
 * A wedding planner's public listing as a couple reads it, and the few reads
 * every planner screen shares.
 *
 * The profile, its weddings, one wedding and the request screen all open on
 * the same `GET /wedding-planners/:id`, under the one query key, so stepping
 * from the profile into "View all" or the request form draws from the cache
 * rather than loading the planner a second time.
 */

export interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

export interface PlannerProfile {
  id: string;
  agencyName: string;
  bio?: string | null;
  city?: string | null;
  state?: string | null;
  servesCities?: string[];
  packages?: PlannerPackage[];
  yearsExperience?: number | null;
  ratingAvg: number | string;
  ratingCount: number;
  portfolio?: string[];
  services?: string[];
  specializations?: string[];
  introVideoUrl?: string | null;
  weddingsCompleted?: number | null;
  planningApproach?: string | null;
  weddings?: PlannerWedding[];
  socialLinks?: SocialLink[] | null;
  website?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
}

export interface PlannerReview {
  id: string;
  rating: number;
  comment?: string | null;
  createdAt?: string;
}

export function usePlannerProfile(id: string | undefined) {
  return useQuery({
    queryKey: ['planner', id],
    queryFn: async () => (await api.get(`/wedding-planners/${id}`)).data as PlannerProfile,
    enabled: Boolean(id),
    retry: false,
  });
}

export function usePlannerReviews(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['planner-reviews', id],
    queryFn: async () => {
      const data = (await api.get(`/wedding-planners/${id}/reviews`)).data as
        | { data?: PlannerReview[] }
        | PlannerReview[];
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

/**
 * Whether this account may ask a planner for work.
 *
 * The same permission the server checks on `POST /bookings` and on the
 * favourite endpoints, so a planner or vendor browsing a colleague's profile is
 * shown neither a heart nor a request button that would only be refused.
 */
export function useCanRequestPlanner(): boolean {
  const permissions = useAuth(selectPermissions);
  return can(permissions, Permission.BOOKING_CREATE);
}

export function plannerPlace(p: Pick<PlannerProfile, 'city' | 'state'>): string {
  return [p.city, p.state].filter(Boolean).join(', ');
}

export function plannerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** The lowest package price, or null when the planner quotes on request. */
export function startingPrice(packages: PlannerPackage[] | undefined): number | null {
  const prices = (packages ?? []).map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Opens a video where it plays best.
 *
 * The app carries no video player, and a YouTube or Vimeo page plays in its own
 * player anyway, so every link opens in the in-app browser; an uploaded file
 * plays there too. If the browser sheet cannot open (no browser on an emulator,
 * say) the system is asked to handle the address instead.
 */
export function openVideo(url: string): void {
  void WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}
