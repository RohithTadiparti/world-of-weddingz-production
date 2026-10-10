import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A business profile picture, and a type for each compliance document.
 *
 * The listing had a portfolio and no way to say which of its images is the
 * business's own picture, so every screen used whichever came first. The
 * picture is one of the portfolio images, kept as its URL; existing rows take
 * their first portfolio image, which is what they were already showing.
 *
 * Compliance documents were bare URLs with nothing to say which certificate
 * each one is. The types sit beside them, aligned by position, so every reader
 * of `complianceDocuments` keeps working unchanged.
 */
export class VendorProfileImageAndDocumentTypes1710000116300 implements MigrationInterface {
  name = 'VendorProfileImageAndDocumentTypes1710000116300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "profileImage" character varying(2048)`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "complianceDocumentTypes" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `UPDATE "vendors" SET "profileImage" = "portfolio"->>0
        WHERE "profileImage" IS NULL
          AND jsonb_typeof("portfolio") = 'array'
          AND jsonb_array_length("portfolio") > 0
          AND length("portfolio"->>0) <= 2048`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "complianceDocumentTypes"`);
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "profileImage"`);
  }
}
