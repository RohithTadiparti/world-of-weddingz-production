import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Withdrawn quotations, and the service on bookings made against a slot
 * (EZ1-I264, EZ1-I266).
 *
 * A provider taking back a price used to cancel the whole booking. The offer is
 * now kept as `withdrawn` and the request goes back to them to re-price, which
 * needs the value on the Postgres type.
 *
 * A slot is published for one service, but a booking against it only recorded
 * the service when the customer picked it again, so the provider's queue read
 * "—" where the service belongs. New bookings copy it from the slot; this fills
 * in the ones already made. Only empty values are written, so a service the
 * customer chose is never replaced.
 */
export class Phase58QuotationWithdrawn1710000083000 implements MigrationInterface {
  name = 'Phase58QuotationWithdrawn1710000083000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "quotations_status_enum" ADD VALUE IF NOT EXISTS 'withdrawn'`,
    );
    await queryRunner.query(`
      UPDATE "bookings" b
         SET "vendorServiceId" = s."vendorServiceId"
        FROM "vendor_availability_slots" s
       WHERE b."vendorServiceId" IS NULL
         AND b."slotId" = s."id"
         AND s."vendorServiceId" IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type, and the backfilled
    // service is the one the slot was published for: both stay.
  }
}
