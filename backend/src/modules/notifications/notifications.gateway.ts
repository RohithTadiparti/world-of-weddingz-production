import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { User } from '../auth/entities/user.entity';
import { isAllowedSocketOrigin, socketCorsOrigin } from '../../common/websocket/socket-origin';

/** What a client is told: something changed, so ask again. Nothing more. */
export interface NotificationsChanged {
  reason: 'created' | 'read';
  unread?: number;
}

/**
 * Tells a signed-in client that its notifications changed.
 *
 * The feed and the badge already poll; this only makes the poll unnecessary
 * while a socket is open, so a vendor watching a booking in progress, or an
 * applicant waiting on verification, sees the update when it is written rather
 * than up to twenty seconds later. The event carries no notification content:
 * the client refetches through the authorised HTTP endpoints, so nothing here
 * can leak a payload to the wrong reader.
 *
 * Authenticated on the handshake exactly like the chat and admin sockets, and
 * every account joins only its own room.
 */
@WebSocketGateway({ namespace: 'notifications', cors: { origin: socketCorsOrigin, credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      if (!isAllowedSocketOrigin(client.handshake.headers.origin, this.cfg.runtime.corsOrigins)) {
        throw new Error('origin');
      }
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      const payload = await this.jwt.verifyAsync(token, { secret: this.cfg.auth.jwtSecret });
      const user = await this.users.findOne({
        where: { id: payload.sub },
        select: ['id', 'isActive', 'mustResetPassword', 'tokenVersion'],
      });
      if (!user || !user.isActive || user.mustResetPassword) throw new Error('inactive');
      if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) throw new Error('revoked');
      client.data.userId = user.id;
      await client.join(`user:${user.id}`);
    } catch {
      this.logger.warn('Rejected notifications socket connection');
      client.disconnect(true);
    }
  }

  /** Best effort: a socket that cannot be reached leaves the poll to catch up. */
  changed(userId: string, event: NotificationsChanged): void {
    try {
      this.server?.to(`user:${userId}`).emit('notifications:changed', event);
    } catch (err) {
      this.logger.warn(`Notifications push failed: ${(err as Error).message}`);
    }
  }
}
