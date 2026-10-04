import { AppConfigService } from '../../config/app-config.service';
import { PINO_REDACT_PATHS, REDACTION_CENSOR } from './log-redaction';
import { enterRequestContext } from './request-context';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';

export const pinoHttpOptions = (cfg: AppConfigService) => ({
  pinoHttp: {
    level: cfg.runtime.logLevel,
    base: {
      service: cfg.runtime.serviceName,
      environment: cfg.runtime.env,
      release: cfg.runtime.release,
    },
    genReqId: (
      req: { headers: Record<string, string | string[] | undefined> },
      res: { setHeader(name: string, value: string): unknown },
    ) => {
      const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader('X-Request-ID', requestId);
      enterRequestContext(requestId);
      return requestId;
    },
    transport: cfg.isProduction ? undefined : { target: 'pino-pretty' },
    redact: { paths: [...PINO_REDACT_PATHS], censor: REDACTION_CENSOR },
  },
});
