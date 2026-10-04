import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { ProvenanceFinding, inspectProvenance } from './provenance';

export interface ImageVerdict {
  allowed: boolean;
  /** Why it was refused, in words a person can act on. Null when allowed. */
  reason: string | null;
  /** 0–1 confidence that the image is synthetic, where the provider gives one. */
  syntheticScore: number | null;
  /** The provenance marker that decided it, for the audit log. */
  marker?: string;
}

/**
 * Whether a photograph is a photograph.
 *
 * A matrimonial profile is a claim about a real person, and a generated face
 * makes every other check on the platform meaningless — the government ID, the
 * in-person visit, the family's consent all attach to somebody who does not
 * exist. So this is not a content filter; it is an identity control, and it
 * belongs on the same shelf as the Aadhaar provider rather than in an upload
 * widget.
 *
 * The interface is deliberately the small part every detector agrees on: hand
 * it a URL, get back a verdict. Detection is a fast-moving field and the
 * provider will be replaced; the calling code should not have to be.
 *
 * `content` is the start of the stored file when the platform could read it
 * (ModerationService.check), so every provider can look at what the file says
 * about itself and not only at what it is called.
 */
export interface ImageModerationProvider {
  check(url: string, content?: Buffer | null): Promise<ImageVerdict>;
}

export const IMAGE_MODERATION_PROVIDER = Symbol('IMAGE_MODERATION_PROVIDER');

/**
 * Markers that a generator left its name on the file.
 *
 * Not detection — an actual detector looks at the pixels. This catches the
 * careless case, which in practice is most of them: a file saved straight out
 * of a tool keeps the tool's name, and C2PA provenance metadata is increasingly
 * carried in the filename by the same tools.
 *
 * Kept in the mock *and* used by the hosted provider as a cheap pre-check,
 * because a name that says `midjourney` needs no API call.
 */
const GENERATOR_MARKERS = [
  'ai-generated',
  'aigenerated',
  'midjourney',
  'dall-e',
  'dalle',
  'stablediffusion',
  'stable-diffusion',
  'firefly-generated',
  'gencraft',
  'thispersondoesnotexist',
  'generated-photos',
  'synthesia',
];

export function looksGenerated(url: string): boolean {
  const lower = url.toLowerCase();
  return GENERATOR_MARKERS.some((marker) => lower.includes(marker));
}

/** What a person is told when a file is refused, whichever check refused it. */
export const GENERATED_REASON = 'This looks like an AI-generated image.';

/**
 * The checks that need no detector: the file's own provenance metadata, then
 * its name. Null when neither says "generated" — which is not the same as
 * "genuine" (see provenance.ts for what metadata cannot catch).
 *
 * The name check is the weaker half — a renamed file defeats it — but it is
 * free: a stored key keeps the uploader's file name (buildKey), so a download
 * still called `midjourney_…png` is caught even if its metadata was stripped.
 */
export function labelledAsGenerated(url: string, content?: Buffer | null): ImageVerdict | null {
  const found: ProvenanceFinding | null = content ? inspectProvenance(content) : null;
  if (found) {
    return { allowed: false, reason: GENERATED_REASON, syntheticScore: 1, marker: `${found.source}: ${found.marker}` };
  }
  if (looksGenerated(url)) {
    return { allowed: false, reason: GENERATED_REASON, syntheticScore: 1, marker: 'filename' };
  }
  return null;
}

/**
 * The default. Refuses what is plainly labelled — in the file's metadata or in
 * its name — and allows the rest.
 *
 * Deliberately not a no-op that returns `allowed` for everything: a mock that
 * always says yes means the rejection path is never exercised, and the first
 * time anybody sees it is in production with a real provider behind it. And
 * since the metadata check reads the file itself, this is a real control on
 * its own for the common case of an image saved straight out of a generator;
 * what it cannot see is an image whose labels were stripped, which only the
 * hosted classifier can.
 */
@Injectable()
export class HeuristicImageModerationProvider implements ImageModerationProvider {
  async check(url: string, content?: Buffer | null): Promise<ImageVerdict> {
    return labelledAsGenerated(url, content) ?? { allowed: true, reason: null, syntheticScore: null };
  }
}

/**
 * A hosted detector.
 *
 * Providers in this space (Hive, Sightengine, Illuminarty and others) have
 * converged on the same shape: post a URL, get a score back. Which one is
 * behind this is configuration.
 *
 * Two decisions worth stating:
 *
 * - **An outage does not reject.** If the detector is unreachable, the upload
 *   is allowed and the event is logged. The alternative is that a third party
 *   going down stops every person on the platform from adding a photograph,
 *   and a wrongly-accepted image can be removed later while a wrongly-refused
 *   one just loses you the user.
 * - **The threshold is configuration, not a constant.** Every detector scores
 *   differently and they all drift; a number compiled into the image is a
 *   number nobody can adjust when it starts refusing real photographs.
 */
@Injectable()
export class HostedImageModerationProvider implements ImageModerationProvider {
  private readonly logger = new Logger(HostedImageModerationProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async check(url: string, content?: Buffer | null): Promise<ImageVerdict> {
    // Free, instant, and right often enough to be worth doing first: a file
    // that names its generator needs no API call.
    const labelled = labelledAsGenerated(url, content);
    if (labelled) return labelled;

    const { imageModerationUrl, imageModerationKey, imageModerationThreshold, imageModerationTimeoutMs } =
      this.cfg.moderation;

    if (!imageModerationUrl || !imageModerationKey) {
      this.logger.warn('IMAGE_MODERATION_PROVIDER is hosted but no endpoint is configured');
      return { allowed: true, reason: null, syntheticScore: null };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), imageModerationTimeoutMs);
    try {
      const res = await fetch(imageModerationUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${imageModerationKey}`,
        },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.error(`Image moderation returned ${res.status}; allowing the upload`);
        return { allowed: true, reason: null, syntheticScore: null };
      }

      const body = (await res.json()) as Record<string, unknown>;
      const score = readScore(body);
      if (score === null) {
        this.logger.error('Image moderation returned no score; allowing the upload');
        return { allowed: true, reason: null, syntheticScore: null };
      }

      if (score >= imageModerationThreshold) {
        return {
          allowed: false,
          reason: GENERATED_REASON,
          syntheticScore: score,
        };
      }
      return { allowed: true, reason: null, syntheticScore: score };
    } catch (err) {
      // Including the abort. A detector that hangs must not hold up a person
      // adding their own photograph.
      this.logger.error(`Image moderation failed: ${(err as Error).message}; allowing the upload`);
      return { allowed: true, reason: null, syntheticScore: null };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The score, under whichever of the usual names this provider uses. */
function readScore(body: Record<string, unknown>): number | null {
  for (const key of ['ai_generated', 'aiGenerated', 'synthetic', 'score', 'confidence']) {
    const value = body[key];
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      const nested = (value as Record<string, unknown>).score;
      if (typeof nested === 'number') return nested;
    }
  }
  return null;
}

export const imageModerationProviderFactory = {
  provide: IMAGE_MODERATION_PROVIDER,
  inject: [AppConfigService, HeuristicImageModerationProvider, HostedImageModerationProvider],
  useFactory: (
    cfg: AppConfigService,
    heuristic: HeuristicImageModerationProvider,
    hosted: HostedImageModerationProvider,
  ): ImageModerationProvider =>
    cfg.moderation.imageProvider === 'hosted' ? hosted : heuristic,
};
