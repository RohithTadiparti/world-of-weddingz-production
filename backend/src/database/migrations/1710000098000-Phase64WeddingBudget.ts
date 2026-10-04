import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One overall budget for the wedding, on the plan.
 *
 * Until now the only budget figures lived on individual events, so the wedding
 * total was whatever the event budgets happened to add up to. Nullable — no
 * existing plan has one, and event budgets are left exactly as they are.
 */
export class Phase64WeddingBudget1710000098000 implements MigrationInterface {
  name = 'Phase64WeddingBudget1710000098000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wedding_plans" ADD COLUMN IF NOT EXISTS "budget" numeric(14,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wedding_plans" DROP COLUMN IF EXISTS "budget"`);
  }
}
