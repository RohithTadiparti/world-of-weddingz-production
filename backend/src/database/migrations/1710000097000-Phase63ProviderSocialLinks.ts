import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Public social links on vendor and planner listings.
 *
 * Planners already had `website` (Phase35); vendors get the same column so both
 * listings share one set of names. All nullable — an existing listing is not
 * invalid for having none.
 */
export class Phase63ProviderSocialLinks1710000097000 implements MigrationInterface {
  name = 'Phase63ProviderSocialLinks1710000097000';

  private readonly links = ['instagramUrl', 'youtubeUrl'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['vendors', 'planner_profiles']) {
      for (const name of this.links) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${name}" varchar(200)`,
        );
      }
    }
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "website" varchar(200)`,
    );
    // A planner's website was free text until now, and is validated as an
    // https:// link from here on. Stored values are brought into that shape
    // the same way the API normalises a submitted one: blank to null, http
    // upgraded, a bare domain given https://. What fits no longer is cleared.
    await queryRunner.query(
      `UPDATE "planner_profiles" SET "website" = NULLIF(btrim("website"), '') WHERE "website" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "planner_profiles" SET "website" = 'https://' || substr("website", 8) ` +
        `WHERE "website" ~* '^http://'`,
    );
    await queryRunner.query(
      `UPDATE "planner_profiles" SET "website" = 'https://' || "website" ` +
        `WHERE "website" IS NOT NULL AND "website" !~* '^[a-z][a-z0-9+.-]*:' AND length("website") <= 192`,
    );
    await queryRunner.query(
      `UPDATE "planner_profiles" SET "website" = NULL ` +
        `WHERE "website" IS NOT NULL AND "website" !~* '^https://[^/\\s]+\\.[^/\\s]+'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['vendors', 'planner_profiles']) {
      for (const name of this.links) {
        await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${name}"`);
      }
    }
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "website"`);
  }
}
