import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { availableParallelism, totalmem } from 'node:os';
import { RedisService } from '../../../platform/redis/redis.service';
import { RuntimeCapacityMetrics, RuntimeCapacityProvider } from './capacity.types';

const REQUESTS_KEY = 'operations:requests';
const ACTIVE_KEY = 'operations:active-actors';
const ACTIVE_COUNTS_KEY = 'operations:active-actor-counts';
const DAY_MS = 86_400_000;

@Injectable()
export class RuntimeCapacityService implements RuntimeCapacityProvider {
  private previousCpu = process.cpuUsage();
  private previousWall = Date.now();

  constructor(private readonly redis: RedisService) {}

  actorKey(userId?: string): string {
    if (!userId) return `anonymous-${randomUUID()}`;
    return createHash('sha256').update(userId).digest('hex');
  }

  async begin(actor: string): Promise<void> {
    await this.redis.raw
      .multi()
      .hincrby(ACTIVE_COUNTS_KEY, actor, 1)
      .zadd(ACTIVE_KEY, Date.now(), actor)
      .expire(ACTIVE_COUNTS_KEY, 3600)
      .expire(ACTIVE_KEY, 3600)
      .exec();
  }

  async finish(actor: string, startedAt: number, failed: boolean, authenticated: boolean): Promise<void> {
    const now = Date.now();
    const latency = Math.max(0, now - startedAt);
    const member = `${randomUUID()}:${latency}:${failed ? 1 : 0}:${authenticated ? actor : ''}`;
    const script = `
      local remaining = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
      if remaining <= 0 then
        redis.call('HDEL', KEYS[1], ARGV[1])
        redis.call('ZREM', KEYS[2], ARGV[1])
      end
      redis.call('ZADD', KEYS[3], ARGV[2], ARGV[3])
      redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[4])
      redis.call('EXPIRE', KEYS[3], 90000)
      return remaining
    `;
    await this.redis.raw.eval(
      script,
      3,
      ACTIVE_COUNTS_KEY,
      ACTIVE_KEY,
      REQUESTS_KEY,
      actor,
      now,
      member,
      now - DAY_MS,
    );
  }

  async read(at: Date): Promise<RuntimeCapacityMetrics> {
    const cutoff = at.getTime() - DAY_MS;
    const [members, concurrentUsers] = await Promise.all([
      this.redis.raw.zrangebyscore(REQUESTS_KEY, cutoff, at.getTime()),
      this.redis.raw.zcard(ACTIVE_KEY),
    ]);
    const parsed = members.map((member) => {
      const [, latency, failed, actor = ''] = member.split(':');
      return { latency: Number(latency), failed: failed === '1', actor };
    });
    const latencies = parsed.map((row) => row.latency).sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
    const cpu = process.cpuUsage(this.previousCpu);
    const now = Date.now();
    const elapsedMs = Math.max(1, now - this.previousWall);
    const elapsedMicros = elapsedMs * 1000;
    this.previousCpu = process.cpuUsage();
    this.previousWall = now;
    const cores = Math.max(1, availableParallelism());
    const memory = process.memoryUsage().rss;
    return {
      dailyActiveUsers: new Set(parsed.map((row) => row.actor).filter(Boolean)).size,
      requestsPerDay: parsed.length,
      concurrentUsers,
      p95LatencyMs: latencies.length ? latencies[p95Index] : 0,
      errorRatePercent: parsed.length
        ? (parsed.filter((row) => row.failed).length / parsed.length) * 100
        : 0,
      cpuPercent: Math.min(100, ((cpu.user + cpu.system) / elapsedMicros / cores) * 100),
      memoryPercent: Math.min(100, (memory / totalmem()) * 100),
      requestWindowMinutes: 24 * 60,
      resourceWindowMinutes: elapsedMs / 60_000,
    };
  }
}
