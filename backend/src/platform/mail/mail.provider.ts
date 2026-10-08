import { Injectable, Logger, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { errorType, maskEmail } from '../../common/logging/log-redaction';
import { DeliveryCaptureService } from '../delivery-capture/delivery-capture.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Pluggable mail transport, chosen by MAIL_PROVIDER, mirroring how payments,
 * media and AI providers are selected. 'log' writes the message (including any
 * action link) to the application log so local and CI runs need no SMTP
 * credentials; 'smtp' sends for real.
 */
export interface MailProvider {
  /**
   * Which transport this is. `log` never reaches an inbox, so anything
   * reporting delivery must call it simulated rather than sent.
   */
  readonly mode?: 'log' | 'smtp';
  send(message: MailMessage): Promise<void>;
}

@Injectable()
export class LogMailProvider implements MailProvider {
  readonly mode = 'log' as const;
  private readonly logger = new Logger('Mail');

  constructor(@Optional() private readonly capture?: DeliveryCaptureService) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.log({
      event: 'provider_delivery',
      channel: 'mail',
      destination: maskEmail(message.to),
      delivered: true,
    });
    await this.capture?.store('mail', message.to, message);
  }
}

@Injectable()
export class SmtpMailProvider implements MailProvider {
  readonly mode = 'smtp' as const;
  private readonly logger = new Logger(SmtpMailProvider.name);
  private transporter?: nodemailer.Transporter;

  constructor(private readonly cfg: AppConfigService) {}

  private transport(): nodemailer.Transporter {
    if (!this.transporter) {
      const m = this.cfg.mail;
      this.transporter = nodemailer.createTransport({
        host: m.host,
        port: m.port,
        secure: m.secure,
        auth: m.user ? { user: m.user, pass: m.password } : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport().sendMail({
        from: this.cfg.mail.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (err) {
      // A mail failure must not roll back the action that triggered it — an
      // invitation row already exists and can be resent.
      this.logger.error({
        event: 'provider_delivery_failure',
        channel: 'mail',
        destination: maskEmail(message.to),
        delivered: false,
        errorType: errorType(err),
      });
      throw err;
    }
  }
}

export const MAIL_PROVIDER = 'MAIL_PROVIDER';

export const LOG_MAIL_IN_PRODUCTION_WARNING =
  'MAIL_PROVIDER is "log" with NODE_ENV=production: no email is delivered, so password ' +
  'reset, email verification and invitation links never reach anyone. Set MAIL_PROVIDER=smtp ' +
  'with MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD.';

/**
 * Chooses the transport. The public deployment tiers already refuse to boot
 * without SMTP (config.schema.ts); any other production-mode run with the log
 * transport is allowed, because test stacks rely on it, but says so loudly at
 * startup rather than leaving the first failed password reset to discover it.
 */
export const mailProviderFactory = {
  provide: MAIL_PROVIDER,
  inject: [AppConfigService, LogMailProvider, SmtpMailProvider],
  useFactory: (
    cfg: AppConfigService,
    log: LogMailProvider,
    smtp: SmtpMailProvider,
  ): MailProvider => {
    if (cfg.mail.provider === 'smtp') return smtp;
    if (cfg.isProduction) new Logger('Mail').warn(LOG_MAIL_IN_PRODUCTION_WARNING);
    return log;
  },
};
