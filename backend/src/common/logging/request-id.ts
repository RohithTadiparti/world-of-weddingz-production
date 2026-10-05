import { randomUUID } from 'crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const isValidRequestId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_REQUEST_ID.test(value);

export const resolveRequestId = (value: unknown): string =>
  isValidRequestId(value) ? value : randomUUID();
