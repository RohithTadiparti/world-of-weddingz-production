import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { contentTypeFits, contentTypeFor } from './content-types';
import { collectStrings, mapStrings } from './deep-strings';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { StorageSettings, assertStorageConfig } from './storage-config';
import { isSafeKey, refKey, toRef } from './storage-keys';
import { STORAGE_DRIVER, StorageDriver, UrlOptions } from './storage.driver';
import { UploadedMediaRecogniser, configureUploadedMedia } from './uploaded-media';

export interface PresignedUpload {
  /** The client PUTs the file here. */
  uploadUrl: string;
  /**
   * A URL that shows the file once it is up, and the value to send back when
   * attaching it. Local: the permanent URL. S3: a signed link, which the API
   * turns back into `ref` when it arrives, so it is safe to store either.
   */
  publicUrl: string;
  key: string;
  /** What the API stores: the URL itself locally, `media://{key}` on S3. */
  ref: string;
  /** Headers the PUT must carry, because they were signed into it. */
  headers: Record<string, string>;
  expiresIn: number;
  maxBytes: number;
}

export interface UploadRequest {
  contentType?: string;
  size?: number;
  requestOrigin?: string;
}

/** A fallback content type stores use when the uploader named none. */
const UNNAMED = /^(application|binary)\/octet-stream$/i;

/**
 * Where uploaded media lives, and the rules for getting it in and out.
 *
 * The driver is chosen by MEDIA_STORAGE_PROVIDER at boot and nothing else in
 * the codebase needs to know which one is running: services store whatever
 * `ref` they were given, and the API's response interceptor turns any private
 * reference into a signed link for the person looking (MediaUrlInterceptor).
 */
@Injectable()
export class StorageService {
  readonly driver: StorageDriver;
  private readonly s: StorageSettings;

  constructor(
    cfg: AppConfigService,
    @Optional() @Inject(STORAGE_DRIVER) driver?: StorageDriver,
  ) {
    this.s = cfg.media as StorageSettings;
    assertStorageConfig(this.s);
    this.driver =
      driver ?? (this.s.storageProvider === 's3' ? new S3StorageDriver(this.s) : new LocalStorageDriver(this.s));
    // The upload fields (IsUploadedUrl) are checked by class-validator, outside
    // dependency injection, so they learn where uploads live from here.
    configureUploadedMedia(new UploadedMediaRecogniser(this.s, this.driver));
  }

  /** True when objects are private and stored as keys. */
  get isPrivate(): boolean {
    return this.driver.private;
  }

  get maxBytes(): number {
    return this.s.maxFileSizeBytes;
  }

