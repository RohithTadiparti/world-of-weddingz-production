import { User } from './entities/user.entity';
import { AdminService } from '../admin/admin.service';
import { AgentsService } from '../agents/agents.service';
import { OfficersService } from '../verification/officers.service';
import { UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Every path that switches an account off must also end its sessions, so that
 * switching it back on needs a fresh sign-in rather than reviving old tokens.
 */
describe('account suspension revokes sessions', () => {
  let account: User;
  let userUpdates: jest.Mock;
  let sessionUpdates: jest.Mock;
  let users: Record<string, unknown>;

  beforeEach(() => {
    account = {
      id: 'user-1',
      email: 'someone@example.com',
      role: UserRole.BRIDE,
      isActive: true,
      managedByAgentId: 'agent-1',
      tokenVersion: 0,
    } as User;
    userUpdates = jest.fn();
    sessionUpdates = jest.fn();
    const manager = {
      save: jest.fn(async (x: unknown) => x),
      getRepository: jest.fn((entity: unknown) =>
        entity === User ? { update: userUpdates } : { update: sessionUpdates },
      ),
    };
    users = {
      findOne: jest.fn(async () => account),
      save: jest.fn(async (x: unknown) => x),
      manager: { transaction: jest.fn(async (work: (m: unknown) => unknown) => work(manager)) },
    };
  });

  const expectRevoked = (reason: string) => {
    expect(userUpdates).toHaveBeenCalledWith('user-1', {
      tokenVersion: expect.any(Function),
    });
    expect(sessionUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ revokedReason: reason }),
    );
  };

  const expectUntouched = () => {
    expect(userUpdates).not.toHaveBeenCalled();
    expect(sessionUpdates).not.toHaveBeenCalled();
  };

  describe('admin', () => {
    const admin = () =>
      new (AdminService as unknown as new (...args: unknown[]) => AdminService)(users);

    it('bumps the token generation and revokes refresh sessions on suspension', async () => {
      const view = await admin().setUserStatus('user-1', { isActive: false });
      expect(view.isActive).toBe(false);
      expectRevoked('account suspended');
    });

    it('does not sign anybody out on reactivation', async () => {
      account.isActive = false;
      await admin().setUserStatus('user-1', { isActive: true });
      expectUntouched();
    });

    it('does nothing extra when the account was already suspended', async () => {
      account.isActive = false;
      await admin().setUserStatus('user-1', { isActive: false });
      expectUntouched();
    });
  });

  describe('agency', () => {
    const agents = () => {
      const profiles = { findOne: jest.fn(async () => ({ id: 'p-1', userId: 'user-1' })) };
      return new (AgentsService as unknown as new (...args: unknown[]) => AgentsService)(
        users,
        profiles,
      );
    };

    it('revokes a client deactivated by their agency', async () => {
      await agents().setClientStatus('agent-1', 'user-1', false);
      expectRevoked('account deactivated');
    });

    it('leaves sessions alone on reactivation', async () => {
      account.isActive = false;
      await agents().setClientStatus('agent-1', 'user-1', true);
      expectUntouched();
    });
  });

  describe('verification officers', () => {
    const actor: AuthUser = {
      userId: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      managedByAgentId: null,
    };
    const officers = () => {
      const profiles = { findOne: jest.fn(async () => null) };
      const availability = { findOne: jest.fn(async () => null) };
      return new (OfficersService as unknown as new (...args: unknown[]) => OfficersService)(
        users,
        profiles,
        availability,
        {},
        {},
        { record: jest.fn() },
      );
    };

    it('revokes a suspended officer', async () => {
      account.role = UserRole.IN_PERSON;
      await officers().setActive(actor, 'user-1', false);
      expectRevoked('account suspended');
    });
  });
});
