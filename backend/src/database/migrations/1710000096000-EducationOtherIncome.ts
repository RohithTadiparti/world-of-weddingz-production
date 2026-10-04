import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Other sources of income, beside the main occupation.
 *
 * A salaried candidate with a business on the side had nowhere to say so: the
 * occupation takes one answer. `profile_details.otherIncome` holds a short list
 * of `{ source, details?, annualIncome? }`, optional for everybody. Every
 * existing row starts with an empty list, which reads the same as "none".
 */
export class EducationOtherIncome1710000096000 implements MigrationInterface {
  name = 'EducationOtherIncome1710000096000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "otherIncome" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "otherIncome"`);
  }
}
