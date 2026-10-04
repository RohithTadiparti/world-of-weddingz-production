import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Interests to an agency's client go to the agency first.
 *
 * `interests.screening` records whether the agency running the receiving
 * profile has let an interest through (see InterestScreening). It is nullable
 * and has no default on purpose: every interest already in the table was sent
 * before anything was held, and null reads as "never held", which is exactly
 * how those rows keep behaving — the client already saw them, and nothing about
 * them changes.
 *
 * `match_declined_by_agency` is the notification the sender gets when the
 * agency turns one down. Added to the Postgres enum alongside the code for the
 * reason Phase59 gives: a type that exists in code alone fails every insert
 * inside the notification writer's catch, where nobody sees it.
 */
export class Phase62InterestAgencyScreening1710000087000 implements MigrationInterface {
  name = 'Phase62InterestAgencyScreening1710000087000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "interests_screening_enum" AS ENUM ('with_agency', 'forwarded', 'declined_by_agency');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "interests" ADD COLUMN IF NOT EXISTS "screening" "interests_screening_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'match_declined_by_agency'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN IF EXISTS "screening"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "interests_screening_enum"`);
    // Postgres cannot remove a value from an enum type. The notification value
    // stays in the definition; nothing references it after a rollback.
  }
}
