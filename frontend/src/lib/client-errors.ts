export type ClientErrorCategory = 'render' | 'global' | 'promise' | 'network' | 'server';

export interface ClientErrorInput {
  category: ClientErrorCategory | string;
  message: string;
  stack?: string;
  route?: string;
  requestId?: string;
}

const TELEMETRY_PATH = '/telemetry/client-errors';
const WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const sentAt = new Map<string, number>();

const bounded = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|cookie|password|passcode|otp|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function sanitizeClientRoute(value: string): string {
  const noSecrets = bounded(value, 512).split(/[?#]/, 1)[0];
  try {
    return new URL(noSecrets, 'https://client.invalid').pathname.slice(0, 128) || '/';
  } catch {
    return noSecrets.slice(0, 128) || '/';
  }
}

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const endpoint = (): string => {
  const base = import.meta.env.VITE_API_URL || '/api';
  return `${String(base).replace(/\/$/, '')}${TELEMETRY_PATH}`;
};

export function reportClientError(input: ClientErrorInput): void {
  const route = sanitizeClientRoute(input.route ?? globalThis.location?.href ?? '/');
  if (route.includes(TELEMETRY_PATH)) return;

  const message = bounded(input.message, 1024) || 'Unexpected client failure';
  const category = bounded(input.category, 128) || 'client';
  const fingerprint = `${category}|${route}|${message}`;
  const now = Date.now();
  if (now - (sentAt.get(fingerprint) ?? 0) < WINDOW_MS) return;
  sentAt.set(fingerprint, now);

  const payload = {
    platform: 'web',
    release: bounded(import.meta.env.VITE_RELEASE ?? 'unknown', 128),
    route,
    category,
    message,
    ...(input.stack ? { stack: bounded(input.stack, 8192) } : {}),
    ...(input.requestId ? { requestId: bounded(input.requestId, 128) } : {}),
    deviceFamily: bounded(navigator.userAgent.split(/[ /(]/, 1)[0] || 'browser', 64),
  };
  let body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    body = JSON.stringify({ ...payload, stack: bounded(input.stack, 2048) });
  }

  try {
    if (navigator.sendBeacon?.(endpoint(), new Blob([body], { type: 'application/json' }))) return;
    void fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'include',
    }).catch(() => undefined);
  } catch {
    // Telemetry is best effort and must never affect the user operation.
  }
}

export function installGlobalErrorReporting(): () => void {
  const onError = (event: ErrorEvent) =>
    reportClientError({
      category: 'global',
      message: event.message || 'Unhandled browser error',
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportClientError({
      category: 'promise',
      message: reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection'),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export const resetClientErrorDeduplicationForTests = (): void => sentAt.clear();
