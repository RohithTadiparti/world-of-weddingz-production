import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { ChatModule } from '../modules/chat/chat.module';
import { ChatService } from '../modules/chat/chat.service';
import { PhantomConversationSweep } from '../modules/chat/phantom-conversations';
import { hasFlag, withMaintenanceContext } from './maintenance/maintenance-context';

loadEnv();

/**
 * Lists, and with --apply deletes, the empty chat threads the old housekeeping
 * bug created (ISS-05). See PhantomConversationSweep for what qualifies, and
 * docs/PHASE-1-OPERATIONS.md for when to run it.
 *
 *   npm run cleanup:phantom-chats                 (dry run, source)
 *   npm run cleanup:phantom-chats -- --apply      (delete, source)
 *   npm run cleanup:phantom-chats:prod [-- --apply]   (compiled, in the container)
 *
 * Dry run by default: it prints what it would delete and changes nothing.
 */
async function main(): Promise<void> {
  const apply = hasFlag(process.argv.slice(2), '--apply');

  await withMaintenanceContext(ChatModule, async (app) => {
    const chat = app.get(ChatService);
    const sweep = new PhantomConversationSweep(app.get(DataSource), (a, b) =>
      chat.assertCanChat(a, b),
    );

    const candidates = await sweep.candidates();
    const phantoms = await sweep.find(candidates);
    console.log(
      `${candidates.length} empty direct thread(s); ${phantoms.length} with no relationship that permits chat.`,
    );
    for (const p of phantoms) {
      console.log(
        `  ${p.id}  ${p.participantA} <-> ${p.participantB}  created ${new Date(p.createdAt).toISOString()}` +
          `  prefs=${p.preferences}  (${p.reason})`,
      );
    }

    if (!apply) {
      console.log('Dry run: nothing was deleted. Re-run with --apply to delete the threads listed above.');
      return;
    }
    const result = await sweep.remove(phantoms.map((p) => p.id));
    console.log(
      `Deleted ${result.conversations} conversation(s) and ${result.preferences} chat preference row(s).` +
        (result.conversations < phantoms.length
          ? ` ${phantoms.length - result.conversations} were skipped because a message arrived since the listing.`
          : ''),
    );
  });
}

main().catch((err) => {
  console.error('Phantom chat cleanup failed:', err);
  process.exit(1);
});
