import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Cross-replica mutex backed by a dedicated PostgreSQL session.
 *
 * Session advisory locks are a good fit for scheduled work: PostgreSQL releases
 * the lock when a worker crashes or its connection disappears, so there is no
 * stale lease row to repair. `try` semantics keep a second replica from waiting
 * and then repeating the same run after the first one finishes.
 */
@Injectable()
export class ReplicaLockService {
  private readonly logger = new Logger(ReplicaLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  async runExclusive<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const acquired = await this.tryAcquire(runner, name);
      if (!acquired) {
        this.logger.debug(`Skipped ${name}; another replica owns the run`);
        return undefined;
      }

      try {
        return await work();
      } finally {
        await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [name]);
      }
    } finally {
      await runner.release();
    }
  }

  private async tryAcquire(runner: QueryRunner, name: string): Promise<boolean> {
    const rows = (await runner.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [name],
    )) as Array<{ acquired: boolean }>;
    return rows[0]?.acquired === true;
  }
}
