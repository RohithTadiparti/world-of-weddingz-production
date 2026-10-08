import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Empty direct threads that the chat gate would never have let anybody open.
 *
 * Before ISS-05, muting, clearing, deleting or read-marking a thread went
 * through getOrCreateConversation, so doing any of those to a stranger created
 * an empty "match" conversation with them, and it then sat in both people's
 * lists. The housekeeping paths no longer create threads, but the rows the old
 * code made are still there.
 *
 * A row is a phantom only when all of these hold:
 *  - it is a direct thread (no booking): a booking thread is opened by the
 *    booking module on its own rules and is never one of these;
 *  - no message has ever been written to it — clearing is a watermark, so a
 *    thread somebody actually used still has its rows;
 *  - the chat gate refuses the pair in BOTH directions, decided by the same
 *    ChatService.assertCanChat the app uses, not a copy of it in SQL. A pair
 *    the gate allows keeps its thread even when it is empty: opening a chat
 *    creates one before anything is said.
 */

export interface ConversationCandidate {
  id: string;
  participantA: string;
  participantB: string;
  createdAt: Date;
}

export interface PhantomConversation extends ConversationCandidate {
  /** What the chat gate said when asked about this pair. */
  reason: string;
  /** Per-reader rows (mute, clear, delete) that go with it. */
  preferences: number;
}

/** ChatService.assertCanChat, or anything with its contract. */
export type ChatGate = (senderId: string, recipientId: string) => Promise<unknown>;

/**
 * Whether the gate refuses the pair, and why.
 *
 * Asked both ways round because the gate is not quite symmetric: it refuses a
 * message *to* a deactivated account, which says nothing about whether the two
 * have a relationship. Only a refusal (403) or a missing account (404) counts
 * as "no relationship"; anything else — the database going away mid-run — is
 * an error and stops the sweep rather than being read as permission to delete.
 */
export async function chatRefusal(
  gate: ChatGate,
  a: string,
  b: string,
): Promise<string | null> {
  const reasons: string[] = [];
  for (const [sender, recipient] of [
    [a, b],
    [b, a],
  ]) {
    try {
      await gate(sender, recipient);
      return null;
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) {
        reasons.push(err.message);
        continue;
      }
      throw err;
    }
  }
  return [...new Set(reasons)].join(' / ');
}

/** Picks the phantoms out of the empty direct threads, in the order given. */
export async function selectPhantomConversations(
  candidates: ConversationCandidate[],
  gate: ChatGate,
  preferenceCounts: Map<string, number> = new Map(),
): Promise<PhantomConversation[]> {
  const phantoms: PhantomConversation[] = [];
  for (const candidate of candidates) {
    const reason = await chatRefusal(gate, candidate.participantA, candidate.participantB);
    if (reason === null) continue;
    phantoms.push({ ...candidate, reason, preferences: preferenceCounts.get(candidate.id) ?? 0 });
  }
  return phantoms;
}

/** "Direct thread, nothing ever written to it", as SQL. Kept in one place so the delete re-checks exactly what the listing checked. */
const EMPTY_DIRECT_THREAD = `
  c."bookingId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "messages" m WHERE m."conversationId" = c."id")
`;

export interface SweepResult {
  conversations: number;
  preferences: number;
}

export class PhantomConversationSweep {
  constructor(
    private readonly dataSource: DataSource,
    private readonly gate: ChatGate,
  ) {}

  /** Every empty direct thread, oldest first. Decides nothing on its own. */
  async candidates(): Promise<ConversationCandidate[]> {
    const rows: ConversationCandidate[] = await this.dataSource.query(`
      SELECT c."id", c."participantA", c."participantB", c."createdAt"
        FROM "conversations" c
       WHERE ${EMPTY_DIRECT_THREAD}
       ORDER BY c."createdAt" ASC, c."id" ASC
    `);
    return rows;
  }

  async find(listed?: ConversationCandidate[]): Promise<PhantomConversation[]> {
    const candidates = listed ?? (await this.candidates());
    if (candidates.length === 0) return [];
    const counts: { conversationId: string; count: string }[] = await this.dataSource.query(
      `SELECT "conversationId", COUNT(*) AS "count"
         FROM "chat_preferences"
        WHERE "conversationId" = ANY($1::uuid[])
        GROUP BY "conversationId"`,
      [candidates.map((c) => c.id)],
    );
    const byId = new Map(counts.map((r) => [r.conversationId, Number(r.count)]));
    return selectPhantomConversations(candidates, this.gate, byId);
  }

  /**
   * Deletes the given threads and their per-reader rows in one transaction.
   *
   * The emptiness test is repeated inside the delete, so a thread that got its
   * first message between the listing and this call is left alone rather than
   * deleted out from under the people talking in it.
   */
  async remove(ids: string[]): Promise<SweepResult> {
    if (ids.length === 0) return { conversations: 0, preferences: 0 };
    return this.dataSource.transaction((manager) => removePhantoms(manager, ids));
  }
}

/**
 * Rows from a DELETE … RETURNING. The Postgres driver hands those back as
 * `[rows, rowCount]` rather than the bare rows a SELECT returns.
 */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as T[];
}

export async function removePhantoms(manager: EntityManager, ids: string[]): Promise<SweepResult> {
  const gone = returnedRows<{ id: string }>(
    await manager.query(
      `DELETE FROM "conversations" c
        WHERE c."id" = ANY($1::uuid[])
          AND ${EMPTY_DIRECT_THREAD}
        RETURNING c."id"`,
      [ids],
    ),
  ).map((r) => r.id);
  if (gone.length === 0) return { conversations: 0, preferences: 0 };

  const prefs = returnedRows<{ id: string }>(
    await manager.query(
      `DELETE FROM "chat_preferences" WHERE "conversationId" = ANY($1::uuid[]) RETURNING "id"`,
      [gone],
    ),
  );
  return { conversations: gone.length, preferences: prefs.length };
}
