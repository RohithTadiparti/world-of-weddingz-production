import { ProfileVisibility } from '../../common/enums';

export interface ProfileAccessRelationship {
  owner?: boolean;
  accepted?: boolean;
  fixed?: boolean;
}

/** Discovery and interest creation must never use this field-access decision. */
export function hasFullProfileAccess(
  visibility: ProfileVisibility,
  relationship: ProfileAccessRelationship = {},
): boolean {
  if (relationship.owner || visibility === ProfileVisibility.PUBLIC) return true;
  if (relationship.fixed) return true;
  return visibility === ProfileVisibility.MATCHES_ONLY && Boolean(relationship.accepted);
}
