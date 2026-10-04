import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The biodata document an agent uploaded when creating a client.
 *
 * `IF NOT EXISTS` because a database that ran this change under its earlier
 * timestamp already has the column.
 */
export class BiodataSourceDocument1710000105000 implements MigrationInterface {
  name = 'BiodataSourceDocument1710000105000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "biodataDocumentUrl" text',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "biodataDocumentUrl"');
  }
}
