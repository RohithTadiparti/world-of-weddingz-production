import { DataSource, EntityManager } from 'typeorm';
import { isUploadedMedia } from '../../platform/storage/uploaded-media';

/**
 * Media values stored before uploads were enforced (ISS-06), found and
 * optionally removed.
 *
 * Every field below used to accept any well-formed URL, so a row can hold a
 * link to somebody else's site where an upload belongs. The API no longer
 * accepts a new one, and the edit forms may resend the old ones unchanged
 * (platform/storage/kept-media.ts), so nothing breaks — but they are still
 * hotlinks that never went through presign or the upload checks, and an
 * operator may want them gone.
 *
 * "External" means exactly what the API means by it: isUploadedMedia, with the
 * recogniser StorageService configures from this deployment's settings.
 *
 * Only list fields that are a gallery somebody curates are ever cleaned, and
 * only by dropping the offending entries: a record is never deleted, and a
 * single-value field is never cleared, because an event without its picture or
 * a profile without its horoscope is a change of meaning that wants a person.
 * Evidence and booking references are report-only for the same reason the
 * platform keeps messages after a chat is cleared — they are what a dispute is
 * argued from.
 */

export type MediaColumnKind =
  /** A jsonb array of URL strings. */
  | 'list'
  /** A single URL column. */
  | 'value'
  /** planner_profiles.weddings: each wedding's `photos` list. */
  | 'wedding-photos'
  /** planner_profiles.weddings: each wedding's `coverUrl`. */
  | 'wedding-cover';

export interface MediaColumn {
  table: string;
  column: string;
  kind: MediaColumnKind;
  /** May --apply remove external entries from it? */
  cleanable: boolean;
}

export const MEDIA_COLUMNS: readonly MediaColumn[] = [
  { table: 'profiles', column: 'photos', kind: 'list', cleanable: true },
  { table: 'agent_profiles', column: 'pictures', kind: 'list', cleanable: true },
  { table: 'vendors', column: 'portfolio', kind: 'list', cleanable: true },
  { table: 'vendors', column: 'complianceDocuments', kind: 'list', cleanable: true },
  { table: 'planner_profiles', column: 'portfolio', kind: 'list', cleanable: true },
  { table: 'planner_profiles', column: 'weddings', kind: 'wedding-photos', cleanable: true },
  { table: 'planner_profiles', column: 'weddings', kind: 'wedding-cover', cleanable: false },
  { table: 'bookings', column: 'referenceImages', kind: 'list', cleanable: false },
  { table: 'bookings', column: 'deliveryEvidence', kind: 'list', cleanable: false },
  { table: 'support_cases', column: 'evidence', kind: 'list', cleanable: false },
  { table: 'events', column: 'imageUrl', kind: 'value', cleanable: false },
  { table: 'wedding_invitations', column: 'cardUrl', kind: 'value', cleanable: false },
  { table: 'profile_details', column: 'horoscopeDocumentUrl', kind: 'value', cleanable: false },
  { table: 'profile_details', column: 'biodataDocumentUrl', kind: 'value', cleanable: false },
  { table: 'profile_details', column: 'primaryPhotoUrl', kind: 'value', cleanable: false },
  { table: 'profile_details', column: 'familyPhotoUrl', kind: 'value', cleanable: false },
  { table: 'media_items', column: 'url', kind: 'value', cleanable: false },
  { table: 'messages', column: 'mediaUrl', kind: 'value', cleanable: false },
];

export type IsUploaded = (value: unknown) => boolean;

export interface PlannerWeddingMedia {
  coverUrl?: string | null;
  photos?: unknown[];
  [key: string]: unknown;
}

/** The string entries of a stored value that are not uploads. */
export function externalEntries(value: unknown, isUploaded: IsUploaded = isUploadedMedia): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is string => typeof v === 'string' && v !== '' && !isUploaded(v));
}

/** What a column holds that is external, for one row's stored value. */
export function externalIn(
  kind: MediaColumnKind,
  value: unknown,
  isUploaded: IsUploaded = isUploadedMedia,
): string[] {
  if (kind === 'list' || kind === 'value') return externalEntries(value, isUploaded);
  const weddings = Array.isArray(value) ? (value as PlannerWeddingMedia[]) : [];
  return weddings.flatMap((w) =>
    kind === 'wedding-photos'
      ? externalEntries(w?.photos ?? [], isUploaded)
      : externalEntries(w?.coverUrl ?? null, isUploaded),
  );
}

/**
 * The stored value with external entries dropped from its lists. Order and
 * everything else are kept; a value with nothing to drop comes back as null so
 * the caller writes nothing.
 */
