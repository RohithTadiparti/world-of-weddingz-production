import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RefreshSession } from './entities/refresh-session.entity';
import { hashSecretToken } from '../../common/util/tokens';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  current: boolean;
}

/**
 * Refresh-token sessions: one row per signed-in device, rotated on every use.
 *
 * Two properties matter here:
 *
 *  - **Multi-device.** The old design kept a single hash on the user row, so
 *    signing in on a phone silently signed out the laptop.
 *  - **Reuse detection.** Because every refresh rotates, a token that has
 *    already been replaced should never be presented again. If one is, it
 *    leaked — so the entire family (that login and all its rotations) is
 *    revoked rather than just the row, and the event is audited.
 *
 * One exception to reuse detection: a token replaced within the last few
 * seconds (`REFRESH_REUSE_GRACE_SECONDS`). A browser reloading while its
 * refresh is in flight, or a second tab, can present the old cookie before the
 * new one lands; that is a lost race, not theft. Within the window the
 * family's live session is rotated instead, so the login carries on and still
 * has exactly one live token. Outside it, reuse revokes the family as before.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(RefreshSession) private readonly sessions: Repository<RefreshSession>,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
  ) {}

  private hashRefreshToken(token: string): string {
    return hashSecretToken(token, this.cfg.auth.jwtRefreshSecret);
  }

  async create(
    userId: string,
    token: string,
    expiresAt: Date,
    ctx: SessionContext = {},
    familyId: string = randomUUID(),
  ): Promise<RefreshSession> {
    return this.sessions.save(
      this.sessions.create({
        userId,
        tokenHash: this.hashRefreshToken(token),
        familyId,
        expiresAt,
        userAgent: ctx.userAgent?.slice(0, 400) ?? null,
        ip: ctx.ip?.slice(0, 64) ?? null,
      }),
    );
  }

  /**
   * Validates a presented refresh token and rotates it.
   *
   * Returns the family id the replacement should join. Throws — after revoking
   * the family — when the token is unknown, expired, or already used.
   */
  async rotate(
    userId: string,
    presentedToken: string,
    newToken: string,
    newExpiresAt: Date,
    ctx: SessionContext = {},
  ): Promise<RefreshSession> {
    const tokenHash = this.hashRefreshToken(presentedToken);
    const existing = await this.sessions.findOne({ where: { tokenHash } });

    if (!existing || existing.userId !== userId) {
      throw new UnauthorizedException('Session not recognised');
    }

    if (existing.revokedAt) {
      // Replaced a moment ago: a reload or another tab lost the race. Carry
      // the login on from its live session rather than ending it.
      if (this.withinReuseGrace(existing)) {
        const live = await this.sessions.findOne({
          where: { familyId: existing.familyId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
          order: { createdAt: 'DESC' },
        });
        if (live) {
          live.revokedAt = new Date();
          live.revokedReason = 'rotated';
          live.lastUsedAt = new Date();
          await this.sessions.save(live);
          return this.create(userId, newToken, newExpiresAt, ctx, existing.familyId);
        }
      }

      // Already rotated away, yet presented again: treat as compromise.
      await this.revokeFamily(existing.familyId, 'refresh token reuse detected');
      await this.audit.record({
        action: AuditAction.AUTH_REFRESH_REUSE_DETECTED,
        actor: { userId, role: 'unknown' as never },
        resourceType: 'refresh_session',
        resourceId: existing.id,
        metadata: { familyId: existing.familyId },
        ip: ctx.ip ?? null,
      });
      this.logger.warn(`Refresh token reuse for user ${userId}; family ${existing.familyId} revoked`);
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.revoke(existing.id, 'expired');
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    existing.revokedAt = new Date();
    existing.revokedReason = 'rotated';
    existing.lastUsedAt = new Date();
    await this.sessions.save(existing);

    return this.create(userId, newToken, newExpiresAt, ctx, existing.familyId);
  }

  /** Rotated (not revoked for any other reason) within the grace window. */
  private withinReuseGrace(session: RefreshSession): boolean {
    const graceMs = this.cfg.auth.refreshReuseGraceSeconds * 1000;
    return (
      graceMs > 0 &&
      session.revokedReason === 'rotated' &&
      !!session.revokedAt &&
      Date.now() - session.revokedAt.getTime() <= graceMs
    );
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.sessions.update(
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.sessions.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  /** Sign out everywhere. Used by logout-all, password change and suspension. */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async revokeByToken(token: string, reason: string): Promise<void> {
    await this.sessions.update(
      { tokenHash: this.hashRefreshToken(token), revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  async listActive(userId: string, currentToken?: string): Promise<SessionView[]> {
    const rows = await this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    const currentHash = currentToken ? this.hashRefreshToken(currentToken) : null;
    return rows
      .filter((r) => r.expiresAt.getTime() > Date.now())
      .map((r) => ({
        id: r.id,
        userAgent: r.userAgent,
        ip: r.ip,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
        current: currentHash !== null && r.tokenHash === currentHash,
      }));
  }

  /** Revokes one of the caller's own sessions. Ownership is checked here. */
  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Session not found');
    }
    await this.revoke(sessionId, 'revoked by user');
  }

  /** Housekeeping: drop rows that expired long ago. */
  async pruneExpired(before = new Date(Date.now() - 30 * 86_400_000)): Promise<number> {
    const result = await this.sessions.delete({ expiresAt: LessThan(before) });
    return result.affected ?? 0;
  }
}
