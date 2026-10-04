/** What a stored object turned out to be, read back from the store. */
export interface ObjectInfo {
  size: number;
  contentType: string | null;
}

export interface PutOptions {
  /** Signed into the upload when given, so the store refuses anything else. */
  contentType?: string;
  /** Likewise: the exact byte count the store will accept. */
  size?: number;
  /** The origin the request reached, for a local store behind loopback. */
  requestOrigin?: string;
}

export interface UrlOptions {
  requestOrigin?: string;
  /** Served as a download under this name rather than shown inline. */
  downloadName?: string;
  /**
   * A shorter life than the store's usual viewing link, for a URL handed to a
   * third party rather than shown to a person. Ignored by a public store.
   */
  expiresInSeconds?: number;
}

/**
 * One place bytes can live.
 *
 * Two of them: `LocalStorageDriver`, the API's own disk behind a public route,
 * which is what a laptop or a test stack runs on with no configuration; and
 * `S3StorageDriver`, a private bucket that is only ever read through a signed
 * link. The difference that matters to callers is `private`: a local URL is the
 * same forever and is stored as it is, while a private object is stored as a
 * key and signed afresh for whoever is looking (see StorageService).
 */
export interface StorageDriver {
  readonly name: 'mock' | 's3';
  readonly private: boolean;

  /** Where the client PUTs the bytes, and any headers it must send with them. */
  presignPut(key: string, options: PutOptions): Promise<{ url: string; headers: Record<string, string> }>;

  /** A URL that shows the object: permanent for local, short-lived for S3. */
  urlFor(key: string, options?: UrlOptions): Promise<string>;

  /** The key behind a URL this driver handed out, or null if it did not. */
  keyFromUrl(url: string): string | null;

  head(key: string): Promise<ObjectInfo | null>;
  delete(key: string): Promise<void>;

  /**
   * The first `maxBytes` of an object, or null when there is none. For reading
   * what a file says about itself (its metadata sits at the front) without
   * pulling a whole video through the API. Optional so a test double need not
   * implement it; a driver without it simply gets no content checks.
   */
  readStart?(key: string, maxBytes: number): Promise<Buffer | null>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
