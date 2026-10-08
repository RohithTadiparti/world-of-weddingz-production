import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RefreshSession } from './entities/refresh-session.entity';
import { User } from './entities/user.entity';
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

/** Error code on a 401 from /auth/refresh when another request already rotated the token. */
export const REFRESH_SUPERSEDED = 'REFRESH_SUPERSEDED';

/**
 * Ends every way an account is currently signed in: bumps the token generation
 * (so access tokens already issued stop working) and revokes every refresh
 * session (so none can be renewed).
 *
 * A free function over an EntityManager rather than a SessionsService method,
 * so the modules that suspend accounts (admin, agencies, officers, erasure) can
 * call it inside their own transaction without importing the auth module.
 */
export async function revokeAllAccess(
  manager: EntityManager,
  userId: string,
  reason: string,
): Promise<void> {
  await manager
    .getRepository(User)
    .update(userId, { tokenVersion: () => '"tokenVersion" + 1' });
  await manager
    .getRepository(RefreshSession)
    .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
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
 * A spent token never mints anything. The one concession to real browsers is a
 * few seconds (`REFRESH_REUSE_GRACE_SECONDS`) after a rotation during which a
 * replay of the token just replaced is refused with `REFRESH_SUPERSEDED`
 * instead of revoking the family: a second tab or a reload can present the old
 * cookie before the new one lands, and that lost race should not sign the
 * person out everywhere. The replay still gets nothing; the client retries
 * with the cookie it now holds. An earlier version continued the login from
 * the family's live session inside that window, which let a stolen token keep
 * minting sessions for as long as it was replayed promptly.
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
   * Returns the replacement session, in the same family. Throws when the token
   * is unknown, expired, or already used; for a used token outside the grace
   * window the whole family is revoked first.
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

    if (existing.revokedAt) return this.rejectSpent(existing, userId, ctx);

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.revoke(existing.id, 'expired');
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    // Consume the token with a conditional write, so two requests presenting
    // it at the same moment cannot both pass the check above and both rotate.
    const now = new Date();
    const claimed = await this.sessions.update(
      { id: existing.id, revokedAt: IsNull() },
      { revokedAt: now, revokedReason: 'rotated', lastUsedAt: now },
    );
    if (!claimed.affected) {
      const spent = await this.sessions.findOne({ where: { id: existing.id } });
      return this.rejectSpent(
        spent ?? { ...existing, revokedAt: now, revokedReason: 'rotated' },
        userId,
        ctx,
      );
    }

    return this.create(userId, newToken, newExpiresAt, ctx, existing.familyId);
  }

  /** A token that was already rotated or revoked has been presented again. */
  private async rejectSpent(
    spent: RefreshSession,
    userId: string,
    ctx: SessionContext,
  ): Promise<never> {
    if (this.withinReuseGrace(spent)) {
      throw new UnauthorizedException({
        message: 'This session was refreshed by another request. Please retry.',
        code: REFRESH_SUPERSEDED,
      });
    }

    await this.revokeFamily(spent.familyId, 'refresh token reuse detected');
    await this.audit.record({
      action: AuditAction.AUTH_REFRESH_REUSE_DETECTED,
      actor: { userId, role: 'unknown' as never },
      resourceType: 'refresh_session',
      resourceId: spent.id,
      metadata: { familyId: spent.familyId },
      ip: ctx.ip ?? null,
    });
    this.logger.warn(`Refresh token reuse for user ${userId}; family ${spent.familyId} revoked`);
    throw new UnauthorizedException('Session expired, please sign in again');
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

  /** Sign out everywhere. Used by logout-all and password change. */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  /**
   * Sign-out of one device: ends the login the token belongs to, every
   * rotation of it included, so an earlier copy of the token cannot outlive it.
   */
  async revokeFamilyByToken(token: string, reason: string): Promise<void> {
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hashRefreshToken(token) },
    });
    if (session) await this.revokeFamily(session.familyId, reason);
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
