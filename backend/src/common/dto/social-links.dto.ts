import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
  isURL,
} from 'class-validator';

/**
 * Public social links on a vendor or planner listing.
 *
 * A listing carries a list of links (`socialLinks`), each naming its platform.
 * Every link must be a full https:// address on the platform's own domain: a
 * handle or bare text is refused rather than guessed into a URL.
 *
 * The three single fields that came before the list (`instagramUrl`,
 * `youtubeUrl`, `website`) are still accepted, because installed app builds
 * keep sending them; see `resolveSocialLinks` for how they fold into the list.
 */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A website as people actually type it, made into the https:// link it means.
 *
 * Planner and vendor listings carried a free-text website long before it was
 * validated, so `www.everafter.in` and `http://everafter.in` are already stored
 * and are resubmitted with every edit of the profile. Refusing them would lock
 * those listings out of saving anything; a bare domain gains https:// and an
 * http:// link is upgraded, and anything still not a URL is refused as before.
 */
export const normaliseWebsite = ({ value }: { value: unknown }) => {
  const trimmed = blankToNull({ value });
  if (typeof trimmed !== 'string') return trimmed;
  if (/^http:\/\//i.test(trimmed)) return `https://${trimmed.slice('http://'.length)}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return `https://${trimmed.replace(/^\/+/, '')}`;
  return trimmed;
};

export const SOCIAL_PLATFORMS = [
  'instagram',
  'youtube',
  'facebook',
  'pinterest',
  'x',
  'linkedin',
  'whatsapp',
  'website',
  'other',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const MAX_SOCIAL_LINKS = 10;

/**
 * Where each platform's links may point, with the name used in messages.
 * `hosts: null` means any real https host (a business's own site, or a
 * platform not listed here).
 */
export const SOCIAL_PLATFORM_RULES: Record<SocialPlatform, { label: string; hosts: RegExp[] | null }> = {
  instagram: { label: 'Instagram', hosts: [/^(www\.|m\.)?instagram\.com$/i] },
  youtube: { label: 'YouTube', hosts: [/^(www\.|m\.)?youtube\.com$/i, /^youtu\.be$/i] },
  facebook: { label: 'Facebook', hosts: [/^(www\.|m\.|web\.)?facebook\.com$/i, /^fb\.com$/i] },
  pinterest: { label: 'Pinterest', hosts: [/^(www\.|[a-z]{2}\.)?pinterest\.com$/i, /^pin\.it$/i] },
  x: { label: 'X', hosts: [/^(www\.)?x\.com$/i, /^(www\.)?twitter\.com$/i] },
  linkedin: { label: 'LinkedIn', hosts: [/^(www\.)?linkedin\.com$/i] },
  whatsapp: { label: 'WhatsApp', hosts: [/^wa\.me$/i, /^(api\.|www\.)?whatsapp\.com$/i] },
  website: { label: 'website', hosts: null },
  other: { label: 'link', hosts: null },
};

/** The platform's own domain, as a person would read it in a message. */
const DOMAINS: Record<SocialPlatform, string> = {
  instagram: 'instagram.com',
  youtube: 'youtube.com or youtu.be',
  facebook: 'facebook.com',
  pinterest: 'pinterest.com or pin.it',
  x: 'x.com or twitter.com',
  linkedin: 'linkedin.com',
  whatsapp: 'wa.me or whatsapp.com',
  website: '',
  other: '',
};

/** Why a link cannot be saved for this platform, or null when it can. */
export function socialLinkProblem(platform: SocialPlatform, url: unknown): string | null {
  const rule = SOCIAL_PLATFORM_RULES[platform];
  if (!rule) return null; // the platform itself is reported by IsIn
  if (typeof url !== 'string' || !url) return `Enter the ${rule.label} link`;
  if (!isURL(url, { protocols: ['https'], require_protocol: true })) {
    return `Enter a full ${rule.label} link starting with https://`;
  }
  if (rule.hosts && !isURL(url, { protocols: ['https'], require_protocol: true, host_whitelist: rule.hosts })) {
    return `${rule.label} links must be on ${DOMAINS[platform]}`;
  }
  return null;
}

@ValidatorConstraint({ name: 'socialLinkUrl' })
class SocialLinkUrlConstraint implements ValidatorConstraintInterface {
  validate(url: unknown, args: ValidationArguments) {
    const { platform } = args.object as SocialLinkDto;
    return socialLinkProblem(platform, url) === null;
  }

  defaultMessage(args: ValidationArguments) {
    const { platform } = args.object as SocialLinkDto;
    return socialLinkProblem(platform, args.value) ?? 'Enter a full link starting with https://';
  }
}

export class SocialLinkDto {
  @ApiProperty({ enum: SOCIAL_PLATFORMS, example: 'instagram' })
  @IsIn(SOCIAL_PLATFORMS, { message: 'Choose which platform this link is for' })
  platform: SocialPlatform;

  @ApiProperty({ example: 'https://www.instagram.com/yourpage', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'A link can be at most 200 characters' })
  @Validate(SocialLinkUrlConstraint)
  url: string;

  /** What to call an `other` link on the listing; ignored for named platforms. */
  @ApiPropertyOptional({ maxLength: 40, example: 'Wedding films' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(40, { message: 'A link name can be at most 40 characters' })
  label?: string | null;
}

/** A link as stored: no label unless the platform is `other`. */
export interface SocialLink {
  platform: SocialPlatform;
  url: string;
  label?: string;
}

const onHosts = (hosts: RegExp[] | undefined, label: string) =>
  IsUrl(
    { protocols: ['https'], require_protocol: true, ...(hosts ? { host_whitelist: hosts } : {}) },
    { message: `Enter a full ${label} link starting with https://` },
  );

export class SocialLinksDto {
  @ApiPropertyOptional({ type: [SocialLinkDto], maxItems: MAX_SOCIAL_LINKS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SOCIAL_LINKS, { message: `Add at most ${MAX_SOCIAL_LINKS} links` })
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];

  @ApiPropertyOptional({
    example: 'https://www.instagram.com/yourpage',
    nullable: true,
    deprecated: true,
    description: 'Sent by older app builds; use socialLinks.',
  })
  @IsOptional()
  @Transform(blankToNull)
  @onHosts(SOCIAL_PLATFORM_RULES.instagram.hosts ?? undefined, 'Instagram')
  @MaxLength(200)
  instagramUrl?: string | null;

  @ApiPropertyOptional({
    example: 'https://www.youtube.com/@yourchannel',
    nullable: true,
    deprecated: true,
    description: 'Sent by older app builds; use socialLinks.',
  })
  @IsOptional()
  @Transform(blankToNull)
  @onHosts(SOCIAL_PLATFORM_RULES.youtube.hosts ?? undefined, 'YouTube')
  @MaxLength(200)
  youtubeUrl?: string | null;

  @ApiPropertyOptional({
    example: 'https://www.yourbusiness.in',
    nullable: true,
    deprecated: true,
    description: 'Sent by older app builds; use socialLinks.',
  })
  @IsOptional()
  @Transform(normaliseWebsite)
  @onHosts(undefined, 'website')
  @MaxLength(200)
  website?: string | null;
}

/** The single-link columns kept alongside the list, and the platform each mirrors. */
export const LEGACY_SOCIAL_COLUMNS = [
  ['website', 'website'],
  ['instagramUrl', 'instagram'],
  ['youtubeUrl', 'youtube'],
] as const;

export const SOCIAL_LINK_FIELDS = [
  'socialLinks',
  'instagramUrl',
  'youtubeUrl',
  'website',
] as const;

export interface ResolvedSocialLinks {
  socialLinks: SocialLink[];
  website: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
}

/** Same link when only the host's case (or a bare trailing slash) differs. */
function sameLinkKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/**
 * The list as it is stored: trimmed, a label only on `other`, and a URL given
 * twice kept once, in its first position. Two rows for the same page would
 * show the customer the same page twice.
 */
export function normaliseSocialLinks(
  links: ReadonlyArray<{ platform?: SocialPlatform; url?: string; label?: string | null }>,
): SocialLink[] {
  const seen = new Set<string>();
  const out: SocialLink[] = [];
  for (const link of links) {
    const url = (link.url ?? '').trim();
    if (!url || !link.platform) continue;
    const key = sameLinkKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = link.platform === 'other' ? (link.label ?? '').trim() : '';
    out.push(label ? { platform: link.platform, url, label } : { platform: link.platform, url });
  }
  return out;
}

/**
 * The social links a create or update leaves the listing with, or null when
 * the request does not touch them.
 *
 * A request with `socialLinks` states the whole list. One with only the old
 * single fields comes from an app build that predates the list: each field it
 * carries replaces the first link of that platform (or is added), and a
 * cleared field removes that platform's links, since clearing the one link the
 * old screen showed means "do not show this platform". Links the old screen
 * cannot see are left alone.
 *
 * The single columns are always rewritten from the result, as the first link
 * of each platform, so older builds keep reading what the list says.
 */
export function resolveSocialLinks(
  dto: SocialLinksDto,
  current?: { socialLinks?: SocialLink[] | null } | null,
): ResolvedSocialLinks | null {
  let links: SocialLink[];
  if (dto.socialLinks !== undefined) {
    links = normaliseSocialLinks(dto.socialLinks ?? []);
  } else {
    const legacy = LEGACY_SOCIAL_COLUMNS.filter(([column]) => dto[column] !== undefined);
    if (legacy.length === 0) return null;
    links = [...(current?.socialLinks ?? [])];
    for (const [column, platform] of legacy) {
      const url = dto[column];
      const at = links.findIndex((l) => l.platform === platform);
      if (!url) {
        links = links.filter((l) => l.platform !== platform);
      } else if (at >= 0) {
        links[at] = { platform, url };
      } else {
        links.push({ platform, url });
      }
    }
    links = normaliseSocialLinks(links).slice(0, MAX_SOCIAL_LINKS);
  }
  const first = (platform: SocialPlatform) =>
    links.find((l) => l.platform === platform)?.url ?? null;
  return {
    socialLinks: links,
    website: first('website'),
    instagramUrl: first('instagram'),
    youtubeUrl: first('youtube'),
  };
}
