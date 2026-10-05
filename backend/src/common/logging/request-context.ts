import { AsyncLocalStorage } from 'async_hooks';

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export const runWithRequestId = <T>(requestId: string, work: () => T): T =>
  requestContext.run({ requestId }, work);

export const enterRequestContext = (requestId: string): void =>
  requestContext.enterWith({ requestId });

export const currentRequestId = (): string | undefined => requestContext.getStore()?.requestId;

export const correlatedHeaders = (base: HeadersInit = {}): Headers => {
  const headers = new Headers(base);
  const requestId = currentRequestId();
  if (requestId) headers.set('X-Request-ID', requestId);
  return headers;
};
