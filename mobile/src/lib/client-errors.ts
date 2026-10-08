import { Platform } from 'react-native';
import { getApiBaseUrl } from './api-base-url';

export interface ClientErrorInput {
  category: string;
  message: string;
  stack?: string;
  route?: string;
  requestId?: string;
}

const TELEMETRY_PATH = '/telemetry/client-errors';
const sentAt = new Map<string, number>();

const bounded = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|cookie|password|passcode|otp|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export const sanitizeClientRoute = (value: string): string =>
  bounded(value, 512).split(/[?#]/, 1)[0].slice(0, 128) || '/';

export const newRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function reportClientError(input: ClientErrorInput): void {
  const route = sanitizeClientRoute(input.route ?? 'unknown');
  if (route.includes(TELEMETRY_PATH)) return;
  const category = bounded(input.category, 128) || 'client';
  const message = bounded(input.message, 1024) || 'Unexpected client failure';
  const fingerprint = `${category}|${route}|${message}`;
  const now = Date.now();
  if (now - (sentAt.get(fingerprint) ?? 0) < 60_000) return;
  sentAt.set(fingerprint, now);

  const payload = {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    release: bounded(process.env.EXPO_PUBLIC_RELEASE ?? 'unknown', 128),
    route,
    category,
    message,
    ...(input.stack ? { stack: bounded(input.stack, 8192) } : {}),
    ...(input.requestId ? { requestId: bounded(input.requestId, 128) } : {}),
    deviceFamily: bounded(Platform.OS, 64),
  };
  let body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > 16 * 1024) {
    body = JSON.stringify({ ...payload, stack: bounded(input.stack, 2048) });
  }
  try {
    void fetch(`${getApiBaseUrl()}${TELEMETRY_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => undefined);
  } catch {
    // Best-effort telemetry must never break the app.
  }
}

type ErrorHandler = (error: Error, isFatal?: boolean) => void;
type ErrorUtilsApi = {
  getGlobalHandler?: () => ErrorHandler;
  setGlobalHandler?: (handler: ErrorHandler) => void;
};

export function installGlobalErrorReporting(): () => void {
  const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsApi }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return () => undefined;
  const previous = errorUtils.getGlobalHandler?.();
  const handler: ErrorHandler = (error, isFatal) => {
    reportClientError({
      category: isFatal ? 'fatal' : 'global',
      message: error.message,
      stack: error.stack,
    });
    previous?.(error, isFatal);
  };
  errorUtils.setGlobalHandler(handler);
  return () => {
    if (previous) errorUtils.setGlobalHandler?.(previous);
  };
}

export const resetClientErrorDeduplicationForTests = (): void => sentAt.clear();
