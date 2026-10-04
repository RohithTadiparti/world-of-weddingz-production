import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentTypeFor } from './content-types';
import { StorageSettings } from './storage-config';
import { isSafeKey } from './storage-keys';
import { ObjectInfo, PutOptions, StorageDriver, UrlOptions } from './storage.driver';

type Presign = typeof getSignedUrl;

/**
 * A private S3 bucket (or anything that speaks its API: MinIO, R2).
 *
 * Nothing in the bucket is public. The browser writes with a presigned PUT and
 * reads with a presigned GET, both minted here from the API's own credentials,
 * so the bucket policy can stay "deny everything that is not the app role".
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  readonly private = true;

  /** The client the API itself talks to the store through. */
  private readonly client: S3Client;
  /**
   * The client URLs for browsers are signed with. Signing is local arithmetic
   * and never touches the network, so this can name a host the API cannot
   * reach — the only thing that matters is that the browser can.
   */
  private readonly signer: S3Client;

  constructor(
    private readonly s: StorageSettings,
    clients?: { client: S3Client; signer?: S3Client },
    private readonly presign: Presign = getSignedUrl,
  ) {
    this.client = clients?.client ?? new S3Client(this.clientConfig(s.s3Endpoint));
    this.signer =
      clients?.signer ??
      clients?.client ??
      (s.s3PublicEndpoint && s.s3PublicEndpoint !== s.s3Endpoint
        ? new S3Client(this.clientConfig(s.s3PublicEndpoint))
        : this.client);
  }

  private clientConfig(endpoint: string): S3ClientConfig {
    return {
      region: this.s.s3Region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.s.s3ForcePathStyle,
      ...(this.s.s3AccessKeyId
        ? {
            credentials: {
              accessKeyId: this.s.s3AccessKeyId,
              secretAccessKey: this.s.s3SecretAccessKey,
            },
          }
        : {}),
      /*
       * Since 3.729 the SDK adds a CRC32 checksum to every PutObject by
       * default, and a presigned URL carries it as a signed parameter. A
       * browser uploading the file cannot compute a matching header, so every
       * upload fails with a signature mismatch. Only when an operation insists.
       */
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
  }

  async presignPut(key: string, options: PutOptions) {
    const command = new PutObjectCommand({
      Bucket: this.s.s3Bucket,
      Key: key,
      ...(options.contentType ? { ContentType: options.contentType } : {}),
      ...(options.size !== undefined ? { ContentLength: options.size } : {}),
    });
    // Signing the length is what enforces the size limit: a presigned PUT
    // cannot carry a range, but it can carry an exact number, and S3 refuses a
    // body of any other length with a signature mismatch.
    const signed = new Set<string>();
    const headers: Record<string, string> = {};
    if (options.contentType) {
      signed.add('content-type');
      headers['Content-Type'] = options.contentType;
    }
    if (options.size !== undefined) signed.add('content-length');

    const url = await this.presign(this.signer, command, {
      expiresIn: this.s.presignExpirySeconds,
      signableHeaders: signed,
    });
    return { url, headers };
  }

  /**
   * A viewing link, good for at least half of S3_GET_EXPIRY.
   *
   * The signing time is rounded down to a window of half the expiry, so every
   * response inside one window hands out the same URL for the same object. The
   * browser's cache keys on the whole URL, query included; signing at "now"
   * made every page load a new URL and every photograph a fresh download.
   *
   * A link with its own shorter life is signed at "now" instead: it is handed
   * to one reader once, so there is no cache to keep, and rounding the signing
   * time down would cut its life shorter still.
   */
  async urlFor(key: string, options: UrlOptions = {}, now: number = Date.now()) {
    const shortLived =
      options.expiresInSeconds !== undefined && options.expiresInSeconds < this.s.getExpirySeconds;
    const expiry = shortLived ? Math.max(1, Math.floor(options.expiresInSeconds as number)) : this.s.getExpirySeconds;
    const windowMs = Math.floor(expiry / 2) * 1000;
    const signingDate = shortLived ? new Date(now) : new Date(Math.floor(now / windowMs) * windowMs);
    const command = new GetObjectCommand({
      Bucket: this.s.s3Bucket,
      Key: key,
      // Decided by the key, never by whatever the uploader claimed: an HTML
      // page uploaded as `photo.jpg` is served as a JPEG and does not run.
      ResponseContentType: contentTypeFor(key),
      ResponseCacheControl: `private, max-age=${Math.floor(expiry / 2)}`,
      ...(options.downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${options.downloadName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
          }
        : {}),
    });
    return this.presign(this.signer, command, { expiresIn: expiry, signingDate });
  }

  /**
   * The key behind one of this bucket's URLs, signed or not.
   *
   * Clients hold signed URLs and send them back — a profile form re-saves the
   * photographs it was shown — so an incoming URL on this bucket is turned
   * back into the key it came from before anything is stored. Both addressing
   * styles are recognised, on both the internal and the public endpoint.
   */
  keyFromUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const path = parsed.pathname;
    for (const base of this.bases()) {
      if (parsed.host.toLowerCase() !== base.host) continue;
      if (!path.startsWith(base.prefix)) continue;
      let key: string;
      try {
        key = decodeURIComponent(path.slice(base.prefix.length));
      } catch {
        return null;
      }
      return isSafeKey(key) ? key : null;
    }
    return null;
  }

  /** Host and path prefix of every address an object of this bucket has. */
  private bases(): { host: string; prefix: string }[] {
    const bucket = this.s.s3Bucket;
    const region = this.s.s3Region;
    const out: { host: string; prefix: string }[] = [];
    for (const endpoint of [this.s.s3Endpoint, this.s.s3PublicEndpoint]) {
      if (!endpoint) continue;
      const host = new URL(endpoint).host.toLowerCase();
      out.push({ host, prefix: `/${bucket}/` });
      out.push({ host: `${bucket}.${host}`.toLowerCase(), prefix: '/' });
    }
    if (!this.s.s3Endpoint) {
      for (const host of [`s3.${region}.amazonaws.com`, 's3.amazonaws.com']) {
        out.push({ host: `${bucket}.${host}`.toLowerCase(), prefix: '/' });
        out.push({ host, prefix: `/${bucket}/` });
      }
    }
    return out;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.s.s3Bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === 'NotFound') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.s.s3Bucket, Key: key }));
  }

  /** A ranged GET, so a large object costs only the bytes asked for. */
  async readStart(key: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.s.s3Bucket, Key: key, Range: `bytes=0-${maxBytes - 1}` }),
      );
      if (!out.Body) return null;
      const bytes = await (out.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
      return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, maxBytes));
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === 'NoSuchKey') return null;
      throw err;
    }
  }
}
