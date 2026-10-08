import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { ExternalMediaFinding, ExternalMediaReport } from './maintenance/external-media';
import { hasFlag, withMaintenanceContext } from './maintenance/maintenance-context';

loadEnv();

/**
 * Lists the media values stored before uploads were enforced (ISS-06) — URLs
 * the platform's own storage did not hand out — per table and column. With
 * --apply it removes them from the gallery list fields only; records are never
 * deleted and single-value fields are never cleared. See ExternalMediaReport
 * and docs/PHASE-1-OPERATIONS.md.
 *
 *   npm run report:external-media                 (dry run, source)
 *   npm run report:external-media -- --apply      (clean list fields, source)
 *   npm run report:external-media:prod [-- --apply]   (compiled, in the container)
 *
 * "External" is decided by the same recogniser the API uses, configured from
 * this environment's MEDIA_* settings, so run it with the deployment's env.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = hasFlag(args, '--apply');
  const verbose = hasFlag(args, '--verbose');

  await withMaintenanceContext(null, async (app) => {
    const report = new ExternalMediaReport(app.get(DataSource));
    const findings = await report.scan();

    const groups = new Map<string, ExternalMediaFinding[]>();
    for (const f of findings) {
      const key = `${f.table}.${f.column}${f.kind.startsWith('wedding-') ? ` (${f.kind})` : ''}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }

    if (groups.size === 0) {
      console.log('No external media URLs are stored.');
      return;
    }
    for (const [key, rows] of groups) {
      const entries = rows.reduce((n, r) => n + r.external.length, 0);
      const mode = rows[0].cleanable ? 'cleanable with --apply' : 'report only';
      console.log(`${key}: ${entries} external value(s) in ${rows.length} row(s) [${mode}]`);
      for (const r of verbose ? rows : rows.slice(0, 5)) {
        console.log(`  ${r.id}  ${r.external.join('  ')}`);
      }
      if (!verbose && rows.length > 5) console.log(`  … ${rows.length - 5} more (--verbose lists all)`);
    }

    if (!apply) {
      console.log('Dry run: nothing was changed. Re-run with --apply to remove the cleanable entries.');
      return;
    }
    const result = await report.clean(findings);
    console.log(
      `Removed ${result.entriesRemoved} external value(s) from ${result.rowsUpdated} row(s)` +
        `; ${result.primaryPhotosReset} primary photo(s) moved to the next remaining photo` +
        (result.rowsSkipped ? `; ${result.rowsSkipped} row(s) had nothing left to remove.` : '.'),
    );
  });
}

main().catch((err) => {
  console.error('External media report failed:', err);
  process.exit(1);
});
