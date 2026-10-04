import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A business lists up to five catalogue categories (EZ1-I263).
 *
 * The listing had one category out of seven, while the catalogue a vendor
 * lists services under has thirty-six. A caterer who also runs a cake counter,
 * or a photographer who also flies a drone, could only be found under one of
 * them.
 *
 * - `categories` holds catalogue category slugs, one to five of them. The
 *   service enforces the count and that each slug is an active category.
 * - `category` stays, as the first of those, so every report, admin view and
 *   planner summary that reads one category keeps working. It becomes a plain
 *   string because the catalogue, not a database enum, now decides what is a
 *   category.
 * - Existing listings keep what they had: every old value except `other` is
 *   also a catalogue slug, so it becomes the first category. A listing filed
 *   under `other` starts with none and its vendor is asked to choose.
 *   `otherCategory` is kept as written, for the record, and no longer read.
 */
export class Phase57VendorCategories1710000082000 implements MigrationInterface {
  name = 'Phase57VendorCategories1710000082000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "categories" varchar(60)[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendors" ALTER COLUMN "category" TYPE varchar(60) USING "category"::text`,
    );
    await queryRunner.query(`ALTER TABLE "vendors" ALTER COLUMN "category" DROP NOT NULL`);

    await queryRunner.query(
      `UPDATE "vendors" SET "categories" = ARRAY["category"]::varchar(60)[]
        WHERE "category" IN (SELECT "slug" FROM "service_categories")`,
    );
    await queryRunner.query(
      `UPDATE "vendors" SET "category" = NULL
        WHERE "category" IS NOT NULL AND "category" NOT IN (SELECT "slug" FROM "service_categories")`,
    );

    await queryRunner.query(`DROP TYPE IF EXISTS "vendors_category_enum"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vendors_categories" ON "vendors" USING GIN ("categories")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vendors_categories"`);
    await queryRunner.query(
      `CREATE TYPE "vendors_category_enum"
         AS ENUM ('venue','catering','photography','decor','makeup','entertainment','other')`,
    );
    // Only the first category survives, and only if the old enum has it.
    await queryRunner.query(
      `UPDATE "vendors" SET "category" = CASE
         WHEN "categories"[1] IN ('venue','catering','photography','decor','makeup','entertainment')
           THEN "categories"[1]
         ELSE 'other' END`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendors" ALTER COLUMN "category" TYPE "vendors_category_enum"
         USING "category"::"vendors_category_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "vendors" ALTER COLUMN "category" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN "categories"`);
  }
}
