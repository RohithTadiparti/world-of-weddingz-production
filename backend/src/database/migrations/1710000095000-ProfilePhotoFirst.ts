import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every profile with photographs gets a profile photo, and it is the first one.
 *
 * `profile_details.primaryPhotoUrl` recorded a choice, but match cards, chat,
 * interests and circulation all show `photos[0]`, so a profile photo picked
 * after the first upload never showed anywhere but the owner's own page.
 * Choosing one now reorders the list; this brings existing profiles into line
 * in two steps:
 *
 *  1. A profile photo somebody chose moves to the front of `photos`.
 *  2. Where nobody chose — or the choice points at a photo since removed — the
 *     first photo becomes the profile photo. Photographs are the first biodata
 *     step, so most rows were created after the uploads and never had one.
 *
 * PRIVATE profiles get the same default; visibility decides who sees it, not
 * whether it exists. Numbered clear of 1710000088000–91000, which open
 * branches already use. `down` is a no-op: the previous order and the missing
 * pointers are not recorded anywhere, and the photographs are the same.
 */
export class ProfilePhotoFirst1710000095000 implements MigrationInterface {
  name = 'ProfilePhotoFirst1710000095000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "profiles" p
         SET "photos" = jsonb_build_array(d."primaryPhotoUrl")
                     || COALESCE(
                          (SELECT jsonb_agg(e ORDER BY i)
                             FROM jsonb_array_elements(p."photos") WITH ORDINALITY AS t(e, i)
                            WHERE e <> to_jsonb(d."primaryPhotoUrl")),
                          '[]'::jsonb)
        FROM "profile_details" d
       WHERE d."profileId" = p."id"
         AND d."primaryPhotoUrl" IS NOT NULL
         AND p."photos" @> jsonb_build_array(d."primaryPhotoUrl")
         AND p."photos"->>0 IS DISTINCT FROM d."primaryPhotoUrl"
    `);

    await queryRunner.query(`
      UPDATE "profile_details" d
         SET "primaryPhotoUrl" = p."photos"->>0
        FROM "profiles" p
       WHERE d."profileId" = p."id"
         AND d."primaryPhotoUrl" IS DISTINCT FROM p."photos"->>0
    `);
  }

  public async down(): Promise<void> {
    // Nothing to undo; see above.
  }
}
