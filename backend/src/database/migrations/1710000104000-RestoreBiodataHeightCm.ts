import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Puts heights back in whole centimetres on a database that stored them in
 * feet under an earlier, withdrawn change. Does nothing anywhere else.
 */
export class RestoreBiodataHeightCm1710000104000 implements MigrationInterface {
  name = 'RestoreBiodataHeightCm1710000104000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns: { column_name: string }[] = await queryRunner.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      ['profile_details'],
    );
    const names = new Set(columns.map((column) => column.column_name));
    const fields = [
      ['heightCm', 'heightFeet', 'heightFeetLegacy', 'CK_heightFeet_feet'],
      ['preferredHeightMinCm', 'preferredHeightMinFeet', 'preferredHeightMinFeetLegacy', 'CK_preferredHeightMinFeet_feet'],
      ['preferredHeightMaxCm', 'preferredHeightMaxFeet', 'preferredHeightMaxFeetLegacy', 'CK_preferredHeightMaxFeet_feet'],
    ] as const;

    for (const [cmName, feetName, legacyName, constraint] of fields) {
      if (names.has(cmName) && names.has(feetName)) {
        throw new Error(`Both ${cmName} and ${feetName} exist; resolve the ambiguous height data before migrating.`);
      }
      if (names.has(feetName)) {
        await queryRunner.query(`ALTER TABLE "profile_details" DROP CONSTRAINT IF EXISTS "${constraint}"`);
        // Preserve the stored tenths-of-feet value: converting it to whole
        // centimeters cannot recover the original centimeter value exactly.
        await queryRunner.query(`ALTER TABLE "profile_details" RENAME COLUMN "${feetName}" TO "${legacyName}"`);
        await queryRunner.query(`ALTER TABLE "profile_details" ADD COLUMN "${cmName}" integer`);
        await queryRunner.query(
          `UPDATE "profile_details" SET "${cmName}" = round("${legacyName}"::numeric * 30.48)::integer`,
        );
      }
      if (!names.has(cmName) && !names.has(feetName)) {
        throw new Error(`Missing height column ${cmName}`);
      }
    }
  }

  async down(): Promise<void> {
    // Nothing to undo. Centimetres are the schema before and after this; on a
    // database it repaired, the feet values are still kept in the *Legacy
    // columns, and putting feet back would reintroduce the withdrawn change.
  }
}
