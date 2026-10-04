import { Profile } from '../users/entities/profile.entity';

/**
 * The four figures at the top of Matches, each of which is also a filter.
 *
 * They used to be worked out in the browser from whatever happened to be on
 * the page — "Active today" counted the twelve cards loaded, "High
 * compatibility" was the length of a five-row recommendation panel — so none
 * of them was a count of anything the reader could then open. Counting here,
 * over the same scored list the page is cut from, is what makes a tile's figure
 * equal the number of rows it shows once pressed.
 */
export const MATCH_VIEWS = ['all', 'active', 'high', 'shortlisted'] as const;
export type MatchView = (typeof MATCH_VIEWS)[number];

/** The same line the "Recommended for you" panel draws: 50% and over. */
export const HIGH_COMPATIBILITY = 50;

const DAY_MS = 86_400_000;

export interface MatchViewCounts {
  total: number;
  activeToday: number;
  highCompatibility: number;
  shortlisted: number;
}

interface ScoredRow {
  profile: Pick<Profile, 'id' | 'lastActiveAt'>;
  score: number;
}

/** Whether one scored candidate belongs in the chosen view. */
export function inView(
  view: MatchView | undefined,
  row: ScoredRow,
  shortlisted: Set<string>,
  now: number,
): boolean {
  switch (view ?? 'all') {
    case 'active': {
      // The last twenty-four hours rather than since midnight, which is what
      // the tile always meant and does not depend on whose midnight.
      const seen = row.profile.lastActiveAt;
      return seen ? now - new Date(seen).getTime() < DAY_MS : false;
    }
    case 'high':
      return row.score >= HIGH_COMPATIBILITY;
    case 'shortlisted':
      return shortlisted.has(row.profile.id);
    default:
      return true;
  }
}

export function viewCounts(
  rows: ScoredRow[],
  shortlisted: Set<string>,
  now: number,
): MatchViewCounts {
  const count = (view: MatchView) => rows.filter((r) => inView(view, r, shortlisted, now)).length;
  return {
    total: rows.length,
    activeToday: count('active'),
    highCompatibility: count('high'),
    shortlisted: count('shortlisted'),
  };
}
