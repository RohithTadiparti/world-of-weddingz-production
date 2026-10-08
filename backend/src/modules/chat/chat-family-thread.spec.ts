import { ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { InterestStatus, ThreadKind, UserRole } from '../../common/enums';

/**
 * A family account's own profile holds the parent's details and is never a
 * match, so an accepted interest left on it (from before that was enforced)
 * must not open a match chat. A bride and groom with an accepted interest
 * still may talk, and the family can still enquire with a provider.
 */
describe('ChatService match threads and family accounts', () => {
  const roles: Record<string, UserRole> = {
    'groom-user': UserRole.GROOM,
    'bride-user': UserRole.BRIDE,
    'mother-user': UserRole.FAMILY,
    'vendor-user': UserRole.VENDOR,
  };
  const profileOf: Record<string, string> = {
    'groom-user': 'groom',
    'bride-user': 'bride',
    'mother-user': 'mother-own',
  };
  // Every pair of profiles here has an accepted interest.
  const accepted = { id: 'i1', status: InterestStatus.ACCEPTED };

  const service = new ChatService(
    {} as never,
    {} as never,
    { findOne: async () => accepted } as never,
    {
      findOne: async ({ where }: { where: { userId: string } }) =>
        profileOf[where.userId] ? { id: profileOf[where.userId], userId: where.userId } : null,
      find: async () => [],
    } as never,
    {
      findOne: async ({ where }: { where: { id: string } }) =>
        roles[where.id]
          ? { id: where.id, role: roles[where.id], isActive: true, managedByAgentId: null }
          : null,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('opens a match thread between a bride and a groom with an accepted interest', async () => {
    await expect(service.assertCanChat('groom-user', 'bride-user')).resolves.toBe(ThreadKind.MATCH);
  });

  it('refuses a match thread with a family account, in either direction', async () => {
    await expect(service.assertCanChat('groom-user', 'mother-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.assertCanChat('mother-user', 'bride-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('still lets a family account enquire with a provider', async () => {
    await expect(service.assertCanChat('mother-user', 'vendor-user')).resolves.toBe(
      ThreadKind.INQUIRY,
    );
  });
});
