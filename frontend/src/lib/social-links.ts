/**
 * A listing's public social links: the platforms, and what each will accept.
 *
 * The server (SocialLinksDto) is the rule; this is the same rule a round trip
 * earlier, so a vendor sees "Instagram links must be on instagram.com" beside
 * the row rather than after pressing Save. The messages are the server's own
 * words for the same reason.
 *
 * Deliberately free of React and of every import: the mobile app reads this
 * file too (mobile/src/shared/social-links.ts), and a shared module has to be
 * dependency-free (see mobile/metro.config.js). No `URL` either, which React
 * Native only partly implements.
 */

export type SocialPlatform =
  | 'instagram'
  | 'youtube'
  | 'facebook'
  | 'pinterest'
  | 'x'
  | 'linkedin'
  | 'whatsapp'
  | 'website'
  | 'other';

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
  /** A name for an `other` link; ignored on the named platforms. */
  label?: string | null;
}

export const MAX_SOCIAL_LINKS = 10;
export const MAX_SOCIAL_LABEL = 40;
export const MAX_SOCIAL_URL = 200;

export interface SocialPlatformRule {
  value: SocialPlatform;
  /** As a person reads it on the listing and in the platform picker. */
  label: string;
  /** As it reads inside a sentence ("Enter a full website link"). */
  noun: string;
  /** Hosts the link may be on; null for any real host. */
  hosts: RegExp | null;
  /** The domains, for the message when a link is on the wrong one. */
  domains: string;
  placeholder: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatformRule[] = [
  {
    value: 'instagram',
    label: 'Instagram',
    noun: 'Instagram',
    hosts: /^(www\.|m\.)?instagram\.com$/,
    domains: 'instagram.com',
    placeholder: 'https://www.instagram.com/yourpage',
  },
  {
    value: 'youtube',
    label: 'YouTube',
    noun: 'YouTube',
    hosts: /^((www\.|m\.)?youtube\.com|youtu\.be)$/,
    domains: 'youtube.com or youtu.be',
    placeholder: 'https://www.youtube.com/@yourchannel',
  },
  {
    value: 'facebook',
    label: 'Facebook',
    noun: 'Facebook',
    hosts: /^((www\.|m\.|web\.)?facebook\.com|fb\.com)$/,
    domains: 'facebook.com',
    placeholder: 'https://www.facebook.com/yourpage',
  },
  {
    value: 'pinterest',
    label: 'Pinterest',
    noun: 'Pinterest',
    hosts: /^((www\.|[a-z]{2}\.)?pinterest\.com|pin\.it)$/,
    domains: 'pinterest.com or pin.it',
    placeholder: 'https://www.pinterest.com/yourboard',
  },
  {
    value: 'x',
    label: 'X',
    noun: 'X',
    hosts: /^(www\.)?(x|twitter)\.com$/,
    domains: 'x.com or twitter.com',
    placeholder: 'https://x.com/yourhandle',
  },
  {
    value: 'linkedin',
    label: 'LinkedIn',
    noun: 'LinkedIn',
    hosts: /^(www\.)?linkedin\.com$/,
    domains: 'linkedin.com',
    placeholder: 'https://www.linkedin.com/company/yourbusiness',
  },
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    noun: 'WhatsApp',
    hosts: /^(wa\.me|(api\.|www\.)?whatsapp\.com)$/,
    domains: 'wa.me or whatsapp.com',
    placeholder: 'https://wa.me/919876543210',
  },
  {
    value: 'website',
    label: 'Website',
    noun: 'website',
    hosts: null,
    domains: '',
    placeholder: 'https://www.yourbusiness.in',
  },
  {
    value: 'other',
    label: 'Other link',
    noun: 'link',
    hosts: null,
    domains: '',
    placeholder: 'https://',
  },
];

export function socialPlatformRule(platform: string): SocialPlatformRule | undefined {
  return SOCIAL_PLATFORMS.find((p) => p.value === platform);
}

/**
 * The host of an https:// address, lower-cased, or null when the text is not
 * one. A host needs a dot and a real top-level part: `https://localhost` and
 * `https://everafter` are not addresses a customer can open.
 */
