import { ForbiddenException } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { UserRole } from '../../../common/enums';
import { User } from '../entities/user.entity';
import { JwtPayload } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy administrator MFA policy', () => {
  const users = { findOne: jest.fn() };
  const cfg = {
    auth: {
      jwtSecret: 'test-jwt-secret-at-least-32-characters',
      mfaRequiredForAdmin: true,
    },
  } as AppConfigService;
  const payload: JwtPayload = {
    sub: 'user-1',
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    managedByAgentId: null,
    tv: 0,
  };

  beforeEach(() => users.findOne.mockReset());

  function account(overrides: Partial<User> = {}): User {
    return {
      id: 'user-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      isActive: true,
      managedByAgentId: null,
      mustResetPassword: false,
      tokenVersion: 0,
      mfaEnabled: false,
      ...overrides,
    } as User;
  }

  it('rejects an existing administrator session when required MFA is not enrolled', async () => {
    users.findOne.mockResolvedValue(account());
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts an administrator session after MFA enrollment', async () => {
    users.findOne.mockResolvedValue(account({ mfaEnabled: true }));
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      userId: 'user-1',
      role: UserRole.ADMIN,
    });
  });

  it('does not impose administrator enrollment policy on a non-admin account', async () => {
    users.findOne.mockResolvedValue(account({ role: UserRole.BRIDE }));
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate({ ...payload, role: UserRole.BRIDE })).resolves.toMatchObject({
      userId: 'user-1',
      role: UserRole.BRIDE,
    });
  });
});
