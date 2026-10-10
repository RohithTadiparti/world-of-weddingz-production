import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageBroken } from 'phosphor-react-native';

import {
  catalogSummary,
  uniquePortfolio,
  uniqueSocialLinks,
  type SummaryService,
} from '@/shared/catalog-rules';
import { listingSocialLinks } from '@/shared/social-links';
import { SocialLinksList, type SocialLinks } from '@/components/social-links';
import { PhotoViewer } from '@/components/planner/media';
import { reachable } from '@/components/uploader';
import { Body, Caption } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The read-only pieces of a submitted listing, shared by the vendor's own
 * Review & Submit and the officer's visit screen, so the two show the same
 * thing: each social link once, photographs that open, and the whole catalog.
 * The web client renders the same data through components/CatalogSummary.tsx.
 */

/** Every service with its category, and every price with its name, details and description. */
export function CatalogSummaryList({ services }: { services: readonly SummaryService[] }) {
  const theme = useTheme();
  const rows = catalogSummary(services);
  if (rows.length === 0) {
    return <Caption style={{ color: rgb(theme.cautionFg) }}>No services added yet.</Caption>;
  }
  return (
    <View style={{ gap: space(2) }}>
      {rows.map((row) => (
        <View
          key={row.serviceId}
          style={{
            backgroundColor: rgb(theme.surfaceSunken),
            borderRadius: radius.sm,
            padding: space(3),
            gap: space(1),
          }}
        >
          <Caption tone="faint">Category</Caption>
          <Body>{row.categoryName}</Body>
          <Caption tone="faint">Service</Caption>
          <Body style={{ fontWeight: '600' }}>
            {row.serviceName}
            {row.active ? '' : ' · switched off'}
          </Body>
          {row.serviceDescription ? <Caption>{row.serviceDescription}</Caption> : null}
          {row.prices.length > 0 ? (
            row.prices.map((price) => (
              <View
                key={price.id}
                style={{
                  gap: space(0.5),
                  marginTop: space(1.5),
                  paddingTop: space(1.5),
                  borderTopWidth: 1,
                  borderTopColor: rgb(theme.border),
                }}
              >
                <Caption tone="faint">Pricing name</Caption>
                <Body>
                  {price.name}
                  {price.active ? '' : ' · retired'}
                </Body>
                <Caption tone="faint">Pricing details</Caption>
                <Body style={{ fontVariant: ['tabular-nums'] }}>{price.details}</Body>
                <Caption tone="faint">Description</Caption>
                <Caption>{price.description ?? 'Not provided'}</Caption>
              </View>
            ))
          ) : (
            <Caption style={{ color: rgb(theme.cautionFg) }}>
              Pricing is missing for this service.
            </Caption>
          )}
        </View>
      ))}
    </View>
  );
}

/** A listing's social links, each platform and address once. */
export function SubmittedSocialLinks({ listing }: { listing: SocialLinks | null | undefined }) {
  const links = uniqueSocialLinks(listingSocialLinks(listing));
  if (links.length === 0) return <Caption tone="faint">No social media links added.</Caption>;
  return <SocialLinksList links={{ socialLinks: links }} />;
}

/**
 * Portfolio photographs that open full screen when tapped. A photo that will
 * not load says so and offers the file in the browser instead of an empty box.
 */
export function PortfolioGallery({ urls }: { urls: readonly string[] }) {
  const theme = useTheme();
  const photos = uniquePortfolio(urls).map(reachable);
  const [open, setOpen] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const viewable = photos.filter((url) => !broken[url]);

  if (photos.length === 0) {
    return <Caption style={{ color: rgb(theme.cautionFg) }}>No photos added yet.</Caption>;
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
        {photos.map((url, i) => (
          <Pressable
            key={url}
            accessibilityRole={broken[url] ? 'link' : 'imagebutton'}
            accessibilityLabel={`Open photo ${i + 1} of ${photos.length}`}
            onPress={() =>
              broken[url] ? void Linking.openURL(url) : setOpen(Math.max(0, viewable.indexOf(url)))
            }
            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
          >
            {broken[url] ? (
              <View
                style={{
                  width: 116,
                  height: 84,
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: rgb(theme.border),
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space(1),
                }}
              >
                <ImageBroken size={18} color={rgb(theme.ink[500])} />
                <Caption tone="faint">Open file {i + 1}</Caption>
              </View>
            ) : (
              <Image
                source={{ uri: url }}
                style={{
                  width: 116,
                  height: 84,
                  borderRadius: radius.sm,
                  backgroundColor: rgb(theme.surfaceSunken),
                }}
                contentFit="cover"
                transition={150}
                onError={() => setBroken((b) => ({ ...b, [url]: true }))}
              />
            )}
          </Pressable>
        ))}
      </ScrollView>
      <PhotoViewer photos={viewable} index={open} onClose={() => setOpen(null)} />
    </>
  );
}
