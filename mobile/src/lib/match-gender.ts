/**
 * Which side of a match a profile is on: a bride is `female`, a groom `male`.
 *
 * Mirrors the server's matchGender (backend matchmaking/match-gender.ts) and
 * has to keep doing so: the server decides from it whether a family save may
 * keep a net worth, so a client that decides "groom" differently either asks
 * a bride's family for a figure that is thrown away or never asks a groom's.
 *
 * `managingFor` comes first and only then `gender`. A family member's profile
 * can carry the family member's own gender (a mother managing her son records
 * "Female") while `managingFor` says whose match it actually is. Both are
 * compared case-insensitively, as the web and agency forms spell them
 * differently.
 */
export type MatchGender = 'male' | 'female';

export function matchGender(
  p: { gender?: string | null; managingFor?: string | null } | null | undefined,
): MatchGender | null {
  if (!p) return null;
  const side = (p.managingFor ?? '').trim().toLowerCase();
  if (side === 'bride') return 'female';
  if (side === 'groom') return 'male';
  const gender = (p.gender ?? '').trim().toLowerCase();
  if (gender === 'female' || gender === 'f') return 'female';
  if (gender === 'male' || gender === 'm') return 'male';
  return null;
}

/** What a family save says back when it did not keep some of what was sent. */
export interface FamilySaveResult {
  ignoredFields?: string[];
  notice?: string;
}
