import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { UserRole } from '../../../common/enums';
import { User } from '../entities/user.entity';
import { JwtPayload } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy administrator SSO policy', () => {
  const users = { findOne: jest.fn() };
  const cfg = {
    auth: {
      jwtSecret: 'test-jwt-secret-at-least-32-characters',
      adminLoginProvider: 'zoho',
    },
  } as unknown as AppConfigService;
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

  it('rejects an administrator token not issued through Zoho SSO', async () => {
    users.findOne.mockResolvedValue(account());
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts an administrator token issued through Zoho SSO', async () => {
    users.findOne.mockResolvedValue(account());
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate({ ...payload, authMethod: 'zoho' })).resolves.toMatchObject({
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

describe('JwtStrategy token generation', () => {
  const users = { findOne: jest.fn() };
  const cfg = {
    auth: { jwtSecret: 'test-jwt-secret-at-least-32-characters', adminLoginProvider: 'password' },
  } as unknown as AppConfigService;
  const payload: JwtPayload = {
    sub: 'user-1',
    email: 'bride@example.com',
    role: UserRole.BRIDE,
    managedByAgentId: null,
    tv: 0,
  };
  const account = (overrides: Partial<User> = {}) =>
    ({
      id: 'user-1',
      email: 'bride@example.com',
      role: UserRole.BRIDE,
      isActive: true,
      managedByAgentId: null,
      mustResetPassword: false,
      tokenVersion: 0,
      ...overrides,
    }) as User;

  it('refuses a token minted before a suspension, after the account is reactivated', async () => {
    // Suspension bumped the generation; reactivation alone does not revive it.
    users.findOne.mockResolvedValue(account({ tokenVersion: 1 }));
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a token from the current generation', async () => {
    users.findOne.mockResolvedValue(account());
    const strategy = new JwtStrategy(cfg, users as never);

    await expect(strategy.validate(payload)).resolves.toMatchObject({ userId: 'user-1' });
  });
});
