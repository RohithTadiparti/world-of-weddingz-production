import { randomBytes } from 'crypto';

/**
 * Where an object lives, decided by who owns it.
 *
 * The first two segments of every key name the owner, so the question "who may
 * read this" is answered from the key itself rather than from whichever row
 * happens to point at it:
 *
 *   users/{userId}/profile/…       photographs shown on a profile or biodata
 *   users/{userId}/albums/…        the couple's own albums
 *   users/{userId}/attachments/…   evidence, receipts, chat attachments
 *   users/{userId}/biodata/…       a biodata document read by the extractor
 *   vendors/{vendorId}/portfolio/… a listing's portfolio
 *   bookings/{bookingId}/deliveries/…  what the provider hands the couple
 *   bookings/{bookingId}/references/…  what the couple shows the provider
 */
export type KeyScope =
  | { owner: 'users'; id: string; area: 'profile' | 'albums' | 'attachments' | 'biodata' }
  | { owner: 'vendors'; id: string; area: 'portfolio' }
  | { owner: 'bookings'; id: string; area: 'deliveries' | 'references' };

const AREAS: Record<KeyScope['owner'], readonly string[]> = {
  users: ['profile', 'albums', 'attachments', 'biodata'],
  vendors: ['portfolio'],
  bookings: ['deliveries', 'references'],
};

/** An owner id as it may appear in a key: a UUID, or anything shaped like one. */
const OWNER_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * A key the platform could have minted.
 *
 * Keys come back from clients (in a ref, in a presigned URL, in the complete
 * step), so the shape is re-checked wherever one arrives rather than trusted:
 * no `..`, no empty segment, nothing that needs escaping in a URL.
 */
export function isSafeKey(key: string): boolean {
  if (key.length === 0 || key.length > 1024) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(key)) return false;
  return key.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/**
 * The stored name.
 *
 * The filename comes from someone's phone or laptop, so it arrives with
 * spaces, brackets, apostrophes and occasionally an emoji in it. Those are
 * fine in a filename and awkward in a URL — a raw space produces a link that
 * some clients encode and others truncate, and the file appears to vanish.
 *
 * So the name is folded down here rather than refused at the door. What the
 * person sees is unchanged; what goes in the key is the same name with the
 * awkward runs turned into hyphens, and the extension preserved because that
 * is what decides the content type on the way back out.
 */
export function safeName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';

  const folded =
    stem
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'file';
  return extension ? `${folded}.${extension.replace(/[^a-z0-9]/g, '')}` : folded;
}

export function scopePrefix(scope: KeyScope): string {
  if (!OWNER_ID.test(scope.id)) throw new Error(`Bad owner id for a storage key: ${scope.id}`);
  if (!AREAS[scope.owner].includes(scope.area)) {
    throw new Error(`No area ${scope.area} under ${scope.owner}`);
  }
  return `${scope.owner}/${scope.id}/${scope.area}`;
}

/**
 * A fresh key for one upload.
 *
 * The time and the random segment make it unguessable and collision-free, so
 * the write-once rule in the local store never refuses a real upload and a key
 * seen once cannot be used to predict the next.
 */
export function buildKey(
  scope: KeyScope,
  filename: string,
  now: number = Date.now(),
  random: string = randomBytes(8).toString('hex'),
): string {
  return `${scopePrefix(scope)}/${now}-${random}-${safeName(filename)}`;
}

/** Who owns a key, read back from the key. Null for anything not minted here. */
export function parseKey(key: string): KeyScope | null {
  if (!isSafeKey(key)) return null;
  const [owner, id, area, ...rest] = key.split('/');
  if (rest.length === 0 || !OWNER_ID.test(id ?? '')) return null;
  if (!(owner in AREAS) || !AREAS[owner as KeyScope['owner']].includes(area)) return null;
  return { owner, id, area } as KeyScope;
}

/**
 * The form a private object is stored in.
 *
 * A key rather than a URL, because a URL for a private object is either
 * permanent — and then it is public — or it expires, and then the row is broken
 * an hour after it was written. `media://` keeps it recognisably a reference
 * to an upload wherever it sits (a column, a jsonb list, an array of
 * photographs) so the API can find it on the way out and sign it for whoever is
 * looking, without every module learning about storage.
 */
export const MEDIA_REF_SCHEME = 'media://';

export function toRef(key: string): string {
  return `${MEDIA_REF_SCHEME}${key}`;
}

/** The key in a `media://` reference, or null if the value is not one. */
export function refKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(MEDIA_REF_SCHEME)) return null;
  const key = value.slice(MEDIA_REF_SCHEME.length);
  return isSafeKey(key) ? key : null;
}

export function isMediaRef(value: unknown): boolean {
  return refKey(value) !== null;
}
