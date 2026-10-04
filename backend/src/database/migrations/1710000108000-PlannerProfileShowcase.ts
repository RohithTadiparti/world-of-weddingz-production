import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a couple needs to choose a planner, and what they chose.
 *
 * The listing gains the services the planner offers, the kinds of wedding they
 * specialise in, an introduction video, how many weddings they have run, how
 * they work, and the weddings themselves (each with its events, photographs and
 * films). A booking gains the services the couple ticked on the profile, so the
 * planner reads them on the request instead of the couple typing them again.
 * Couples can also save a planner as a favourite.
 *
 * Every column is additive with a default, so existing listings and bookings
 * keep loading unchanged.
 */
export class PlannerProfileShowcase1710000108000 implements MigrationInterface {
  name = 'PlannerProfileShowcase1710000108000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "planner_profiles"
        ADD COLUMN IF NOT EXISTS "services" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "specializations" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "introVideoUrl" varchar(2048),
        ADD COLUMN IF NOT EXISTS "weddingsCompleted" integer,
        ADD COLUMN IF NOT EXISTS "planningApproach" text,
        ADD COLUMN IF NOT EXISTS "weddings" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "requestedServices" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "planner_favourites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "plannerId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_planner_favourites" PRIMARY KEY ("id"),
        CONSTRAINT "FK_planner_favourites_planner" FOREIGN KEY ("plannerId")
          REFERENCES "planner_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_planner_favourites_user_planner" ON "planner_favourites" ("userId", "plannerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_planner_favourites_user" ON "planner_favourites" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_planner_favourites_planner" ON "planner_favourites" ("plannerId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "planner_favourites"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "requestedServices"`);
    await queryRunner.query(`
      ALTER TABLE "planner_profiles"
        DROP COLUMN IF EXISTS "weddings",
        DROP COLUMN IF EXISTS "planningApproach",
        DROP COLUMN IF EXISTS "weddingsCompleted",
        DROP COLUMN IF EXISTS "introVideoUrl",
        DROP COLUMN IF EXISTS "specializations",
        DROP COLUMN IF EXISTS "services"
    `);
  }
}
