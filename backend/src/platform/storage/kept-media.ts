import { BadRequestException } from '@nestjs/common';
import { isUploadedMedia } from './uploaded-media';

/**
 * "New media must be an upload", for a field whose old value is in hand.
 *
 * IsUploadedUrl refuses anything the platform's storage did not hand out
 * (ISS-06). That is right for a new value and wrong for one already stored:
 * rows written before the check can hold an outside link, and a form that
 * sends its whole photo list back on every save — a planner's weddings, a
 * vendor's portfolio, an agency's office photographs, a profile's photos —
 * then got a 400 for a picture its owner never touched, and could not save
 * anything else on the page until they removed it.
 *
 * class-validator cannot tell the two apart, because it never sees the stored
 * row. So those fields carry a shape check in the DTO (IsMediaUrlShape) and
 * the service, holding the stored row, calls one of these: an entry that is
 * byte-for-byte one the record already holds is kept; anything new has to pass
 * isUploadedMedia exactly as it would have in the DTO. The error reads the way
 * the validation pipe's does, so clients see no difference.
 */

type Stored = Iterable<string | null | undefined> | string | null | undefined;

function storedSet(stored: Stored): Set<string> {
  if (stored === null || stored === undefined) return new Set();
  if (typeof stored === 'string') return new Set([stored]);
  const set = new Set<string>();
  for (const value of stored) if (typeof value === 'string') set.add(value);
  return set;
}

/** The entries of `next` that are neither already stored nor uploaded here. */
export function unacceptedMedia(next: readonly unknown[], stored: Stored): unknown[] {
  const kept = storedSet(stored);
  return next.filter((value) => !(typeof value === 'string' && kept.has(value)) && !isUploadedMedia(value));
}

function refuse(message: string): never {
  throw new BadRequestException([message]);
}

/**
 * A list of media URLs: every entry not already on the record must be an
 * upload. `path` prefixes the message for a nested field ("weddings.0.").
 */
export function assertNewMediaUploaded(
  property: string,
  next: readonly unknown[] | null | undefined,
  stored: Stored,
  path = '',
): void {
  if (!next || next.length === 0) return;
  if (unacceptedMedia(next, stored).length > 0) {
    refuse(`${path}each value in ${property} must be a file uploaded here`);
  }
}

/**
 * A single media URL: unchanged is fine, a new value must be an upload. Null
 * or absent is a clear or "not sent", which the caller handles.
 */
export function assertMediaValueUploaded(
  property: string,
  next: unknown,
  stored: Stored,
  path = '',
): void {
  if (next === null || next === undefined) return;
  if (unacceptedMedia([next], stored).length > 0) {
    refuse(`${path}${property} must be a file uploaded here`);
  }
}
