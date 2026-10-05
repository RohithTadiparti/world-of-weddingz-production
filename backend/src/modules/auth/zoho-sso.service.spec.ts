import { BadRequestException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../platform/redis/redis.service';
import { ZohoSsoService } from './zoho-sso.service';

describe('ZohoSsoService', () => {
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  } as unknown as RedisService;
  const cfg = {
    auth: {
      zohoSsoEnabled: true,
      zohoAccountsUrl: 'https://accounts.zoho.in',
      zohoClientId: 'client-id',
      zohoClientSecret: 'client-secret',
      zohoRedirectUri: 'https://app.example.com/api/auth/sso/zoho/callback',
    },
  } as unknown as AppConfigService;

  beforeEach(() => jest.clearAllMocks());

  it('creates a one-time state and least-privilege authorization URL', async () => {
    const service = new ZohoSsoService(cfg, redis);
    const url = new URL(await service.authorizationUrl());
    expect(url.origin).toBe('https://accounts.zoho.in');
    expect(url.searchParams.get('scope')).toBe('AaaServer.profile.Read');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('online');
    expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^sso:zoho:/), true, 600);
  });

  it('rejects a callback when state is absent or already consumed', async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    const service = new ZohoSsoService(cfg, redis);
    await expect(service.exchange('code', 'state', 'in')).rejects.toBeInstanceOf(BadRequestException);
  });
});
