import { MigrationInterface, QueryRunner } from 'typeorm';

export class Usernames1710000112000 implements MigrationInterface {
  name = 'Usernames1710000112000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "username" character varying(40)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_users_username"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}
