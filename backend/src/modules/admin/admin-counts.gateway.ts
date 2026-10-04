import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { Permission, roleHasPermission } from '../../common/authz/permissions';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../../common/enums';
import { AdminPendingCounts, AdminPendingCountsService } from './admin-pending-counts.service';

/** How often the counts are recomputed for the administrators watching them. */
export const ADMIN_COUNTS_POLL_MS = 5000;

/**
 * Pushes the admin navigation's pending counts to connected consoles.
 *
 * The counts are recomputed only for administrators with a socket open on this
 * instance, and the timer runs only while there is at least one. With nobody
 * connected there is no one to tell, so there is nothing to count.
 */
@WebSocketGateway({ namespace: 'admin', cors: true })
export class AdminCountsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(AdminCountsGateway.name);
  private readonly snapshots = new Map<string, string>();
  /** Open sockets per administrator on this instance. */
  private readonly connected = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly counts: AdminPendingCountsService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  onModuleDestroy() {
    this.stopPolling();
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.auth.jwtSecret });
      const user = await this.users.findOne({
        where: { id: payload.sub },
        select: ['id', 'role', 'isActive'],
      });
      if (!user || !user.isActive || user.role !== UserRole.ADMIN || !roleHasPermission(user.role, Permission.ADMIN_ANALYTICS_READ)) {
        throw new Error('forbidden');
      }
      client.data.userId = user.id;
      client.join(`admin:${user.id}`);
      this.connected.set(user.id, (this.connected.get(user.id) ?? 0) + 1);
      this.startPolling();
      // A new console has seen nothing yet, so it gets the counts whether or
      // not they changed since the last push.
      this.snapshots.delete(user.id);
      await this.publishFor(user.id);
    } catch {
      this.logger.warn('Rejected admin counts socket connection');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;
    const open = (this.connected.get(userId) ?? 1) - 1;
    if (open > 0) {
      this.connected.set(userId, open);
      return;
    }
    this.connected.delete(userId);
    this.snapshots.delete(userId);
    if (this.connected.size === 0) this.stopPolling();
  }

  /** The administrators with a console open here; exposed for tests. */
  connectedAdmins(): string[] {
    return [...this.connected.keys()];
  }

  private startPolling() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.publishChanged(), ADMIN_COUNTS_POLL_MS);
  }

  private stopPolling() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async publishChanged() {
    await Promise.all(
      this.connectedAdmins().map((adminUserId) =>
        this.publishFor(adminUserId).catch((error: unknown) =>
          this.logger.warn(`Admin counts refresh failed: ${String(error)}`),
        ),
      ),
    );
  }

  private async publishFor(adminUserId: string) {
    const next = await this.counts.getCounts(adminUserId);
    const serialized = JSON.stringify(next);
    if (this.snapshots.get(adminUserId) === serialized) return;
    this.snapshots.set(adminUserId, serialized);
    this.server.to(`admin:${adminUserId}`).emit('counts:changed', next satisfies AdminPendingCounts);
  }
}
