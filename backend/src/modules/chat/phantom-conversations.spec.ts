import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ChatService } from './chat.service';
import {
  ConversationCandidate,
  PhantomConversationSweep,
  chatRefusal,
  removePhantoms,
  selectPhantomConversations,
} from './phantom-conversations';
import { InterestStatus, UserRole } from '../../common/enums';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const candidate = (id: string, participantA: string, participantB: string): ConversationCandidate => ({
  id,
  participantA,
  participantB,
  createdAt: new Date('2026-09-01T00:00:00Z'),
});

/**
 * The empty threads the old housekeeping bug created (ISS-05) are picked out
 * by asking the chat gate, never by a rule of their own.
 */
describe('phantom conversations', () => {
  describe('chatRefusal', () => {
    it('is null when the gate allows the pair in either direction', async () => {
      const gate = jest.fn(async (sender: string) => {
        if (sender === A) throw new ForbiddenException('That account is not available');
      });
      await expect(chatRefusal(gate, A, B)).resolves.toBeNull();
      expect(gate).toHaveBeenCalledWith(A, B);
      expect(gate).toHaveBeenCalledWith(B, A);
    });

    it('stops at the first direction that is allowed', async () => {
      const gate = jest.fn(async () => undefined);
      await expect(chatRefusal(gate, A, B)).resolves.toBeNull();
      expect(gate).toHaveBeenCalledTimes(1);
    });

    it('gives the reasons when both directions are refused or an account is gone', async () => {
      const refused = jest.fn(async () => {
        throw new ForbiddenException('You can only chat with accepted matches');
      });
      await expect(chatRefusal(refused, A, B)).resolves.toBe('You can only chat with accepted matches');

      const gone = jest.fn(async (sender: string) => {
        if (sender === A) throw new NotFoundException('User not found');
        throw new ForbiddenException('You are not permitted to message this account');
      });
      await expect(chatRefusal(gone, A, B)).resolves.toBe(
        'User not found / You are not permitted to message this account',
      );
    });

    it('does not read any other failure as "no relationship"', async () => {
      const broken = jest.fn(async () => {
        throw new Error('connection terminated');
      });
      await expect(chatRefusal(broken, A, B)).rejects.toThrow('connection terminated');
    });
  });

  describe('selectPhantomConversations', () => {
    it('keeps the threads the gate refuses, with their preference counts, in order', async () => {
      const allowed = new Set([`${A}:${C}`]);
      const gate = async (s: string, r: string) => {
        if (!allowed.has(`${s}:${r}`)) throw new ForbiddenException('You can only chat with accepted matches');
      };
      const phantoms = await selectPhantomConversations(
        [candidate('c1', A, B), candidate('c2', A, C), candidate('c3', B, C)],
        gate,
        new Map([['c1', 2]]),
      );
      expect(phantoms.map((p) => [p.id, p.preferences])).toEqual([
        ['c1', 2],
        ['c3', 0],
      ]);
      expect(phantoms[0].reason).toBe('You can only chat with accepted matches');
    });

    it('uses ChatService.assertCanChat itself', async () => {
      // Two individuals: a match thread, which needs an accepted interest. One
      // pair has it, the other only a pending one.
      const users = {
        findOne: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          role: UserRole.BRIDE,
          isActive: true,
          managedByAgentId: null,
        })),
      };
      const profiles = {
        findOne: jest.fn(async ({ where }: { where: { userId: string } }) => ({ id: `p-${where.userId}` })),
      };
      const interests = {
        findOne: jest.fn(async ({ where }: { where: { fromProfileId: string; toProfileId: string; status: InterestStatus }[] }) =>
          where.some(
            (w) => w.status === InterestStatus.ACCEPTED && [w.fromProfileId, w.toProfileId].includes(`p-${C}`),
          )
            ? { id: 'i1' }
            : null,
        ),
      };
      const none = {} as never;
      const chat = new ChatService(
        none,
        none,
        interests as never,
        profiles as never,
        users as never,
        none, none, none, none, none, none, none, none, none, none, none, none,
      );

      const phantoms = await selectPhantomConversations(
        [candidate('c1', A, B), candidate('c2', A, C)],
        (a, b) => chat.assertCanChat(a, b),
      );
      expect(phantoms.map((p) => p.id)).toEqual(['c1']);
      expect(phantoms[0].reason).toBe('You can only chat with accepted matches');
    });
  });

  describe('PhantomConversationSweep', () => {
    it('counts preferences only for the candidates it found', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce([candidate('c1', A, B)])
        .mockResolvedValueOnce([{ conversationId: 'c1', count: '3' }]);
      const sweep = new PhantomConversationSweep({ query } as unknown as DataSource, async () => {
        throw new ForbiddenException('nope');
      });
      const found = await sweep.find();
      expect(found).toEqual([expect.objectContaining({ id: 'c1', preferences: 3, reason: 'nope' })]);
      expect(query.mock.calls[0][0]).toContain('"bookingId" IS NULL');
      expect(query.mock.calls[0][0]).toContain('NOT EXISTS (SELECT 1 FROM "messages"');
      expect(query.mock.calls[1][1]).toEqual([['c1']]);
    });

    it('does nothing further when there are no empty threads', async () => {
      const query = jest.fn().mockResolvedValueOnce([]);
      const gate = jest.fn();
      const sweep = new PhantomConversationSweep({ query } as unknown as DataSource, gate);
      await expect(sweep.find()).resolves.toEqual([]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(gate).not.toHaveBeenCalled();
    });

    it('opens no transaction for an empty list', async () => {
      const transaction = jest.fn();
      const sweep = new PhantomConversationSweep({ transaction } as unknown as DataSource, jest.fn());
      await expect(sweep.remove([])).resolves.toEqual({ conversations: 0, preferences: 0 });
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('removePhantoms', () => {
    it('deletes only threads still empty, then their preferences', async () => {
      const query = jest
        .fn()
        // DELETE … RETURNING comes back as [rows, count]: c2 got a message.
        .mockResolvedValueOnce([[{ id: 'c1' }], 1])
        .mockResolvedValueOnce([[{ id: 'pref1' }, { id: 'pref2' }], 2]);
      const result = await removePhantoms({ query } as unknown as EntityManager, ['c1', 'c2']);

      expect(result).toEqual({ conversations: 1, preferences: 2 });
      const [deleteConvos, convoParams] = query.mock.calls[0];
      expect(deleteConvos).toContain('DELETE FROM "conversations"');
      expect(deleteConvos).toContain('"bookingId" IS NULL');
      expect(deleteConvos).toContain('NOT EXISTS (SELECT 1 FROM "messages"');
      expect(convoParams).toEqual([['c1', 'c2']]);
      expect(query.mock.calls[1][0]).toContain('DELETE FROM "chat_preferences"');
      expect(query.mock.calls[1][1]).toEqual([['c1']]);
    });

    it('leaves preferences alone when nothing was deleted', async () => {
      const query = jest.fn().mockResolvedValueOnce([[], 0]);
      await expect(removePhantoms({ query } as unknown as EntityManager, ['c1'])).resolves.toEqual({
        conversations: 0,
        preferences: 0,
      });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
