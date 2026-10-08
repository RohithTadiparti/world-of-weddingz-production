/**
 * Labels for the side of a match a profile is on, and for who manages it.
 *
 * `managingFor` is only set when a family member records who the match is for;
 * an agency-built profile leaves it null, and older rows may hold anything. A
 * renderer that read `managingFor === 'bride' ? 'Bride' : 'Groom'` called every
 * such profile a groom, including a woman an agency had listed. The side is
 * read from `managingFor` when it is a real side, then from the gender, and is
 * otherwise left neutral rather than guessed.
 */
export type ProfileSide = 'Bride' | 'Groom' | 'Profile';

export function profileSideLabel(
  managingFor: string | null | undefined,
  gender?: string | null,
): ProfileSide {
  const side = (managingFor ?? '').trim().toLowerCase();
  if (side === 'bride') return 'Bride';
  if (side === 'groom') return 'Groom';
  const g = (gender ?? '').trim().toLowerCase();
  if (g === 'female' || g === 'f') return 'Bride';
  if (g === 'male' || g === 'm') return 'Groom';
  return 'Profile';
}

export interface StewardshipInfo {
  kind?: string | null;
  /** The whole line from the server, "Managed by" already included. */
  label?: string | null;
  relation?: string | null;
}

/**
 * One line saying who manages a profile, with "Managed by" said exactly once.
 *
 * The server's label already reads "Managed by an agency"; the preview put its
 * own "Managed by" in front of it and printed "Managed by Managed by an agency".
 * A family steward's recorded relation is the more useful phrase when there is
 * one ("Managed by their parent").
 */
export function stewardshipLine(stewardship: StewardshipInfo | null | undefined): string | null {
  if (!stewardship) return null;
  const relation = stewardship.relation?.trim();
  if (relation && stewardship.kind !== 'agency') return `Managed by their ${relation.toLowerCase()}`;
  const label = stewardship.label?.trim();
  if (!label) return null;
  return /^managed\b/i.test(label) ? label : `Managed by ${label}`;
}

/**
 * The stewardship line for a suggestion card.
 *
 * Uses the server's `stewardship` hint where it is sent, falling back to the
 * older `managedByRelation`. An agency line is left to the card's own
 * "Added by <agency>" when that is shown, so the agency is not named twice.
 */
export function cardStewardshipLine(p: {
  stewardship?: StewardshipInfo | null;
  managedByRelation?: string | null;
  sourceAgency?: string | null;
}): string | null {
  if (p.stewardship) {
    if (p.stewardship.kind === 'agency' && p.sourceAgency) return null;
    return stewardshipLine(p.stewardship);
  }
  return p.managedByRelation ? `Managed by their ${p.managedByRelation.toLowerCase()}` : null;
}
