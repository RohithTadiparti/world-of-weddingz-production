import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a couple tells a wedding planner, and the planner's first answer.
 *
 * `plannerBrief` carries the structured part of a planner request (where,
 * how many guests, what kind of wedding, a budget range); the services are
 * `requestedServices` (PlannerProfileShowcase). `providerAcceptedAt` records
 * the planner taking the request on before any price is agreed.
 */
export class PlannerRequestBrief1710000110000 implements MigrationInterface {
  name = 'PlannerRequestBrief1710000110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "plannerBrief" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "providerAcceptedAt" TIMESTAMPTZ`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "providerAcceptedAt"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "plannerBrief"`);
  }
}
