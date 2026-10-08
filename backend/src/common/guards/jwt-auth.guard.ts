import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global JWT guard; routes marked @Public() bypass authentication.
 *
 * A public route that is also marked @OptionalAuth() attempts it when the
 * request carries a bearer token, so `request.user` is set for a signed-in
 * caller, and falls back to anonymous on any failure.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (!isPublic) return (await super.canActivate(context)) as boolean;

    const optional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, targets);
    if (!optional) return true;

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || !/^Bearer\s+\S+/i.test(header)) return true;
    try {
      await super.canActivate(context);
    } catch {
      // An unusable token on a public route is the anonymous case, not a 401.
    }
    return true;
  }
}
