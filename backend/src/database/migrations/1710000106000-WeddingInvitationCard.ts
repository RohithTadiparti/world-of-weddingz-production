import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeddingInvitationCard1710000106000 implements MigrationInterface {
  name = 'WeddingInvitationCard1710000106000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "wedding_invitations" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "userId" uuid NOT NULL,
      "cardUrl" varchar(2000),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_wedding_invitations" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_wedding_invitations_user" UNIQUE ("userId")
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "wedding_invitations"');
  }
}
