import { isSafeKey, isMediaRef } from './storage-keys';
import { StorageDriver } from './storage.driver';

/**
 * Is this value something the platform's own storage handed out?
 *
 * A field that holds a photograph, a document or a piece of evidence used to
 * accept any well-formed URL, so `https://anywhere.example/x.jpg` was stored
 * as a profile photo: a hotlink or a tracking pixel that never went through
 * presign, the size and type checks, or anything that inspects an upload.
 *
 * Accepted:
 *  - a `media://{key}` reference (private store; the API turns its own signed
 *    links into these before validation runs, see MediaUrlInterceptor);
 *  - a URL under the CDN base, when one is configured;
 *  - a URL under the local store's public base (`…/api/mock-storage/{key}`),
 *    which is what a local store hands out and what an S3 deployment still
 *    serves for objects stored before it switched;
 *  - on a private store, a URL the bucket driver recognises as its own.
 *
 * When the local store's configured base is a loopback address, the API
 * rewrites it to the origin the request reached (a phone on the same Wi-Fi
 * gets the laptop's LAN address), so on such a development stack any loopback
 * or private-network host is accepted under the same path. A public host never
 * is unless it is the configured one.
 */

export interface UploadedMediaSettings {
  cdnBaseUrl: string;
  mockBaseUrl: string;
}

/** Names this machine, or a machine on the same private network. */
const LOCAL_HOST =
  /^(localhost|[^.]+\.localhost|[^.]+\.local|127(?:\.\d{1,3}){3}|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2})$/i;
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const LOCAL_STORE_PATH = '/mock-storage/';

interface Base {
  origin: string;
  path: string;
  /** Any local/private-network origin is acceptable under this path. */
  anyLocalOrigin: boolean;
}

function parseBase(value: string, allowLocalRewrite: boolean): Base | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {
      origin: url.origin.toLowerCase(),
      path: `${url.pathname.replace(/\/+$/, '')}/`,
      anyLocalOrigin: allowLocalRewrite && LOOPBACK.test(url.hostname),
    };
  } catch {
    return null;
  }
}

function keyUnder(url: URL, base: Base): string | null {
  const sameOrigin = url.origin.toLowerCase() === base.origin;
  const localOrigin = base.anyLocalOrigin && LOCAL_HOST.test(url.hostname);
  if (!sameOrigin && !localOrigin) return null;
  let start: number;
  if (url.pathname.startsWith(base.path)) {
    start = base.path.length;
  } else if (base.anyLocalOrigin) {
    // A development stack has handed out both `/mock-storage/…` (straight off
    // the API port) and `/api/mock-storage/…` (through the web proxy).
    const at = url.pathname.indexOf(LOCAL_STORE_PATH);
    if (at < 0) return null;
    start = at + LOCAL_STORE_PATH.length;
  } else {
    return null;
  }
  try {
    const key = decodeURIComponent(url.pathname.slice(start));
    return isSafeKey(key) ? key : null;
  } catch {
    return null;
  }
}

export class UploadedMediaRecogniser {
  private readonly bases: Base[];

  constructor(
    settings: UploadedMediaSettings,
    private readonly driver?: Pick<StorageDriver, 'private' | 'keyFromUrl'>,
  ) {
    this.bases = [
      parseBase(settings.cdnBaseUrl, false),
      parseBase(settings.mockBaseUrl, true),
    ].filter((b): b is Base => b !== null);
  }

  matches(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (isMediaRef(value)) return true;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;

    if (this.bases.some((base) => keyUnder(url, base) !== null)) return true;
    // The bucket's own addresses (path-style, virtual-hosted, a public
    // endpoint). Only a private driver: the local one recognises its path on
    // any host, which is exactly the check this exists to make.
    return Boolean(this.driver?.private && this.driver.keyFromUrl(value));
  }
}

/**
 * What a fresh process accepts before storage has booted: the defaults a
 * local stack runs with. StorageService replaces it with the real settings.
 */
let current = new UploadedMediaRecogniser({
  cdnBaseUrl: '',
  mockBaseUrl: 'http://localhost:8080/api/mock-storage',
});

/** Installed by StorageService once it knows where uploads live. */
export function configureUploadedMedia(recogniser: UploadedMediaRecogniser): void {
  current = recogniser;
}

export function isUploadedMedia(value: unknown): boolean {
  return current.matches(value);
}