export function withoutExternal(
  kind: MediaColumnKind,
  value: unknown,
  isUploaded: IsUploaded = isUploadedMedia,
): unknown[] | null {
  if (!Array.isArray(value)) return null;
  if (kind === 'list') {
    const kept = value.filter((v) => !(typeof v === 'string' && v !== '' && !isUploaded(v)));
    return kept.length === value.length ? null : kept;
  }
  if (kind === 'wedding-photos') {
    let changed = false;
    const next = (value as PlannerWeddingMedia[]).map((w) => {
      if (!w || !Array.isArray(w.photos)) return w;
      const photos = w.photos.filter((p) => !(typeof p === 'string' && p !== '' && !isUploaded(p)));
      if (photos.length === w.photos.length) return w;
      changed = true;
      return { ...w, photos };
    });
    return changed ? next : null;
  }
  return null;
}

export interface ExternalMediaFinding {
  table: string;
  column: string;
  kind: MediaColumnKind;
  cleanable: boolean;
  id: string;
  external: string[];
}

export interface CleanupResult {
  rowsUpdated: number;
  entriesRemoved: number;
  /** Rows whose value changed between the scan and the update, left alone. */
  rowsSkipped: number;
  primaryPhotosReset: number;
}

const BATCH = 500;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export class ExternalMediaReport {
  constructor(
    private readonly dataSource: DataSource,
    private readonly isUploaded: IsUploaded = isUploadedMedia,
  ) {}

  /** Every stored external value, one finding per row and column. */
  async scan(columns: readonly MediaColumn[] = MEDIA_COLUMNS): Promise<ExternalMediaFinding[]> {
    const findings: ExternalMediaFinding[] = [];
    for (const col of columns) {
      if (!(await this.columnExists(col))) continue;
      let after = '';
      for (;;) {
        const rows: { id: string; value: unknown }[] = await this.dataSource.query(
          `SELECT "id"::text AS "id", ${ident(col.column)} AS "value"
             FROM ${ident(col.table)}
            WHERE ${ident(col.column)} IS NOT NULL AND "id"::text > $1
            ORDER BY "id"::text ASC
            LIMIT ${BATCH}`,
          [after],
        );
        for (const row of rows) {
          const external = externalIn(col.kind, row.value, this.isUploaded);
          if (external.length) {
            findings.push({ ...col, id: row.id, external });
          }
        }
        if (rows.length < BATCH) break;
        after = rows[rows.length - 1].id;
      }
    }
    return findings;
  }

  /**
   * Removes the external entries from the cleanable findings, in one
   * transaction. Each row is re-read under a lock and recomputed, so a value
   * edited since the scan is cleaned as it now stands rather than overwritten
   * with what the scan saw.
   */
  async clean(findings: readonly ExternalMediaFinding[]): Promise<CleanupResult> {
    const targets = findings.filter((f) => f.cleanable);
    return this.dataSource.transaction((manager) => this.cleanWith(manager, targets));
  }

  private async cleanWith(
    manager: EntityManager,
    targets: readonly ExternalMediaFinding[],
  ): Promise<CleanupResult> {
    const result: CleanupResult = { rowsUpdated: 0, entriesRemoved: 0, rowsSkipped: 0, primaryPhotosReset: 0 };
    for (const f of targets) {
      const [row]: { value: unknown }[] = await manager.query(
        `SELECT ${ident(f.column)} AS "value" FROM ${ident(f.table)} WHERE "id"::text = $1 FOR UPDATE`,
        [f.id],
      );
      const next = row ? withoutExternal(f.kind, row.value, this.isUploaded) : null;
      if (!next) {
        result.rowsSkipped += 1;
        continue;
      }
      const removed = externalIn(f.kind, row.value, this.isUploaded).length;
      await manager.query(
        `UPDATE ${ident(f.table)} SET ${ident(f.column)} = $1::jsonb WHERE "id"::text = $2`,
        [JSON.stringify(next), f.id],
      );
      result.rowsUpdated += 1;
      result.entriesRemoved += removed;

      // The biodata's primary photo is "one of profiles.photos"; when it was
      // one of those removed it moves to the first remaining photo, as it does
      // when the owner removes it themselves.
      if (f.table === 'profiles' && f.column === 'photos') {
        const reset: unknown = await manager.query(
          `UPDATE "profile_details"
              SET "primaryPhotoUrl" = $1
            WHERE "profileId"::text = $2
              AND "primaryPhotoUrl" IS NOT NULL
              AND NOT ($3::jsonb ? "primaryPhotoUrl")
            RETURNING "id"`,
          [(next[0] as string | undefined) ?? null, f.id, JSON.stringify(next)],
        );
        const rows = Array.isArray(reset) && Array.isArray(reset[0]) ? reset[0] : reset;
        result.primaryPhotosReset += Array.isArray(rows) ? rows.length : 0;
      }
    }
    return result;
  }

  private async columnExists(col: MediaColumn): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [col.table, col.column],
    );
    return rows.length > 0;
  }
}
