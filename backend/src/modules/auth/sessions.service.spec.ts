import { UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SessionsService } from './sessions.service';
import { RefreshSession } from './entities/refresh-session.entity';
import { hashToken } from '../../common/util/tokens';
import { AuditService } from '../../platform/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';

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
      tokenHash: hashToken(token),
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
      // The live session of a family, newest first.
      const live = rows
        .filter((r) => r.familyId === where.familyId && !r.revokedAt && r.expiresAt > new Date())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return live[0] ?? null;
    }),
    save: jest.fn(async (row: RefreshSession) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    }),
    create: jest.fn((row: Partial<RefreshSession>) => ({ id: `s-new-${rows.length}`, createdAt: new Date(), revokedAt: null, ...row })),
    update: jest.fn(async (where: Partial<RefreshSession>, patch: Partial<RefreshSession>) => {
      for (const r of rows) {
        if (r.familyId === where.familyId && !r.revokedAt) Object.assign(r, patch);
      }
    }),
  };

  const service = (graceSeconds: number) =>
    new SessionsService(
      repo as unknown as Repository<RefreshSession>,
      audit as unknown as AuditService,
      { auth: { refreshReuseGraceSeconds: graceSeconds } } as unknown as AppConfigService,
    );

  const live = () => rows.filter((r) => !r.revokedAt);

  beforeEach(() => {
    rows = [];
    audit = { record: jest.fn() };
    jest.clearAllMocks();
  });

  it('rotates a live token into a new one in the same family', async () => {
    rows.push(session('a'));
    const next = await service(10).rotate(userId, 'a', 'b', later());
    expect(next.familyId).toBe(familyId);
    expect(rows.find((r) => r.id === 's-a')?.revokedReason).toBe('rotated');
    expect(live()).toHaveLength(1);
  });

  it('carries the login on when a token replaced moments ago is presented again', async () => {
    // A reload that lost the race: "a" was rotated to "b" a second ago, and the
    // browser still sent "a".
    rows.push(session('a', { revokedAt: new Date(Date.now() - 1_000), revokedReason: 'rotated' }));
    rows.push(session('b'));

    const next = await service(10).rotate(userId, 'a', 'c', later());

    expect(next.tokenHash).toBe(hashToken('c'));
    expect(next.familyId).toBe(familyId);
    expect(live()).toEqual([next]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats reuse after the grace window as theft and revokes the family', async () => {
    rows.push(session('a', { revokedAt: new Date(Date.now() - 60_000), revokedReason: 'rotated' }));
    rows.push(session('b'));

    await expect(service(10).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(live()).toHaveLength(0);
    expect(audit.record).toHaveBeenCalled();
  });

  it('treats every reuse as theft when the grace window is 0', async () => {
    rows.push(session('a', { revokedAt: new Date(), revokedReason: 'rotated' }));
    rows.push(session('b'));

    await expect(service(0).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(live()).toHaveLength(0);
  });

  it('never revives a token revoked by sign-out, even within the window', async () => {
    rows.push(session('a', { revokedAt: new Date(), revokedReason: 'logout' }));

    await expect(service(10).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(live()).toHaveLength(0);
  });

  it('does not continue a family that has no live session left', async () => {
    // Rotated a moment ago, but the successor was signed out since.
    rows.push(session('a', { revokedAt: new Date(), revokedReason: 'rotated' }));
    rows.push(session('b', { revokedAt: new Date(), revokedReason: 'logout' }));

    await expect(service(10).rotate(userId, 'a', 'c', later())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(live()).toHaveLength(0);
  });
});
