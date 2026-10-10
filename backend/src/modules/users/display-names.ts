import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from './entities/profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { maskEmail, maskPhone } from '../../common/util/pii-mask';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';

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
 *
 * `maskEmail` is for administrator lists (ISS-11): the email fallback is then
 * shown masked, so a nameless account still reads as somebody recognisable
 * without the list printing its address.
 */
export async function displayNamesByUserIds(
  repos: NameRepositories,
  ids: (string | null | undefined)[],
  options: { maskEmail?: boolean } = {},
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
      email: options.maskEmail ? maskEmail(emailOf.get(id)) : emailOf.get(id),
    });
    if (name) names.set(id, name);
  }
  return names;
}

/** How an administrator list names one account (WOW-01..04). */
export interface AdminAccountName {
  /**
   * The label the row leads with: the person's name, else their business,
   * else the masked email or mobile. Never a raw contact value.
   */
  name: string | null;
  /** The person's own name, when one is on record. */
  personName: string | null;
  /**
   * The business the account runs: the vendor business, the planner's
   * company or the matchmaking agency, oldest first.
   */
  businessName: string | null;
}

export interface AdminNameRepositories extends NameRepositories {
  /** Biodata, for the first and last name the intake form records. */
  details?: Repository<ProfileDetails>;
}

/** `Asha` + `Rao` -> `Asha Rao`; blanks drop out, nothing at all is null. */
export function joinName(...parts: (string | null | undefined)[]): string | null {
  const joined = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return joined || null;
}

/**
 * Names for a page of accounts on an administrator list.
 *
 * The lists used to lead with the email — masked since ISS-11, which left a
 * column of `r***@gmail.com` an administrator could not tell apart. A person
 * is recognised by name, so the label is the first and last name from their
 * own profile's biodata, else the profile's display name (every sign-up
 * records one), else the business the account runs, and only then the masked
 * email or mobile.
 *
 * Takes the account rows already read, with their stored contact values, so
 * the masking happens here and nowhere upstream has to remember it.
 */
export async function adminAccountNames(
  repos: AdminNameRepositories,
  accounts: { id: string; email?: string | null; phone?: string | null }[],
): Promise<Map<string, AdminAccountName>> {
  const ids = [...new Set(accounts.map((a) => a.id).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [profiles, vendors, planners, agencies] = await Promise.all([
    repos.profiles.find({ where: { userId: In(ids) }, order: { createdAt: 'ASC' } }),
    repos.vendors
      ? repos.vendors.find({ where: { ownerUserId: In(ids) }, order: { createdAt: 'ASC' } })
      : Promise.resolve([] as Vendor[]),
    repos.planners
      ? repos.planners.find({ where: { ownerUserId: In(ids) }, order: { createdAt: 'ASC' } })
      : Promise.resolve([] as PlannerProfile[]),
    repos.agencies
      ? repos.agencies.find({ where: { ownerUserId: In(ids) }, order: { createdAt: 'ASC' } })
      : Promise.resolve([] as AgentProfile[]),
  ]);

  // The account's own profile: the oldest one it owns outright.
  const ownProfile = new Map<string, Profile>();
  for (const p of profiles) if (p.userId && !ownProfile.has(p.userId)) ownProfile.set(p.userId, p);

  const profileIds = [...ownProfile.values()].map((p) => p.id);
  const details =
    repos.details && profileIds.length
      ? await repos.details.find({ where: { profileId: In(profileIds) } })
      : [];
  const detailsFor = new Map(details.map((d) => [d.profileId, d]));

  const firstBy = <T>(rows: T[], key: (row: T) => string | null, value: (row: T) => string | null) => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const k = key(row);
      const v = filled(value(row));
      if (k && v && !map.has(k)) map.set(k, v.trim());
    }
    return map;
  };
  const vendorName = firstBy(vendors, (v) => v.ownerUserId, (v) => v.name);
  const plannerName = firstBy(planners, (p) => p.ownerUserId, (p) => p.agencyName);
  const agencyName = firstBy(agencies, (a) => a.ownerUserId, (a) => a.agencyName);

  const names = new Map<string, AdminAccountName>();
  for (const account of accounts) {
    const profile = ownProfile.get(account.id);
    const d = profile ? detailsFor.get(profile.id) : undefined;
    const personName =
      joinName(d?.firstName, d?.lastName || d?.surname) ?? filled(profile?.displayName)?.trim() ?? null;
    const businessName =
      vendorName.get(account.id) ?? plannerName.get(account.id) ?? agencyName.get(account.id) ?? null;
    names.set(account.id, {
      name: personName ?? businessName ?? maskEmail(account.email) ?? maskPhone(account.phone),
      personName,
      businessName,
    });
  }
  return names;
}
