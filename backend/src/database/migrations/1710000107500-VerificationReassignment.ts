import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preserve the last visitor while a "Needs another look" request awaits
 * reassignment. Renumbered from 1710000107000; ADD COLUMN IF NOT EXISTS keeps
 * upgrades safe for databases that recorded the historical migration name.
 */
export class VerificationReassignment1710000107500 implements MigrationInterface {
  name = 'VerificationReassignment1710000107500';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "verification_requests" ADD COLUMN IF NOT EXISTS "previousOfficerUserId" uuid',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "verification_requests" DROP COLUMN IF EXISTS "previousOfficerUserId"',
    );
  }
}
