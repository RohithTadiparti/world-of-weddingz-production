import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  IMAGE_MODERATION_PROVIDER,
  ImageModerationProvider,
  ImageVerdict,
} from './image-moderation.provider';
import { AuditAction, AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { PROVENANCE_READ_BYTES } from './provenance';

/**
 * The one place a photograph is checked before it is attached to anybody.
 *
 * Uploading and *attaching* are separate steps here: the browser puts the file
 * straight into storage, which is what keeps a fifty-megabyte upload off a
 * request worker, and the backend only ever sees a URL afterwards. So the check
 * lives at the attach points — profile photographs, biodata galleries, agency
 * photographs, album items — rather than in the upload itself.
 *
 * That has a consequence worth naming: a rejected file has already been stored.
 * It is never referenced, so nobody can see it, and the storage lifecycle
 * sweeps unreferenced objects. Refusing at attach time is the earliest point
 * the platform can refuse at all without proxying every byte — with one
 * exception: a file uploaded into a profile-photograph slot is checked when
 * the upload is confirmed (MediaService.completeUpload) and deleted there, so
 * the person hears about it before they press save.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @Inject(IMAGE_MODERATION_PROVIDER) private readonly provider: ImageModerationProvider,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Refuses anything that is not a photograph of a real person.
   *
   * Throws rather than returning a verdict, because every caller would
   * otherwise write the same three lines and one of them would eventually
   * forget.
   */
  async assertGenuinePhoto(url: string, context: { userId?: string; kind: string }): Promise<void> {
    const verdict = await this.check(url);
    if (verdict.allowed) return;

    // Recorded, not just refused. A run of rejections against one account is
    // worth somebody looking at, and the refusal message alone tells nobody.
    await this.audit
      .record({
        action: AuditAction.PROFILE_PHOTO_REJECTED,
        actor: context.userId ? { userId: context.userId, role: undefined as never } : undefined,
        resourceType: 'image',
        resourceId: url.slice(0, 200),
        metadata: { kind: context.kind, score: verdict.syntheticScore, marker: verdict.marker ?? null },
      })
      .catch((err) => this.logger.error('could not record a rejected image', err as Error));

    // The clients show this text as it is, so it is the whole message: what
    // was wrong and what to do instead.
    throw new BadRequestException(
      `${verdict.reason ?? 'That image cannot be used.'} ${ModerationService.askFor(context.kind)}`,
    );
  }

  /**
   * `assertGenuinePhoto` for a whole `photos` list arriving in a profile save,
   * checking only the ones that are new. A form re-sends every photograph it
   * was shown; re-checking those on every save would make the form slower
   * with each photo and could refuse a save over a photograph nobody touched.
   */
  async assertGenuinePhotos(
    urls: readonly string[] | null | undefined,
    already: readonly string[] | null | undefined,
    context: { userId?: string; kind: string },
  ): Promise<void> {
    // Compared in stored form: the client sends back signed links for the
    // `media://` references it was shown.
    const known = new Set((already ?? []).map((u) => this.storage.storedForm(u)));
    for (const url of urls ?? []) {
      if (!known.has(this.storage.storedForm(url))) await this.assertGenuinePhoto(url, context);
    }
  }

  /** What to upload instead, in terms of whose photograph it is. */
  private static askFor(kind: string): string {
    if (kind === 'profile' || kind === 'biodata') return 'Please upload a genuine photo of yourself.';
    if (kind === 'managed_profile') return 'Please upload a genuine photo of the person.';
    return 'Please upload a genuine photograph.';
  }

  /**
   * The provider sees the start of the file as well as its URL, so the
   * metadata a generator wrote into it is judged however the provider is set.
   * Reading it is best-effort: a store that cannot be read right now is not a
   * reason to refuse somebody's photograph, any more than a detector outage is.
   *
   * A stored reference to a private object means nothing to a detector on the
   * other side of the internet, so it is sent a short-lived link instead.
   */
  async check(url: string): Promise<ImageVerdict> {
    const content = await this.storage.readStart(url, PROVENANCE_READ_BYTES).catch((err) => {
      this.logger.warn(`could not read an image for moderation: ${(err as Error).message}`);
      return null;
    });
    const key = this.storage.keyOf(url);
    return this.provider.check(key ? await this.storage.signedUrl(key) : url, content);
  }
}
