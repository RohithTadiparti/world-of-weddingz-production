import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The notification a couple gets when a planner accepts their request.
 *
 * Added to the Postgres enum as well as the code one: a value only in code
 * makes every insert throw and the notification writer swallow it (see
 * Phase56BookingAddonNotification). IF NOT EXISTS keeps a re-run harmless.
 */
export class PlannerRequestAcceptedNotification1710000111000 implements MigrationInterface {
  name = 'PlannerRequestAcceptedNotification1710000111000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'booking_request_accepted'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type.
  }
}
