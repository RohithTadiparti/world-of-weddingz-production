import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a profile-code prefix search use an index (ISS-19).
 *
 * The unique index on "profileCode" uses the database collation, and under a
 * non-C collation Postgres will not use it for `LIKE 'WOW1015%'`. The pattern
 * operator class compares byte-wise, which is exactly what an anchored prefix
 * on an upper-case code needs.
 */
export class ProfileCodePrefixIndex1710000112600 implements MigrationInterface {
  name = 'ProfileCodePrefixIndex1710000112600';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_profiles_profileCode_prefix" ON "profiles" ("profileCode" varchar_pattern_ops)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_profiles_profileCode_prefix"`);
  }
}
