import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vendor verification tracking and cancellable business change requests.
 *
 * Two notification types (the applicant's verification progress, and an update
 * on a business change request) and one support case status (cancelled by an
 * administrator). All three are Postgres enums as well as code ones: a value
 * only in code makes every insert using it throw. IF NOT EXISTS keeps a re-run
 * harmless. No table or column changes.
 */
export class VerificationProgressAndCaseCancel1710000116500 implements MigrationInterface {
  name = 'VerificationProgressAndCaseCancel1710000116500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'verification_progress'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'business_change_update'`,
    );
    await queryRunner.query(
      `ALTER TYPE "support_cases_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type.
  }
}
