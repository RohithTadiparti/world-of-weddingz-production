import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One invitation per guest for the wedding, and host notes on a guest.
 *
 * The RSVP link used to be per event, so a guest invited to four functions got
 * four links and four questions. The wedding invitation lives on the guest row:
 * one token, one answer, covering the events that guest is invited to. All
 * nullable — existing guests are simply "not invited yet" at wedding level,
 * and their per-event invites and links are untouched.
 *
 * `event_invites.answeredIndividually` marks an invite answered for its own
 * event, which a wedding-level reply must not overwrite. Every answer given
 * before this migration was given that way, so those are marked as such.
 */
export class Phase65WeddingInvitation1710000099000 implements MigrationInterface {
  name = 'Phase65WeddingInvitation1710000099000';

  private readonly columns: [string, string][] = [
    ['notes', 'text'],
    ['rsvpStatus', 'varchar(20)'],
    ['rsvpTokenHash', 'varchar'],
    ['rsvpTokenExpiresAt', 'timestamptz'],
    ['respondedAt', 'timestamptz'],
    ['attendingCount', 'int'],
    ['declineReason', 'text'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, type] of this.columns) {
      await queryRunner.query(`ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_guests_rsvp_token_hash" ON "guests" ("rsvpTokenHash") ` +
        `WHERE "rsvpTokenHash" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_invites" ADD COLUMN IF NOT EXISTS "answeredIndividually" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "event_invites" SET "answeredIndividually" = true WHERE "status" <> 'invited'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "event_invites" DROP COLUMN IF EXISTS "answeredIndividually"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guests_rsvp_token_hash"`);
    for (const [name] of this.columns) {
      await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN IF EXISTS "${name}"`);
    }
  }
}
