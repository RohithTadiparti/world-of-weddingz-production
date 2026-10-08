/// <reference types="jest" />

import {
  installGlobalErrorReporting,
  reportClientError,
  resetClientErrorDeduplicationForTests,
  sanitizeClientRoute,
} from './client-errors';

describe('mobile client error reporting', () => {
  beforeEach(() => {
    resetClientErrorDeduplicationForTests();
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  it('strips query strings and fragments', () => {
    expect(sanitizeClientRoute('/profile?token=secret#photo')).toBe('/profile');
  });

  it('deduplicates and excludes secrets', async () => {
    reportClientError({ category: 'network', route: '/login?token=secret', message: 'password=hunter2' });
    reportClientError({ category: 'network', route: '/login?token=other', message: 'password=hunter2' });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = String((fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toContain('secret');
    expect(body).not.toContain('hunter2');
  });

  it('does not recursively report telemetry failures', () => {
    reportClientError({ category: 'network', route: '/telemetry/client-errors', message: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves and restores the native global handler', () => {
    const previous = jest.fn();
    let current = previous;
    Object.assign(globalThis, {
      ErrorUtils: {
        getGlobalHandler: () => current,
        setGlobalHandler: (handler: typeof previous) => { current = handler; },
      },
    });
    const cleanup = installGlobalErrorReporting();
    current(new Error('native failed'), true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalled();
    cleanup();
    expect(current).toBe(previous);
  });
});
