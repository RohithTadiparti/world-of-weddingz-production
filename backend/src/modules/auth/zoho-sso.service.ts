import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../platform/redis/redis.service';

interface ZohoTokenResponse { access_token?: string; }
interface ZohoUserInfo { Email?: string; email?: string; }

@Injectable()
export class ZohoSsoService {
  constructor(private readonly cfg: AppConfigService, private readonly redis: RedisService) {}

  async authorizationUrl(): Promise<string> {
    const auth = this.cfg.auth;
    if (!auth.zohoSsoEnabled) throw new ServiceUnavailableException('Zoho sign-in is not configured yet');
    const state = randomBytes(32).toString('base64url');
    await this.redis.set(`sso:zoho:${state}`, true, 600);
    const url = new URL('/oauth/v2/auth', auth.zohoAccountsUrl);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: auth.zohoClientId,
      scope: 'AaaServer.profile.Read',
      redirect_uri: auth.zohoRedirectUri,
      access_type: 'online',
      state,
    }).toString();
    return url.toString();
  }

  async exchange(code: string, state: string, location?: string): Promise<string> {
    const key = `sso:zoho:${state}`;
    if (!(await this.redis.get<boolean>(key))) throw new BadRequestException('Invalid or expired SSO state');
    await this.redis.del(key);

    const accountsUrl = this.accountsUrl(location);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.cfg.auth.zohoClientId,
      client_secret: this.cfg.auth.zohoClientSecret,
      redirect_uri: this.cfg.auth.zohoRedirectUri,
      code,
    });
    const tokenResponse = await fetch(new URL('/oauth/v2/token', accountsUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenResponse.ok) throw new BadGatewayException('Zoho token exchange failed');
    const token = (await tokenResponse.json()) as ZohoTokenResponse;
    if (!token.access_token) throw new BadGatewayException('Zoho did not return an access token');

    const infoResponse = await fetch(new URL('/oauth/user/info', accountsUrl), {
      headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` },
    });
    if (!infoResponse.ok) throw new BadGatewayException('Zoho profile lookup failed');
    const profile = (await infoResponse.json()) as ZohoUserInfo;
    const email = profile.Email ?? profile.email;
    if (!email) throw new BadGatewayException('Zoho profile did not include an email address');
    return email.trim().toLowerCase();
  }

  private accountsUrl(location?: string): string {
    if (!location) return this.cfg.auth.zohoAccountsUrl;
    const suffix: Record<string, string> = {
      us: 'com', in: 'in', eu: 'eu', au: 'com.au', jp: 'jp', ca: 'ca', sa: 'sa',
    };
    const domain = suffix[location.toLowerCase()];
    if (!domain) throw new BadRequestException('Unsupported Zoho data centre');
    return `https://accounts.zoho.${domain}`;
  }
}
