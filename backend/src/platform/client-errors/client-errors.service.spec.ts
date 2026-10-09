import { UserRole } from '../../common/enums';
import { ClientErrorsService, sanitizeClientRoute } from './client-errors.service';

describe('ClientErrorsService', () => {
  const service = new ClientErrorsService();

  it('strips query strings fragments control characters and secrets', () => {
    const event = service.normalize(
      {
        platform: 'web',
        route: 'https://wow.test/profile?token=secret#photos',
        category: 'network\nerror',
        message: 'Authorization: Bearer abc.def password=hunter2',
        stack: 'Error\u0000at page?x-amz-signature=secret',
        requestId: 'web.request-1',
      },
      undefined,
    );
    expect(event.route).toBe('/profile');
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('hunter2');
    expect(event.category).toBe('network error');
  });

  it('takes actor identity only from authenticated server context', () => {
    const event = service.normalize(
      { platform: 'android', route: '/home', category: 'render', message: 'failed' },
      {
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'admin@example.test',
        role: UserRole.ADMIN,
        managedByAgentId: null,
      },
      'server-request',
    );
    expect(event).toMatchObject({
      actorId: '11111111-1111-4111-8111-111111111111',
      actorRole: UserRole.ADMIN,
      requestId: 'server-request',
    });
    expect(event).not.toHaveProperty('email');
  });

  it('bounds every emitted field', () => {
    const event = service.normalize({
      platform: 'ios',
      route: `/${'r'.repeat(300)}`,
      category: 'c'.repeat(300),
      message: 'm'.repeat(2000),
      stack: 's'.repeat(9000),
      deviceFamily: 'd'.repeat(100),
    });
    expect(event.route.length).toBeLessThanOrEqual(128);
    expect(event.category.length).toBeLessThanOrEqual(128);
    expect(event.message.length).toBeLessThanOrEqual(1024);
    expect(event.stack?.length).toBeLessThanOrEqual(8192);
    expect(event.deviceFamily?.length).toBeLessThanOrEqual(64);
  });

  it('normalizes relative routes', () => {
    expect(sanitizeClientRoute('/matches/123?from=notification#card')).toBe('/matches/123');
  });
});
