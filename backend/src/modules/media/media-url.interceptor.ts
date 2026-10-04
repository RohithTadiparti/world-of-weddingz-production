import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, mergeMap } from 'rxjs';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../platform/storage/storage.service';
import { AccessMemo, MediaAccessService } from './media-access.service';

const RAW_MEDIA_REFS = 'media:raw-refs';

/**
 * Marks a route whose response carries references on purpose — the upload
 * slot hands back `ref` so a client knows what will be stored — and must not
 * have them signed over.
 */
export const RawMediaRefs = () => SetMetadata(RAW_MEDIA_REFS, true);

/**
 * Private storage, at the edge of the API.
 *
 * On a private store an upload is kept as `media://{key}` and shown through a
 * link that expires. Rather than teach every module that stores a picture —
 * profiles, biodata, albums, listings, bookings, cases, chat — to sign and
 * unsign, it is done here, once, for every HTTP request:
 *
 *   in:  a signed link to one of our objects becomes its reference, so the
 *        stored value never expires; and every object a body refers to must be
 *        one the caller could open (MediaAccessService.canView), so a key
 *        cannot be borrowed into somebody else's row to get it signed.
 *   out: every reference in the response becomes a link signed for this
 *        viewer, or null where the viewer is not on the booking it belongs to.
 *
 * On the local store every upload already has a permanent URL, and this does
 * nothing at all.
 */
@Injectable()
export class MediaUrlInterceptor implements NestInterceptor {
  constructor(
    private readonly storage: StorageService,
    private readonly access: MediaAccessService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.storage.isPrivate || context.getType() !== 'http') return next.handle();
    return from(this.inbound(context)).pipe(
      mergeMap(({ viewer, memo }) => next.handle().pipe(mergeMap((body) => this.outbound(context, body, viewer, memo)))),
    );
  }

  private async inbound(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser; body?: unknown }>();
    const viewer = req.user;
    const memo: AccessMemo = new Map();

    const body = req.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      for (const key of this.storage.keysIn(body)) {
        if (!(await this.access.canView(viewer, key, memo))) {
          throw new ForbiddenException('One of those files is not yours to attach');
        }
      }
      req.body = this.storage.normaliseDeep(body);
    }
    return { viewer, memo };
  }

  private outbound(context: ExecutionContext, body: unknown, viewer: AuthUser | undefined, memo: AccessMemo) {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_MEDIA_REFS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return Promise.resolve(body);
    return this.storage.signDeep(body, (key) => this.access.canReceive(viewer, key, memo));
  }
}
