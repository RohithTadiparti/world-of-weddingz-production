import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import { DeliveryCaptureService } from './delivery-capture.service';

describe('DeliveryCaptureService', () => {
  const key = 'a'.repeat(32);
  const make = (enabled: boolean, configuredKey = key) => {
    const redis = { set: jest.fn(), get: jest.fn() } as unknown as RedisService;
    const cfg = {
      observability: {
        testDeliveryCaptureEnabled: enabled,
        testDeliveryCaptureKey: configuredKey,
      },
    } as AppConfigService;
    return { capture: new DeliveryCaptureService(redis, cfg), redis };
  };

  it('is disabled by default and never writes payloads', async () => {
    const { capture, redis } = make(false);
    expect(capture.authorized(key)).toBe(false);
    await capture.store('sms', '+919876543210', { code: '123456' });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('requires an exact constant-time comparable key and stores for ten minutes', async () => {
    const { capture, redis } = make(true);
    expect(capture.authorized(undefined)).toBe(false);
    expect(capture.authorized('short')).toBe(false);
    expect(capture.authorized('b'.repeat(32))).toBe(false);
    expect(capture.authorized(key)).toBe(true);

    await capture.store('mail', 'person@example.com', { token: 'qa-only' });
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^test-delivery:mail:[0-9a-f]{64}$/),
      { channel: 'mail', destination: 'person@example.com', payload: { token: 'qa-only' } },
      600,
    );
    expect(JSON.stringify((redis.set as jest.Mock).mock.calls[0][0])).not.toContain(
      'person@example.com',
    );
  });
});
