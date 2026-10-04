import { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve the last visitor while a "Needs another look" request awaits reassignment. */
export class VerificationReassignment1710000107000 implements MigrationInterface {
  name = 'VerificationReassignment1710000107000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "verification_requests" ADD COLUMN IF NOT EXISTS "previousOfficerUserId" uuid',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "verification_requests" DROP COLUMN IF EXISTS "previousOfficerUserId"');
  }
}
