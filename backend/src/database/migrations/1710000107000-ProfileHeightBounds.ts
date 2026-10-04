import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The API accepts only whole-centimetre heights representing 3 ft 0 in through
 * 8 ft 0 in. Keep the same invariant in Postgres so a direct write cannot
 * store a value the web and mobile feet/inches controls would reject.
 */
export class ProfileHeightBounds1710000107000 implements MigrationInterface {
  name = 'ProfileHeightBounds1710000107000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_profile_details_height_cm_range') THEN
          ALTER TABLE "profile_details" ADD CONSTRAINT "CK_profile_details_height_cm_range"
            CHECK ("heightCm" IS NULL OR "heightCm" BETWEEN 91 AND 244);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_profile_details_preferred_height_min_cm_range') THEN
          ALTER TABLE "profile_details" ADD CONSTRAINT "CK_profile_details_preferred_height_min_cm_range"
            CHECK ("preferredHeightMinCm" IS NULL OR "preferredHeightMinCm" BETWEEN 91 AND 244);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_profile_details_preferred_height_max_cm_range') THEN
          ALTER TABLE "profile_details" ADD CONSTRAINT "CK_profile_details_preferred_height_max_cm_range"
            CHECK ("preferredHeightMaxCm" IS NULL OR "preferredHeightMaxCm" BETWEEN 91 AND 244);
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profile_details"
        DROP CONSTRAINT IF EXISTS "CK_profile_details_preferred_height_max_cm_range",
        DROP CONSTRAINT IF EXISTS "CK_profile_details_preferred_height_min_cm_range",
        DROP CONSTRAINT IF EXISTS "CK_profile_details_height_cm_range";
    `);
  }
}
