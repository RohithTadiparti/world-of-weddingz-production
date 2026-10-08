import { DynamicModule, Global, INestApplicationContext, Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/config.module';
import { DatabaseModule } from '../database.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { StorageModule } from '../../platform/storage/storage.module';
import { OutboxEvent } from '../../platform/events/outbox-event.entity';
import { OutboxService } from '../../platform/events/outbox.service';
import { RedisService } from '../../platform/redis/redis.service';

/**
 * What a one-off maintenance script needs to call real application services.
 *
 * A script that decides something the app also decides (who may chat, what
 * counts as an upload) asks the app's own service rather than restating the
 * rule in SQL, so the two cannot drift. Booting the whole AppModule for that
 * would also start the outbox poller, the schedulers and the Kafka consumers
 * inside a script that is supposed to do one thing and exit, so this is the
 * smaller tree: configuration, the database, audit, storage and the outbox
 * writer, with Redis replaced by a stand-in that refuses to be used.
 */

const LIFECYCLE_HOOKS = new Set([
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

function unavailable(name: string): object {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        // Nest probes for lifecycle hooks, and an awaiter probes for `then`: neither is a use.
        if (typeof prop === 'symbol' || prop === 'then' || LIFECYCLE_HOOKS.has(prop)) return undefined;
        throw new Error(`${name} is not available to maintenance scripts (tried to use ${String(prop)})`);
      },
    },
  );
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [OutboxService, { provide: RedisService, useValue: unavailable('Redis') }],
  exports: [OutboxService, RedisService],
})
class MaintenanceSupportModule {}

/** Boots the maintenance tree (plus `feature`, if any), runs `work`, and always closes. */
export async function withMaintenanceContext<T>(
  feature: Type<unknown> | DynamicModule | null,
  work: (app: INestApplicationContext) => Promise<T>,
): Promise<T> {
  @Module({
    imports: [
      AppConfigModule,
      DatabaseModule,
      AuditModule,
      StorageModule,
      MaintenanceSupportModule,
      ...(feature ? [feature] : []),
    ],
  })
  class MaintenanceModule {}

  const app = await NestFactory.createApplicationContext(MaintenanceModule, {
    logger: ['error', 'warn'],
  });
  try {
    return await work(app);
  } finally {
    await app.close();
  }
}

/** `--flag` present on the command line. */
export function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}
