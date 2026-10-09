import { Injectable, Logger } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { resolveRequestId } from '../../common/logging/request-id';
import { ClientErrorDto } from './dto/client-error.dto';

const CONTROL = /[\u0000-\u001f\u007f]/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_PAIR = /\b(authorization|cookie|password|passcode|otp|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const SIGNED_QUERY = /([?&](?:x-amz-[^=&]+|signature|token|key|code)=[^&#\s]+)/gi;

export const sanitizeClientText = (value: string, max: number): string =>
  value
    .replace(CONTROL, ' ')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(SECRET_PAIR, '$1=[REDACTED]')
    .replace(SIGNED_QUERY, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export const sanitizeClientRoute = (value: string): string => {
  const clean = sanitizeClientText(value, 512).split(/[?#]/, 1)[0];
  try {
    return new URL(clean, 'https://client.invalid').pathname.slice(0, 128) || '/';
  } catch {
    return clean.slice(0, 128) || '/';
  }
};

export interface ClientErrorEvent {
  event: 'client_error';
  platform: ClientErrorDto['platform'];
  release?: string;
  route: string;
  category: string;
  message: string;
  stack?: string;
  requestId: string;
  deviceFamily?: string;
  actorId?: string;
  actorRole?: string;
}

@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger(ClientErrorsService.name);

  normalize(dto: ClientErrorDto, actor?: AuthUser, serverRequestId?: string): ClientErrorEvent {
    const requestId = dto.requestId || serverRequestId || resolveRequestId(undefined);
    return {
      event: 'client_error',
      platform: dto.platform,
      ...(dto.release ? { release: sanitizeClientText(dto.release, 128) } : {}),
      route: sanitizeClientRoute(dto.route),
      category: sanitizeClientText(dto.category, 128),
      message: sanitizeClientText(dto.message, 1024),
      ...(dto.stack ? { stack: sanitizeClientText(dto.stack, 8192) } : {}),
      requestId,
      ...(dto.deviceFamily
        ? { deviceFamily: sanitizeClientText(dto.deviceFamily, 64) }
        : {}),
      ...(actor ? { actorId: actor.userId, actorRole: actor.role } : {}),
    };
  }

  report(dto: ClientErrorDto, actor?: AuthUser, serverRequestId?: string): ClientErrorEvent {
    const event = this.normalize(dto, actor, serverRequestId);
    this.logger.warn(event);
    return event;
  }
}
