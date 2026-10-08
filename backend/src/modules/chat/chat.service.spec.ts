import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

/**
 * Thread housekeeping (mute, clear, delete, read-mark) works on a thread that
 * already exists and never creates one.
 *
 * These used to go through getOrCreateConversation, so muting a stranger made
 * an empty "match" thread with them appear in both lists — a conversation the
 * chat gate would never have allowed to start.
 */
describe('ChatService thread housekeeping', () => {
  const ME = '11111111-1111-4111-8111-111111111111';
  const THEM = '22222222-2222-4222-8222-222222222222';
  const convo = { id: 'c1', participantA: ME, participantB: THEM, bookingId: null };

  let knownUsers: string[];
  let existing: typeof convo | null;

  const conversations = {
    findOne: jest.fn(async () => existing),
    save: jest.fn(),
    create: jest.fn(),
  };
  const users = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      knownUsers.includes(where.id) ? { id: where.id } : null,
    ),
  };
  const prefs = {
    findOne: jest.fn(async () => null),
    create: jest.fn((row: object) => ({ muted: false, clearedAt: null, deletedAt: null, ...row })),
    save: jest.fn(async (row: object) => row),
  };
  const messages = { update: jest.fn(async () => ({ affected: 2 })) };

  const none = {} as never;
  const service = new ChatService(
    conversations as never,
    messages as never,
    none,
    none,
    users as never,
    none,
    none,
    prefs as never,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    knownUsers = [ME, THEM];
    existing = convo;
  });

  const housekeeping: [string, () => Promise<unknown>][] = [
    ['mute', () => service.setMuted(ME, THEM, true)],
    ['clear', () => service.clear(ME, THEM)],
    ['delete', () => service.deleteConversation(ME, THEM)],
    ['read-mark', () => service.markRead(ME, THEM)],
  ];

  it.each(housekeeping)('%s refuses with 404 and creates nothing when there is no thread', async (_n, call) => {
    existing = null;
    await expect(call()).rejects.toThrow(
      new NotFoundException('You have no conversation with this account'),
    );
    expect(conversations.save).not.toHaveBeenCalled();
    expect(prefs.save).not.toHaveBeenCalled();
  });

  it.each(housekeeping)('%s refuses with 404 for an account that does not exist', async (_n, call) => {
    knownUsers = [ME];
    await expect(call()).rejects.toThrow(new NotFoundException('User not found'));
    expect(conversations.findOne).not.toHaveBeenCalled();
    expect(conversations.save).not.toHaveBeenCalled();
  });

  it('refuses housekeeping on a thread with yourself', async () => {
    await expect(service.setMuted(ME, ME, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('looks up only the direct thread, never a booking thread', async () => {
    await service.setMuted(THEM, ME, true);
    const [{ where }] = conversations.findOne.mock.calls[0] as unknown as [
      { where: { participantA: string; participantB: string; bookingId: unknown } },
    ];
    // Participants are stored in sorted order whichever side asks.
    expect(where.participantA).toBe(ME);
    expect(where.participantB).toBe(THEM);
    expect(where.bookingId).toEqual(expect.objectContaining({ _type: 'isNull' }));
  });

  it('still mutes, clears and removes an existing thread', async () => {
    await expect(service.setMuted(ME, THEM, true)).resolves.toEqual({ muted: true });
    expect(prefs.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: ME, conversationId: 'c1', muted: true }),
    );

    await expect(service.clear(ME, THEM)).resolves.toEqual(
      expect.objectContaining({ cleared: true }),
    );
    await expect(service.deleteConversation(ME, THEM)).resolves.toEqual({ deleted: true });
    expect(conversations.save).not.toHaveBeenCalled();
  });

  it("marks the other side's messages read in an existing thread", async () => {
    await expect(service.markRead(ME, THEM)).resolves.toEqual({ marked: 2 });
    expect(messages.update).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', senderId: THEM }),
      expect.objectContaining({ readAt: expect.any(Date) }),
    );
  });
});
