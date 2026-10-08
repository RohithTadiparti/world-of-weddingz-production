import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize, tap } from 'rxjs';
import { RuntimeCapacityService } from './runtime-capacity.service';

@Injectable()
export class RequestCapacityInterceptor implements NestInterceptor {
  constructor(private readonly metrics: RuntimeCapacityService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ user?: { userId?: string } }>();
    const userId = request.user?.userId;
    const actor = this.metrics.actorKey(userId);
    const startedAt = Date.now();
    let failed = false;
    await this.metrics.begin(actor);
    return next.handle().pipe(
      tap({ error: () => (failed = true) }),
      finalize(() => {
        void this.metrics.finish(actor, startedAt, failed, Boolean(userId));
      }),
    );
  }
}
