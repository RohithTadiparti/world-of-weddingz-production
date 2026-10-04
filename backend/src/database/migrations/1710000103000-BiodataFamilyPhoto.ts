import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The family photograph on a biodata. Heights stay in whole centimetres.
 *
 * `IF NOT EXISTS` because a database that ran this change under its earlier
 * timestamp already has the column.
 */
export class BiodataFamilyPhoto1710000103000 implements MigrationInterface {
  name = 'BiodataFamilyPhoto1710000103000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "familyPhotoUrl" varchar(2000)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "familyPhotoUrl"');
  }
}
