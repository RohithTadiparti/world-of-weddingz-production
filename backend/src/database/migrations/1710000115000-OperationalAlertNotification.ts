import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The in-app notification administrators receive for an operational alert.
 *
 * Added to the Postgres enum as well as the code one: a value only in code
 * makes every insert throw, and the alert would be recorded as a failed portal
 * delivery on every evaluation. IF NOT EXISTS keeps a re-run harmless. No
 * column or table changes: delivery state lives in the existing
 * operational_alerts.deliveryMetadata column.
 */
export class OperationalAlertNotification1710000115000 implements MigrationInterface {
  name = 'OperationalAlertNotification1710000115000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'operational_alert'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type.
  }
}
