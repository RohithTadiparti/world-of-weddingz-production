import { FindOptionsWhere, Raw } from 'typeorm';
import { Profile } from '../users/entities/profile.entity';

export type MatchGender = 'male' | 'female';

/**
 * Which side of a match a profile is on: a bride is `female`, a groom `male`.
 *
 * Read from `managingFor` first and only then from `gender`. A family member's
 * profile carries the family member's own gender — a mother managing her son
 * records "Female" — while `managingFor` says whose match it actually is. The
 * suggestions used to exclude "the same gender as the profile", which for that
 * mother meant excluding women and handing her son a list of grooms.
 *
 * Case-insensitive on purpose: the web form writes "Female", the seed and the
 * agency forms write "female", and a strict comparison between the two let
 * every profile of both genders through.
 */
export function matchGender(p: Pick<Profile, 'gender' | 'managingFor'>): MatchGender | null {
  const side = (p.managingFor ?? '').trim().toLowerCase();
  if (side === 'bride') return 'female';
  if (side === 'groom') return 'male';
  const gender = (p.gender ?? '').trim().toLowerCase();
  if (gender === 'female' || gender === 'f') return 'female';
  if (gender === 'male' || gender === 'm') return 'male';
  return null;
}

/** Who this profile should be shown, or null when its side is not known yet. */
export function soughtGender(p: Pick<Profile, 'gender' | 'managingFor'>): MatchGender | null {
  const own = matchGender(p);
  if (!own) return null;
  return own === 'female' ? 'male' : 'female';
}

/**
 * The same rule as `matchGender`, as `find()` conditions ORed together: either
 * the steward said which side this profile is on, or they did not and the
 * profile's own gender decides.
 */
export function genderWhere(want: MatchGender): FindOptionsWhere<Profile>[] {
  const side = want === 'female' ? 'bride' : 'groom';
  const spellings = want === 'female' ? ['female', 'f'] : ['male', 'm'];
  return [
    { managingFor: Raw((col) => `LOWER(${col}) = :side`, { side }) },
    {
      managingFor: Raw((col) => `(${col} IS NULL OR LOWER(${col}) NOT IN ('bride', 'groom'))`),
      gender: Raw((col) => `LOWER(TRIM(${col})) IN (:...spellings)`, { spellings }),
    },
  ];
}

/** The same rule again, as a SQL expression over a query-builder alias. */
export function matchGenderSql(alias: string): string {
  const g = `LOWER(TRIM(${alias}.gender))`;
  return `COALESCE(
    CASE LOWER(${alias}."managingFor") WHEN 'bride' THEN 'female' WHEN 'groom' THEN 'male' END,
    CASE WHEN ${g} IN ('female', 'f') THEN 'female' WHEN ${g} IN ('male', 'm') THEN 'male' END
  )`;
}
