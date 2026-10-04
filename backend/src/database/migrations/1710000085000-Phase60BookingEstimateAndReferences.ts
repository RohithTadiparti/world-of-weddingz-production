import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The total a buyer was shown, and the designs they attached, on a booking
 * request.
 *
 * The request form priced "Guest mehendi for the day" at 12,000 however many
 * days were asked for, and nothing on the booking said what the buyer had been
 * shown, so the vendor could not see it either. `estimatedAmount` is the
 * published price times the quantity where the price counts something; the
 * backfill applies the same rule to requests already made against a price.
 *
 * `referenceImages` holds the photos a buyer uploads with the request — the
 * mehendi design, the decor they liked — as URLs from the media upload.
 */
export class Phase60BookingEstimateAndReferences1710000085000 implements MigrationInterface {
  name = 'Phase60BookingEstimateAndReferences1710000085000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "estimatedAmount" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "referenceImages" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(`
      UPDATE "bookings" b
         SET "estimatedAmount" = CASE
               WHEN o."pricingModel" IN ('per_person', 'per_item', 'per_hour', 'per_day', 'per_session')
                 THEN CASE WHEN b."quantity" >= 1 THEN o."price" * b."quantity" END
               ELSE o."price"
             END
        FROM "service_offerings" o
       WHERE b."offeringId" = o."id"
         AND b."estimatedAmount" IS NULL
         AND o."price" IS NOT NULL
         AND o."pricingModel" NOT IN ('custom_quote', 'no_public_price')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "referenceImages"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "estimatedAmount"`);
  }
}
