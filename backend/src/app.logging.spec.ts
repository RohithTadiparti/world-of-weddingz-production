import { pinoHttpOptions } from './common/logging/pino-options';
import { AppConfigService } from './config/app-config.service';

describe('Pino observability bindings', () => {
  it('binds stable service, environment and release fields', () => {
    const cfg = {
      runtime: { logLevel: 'info', serviceName: 'backend', env: 'staging', release: 'sha-123' },
      isProduction: true,
    } as AppConfigService;
    expect(pinoHttpOptions(cfg).pinoHttp.base).toEqual({
      service: 'backend',
      environment: 'staging',
      release: 'sha-123',
    });
  });

  it('replaces a hostile request id and echoes the safe value', () => {
    const cfg = {
      runtime: { logLevel: 'info', serviceName: 'backend', env: 'test', release: 'test' },
      isProduction: true,
    } as AppConfigService;
    const setHeader = jest.fn();
    const requestId = pinoHttpOptions(cfg).pinoHttp.genReqId(
      { headers: { 'x-request-id': 'hostile\r\nvalue' } },
      { setHeader },
    );
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', requestId);
  });
});
