import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores the approved field scope for vendor business-details change requests. */
export class Phase63VendorBusinessChangeRequest1710000101000 implements MigrationInterface {
  name = 'Phase63VendorBusinessChangeRequest1710000101000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "support_cases" ADD COLUMN IF NOT EXISTS "requestedFields" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_cases" DROP COLUMN IF EXISTS "requestedFields"`);
  }
}