export function httpsHost(url: string): string | null {
  const match = /^https:\/\/([^/?#:\s@]+)(:\d{1,5})?([/?#]\S*)?$/i.exec(url.trim());
  const host = match?.[1]?.toLowerCase();
  if (!host || !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return null;
  return host;
}

/** What is wrong with one link, in the server's words, or null when nothing is. */
export function socialLinkError(link: SocialLink): string | null {
  const rule = socialPlatformRule(link.platform);
  if (!rule) return 'Choose which platform this link is for';
  const url = (link.url ?? '').trim();
  if (!url) return `Enter the ${rule.noun} link`;
  if (url.length > MAX_SOCIAL_URL) return `A link can be at most ${MAX_SOCIAL_URL} characters`;
  const host = httpsHost(url);
  if (!host) return `Enter a full ${rule.noun} link starting with https://`;
  if (rule.hosts && !rule.hosts.test(host)) return `${rule.noun} links must be on ${rule.domains}`;
  if (link.platform === 'other' && (link.label ?? '').trim().length > MAX_SOCIAL_LABEL) {
    return `A link name can be at most ${MAX_SOCIAL_LABEL} characters`;
  }
  return null;
}

/**
 * One entry per row, null where the row is fine; and a count over the limit.
 * A row with no address is not checked: it is an "Add a link" row nobody
 * filled in, and `normaliseSocialLinks` drops it rather than sending it.
 */
export function socialLinkErrors(links: readonly SocialLink[]): {
  rows: (string | null)[];
  list: string | null;
  any: boolean;
} {
  const rows = links.map((link) => ((link.url ?? '').trim() ? socialLinkError(link) : null));
  const filled = links.filter((link) => (link.url ?? '').trim()).length;
  const list = filled > MAX_SOCIAL_LINKS ? `Add at most ${MAX_SOCIAL_LINKS} links` : null;
  return { rows, list, any: Boolean(list) || rows.some(Boolean) };
}

/** The same page twice, whatever the case of its host. */
function linkKey(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url);
  if (!match) return url;
  return `${match[1].toLowerCase()}${match[2].toLowerCase()}${match[3] || '/'}`;
}

/**
 * The list as it is sent: trimmed, a label only on `other`, and a link given
 * twice kept once, in its first position. A row with no address yet is the
 * editor's blank "Add a link" row, not a link, so it is dropped.
 */
export function normaliseSocialLinks(links: readonly SocialLink[]): SocialLink[] {
  const seen = new Set<string>();
  const out: SocialLink[] = [];
  for (const link of links) {
    const url = (link.url ?? '').trim();
    if (!url) continue;
    const key = linkKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = link.platform === 'other' ? (link.label ?? '').trim() : '';
    out.push(label ? { platform: link.platform, url, label } : { platform: link.platform, url });
  }
  return out;
}

/** What a link is called on a listing: its own name for `other`, else the platform's. */
export function socialLinkName(link: SocialLink): string {
  if (link.platform === 'other' && link.label?.trim()) return link.label.trim();
  return socialPlatformRule(link.platform)?.label ?? 'Link';
}

interface ListingLinks {
  socialLinks?: SocialLink[] | null;
  website?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
}

/**
 * The links to show a customer: the list, or, from a server that predates it,
 * the three single fields. Anything that is not an https:// address on a real
 * host is left off; a listing must not become a way to hand people a
 * `javascript:` link.
 */
export function listingSocialLinks(listing: ListingLinks | null | undefined): SocialLink[] {
  if (!listing) return [];
  const links: SocialLink[] = Array.isArray(listing.socialLinks)
    ? listing.socialLinks
    : [
        { platform: 'website' as const, url: listing.website ?? '' },
        { platform: 'instagram' as const, url: listing.instagramUrl ?? '' },
        { platform: 'youtube' as const, url: listing.youtubeUrl ?? '' },
      ];
  return normaliseSocialLinks(links).filter((l) => httpsHost(l.url) !== null);
}

/**
 * First path segments on instagram.com that are Instagram's own pages, not
 * someone's profile: a link to one post is not "their Instagram", so it is
 * not offered as one.
 */
const INSTAGRAM_NOT_PROFILES = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'about',
  'legal',
  'developer',
]);

/** Instagram's own rule for a username: letters, digits, dots and underscores, at most 30. */
const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/i;

/**
 * One Instagram link or handle as the profile page it names, or null.
 *
 * Takes what a provider is likely to have typed, not only what the editor now
 * insists on: `@name`, `instagram.com/name`, `www.instagram.com/name/`, an
 * `http://` or `m.` link, one with `?igsh=` share tracking on the end. Each
 * becomes the same `https://www.instagram.com/name/`, so the button opens the
 * profile rather than whatever page the link was copied from.
 */
export function instagramProfileUrl(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  let handle: string | undefined;
  if (text.startsWith('@')) {
    handle = text.slice(1);
  } else {
    // The host must be instagram.com itself: "instagram.com.evil.in" and a
    // site with "instagram" somewhere in its path are not Instagram links.
    const match = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com(\/[^?#\s]*)?(?:[?#]\S*)?$/i.exec(
      text,
    );
    if (!match) return null;
    // A later segment (/name/reels, /name/tagged) is still that profile.
    handle = (match[1] ?? '').split('/').filter(Boolean)[0];
  }
  if (!handle || !INSTAGRAM_HANDLE.test(handle)) return null;
  if (INSTAGRAM_NOT_PROFILES.has(handle.toLowerCase())) return null;
  return `https://www.instagram.com/${handle}/`;
}

/**
 * The provider's Instagram profile for a "View Instagram" button, or null when
 * there is none to show.
 *
 * The first Instagram entry in the list that names a profile wins; the single
 * `instagramUrl` field is read after it, for a server or a listing that
 * predates the list. Checked here rather than trusted: what is stored is
 * whatever the rules were on the day it was saved.
 */
export function listingInstagramUrl(listing: ListingLinks | null | undefined): string | null {
  if (!listing) return null;
  const fromList = Array.isArray(listing.socialLinks)
    ? listing.socialLinks.filter((l) => l?.platform === 'instagram').map((l) => l.url)
    : [];
  for (const url of [...fromList, listing.instagramUrl]) {
    const profile = instagramProfileUrl(url);
    if (profile) return profile;
  }
  return null;
}
