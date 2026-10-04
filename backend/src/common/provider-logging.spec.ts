import { Logger } from '@nestjs/common';
import { LogMailProvider } from '../platform/mail/mail.provider';
import { LogPushProvider } from '../platform/push/push.provider';
import { LogSmsProvider } from '../platform/sms/sms.provider';
import { LogWhatsAppProvider } from '../platform/whatsapp/whatsapp.provider';

describe('log delivery providers', () => {
  it('retain delivery metadata without credentials, recipients or content', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    await new LogMailProvider().send({
      to: 'person@example.com',
      subject: 'Reset',
      text: 'https://wow.test/reset?token=reset-secret',
      html: '<b>reset-secret</b>',
    });
    await new LogSmsProvider().send({ to: '+919876543210', body: 'OTP 123456' });
    await new LogWhatsAppProvider().send({
      to: '+919876543210',
      template: 'booking_update',
      params: ['private-param'],
      language: 'en',
    });
    await new LogPushProvider().send({
      tokens: ['device-secret'],
      title: 'Private title',
      body: 'Private body',
      data: { token: 'push-secret' },
    });

    const output = JSON.stringify(log.mock.calls);
    for (const secret of [
      'person@example.com',
      '+919876543210',
      'reset-secret',
      '123456',
      'private-param',
      'device-secret',
      'Private body',
      'push-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('provider_delivery');
    expect(output).toContain('p***@example.com');
    expect(output).toContain('***3210');
    log.mockRestore();
  });
});
