import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The notification an agency receives when somebody sends an interest to a
 * client it manages.
 *
 * Added to the Postgres enum alongside the code, not after it: Phase43 and
 * Phase56 both exist because a type shipped in code alone, and every insert of
 * it failed inside the notification writer's catch where nobody saw it.
 *
 * IF NOT EXISTS keeps a re-run harmless.
 */
export class Phase59InterestForClientNotification1710000084000 implements MigrationInterface {
  name = 'Phase59InterestForClientNotification1710000084000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'match_interest_for_client'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type. The value stays in the
    // definition; nothing references it after a rollback.
  }
}
