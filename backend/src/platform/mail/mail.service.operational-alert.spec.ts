import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { MailMessage, MailProvider } from './mail.provider';
import { MailService, OperationalAlertMail } from './mail.service';

const content: OperationalAlertMail = {
  event: 'opened',
  alertId: '0b6c8f8e-3b0e-4c55-9d0e-2a4c3f1b9a11',
  severity: 'critical',
  metric: 'cpuPercent',
  observedValue: 91.5,
  unit: 'percent',
  thresholdValue: 80,
  source: 'railway-runtime',
  firstObservedAt: '2026-10-09T10:00:00.000Z',
  recommendedAction: 'Scale the service.',
  correlationId: 'run-42',
};

const cfg = (provider: string) =>
  ({
    mail: {
      provider,
      appBaseUrl: 'https://wow.test',
      password: 'smtp-password-canary',
      user: 'smtp-user-canary',
    },
  }) as unknown as AppConfigService;

class FakeProvider implements MailProvider {
  sent: MailMessage[] = [];
  constructor(
    readonly mode: 'log' | 'smtp',
    private readonly failFor: string[] = [],
  ) {}
  async send(message: MailMessage): Promise<void> {
    if (this.failFor.includes(message.to)) throw new Error('smtp-password-canary rejected');
    this.sent.push(message);
  }
}

describe('MailService.sendOperationalAlert', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports not_configured and sends nothing without recipients', async () => {
    const provider = new FakeProvider('smtp');
    const result = await new MailService(provider, cfg('smtp')).sendOperationalAlert([], content);
    expect(result).toEqual({ status: 'not_configured', recipients: 0, provider: 'smtp' });
    expect(provider.sent).toHaveLength(0);
  });

  it('marks the log transport as simulated, never sent', async () => {
    const provider = new FakeProvider('log');
    const result = await new MailService(provider, cfg('log')).sendOperationalAlert(
      ['ops@example.com'],
      content,
    );
    expect(result).toEqual({ status: 'simulated', recipients: 1, provider: 'log' });
  });

  it('sends one message per configured recipient over SMTP', async () => {
    const provider = new FakeProvider('smtp');
    const result = await new MailService(provider, cfg('smtp')).sendOperationalAlert(
      ['ops@example.com', 'oncall@example.org'],
      content,
    );
    expect(result).toEqual({ status: 'sent', recipients: 2, provider: 'smtp' });
    expect(provider.sent.map((m) => m.to)).toEqual(['ops@example.com', 'oncall@example.org']);
  });

  it('carries only the alert facts, and never the recipient list or secrets', async () => {
    const provider = new FakeProvider('smtp');
    await new MailService(provider, cfg('smtp')).sendOperationalAlert(
      ['ops@example.com', 'oncall@example.org'],
      content,
    );
    const [first] = provider.sent;
    const body = `${first.subject}\n${first.text}\n${first.html}`;
    for (const fact of [
      'CRITICAL',
      'cpuPercent',
      '91.5 percent',
      '80 percent',
      'railway-runtime',
      '2026-10-09T10:00:00.000Z',
      'Scale the service.',
      content.alertId,
      'run-42',
    ]) {
      expect(body).toContain(fact);
    }
    expect(body).not.toContain('oncall@example.org');
    expect(body).not.toContain('ops@example.com');
    expect(body).not.toContain('smtp-password-canary');
    expect(body).not.toContain('smtp-user-canary');
  });

  it('reports a failed delivery explicitly when any recipient fails', async () => {
    const provider = new FakeProvider('smtp', ['oncall@example.org']);
    const result = await new MailService(provider, cfg('smtp')).sendOperationalAlert(
      ['ops@example.com', 'oncall@example.org'],
      content,
    );
    expect(result).toEqual({ status: 'failed', recipients: 2, provider: 'smtp' });
  });

  it('falls back to the configured mode for a provider that does not declare one', () => {
    const provider = { send: jest.fn() } as MailProvider;
    expect(new MailService(provider, cfg('log')).providerMode).toBe('log');
  });
});
