import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The bank account a vendor or planner asks to be paid into.
 *
 * This slot first held a migration that dropped `vendor_services.
 * concurrentCapacity` and `service_definitions.defaultCapacity`. That lost
 * each vendor's own capacity with no way back, so it was withdrawn: the
 * columns stay, the vendor forms stop editing them, and the stored values
 * keep seeding new availability windows.
 *
 * The account number is stored sealed; see field-cipher.ts.
 */
export class PayoutBankAccounts1710000100000 implements MigrationInterface {
  name = 'PayoutBankAccounts1710000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payout_bank_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ownerType" character varying(16) NOT NULL,
        "ownerId" uuid NOT NULL,
        "accountHolderName" character varying(120) NOT NULL,
        "bankName" character varying(120) NOT NULL,
        "accountType" character varying(16) NOT NULL,
        "accountNumberSealed" text NOT NULL,
        "accountLast4" character varying(4) NOT NULL,
        "ifsc" character varying(11) NOT NULL,
        "branch" character varying(200) NOT NULL DEFAULT '',
        "status" character varying(32) NOT NULL DEFAULT 'pending_verification',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payout_bank_accounts_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payout_bank_accounts_owner" ON "payout_bank_accounts" ("ownerType", "ownerId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payout_bank_accounts_owner"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payout_bank_accounts"`);
  }
}
