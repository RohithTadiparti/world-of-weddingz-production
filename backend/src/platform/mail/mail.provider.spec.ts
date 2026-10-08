import { Logger } from '@nestjs/common';
import {
  LOG_MAIL_IN_PRODUCTION_WARNING,
  LogMailProvider,
  SmtpMailProvider,
  mailProviderFactory,
} from './mail.provider';
import { AppConfigService } from '../../config/app-config.service';

describe('mailProviderFactory', () => {
  const log = {} as LogMailProvider;
  const smtp = {} as SmtpMailProvider;
  let warn: jest.SpyInstance;

  const cfg = (provider: string, isProduction: boolean) =>
    ({ mail: { provider }, isProduction }) as unknown as AppConfigService;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('sends for real when MAIL_PROVIDER is smtp', () => {
    expect(mailProviderFactory.useFactory(cfg('smtp', true), log, smtp)).toBe(smtp);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the log transport quietly outside production', () => {
    expect(mailProviderFactory.useFactory(cfg('log', false), log, smtp)).toBe(log);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns at startup when production runs on the log transport', () => {
    expect(mailProviderFactory.useFactory(cfg('log', true), log, smtp)).toBe(log);
    expect(warn).toHaveBeenCalledWith(LOG_MAIL_IN_PRODUCTION_WARNING);
    expect(LOG_MAIL_IN_PRODUCTION_WARNING).toContain('MAIL_PROVIDER=smtp');
  });
});
