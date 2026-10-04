import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from './entities/profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';

/** Where a person's name can come from, strongest first. */
export interface NameSources {
  profileName?: string | null;
  businessName?: string | null;
  email?: string | null;
}

const filled = (value?: string | null): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

/**
 * The name to show for an account.
 *
 * A marriage profile carries a person's own name, but most provider accounts —
 * vendors, planners, agencies, officers — never have one. Reading the profile
 * alone put "Customer", "Provider" or a blank where the business was plainly
 * named on its own record, so the business name follows, and the email is the
 * last resort because it is always there.
 */
export function pickDisplayName(src: NameSources): string | null {
  return filled(src.profileName) ?? filled(src.businessName) ?? filled(src.email);
}

export interface NameRepositories {
  users: Repository<User>;
  profiles: Repository<Profile>;
  vendors?: Repository<Vendor>;
  planners?: Repository<PlannerProfile>;
  agencies?: Repository<AgentProfile>;
}

/**
 * Display names for many accounts at once, keyed by user id: the profile's
 * name, else the business the account owns (vendor, planner agency, then
 * matchmaking agency), else the email. One read per source for the whole set.
 * A source whose repository is not passed is simply not consulted.
 */
export async function displayNamesByUserIds(
  repos: NameRepositories,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const [users, profiles, vendors, planners, agencies] = await Promise.all([
    repos.users.find({ where: { id: In(unique) }, select: ['id', 'email'] }),
    repos.profiles.find({ where: { userId: In(unique) } }),
    repos.vendors
      ? repos.vendors.find({ where: { ownerUserId: In(unique) }, order: { createdAt: 'ASC' } })
      : Promise.resolve([] as Vendor[]),
    repos.planners
      ? repos.planners.find({ where: { ownerUserId: In(unique) } })
      : Promise.resolve([] as PlannerProfile[]),
    repos.agencies
      ? repos.agencies.find({ where: { ownerUserId: In(unique) } })
      : Promise.resolve([] as AgentProfile[]),
  ]);

  // The first of each kind wins, so an owner of several businesses reads as
  // the oldest of them rather than whichever row happened to come back last.
  const first = <T>(rows: T[], key: (row: T) => string | null, value: (row: T) => string) => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const k = key(row);
      if (k && !map.has(k) && filled(value(row))) map.set(k, value(row));
    }
    return map;
  };
  const profileName = first(profiles, (p) => p.userId, (p) => p.displayName);
  const vendorName = first(vendors, (v) => v.ownerUserId, (v) => v.name);
  const plannerName = first(planners, (p) => p.ownerUserId, (p) => p.agencyName);
  const agencyName = first(agencies, (a) => a.ownerUserId, (a) => a.agencyName);
  const emailOf = new Map(users.map((u) => [u.id, u.email]));

  const names = new Map<string, string>();
  for (const id of unique) {
    const name = pickDisplayName({
      profileName: profileName.get(id),
      businessName: vendorName.get(id) ?? plannerName.get(id) ?? agencyName.get(id),
      email: emailOf.get(id),
    });
    if (name) names.set(id, name);
  }
  return names;
}