  /**
   * An upload slot for `key`.
   *
   * A size and a content type are signed into the slot when the client names
   * them, so the store itself refuses a larger file or a different type. On a
   * private store the size is required: a presigned PUT with no length signed
   * into it accepts anything up to 5 GB, and the bill for that is ours.
   */
  async presignUpload(key: string, req: UploadRequest = {}): Promise<PresignedUpload> {
    if (!isSafeKey(key)) throw new BadRequestException('Bad object key');
    if (req.size !== undefined && !(Number.isInteger(req.size) && req.size > 0)) {
      throw new BadRequestException('The file size must be a whole number of bytes');
    }
    if (req.size !== undefined && req.size > this.maxBytes) {
      throw new BadRequestException(`That file is too large. The limit is ${this.limitText()}.`);
    }
    if (this.isPrivate && req.size === undefined) {
      throw new BadRequestException('Send the file size with the upload request');
    }
    if (req.contentType && !contentTypeFits(key, req.contentType)) {
      throw new BadRequestException(`A ${req.contentType} file cannot be uploaded under that name`);
    }

    const put = await this.driver.presignPut(key, req);
    const publicUrl = await this.driver.urlFor(key, { requestOrigin: req.requestOrigin });
    return {
      uploadUrl: put.url,
      publicUrl,
      key,
      ref: this.isPrivate ? toRef(key) : publicUrl,
      headers: put.headers,
      expiresIn: this.s.presignExpirySeconds,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Confirms what actually landed in an upload slot.
   *
   * The client may have ignored everything it was told, so the object is read
   * back from the store: it must exist, be no larger than the limit, and — if
   * the store recorded a type — be the kind of file its name says. Anything
   * else is deleted rather than left for somebody to link to.
   */
  async verifyUpload(key: string, requestOrigin?: string) {
    if (!isSafeKey(key)) throw new BadRequestException('Bad object key');
    const info = await this.driver.head(key);
    if (!info) throw new NotFoundException('Nothing has been uploaded to that slot');

    const problem =
      info.size <= 0
        ? 'That file is empty.'
        : info.size > this.maxBytes
          ? `That file is too large. The limit is ${this.limitText()}.`
          : info.contentType && !UNNAMED.test(info.contentType) && !contentTypeFits(key, info.contentType)
            ? `A ${info.contentType} file cannot be kept under that name.`
            : null;
    if (problem) {
      await this.driver.delete(key);
      throw new BadRequestException(problem);
    }

    const url = await this.driver.urlFor(key, { requestOrigin });
    return {
      key,
      ref: this.isPrivate ? toRef(key) : url,
      url,
      size: info.size,
      contentType: contentTypeFor(key),
    };
  }

  /** A link to one object, for someone already allowed to see it. */
  signedUrl(key: string, options: UrlOptions = {}) {
    return this.driver.urlFor(key, options);
  }

  /**
   * The first `maxBytes` of the object a stored or incoming value refers to,
   * or null when it is not one of ours (or the store cannot say).
   *
   * Only ever our own objects, found by key: a URL pointing somewhere else is
   * never fetched, because "read whatever URL the client sent" is how an API
   * ends up making requests into its own network on a stranger's behalf.
   */
  async readStart(value: string, maxBytes: number): Promise<Buffer | null> {
    if (!this.driver.readStart) return null;
    const key = refKey(value) ?? this.driver.keyFromUrl(value);
    if (!key || !isSafeKey(key)) return null;
    return this.driver.readStart(key, maxBytes);
  }

  /** The key a stored or incoming value refers to, if it is one of ours. */
  keyOf(value: string): string | null {
    return refKey(value) ?? (this.isPrivate ? this.driver.keyFromUrl(value) : null);
  }

  /**
   * What to store for a value a client sent.
   *
   * A signed link to one of our objects becomes the `media://` reference it
   * was minted from: stored as it arrived, it would stop working an hour
   * later. Everything else — a reference already, an old local URL, a link to
   * somewhere else entirely — is stored as it is.
   */
  storedForm(value: string): string {
    if (!this.isPrivate || refKey(value)) return value;
    const key = this.driver.keyFromUrl(value);
    return key ? toRef(key) : value;
  }

  /** `storedForm` applied to every string in a body. */
  normaliseDeep<T>(value: T): T {
    if (!this.isPrivate) return value;
    return mapStrings(value, (s) => this.storedForm(s));
  }

  /** Every object key a body refers to, by reference or by one of our URLs. */
  keysIn(value: unknown): Set<string> {
    const keys = new Set<string>();
    if (!this.isPrivate) return keys;
    for (const s of collectStrings(value, (v) => this.keyOf(v) !== null)) {
      keys.add(this.keyOf(s) as string);
    }
    return keys;
  }

  /**
   * `value` with every `media://` reference replaced by a signed link.
   *
   * `allow` decides per key; a reference the viewer may not see becomes null,
   * never the reference itself, so nothing downstream can mistake it for a URL.
   */
  async signDeep<T>(
    value: T,
    allow: (key: string) => boolean | Promise<boolean> = () => true,
  ): Promise<T> {
    if (!this.isPrivate) return value;
    const refs = collectStrings(value, (s) => refKey(s) !== null);
    if (refs.size === 0) return value;

    const signed = new Map<string, string | null>();
    await Promise.all(
      [...refs].map(async (ref) => {
        const key = refKey(ref) as string;
        signed.set(ref, (await allow(key)) ? await this.driver.urlFor(key) : null);
      }),
    );
    return mapStrings(value, (s) => (signed.has(s) ? (signed.get(s) as string | null) : s));
  }

  private limitText(): string {
    return `${Math.floor(this.maxBytes / (1024 * 1024))} MB`;
  }
}
