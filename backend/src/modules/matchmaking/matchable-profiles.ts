import { In, Repository } from 'typeorm';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { UserRole, isMatchable } from '../../common/enums';

/** Why a profile that is not a bride or groom is refused as a matchmaking subject. */
export const NOT_A_CANDIDATE_MESSAGE =
  'Only a bride or groom profile can take part in matchmaking.';

/**
 * Profiles that are not somebody to be matched.
 *
 * A profile is a matchmaking subject when it is unclaimed (an agency or a
 * family built it for a relative and nobody has signed in to it yet) or when
 * the account holding it is a bride or groom. Everything else — a family
 * account's own row, which describes the parent or guardian; an agency's own
 * row; a vendor's or planner's — is returned here, so a caller can refuse or
 * drop it.
 *
 * One read for the whole set. A profile whose account no longer exists counts
 * as not matchable: there is nobody behind it to answer.
 */
export async function nonMatchableProfileIds(
  users: Pick<Repository<User>, 'find'>,
  profiles: Pick<Profile, 'id' | 'userId'>[],
): Promise<Set<string>> {
  const owned = profiles.filter((p) => p.userId);
  if (owned.length === 0) return new Set();
  const accounts = await users.find({
    where: { id: In([...new Set(owned.map((p) => p.userId as string))]) },
    select: ['id', 'role'],
  });
  const roleById = new Map(accounts.map((u) => [u.id, u.role as UserRole]));
  return new Set(
    owned
      .filter((p) => {
        const role = roleById.get(p.userId as string);
        return !role || !isMatchable(role);
      })
      .map((p) => p.id),
  );
}

/**
 * The role of whoever manages each of these profiles, keyed by profile.
 *
 * What a card says about a managed profile depends on it — "Managed by a family
 * member" and an agency listing are different propositions — and the profile
 * row alone cannot tell the two apart when no relation was recorded. Self-run
 * profiles are absent from the map.
 */
export async function stewardRolesFor(
  users: Pick<Repository<User>, 'find'>,
  profiles: Pick<Profile, 'id' | 'userId' | 'managedByUserId'>[],
): Promise<Map<string, UserRole>> {
  const managed = profiles.filter((p) => p.managedByUserId && p.managedByUserId !== p.userId);
  if (managed.length === 0) return new Map();
  const stewards = await users.find({
    where: { id: In([...new Set(managed.map((p) => p.managedByUserId as string))]) },
    select: ['id', 'role'],
  });
  const roleById = new Map(stewards.map((u) => [u.id, u.role as UserRole]));
  const byProfile = new Map<string, UserRole>();
  for (const p of managed) {
    const role = roleById.get(p.managedByUserId as string);
    if (role) byProfile.set(p.id, role);
  }
  return byProfile;
}
