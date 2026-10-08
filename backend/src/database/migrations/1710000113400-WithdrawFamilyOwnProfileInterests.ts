import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ends the live interests attached to a family account's own profile.
 *
 * That row holds the parent's or guardian's details. It used to be served as a
 * bride or groom candidate, so some brides and grooms are holding pending or
 * accepted interests with it — and, through an accepted one, a chat thread with
 * somebody who was never a match. The application now refuses all of it; this
 * clears what was already there so nobody is left waiting on, or talking to, a
 * profile that is not a candidate.
 *
 * A pending interest is withdrawn and an accepted one unmatched, with the
 * reason recorded on the row; the rows themselves are kept for history. A match
 * already confirmed as fixed is left alone: accounts have been provisioned from
 * it, and undoing that is a support case, not a migration. Shortlist rows are
 * not deleted — the application drops them on read.
 */
export class WithdrawFamilyOwnProfileInterests1710000113400 implements MigrationInterface {
  name = 'WithdrawFamilyOwnProfileInterests1710000113400';

  async up(queryRunner: QueryRunner): Promise<void> {
    const familyOwnProfiles = `
      SELECT p.id FROM profiles p
        JOIN users u ON u.id = p."userId"
       WHERE u.role = 'family'`;

    await queryRunner.query(`
      UPDATE interests
         SET status = CASE WHEN status = 'accepted' THEN 'unmatched'::interests_status_enum
                           ELSE 'withdrawn'::interests_status_enum END,
             "matchFixedState" = 'none',
             "fixedConfirmedFromAt" = NULL,
             "fixedConfirmedToAt" = NULL,
             "endedReason" = 'A family member''s own profile is not a matchmaking profile.',
             "updatedAt" = now()
       WHERE status IN ('pending', 'accepted')
         AND "matchFixedState" <> 'confirmed'
         AND ("fromProfileId" IN (${familyOwnProfiles}) OR "toProfileId" IN (${familyOwnProfiles}))
    `);
  }

  async down(): Promise<void> {
    // Not reversible: which rows were pending and which accepted is not kept,
    // and re-opening an interest with a profile that is not a candidate would
    // only recreate the defect this removed.
  }
}
