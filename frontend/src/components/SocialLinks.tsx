import { useId, useState } from 'react';
import {
  FacebookLogo,
  Globe,
  InstagramLogo,
  Link as LinkIcon,
  LinkedinLogo,
  PinterestLogo,
  WhatsappLogo,
  XLogo,
  YoutubeLogo,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import {
  MAX_SOCIAL_LABEL,
  MAX_SOCIAL_LINKS,
  MAX_SOCIAL_URL,
  SOCIAL_PLATFORMS,
  SocialLink,
  SocialPlatform,
  httpsHost,
  listingInstagramUrl,
  socialLinkError,
  socialLinkName,
  socialPlatformRule,
} from '../lib/social-links';

export const SOCIAL_ICONS: Record<SocialPlatform, Icon> = {
  instagram: InstagramLogo,
  youtube: YoutubeLogo,
  facebook: FacebookLogo,
  pinterest: PinterestLogo,
  x: XLogo,
  linkedin: LinkedinLogo,
  whatsapp: WhatsappLogo,
  website: Globe,
  other: LinkIcon,
};

/**
 * Where a business shows its work off the platform, as many rows as it has.
 *
 * Three fixed boxes (Instagram, YouTube, website) left a florist whose
 * portfolio lives on Pinterest, or a caterer on Facebook, with nowhere to put
 * it. Each row names its platform so the listing can show the right icon and
 * the server can check the link is really on that platform.
 *
 * A row's error shows once the address has been left, or once the form has
 * been submitted (`showErrors`), not while the first characters are typed.
 */
export function SocialLinksEditor({
  value,
  onChange,
  showErrors = false,
  error,
}: {
  value: SocialLink[];
  onChange: (next: SocialLink[]) => void;
  showErrors?: boolean;
  /** A problem with the list as a whole, e.g. from the server. */
  error?: string;
}) {
  const id = useId();
  const [touched, setTouched] = useState<boolean[]>([]);
  const full = value.length >= MAX_SOCIAL_LINKS;

  const update = (i: number, patch: Partial<SocialLink>) =>
    onChange(value.map((link, j) => (j === i ? { ...link, ...patch } : link)));
  const remove = (i: number) => {
    onChange(value.filter((_, j) => j !== i));
    setTouched((t) => t.filter((_, j) => j !== i));
  };
  const add = () => {
    if (full) return;
    // A business's own site is the most common first link; Instagram the
    // most common after it.
    const used = new Set(value.map((l) => l.platform));
    const platform: SocialPlatform = !used.has('website')
      ? 'website'
      : !used.has('instagram')
        ? 'instagram'
        : 'other';
    onChange([...value, { platform, url: '' }]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-sm text-gray-500">
          No links yet. Add your website, Instagram, YouTube, Facebook or anywhere else your work
          can be seen.
        </p>
      )}
      <ul className="space-y-2">
        {value.map((link, i) => {
          const rule = socialPlatformRule(link.platform);
          // Same rule as socialLinkErrors: an empty row is dropped, not refused.
          const rowError =
            (showErrors || touched[i]) && link.url.trim() ? socialLinkError(link) : null;
          const n = i + 1;
          const errorId = `${id}-error-${i}`;
          return (
            <li key={i} className="rounded-sm border border-gray-200 p-2">
              <div className="flex flex-wrap items-start gap-2">
                <div className="w-full sm:w-40">
                  <label className="sr-only" htmlFor={`${id}-platform-${i}`}>
                    Platform for link {n}
                  </label>
                  <select
                    id={`${id}-platform-${i}`}
                    className="input"
                    value={link.platform}
                    onChange={(e) => update(i, { platform: e.target.value as SocialPlatform })}
                  >
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 flex-1 basis-56">
                  <label className="sr-only" htmlFor={`${id}-url-${i}`}>
                    {rule?.label ?? 'Link'} address for link {n}
                  </label>
                  <input
                    id={`${id}-url-${i}`}
                    className="input"
                    // Text with a URL keyboard rather than type="url": the
                    // browser's own check would pop up over the row's message
                    // in a form that does not set noValidate.
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    maxLength={MAX_SOCIAL_URL}
                    placeholder={rule?.placeholder ?? 'https://'}
                    value={link.url}
                    aria-invalid={rowError ? true : undefined}
                    aria-describedby={rowError ? errorId : undefined}
                    onChange={(e) => update(i, { url: e.target.value })}
                    onBlur={() =>
                      setTouched((t) => {
                        const next = [...t];
                        next[i] = true;
                        return next;
                      })
                    }
                  />
                </div>
                {link.platform === 'other' && (
                  <div className="w-full sm:w-44">
                    <label className="sr-only" htmlFor={`${id}-label-${i}`}>
                      Name for link {n}
                    </label>
                    <input
                      id={`${id}-label-${i}`}
                      className="input"
                      placeholder="Name, e.g. Behance"
                      maxLength={MAX_SOCIAL_LABEL}
                      value={link.label ?? ''}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </div>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm min-h-12 text-critical-fg"
                  aria-label={`Remove link ${n}`}
                  onClick={() => remove(i)}
                >
                  Remove
                </button>
              </div>
              {rowError && (
                <p id={errorId} className="mt-1 text-xs text-red-600">
                  {rowError}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-outline btn-sm" onClick={add} disabled={full}>
          Add a link
        </button>
        <span className={`text-xs ${full ? 'text-caution-fg' : 'text-gray-500'}`}>
          {value.length} of {MAX_SOCIAL_LINKS}
        </span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * "View Instagram", the same button on every vendor and planner card and
 * profile, and in the provider's own console. Takes a listing and resolves
 * its profile with `listingInstagramUrl`; renders nothing when there is none,
 * so a caller never has to check first.
 *
 * Its own anchor, so it must never sit inside another link: a card that is a
 * whole-card link puts its Instagram button beside that link, not in it.
 */
export function ViewInstagramLink({
  listing,
  className = '',
}: {
  listing: Parameters<typeof listingInstagramUrl>[0];
  className?: string;
}) {
  const url = listingInstagramUrl(listing);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn-outline btn-sm inline-flex items-center justify-center gap-1.5 ${className}`}
    >
      <InstagramLogo size={16} weight="regular" aria-hidden="true" />
      View Instagram
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * A listing's links as a customer or the vendor reads them back: icon, name
 * and the site it leads to, each opening in a new tab. Expects links already
 * filtered to https (see `listingSocialLinks`); nothing renders for none.
 */
export function SocialLinksList({
  links,
  className = '',
}: {
  links: SocialLink[];
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {links.map((link) => {
        const Icon = SOCIAL_ICONS[link.platform] ?? LinkIcon;
        const name = socialLinkName(link);
        const host = httpsHost(link.url)?.replace(/^www\./, '');
        return (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-sm border border-gray-200 px-3 py-1.5 text-sm text-gray-800 hover:border-brand hover:text-brand-strong"
            >
              <Icon size={18} weight="regular" aria-hidden="true" className="text-brand" />
              <span className="font-medium">{name}</span>
              {host && <span className="text-xs text-gray-500">{host}</span>}
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
