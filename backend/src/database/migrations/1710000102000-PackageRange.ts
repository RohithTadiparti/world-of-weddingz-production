import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The annual package range a profile looks for in a partner.
 *
 * `IF NOT EXISTS` and a replaced constraint because a database that ran this
 * change under its earlier timestamp already has the columns.
 */
export class PackageRange1710000102000 implements MigrationInterface {
  name = 'PackageRange1710000102000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profile_details"
      ADD COLUMN IF NOT EXISTS "preferredPackageMin" double precision,
      ADD COLUMN IF NOT EXISTS "preferredPackageMax" double precision`);
    await queryRunner.query(
      'ALTER TABLE "profile_details" DROP CONSTRAINT IF EXISTS "CHK_profile_package_range"',
    );
    await queryRunner.query(`ALTER TABLE "profile_details"
      ADD CONSTRAINT "CHK_profile_package_range" CHECK (
        ("preferredPackageMin" IS NULL OR ("preferredPackageMin" BETWEEN 0 AND 9007199254740991 AND "preferredPackageMin" = floor("preferredPackageMin"))) AND
        ("preferredPackageMax" IS NULL OR ("preferredPackageMax" BETWEEN 0 AND 9007199254740991 AND "preferredPackageMax" = floor("preferredPackageMax"))) AND
        ("preferredPackageMin" IS NULL OR "preferredPackageMax" IS NULL OR "preferredPackageMin" <= "preferredPackageMax")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profile_details"
      DROP CONSTRAINT IF EXISTS "CHK_profile_package_range",
      DROP COLUMN IF EXISTS "preferredPackageMax",
      DROP COLUMN IF EXISTS "preferredPackageMin"`);
  }
}
