import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  CaretRight,
  FacebookLogo,
  Globe,
  InstagramLogo,
  Link as LinkIcon,
  LinkedinLogo,
  PinterestLogo,
  WhatsappLogo,
  XLogo,
  YoutubeLogo,
} from 'phosphor-react-native';

import { SelectField } from '@/components/form';
import { Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import {
  MAX_SOCIAL_LABEL,
  MAX_SOCIAL_LINKS,
  MAX_SOCIAL_URL,
  SOCIAL_PLATFORMS,
  httpsHost,
  listingInstagramUrl,
  listingSocialLinks,
  socialLinkError,
  socialLinkName,
  socialPlatformRule,
  type SocialLink,
  type SocialPlatform,
} from '@/shared/social-links';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * A listing's public social links. The rules are the web client's
 * (shared/social-links), which are the server's (SocialLinksDto); checking them
 * here only catches a mistake before the round trip.
 */

const ICONS: Record<SocialPlatform, typeof Globe> = {
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

const PLATFORM_OPTIONS = SOCIAL_PLATFORMS.map((p) => ({ value: p.value, label: p.label }));

/**
 * As many links as the business has, each naming its platform.
 *
 * Three fixed boxes left a florist whose work is on Pinterest, or a caterer on
 * Facebook, nowhere to put it. A row's problem shows once the form has been
 * saved (`showErrors`) or the address has been left, not while it is typed.
 */
export function SocialLinksEditor({
  value,
  onChange,
  showErrors = false,
  error,
  saved,
}: {
  value: SocialLink[];
  onChange: (next: SocialLink[]) => void;
  showErrors?: boolean;
  error?: string;
  /** The listing as last saved, for the View Instagram check. */
  saved?: SocialLinks | null;
}) {
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
    // A business's own site is the most common first link, Instagram the next.
    const used = new Set(value.map((l) => l.platform));
    const platform: SocialPlatform = !used.has('website')
      ? 'website'
      : !used.has('instagram')
        ? 'instagram'
        : 'other';
    onChange([...value, { platform, url: '' }]);
  };

  return (
    <Card>
      <SectionTitle>Social media and website</SectionTitle>
      <Body tone="muted">
        Optional. Where couples can see more of your work. Each link must start with https://.
      </Body>
      {value.length === 0 ? <Caption tone="faint">No links yet.</Caption> : null}
      {value.map((link, i) => {
        const rule = socialPlatformRule(link.platform);
        // An empty row is dropped on save, not refused (see socialLinkErrors).
        const rowError =
          (showErrors || touched[i]) && link.url.trim() ? socialLinkError(link) : null;
        return (
          <View key={i} style={{ gap: space(2) }}>
            <SelectField
              label={`Link ${i + 1} platform`}
              value={link.platform}
              options={PLATFORM_OPTIONS}
              onChange={(platform) => update(i, { platform: platform as SocialPlatform })}
            />
            <Field
              label={`${rule?.label ?? 'Link'} address`}
              value={link.url}
              onChangeText={(url) => update(i, { url })}
              onBlur={() =>
                setTouched((t) => {
                  const next = [...t];
                  next[i] = true;
                  return next;
                })
              }
              placeholder={rule?.placeholder ?? 'https://'}
              error={rowError ?? undefined}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={MAX_SOCIAL_URL}
            />
            {link.platform === 'other' ? (
              <Field
                label="Name for this link"
                value={link.label ?? ''}
                onChangeText={(label) => update(i, { label })}
                placeholder="e.g. Behance"
                maxLength={MAX_SOCIAL_LABEL}
              />
            ) : null}
            <Button label={`Remove link ${i + 1}`} variant="ghost" small onPress={() => remove(i)} />
          </View>
        );
      })}
      <Button label="Add a link" variant="outline" small disabled={full} onPress={add} />
      <Caption tone={full ? 'brand' : 'faint'}>
        {value.length} of {MAX_SOCIAL_LINKS}
      </Caption>
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {/* The saved link, not the one being typed: this is the button couples
          get, so it is what the provider needs to see open their profile. */}
      {listingInstagramUrl(saved) ? (
        <View style={{ gap: space(1) }}>
          <ViewInstagramButton listing={saved} />
          <Caption tone="faint">Couples see this button. Check it opens your profile.</Caption>
        </View>
      ) : null}
    </Card>
  );
}

export interface SocialLinks {
  socialLinks?: SocialLink[] | null;
  website?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
}

/** Whether a listing has any link worth showing. */
export function hasSocialLinks(listing: SocialLinks | null | undefined): boolean {
  return listingSocialLinks(listing).length > 0;
}

/**
 * "View Instagram", the same button on every vendor and planner card and
 * profile, and on the provider's own business screens. Resolves the profile
 * with `listingInstagramUrl` and renders nothing when there is none, so a
 * caller never has to check first.
 *
 * The https profile address rather than an `instagram://` one: Instagram
 * claims its own web links, so the app opens where it is installed and the
 * browser where it is not, with no scheme query to declare.
 *
 * Inside a tappable card, render it as a sibling of the card's Pressable,
 * not within it: a nested Pressable takes the touch, but a screen reader
 * reads the outer one as a single button and never reaches this one.
 */
export function ViewInstagramButton({
  listing,
  style,
}: {
  listing: SocialLinks | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const url = listingInstagramUrl(listing);
  if (!url) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="View Instagram"
      accessibilityHint="Opens their Instagram profile"
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space(2),
          minHeight: 40,
          paddingHorizontal: space(3),
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.borderStrong),
        },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      <InstagramLogo size={18} color={rgb(theme.brand)} />
      <Caption style={{ fontWeight: '600', color: rgb(theme.ink[800]) }}>View Instagram</Caption>
    </Pressable>
  );
}

/** The configured https links only; nothing at all when there are none. */
export function SocialLinksList({ links }: { links: SocialLinks }) {
  const theme = useTheme();
  const shown = listingSocialLinks(links);
  if (shown.length === 0) return null;
  return (
    <View style={{ gap: space(1), marginTop: space(2) }}>
      <Body style={{ fontWeight: '600' }}>Social media and website</Body>
      {shown.map((link) => {
        const Icon = ICONS[link.platform] ?? LinkIcon;
        const name = socialLinkName(link);
        const host = httpsHost(link.url)?.replace(/^www\./, '');
        return (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={`Open ${name}${host ? `, ${host}` : ''}`}
            onPress={() => void Linking.openURL(link.url)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space(3),
              paddingVertical: space(2),
              borderTopWidth: 1,
              borderTopColor: rgb(theme.border),
            }}
          >
            <Icon size={20} color={rgb(theme.brand)} />
            <View style={{ flex: 1 }}>
              <Body>{name}</Body>
              {host ? <Caption tone="faint">{host}</Caption> : null}
            </View>
            <CaretRight size={16} color={rgb(theme.ink[500])} />
          </Pressable>
        );
      })}
    </View>
  );
}
