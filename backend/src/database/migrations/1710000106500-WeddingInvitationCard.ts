import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renumbered from 1710000106000 after that timestamp collided with
 * ProviderSocialLinkList. The up migration is intentionally idempotent so an
 * environment that recorded the historical name can safely record this
 * reconciled name without changing its existing table.
 */
export class WeddingInvitationCard1710000106500 implements MigrationInterface {
  name = 'WeddingInvitationCard1710000106500';

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
