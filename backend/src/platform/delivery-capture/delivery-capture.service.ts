import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../redis/redis.service';

export type DeliveryChannel = 'mail' | 'sms' | 'whatsapp' | 'push';

@Injectable()
export class DeliveryCaptureService {
  private readonly ttlSeconds = 600;

  constructor(
    private readonly redis: RedisService,
    private readonly cfg: AppConfigService,
  ) {}

  get enabled(): boolean {
    return this.cfg.observability.testDeliveryCaptureEnabled;
  }

  authorized(candidate: string | undefined): boolean {
    const expected = this.cfg.observability.testDeliveryCaptureKey;
    if (!this.enabled || !candidate || expected.length < 32 || candidate.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  }

  async store(channel: DeliveryChannel, destination: string, payload: unknown): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(this.key(channel, destination), { channel, destination, payload }, this.ttlSeconds);
  }

  latest(channel: DeliveryChannel, destination: string): Promise<unknown | null> {
    return this.redis.get(this.key(channel, destination));
  }

  private key(channel: DeliveryChannel, destination: string): string {
    const digest = createHash('sha256').update(destination).digest('hex');
    return `test-delivery:${channel}:${digest}`;
  }
}
