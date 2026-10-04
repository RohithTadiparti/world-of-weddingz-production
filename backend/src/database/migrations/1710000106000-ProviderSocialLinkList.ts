import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social links as a list on vendor and planner listings.
 *
 * Three fixed columns left a business with a Facebook page or a Pinterest
 * board nowhere to put it. The list replaces them as the source of truth; the
 * old columns stay, written from the list, because installed app builds read
 * them.
 *
 * The backfill only fills a list that is still empty, so running `up` twice
 * (or over a list a vendor has since edited) changes nothing. Only https://
 * values are carried over: anything else would fail validation the next time
 * the listing is saved.
 */
export class ProviderSocialLinkList1710000106000 implements MigrationInterface {
  name = 'ProviderSocialLinkList1710000106000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['vendors', 'planner_profiles']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "socialLinks" jsonb NOT NULL DEFAULT '[]'::jsonb`,
      );
      const link = (column: string, platform: string) =>
        `CASE WHEN btrim(coalesce("${column}", '')) ~* '^https://' ` +
        `THEN jsonb_build_array(jsonb_build_object('platform', '${platform}', 'url', btrim("${column}"))) ` +
        `ELSE '[]'::jsonb END`;
      await queryRunner.query(
        `UPDATE "${table}" SET "socialLinks" = ` +
          `${link('website', 'website')} || ${link('instagramUrl', 'instagram')} || ${link('youtubeUrl', 'youtube')} ` +
          `WHERE "socialLinks" = '[]'::jsonb ` +
          `AND ("website" IS NOT NULL OR "instagramUrl" IS NOT NULL OR "youtubeUrl" IS NOT NULL)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['vendors', 'planner_profiles']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "socialLinks"`);
    }
  }
}
