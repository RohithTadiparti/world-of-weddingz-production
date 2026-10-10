import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The booking negotiation as a history, and the time asked for on a request.
 *
 * `quotation_events` keeps every step of how a price was reached: the
 * provider's listed price and the customer's budget from the request, each
 * quotation and the customer's answer to it, and a price agreed without a
 * quotation. Bookings placed before this table existed are backfilled with
 * what their own rows still say -- listed price and budget at the request's
 * time, every quotation and its recorded answer, and an agreed price with no
 * accepted quotation at the booking's last update (the closest moment that is
 * still on record).
 *
 * `bookings.requestedTime` is the time of day asked for on a request made for
 * a date the provider never published a window on. HH:MM, nullable: requests
 * against a published window carry the window's own times.
 */
export class QuotationEventsAndRequestedTime1710000117600 implements MigrationInterface {
  name = 'QuotationEventsAndRequestedTime1710000117600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "quotation_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "bookingId" uuid NOT NULL,
        "kind" character varying(40) NOT NULL,
        "amount" numeric(12,2),
        "currency" character varying NOT NULL DEFAULT 'INR',
        "actorRole" character varying(20),
        "actorUserId" uuid,
        "quotationId" uuid,
        "note" text,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quotation_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_quotation_events_booking_occurred" ON "quotation_events" ("bookingId", "occurredAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "requestedTime" character varying(5)`,
    );

    // ---------------------------------------------------------------- backfill
    await queryRunner.query(`
      INSERT INTO "quotation_events" ("bookingId", "kind", "amount", "currency", "actorRole", "occurredAt")
      SELECT b."id", 'listed_price', b."estimatedAmount", b."currency", 'provider', b."createdAt"
        FROM "bookings" b
       WHERE b."estimatedAmount" IS NOT NULL AND b."estimatedAmount" > 0
    `);
    await queryRunner.query(`
      INSERT INTO "quotation_events" ("bookingId", "kind", "amount", "currency", "actorRole", "actorUserId", "occurredAt")
      SELECT b."id", 'budget', b."expectedBudget", b."currency", 'customer', b."userId", b."createdAt"
        FROM "bookings" b
       WHERE b."expectedBudget" IS NOT NULL AND b."expectedBudget" > 0
    `);
    await queryRunner.query(`
      INSERT INTO "quotation_events"
        ("bookingId", "kind", "amount", "currency", "actorRole", "actorUserId", "quotationId", "occurredAt")
      SELECT q."bookingId", 'quotation_sent', q."amount", q."currency", 'provider', q."issuedByUserId", q."id", q."createdAt"
        FROM "quotations" q
    `);
    await queryRunner.query(`
      INSERT INTO "quotation_events"
        ("bookingId", "kind", "amount", "currency", "actorRole", "actorUserId", "quotationId", "note", "occurredAt")
      SELECT q."bookingId",
             CASE q."status"::text
               WHEN 'accepted' THEN 'quotation_accepted'
               WHEN 'rejected' THEN 'quotation_rejected'
               ELSE 'quotation_withdrawn'
             END,
             q."amount", q."currency",
             CASE WHEN q."status"::text = 'withdrawn' THEN 'provider' ELSE 'customer' END,
             q."respondedByUserId", q."id", q."responseNote",
             COALESCE(q."respondedAt", q."updatedAt")
        FROM "quotations" q
       WHERE q."status"::text IN ('accepted', 'rejected', 'withdrawn')
    `);
    await queryRunner.query(`
      INSERT INTO "quotation_events" ("bookingId", "kind", "amount", "currency", "actorRole", "occurredAt")
      SELECT b."id", 'request_accepted', COALESCE(b."baseAmount", b."amount"), b."currency", 'provider', b."updatedAt"
        FROM "bookings" b
       WHERE COALESCE(b."baseAmount", b."amount") > 0
         AND b."status"::text IN (
           'payment_pending', 'pending', 'confirmed', 'in_progress',
           'completed_pending_final_payment', 'completed', 'disputed'
         )
         AND NOT EXISTS (
           SELECT 1 FROM "quotations" q
            WHERE q."bookingId" = b."id" AND q."status"::text = 'accepted'
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "requestedTime"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_quotation_events_booking_occurred"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quotation_events"`);
  }
}
