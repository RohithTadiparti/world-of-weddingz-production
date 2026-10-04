import { isAxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { Permission, can } from '@/shared/permissions';
import type { PlannerWedding } from '@/shared/planner-profile';
import type { SocialLink } from '@/shared/social-links';

/**
 * A wedding planner's own listing, from `GET /wedding-planners/me`.
 *
 * A planner has exactly one, addressed as `me` on the server, which is why this
 * is a single row rather than the vendor's list of businesses and a switcher.
 * The screens that read `/vendors/me` for a planner — Home's rating and open
 * windows, the payout account, My Reviews — read this instead: a planner has no
 * vendor listing, so every one of those came back empty.
 *
 * A 404 means no listing has been written yet. That is an answer (null) rather
 * than an error, and the screens say so rather than showing a failure.
 */
export interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

export interface PlannerListing {
  id: string;
  agencyName: string;
  bio: string | null;
  city: string | null;
  servesCities: string[];
  packages: PlannerPackage[];
  yearsExperience: number;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  /** Absent from a server that predates the list; the three below mirror it. */
  socialLinks?: SocialLink[];
  website: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  portfolio: string[];
  /**
   * The public profile. Optional because a server that predates it leaves
   * them out; the form reads an absent one as empty.
   */
  services?: string[];
  specializations?: string[];
  weddingsCompleted?: number | null;
  planningApproach?: string | null;
  introVideoUrl?: string | null;
  weddings?: PlannerWedding[];
  ratingAvg: number;
  ratingCount: number;
  isApproved: boolean;
  payoutAccountId: string | null;
}

/**
 * A planner who is not also a vendor.
 *
 * The vendor's screens win for an account holding both, because that account's
 * set-up is the vendor's guided one and its home is built on the business
 * switcher.
 */
export function isPlannerAccount(permissions: string[] | null | undefined): boolean {
  return (
    can(permissions, Permission.PLANNER_LISTING_MANAGE) &&
    !can(permissions, Permission.VENDOR_LISTING_MANAGE)
  );
}

export function usePlannerListing(enabled = true) {
  return useQuery({
    queryKey: ['planner-me'],
    enabled,
    retry: false,
    queryFn: async (): Promise<PlannerListing | null> => {
      try {
        return (await api.get('/wedding-planners/me')).data as PlannerListing;
      } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }
    },
  });
}
