import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installGlobalErrorReporting,
  reportClientError,
  resetClientErrorDeduplicationForTests,
  sanitizeClientRoute,
} from './client-errors';

describe('web client error reporting', () => {
  beforeEach(() => {
    resetClientErrorDeduplicationForTests();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined });
    const target = new EventTarget() as EventTarget & { location: { origin: string; href: string } };
    target.location = { origin: 'https://wow.test', href: 'https://wow.test/home' };
    vi.stubGlobal('window', target);
  });

  it('strips query strings and fragments', () => {
    expect(sanitizeClientRoute('https://wow.test/profile?token=secret#photo')).toBe('/profile');
  });

  it('deduplicates identical reports for sixty seconds and excludes secrets', async () => {
    reportClientError({ category: 'network', route: '/login?token=secret', message: 'Bearer abc password=hunter2' });
    reportClientError({ category: 'network', route: '/login?token=other', message: 'Bearer abc password=hunter2' });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(String(init.body)).not.toContain('secret');
    expect(String(init.body)).not.toContain('hunter2');
  });

  it('never reports the telemetry endpoint or throws when transport fails', () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    expect(() => reportClientError({ category: 'network', route: '/api/telemetry/client-errors', message: 'offline' })).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('captures global errors and unhandled rejections', async () => {
    const cleanup = installGlobalErrorReporting();
    const error = new Event('error') as ErrorEvent;
    Object.assign(error, { message: 'render failed', error: new Error('render failed') });
    window.dispatchEvent(error);
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.assign(rejection, { promise: Promise.resolve(), reason: new Error('promise failed') });
    window.dispatchEvent(rejection);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    cleanup();
  });
});
