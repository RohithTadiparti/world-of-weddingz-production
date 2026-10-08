import { UnauthorizedException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { REFRESH_SUPERSEDED, SessionsService, revokeAllAccess } from './sessions.service';
import { RefreshSession } from './entities/refresh-session.entity';
import { User } from './entities/user.entity';
import { hashSecretToken } from '../../common/util/tokens';
import { AuditService } from '../../platform/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';

const refreshSecret = 'test-refresh-secret-with-enough-entropy';

/**
 * Rotation and reuse detection, against an in-memory table of sessions.
 */
describe('SessionsService.rotate', () => {
  const userId = 'user-1';
  const familyId = 'family-1';
  const later = () => new Date(Date.now() + 86_400_000);

  let rows: RefreshSession[];
  let audit: { record: jest.Mock };

  const session = (token: string, over: Partial<RefreshSession> = {}): RefreshSession =>
    ({
      id: `s-${token}`,
      userId,
      familyId,
      tokenHash: hashSecretToken(token, refreshSecret),
      expiresAt: later(),
      revokedAt: null,
      revokedReason: null,
      lastUsedAt: null,
      createdAt: new Date(),
      ...over,
    }) as RefreshSession;

  const repo = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.tokenHash) return rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
      return rows.find((r) => r.id === where.id) ?? null;
    }),
    save: jest.fn(async (row: RefreshSession) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    }),
    create: jest.fn((row: Partial<RefreshSession>) => ({
      id: `s-new-${rows.length}`,
      createdAt: new Date(),
      revokedAt: null,
      ...row,
    })),
    // Every update the service makes is conditional on the row still being live.
    update: jest.fn(async (where: Partial<RefreshSession>, patch: Partial<RefreshSession>) => {
      let affected = 0;
      for (const r of rows) {
        const match =
          (where.id === undefined || r.id === where.id) &&
          (where.familyId === undefined || r.familyId === where.familyId) &&
          (where.userId === undefined || r.userId === where.userId);
        if (match && !r.revokedAt) {
          Object.assign(r, patch);
          affected += 1;
        }
      }
      return { affected };
    }),
  };

  const service = (graceSeconds: number) =>
    new SessionsService(
      repo as unknown as Repository<RefreshSession>,
      audit as unknown as AuditService,
      {
        auth: { refreshReuseGraceSeconds: graceSeconds, jwtRefreshSecret: refreshSecret },
      } as unknown as AppConfigService,
    );

  const live = () => rows.filter((r) => !r.revokedAt);

  beforeEach(() => {
    rows = [];
    audit = { record: jest.fn() };
    jest.clearAllMocks();
  });

  it('rotates a live token into a new one in the same family', async () => {
    rows.push(session('a'));
    const next = await service(5).rotate(userId, 'a', 'b', later());
    expect(next.familyId).toBe(familyId);
    expect(rows.find((r) => r.id === 's-a')?.revokedReason).toBe('rotated');
    expect(live()).toHaveLength(1);
  });

  it('refuses a replay of a token replaced moments ago without minting anything', async () => {
    // A second tab that lost the race, or a stolen copy replayed quickly: "a"
    // was rotated to "b" a second ago and is presented again.
    rows.push(session('a', { revokedAt: new Date(Date.now() - 1_000), revokedReason: 'rotated' }));
    rows.push(session('b'));

    const err = await service(5)
      .rotate(userId, 'a', 'c', later())
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: REFRESH_SUPERSEDED });
    // No new session, and the legitimate successor is untouched.
    expect(repo.save).not.toHaveBeenCalled();
    expect(live().map((r) => r.id)).toEqual(['s-b']);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never lets a replayed token trade places with its successor', async () => {
    // The old grace rule continued the family from its live session, so a
    // thief replaying promptly could keep minting sessions alongside the owner.
    rows.push(session('a'));
    const svc = service(5);
    await svc.rotate(userId, 'a', 'b', later());

    await expect(svc.rotate(userId, 'a', 'x', later())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.some((r) => r.tokenHash === hashSecretToken('x', refreshSecret))).toBe(false);

    // The owner's successor still works.
    const next = await svc.rotate(userId, 'b', 'c', later());
    expect(next.familyId).toBe(familyId);
  });

  it('treats reuse after the grace window as theft and revokes the family', async () => {
    rows.push(session('a', { revokedAt: new Date(Date.now() - 60_000), revokedReason: 'rotated' }));
    rows.push(session('b'));

    await expect(service(5).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(live()).toHaveLength(0);
    expect(audit.record).toHaveBeenCalled();
  });

  it('treats every reuse as theft when the grace window is 0', async () => {
    rows.push(session('a', { revokedAt: new Date(), revokedReason: 'rotated' }));
    rows.push(session('b'));

    await expect(service(0).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(live()).toHaveLength(0);
  });

  it('revokes the family on replay of a token signed out, even within the window', async () => {
    rows.push(session('a', { revokedAt: new Date(), revokedReason: 'logout' }));
    rows.push(session('b'));

    await expect(service(5).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(live()).toHaveLength(0);
  });

  it('lets only one of two simultaneous refreshes with the same token rotate it', async () => {
    rows.push(session('a'));
    const svc = service(5);

    const results = await Promise.allSettled([
      svc.rotate(userId, 'a', 'b1', later()),
      svc.rotate(userId, 'a', 'b2', later()),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(live()).toHaveLength(1);
  });

  it('refuses a token that belongs to somebody else', async () => {
    rows.push(session('a', { userId: 'someone-else' }));
    await expect(service(5).rotate(userId, 'a', 'b', later())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('SessionsService.revokeFamilyByToken', () => {
  it('signs out the whole login the token belongs to, not just its row', async () => {
    const tokenHash = hashSecretToken('current', refreshSecret);
    const repo = {
      findOne: jest.fn().mockResolvedValue({ id: 's-1', familyId: 'family-9', tokenHash }),
      update: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    const svc = new SessionsService(
      repo as unknown as Repository<RefreshSession>,
      { record: jest.fn() } as unknown as AuditService,
      { auth: { jwtRefreshSecret: refreshSecret } } as unknown as AppConfigService,
    );

    await svc.revokeFamilyByToken('current', 'logout');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { tokenHash } });
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: 'family-9' }),
      expect.objectContaining({ revokedReason: 'logout' }),
    );
  });
});

describe('revokeAllAccess', () => {
  it('bumps the token generation and revokes every refresh session', async () => {
    const users = { update: jest.fn() };
    const sessions = { update: jest.fn() };
    const manager = {
      getRepository: jest.fn((entity: unknown) => (entity === User ? users : sessions)),
    };

    await revokeAllAccess(manager as unknown as EntityManager, 'user-7', 'account suspended');

    const [id, patch] = users.update.mock.calls[0];
    expect(id).toBe('user-7');
    expect((patch.tokenVersion as () => string)()).toBe('"tokenVersion" + 1');
    expect(sessions.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-7' }),
      expect.objectContaining({ revokedReason: 'account suspended' }),
    );
  });
});
