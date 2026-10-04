import { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight, Heart, MapPin } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, apiMessage } from '@/lib/api';
import { rupees } from '@/lib/format';
import { loadPlannerShortlist, togglePlannerShortlist } from '@/lib/plan-shortlist';
import { Sheet } from '@/components/sheet';
import { ViewInstagramButton } from '@/components/social-links';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Eyebrow,
  Loading,
} from '@/components/ui';
import { PlannerAvailabilityCalendar } from '@/components/planner/availability-calendar';
import {
  plannerInitials,
  plannerPlace,
  startingPrice,
  useCanRequestPlanner,
  usePlannerProfile,
  type PlannerProfile,
} from '@/components/planner/data';
import {
  ConnectLinks,
  PhotoViewer,
  VideoTile,
  WeddingCard,
  hasConnectLinks,
} from '@/components/planner/media';
import { Chip, ChipRow, PlannerSection, Stars, VerifiedBadge } from '@/components/planner/parts';
import { ServicesPicker } from '@/components/planner/services-picker';
import {
  PLANNER_SERVICES,
  plannerServiceLabel,
  plannerSpecializationLabel,
  weddingCover,
} from '@/shared/planner-profile';
import { usePlannerRequest } from '@/store/planner-request';
import { rgb, rgba, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * A wedding planner's profile, as a couple choosing one reads it.
 *
 * One column, in the order a couple decides: who this is and whether others
 * rated them (the header), what they are like to work with (About), what they
 * would do (Services), what they have done (Portfolio), what it costs, and
 * whether they are free. Tabs used to hide all but one of those at a time,
 * which suits a page you know and fails one you are judging.
 *
 * The page is also where the request is assembled. The services ticked here and
 * the date picked on the calendar go into a small store (store/planner-request)
 * that the request screen opens prefilled from, so "Send Request" is a review
 * of choices already made rather than a blank form.
 *
 * Only the business side of the listing is shown, as on the web: the planner's
 * phone, email and address stay out, because bookings and the conversation
 * about them run through the platform.
 */
export default function PlannerProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canRequest = useCanRequestPlanner();
  const query = usePlannerProfile(id);

  const beginFor = usePlannerRequest((s) => s.beginFor);
  const date = usePlannerRequest((s) => s.date);
  const setDate = usePlannerRequest((s) => s.setDate);
  const services = usePlannerRequest((s) => s.services);
  const toggleService = usePlannerRequest((s) => s.toggleService);

  const [packagesOpen, setPackagesOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  useEffect(() => {
    if (id) beginFor(id);
  }, [id, beginFor]);

  if (query.isPending) {
    return (
      <View style={{ flex: 1, padding: space(4), backgroundColor: rgb(theme.canvas) }}>
        <Loading rows={5} />
      </View>
    );
  }

  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, padding: space(4), backgroundColor: rgb(theme.canvas) }}>
        <EmptyState title="Planner unavailable">
          {apiMessage(query.error, 'This listing may no longer be available.')}
        </EmptyState>
      </View>
    );
  }

  const planner = query.data;
  const weddings = planner.weddings ?? [];
  const photos = planner.portfolio ?? [];
  const cover = photos[0] ?? (weddings[0] ? weddingCover(weddings[0]) : null);
  const specializations = planner.specializations ?? [];
  const serviceKeys: string[] = planner.services?.length
    ? planner.services
    : PLANNER_SERVICES.map((s) => s.key);
  const packages = planner.packages ?? [];
  const lowest = startingPrice(packages);
  // Screen gutter and the card's own padding, each side.
  const innerWidth = width - space(16);

  const openRequest = () => router.push(`/planners/${planner.id}/request`);
  const openReviews = () => router.push(`/planners/${planner.id}/reviews`);
  const openWeddings = () => router.push(`/planners/${planner.id}/weddings`);

  return (
    <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space(8) }}>
        {/* ------------------------------------------------------ header -- */}
        <View style={{ height: width * 0.62, backgroundColor: rgb(theme.surfaceSunken) }}>
          {cover ? (
            <Image source={{ uri: cover }} style={{ width, height: '100%' }} resizeMode="cover" />
          ) : null}
          {canRequest ? <FavouriteToggle plannerId={planner.id} /> : null}
        </View>

        <View style={{ paddingHorizontal: space(4), gap: space(4) }}>
          <View style={{ gap: space(3) }}>
            <View
              style={{
                width: 84,
                height: 84,
                marginTop: -42,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: rgb(theme.surface),
                borderWidth: 1,
                borderColor: rgb(theme.rose[200]),
              }}
            >
              <Txt
                serif
                style={{ fontSize: 32, letterSpacing: 2, color: rgb(theme.brand) }}
                accessibilityLabel={`${planner.agencyName} logo`}
              >
                {plannerInitials(planner.agencyName)}
              </Txt>
            </View>

            <View style={{ gap: space(2) }}>
              <Eyebrow>Wedding planner</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) }}>
                <Txt serif style={{ fontSize: 30, lineHeight: 34, color: rgb(theme.brand), flexShrink: 1 }}>
                  {planner.agencyName}
                </Txt>
                <VerifiedBadge />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Rated ${Number(planner.ratingAvg).toFixed(1)} from ${planner.ratingCount} reviews. Open reviews`}
                onPress={openReviews}
                hitSlop={6}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), alignSelf: 'flex-start' }}
              >
                <Stars value={Number(planner.ratingAvg)} />
                <Body style={{ fontWeight: '600' }}>{Number(planner.ratingAvg).toFixed(1)}</Body>
                <Caption tone="brand" style={{ textDecorationLine: 'underline' }}>
                  {planner.ratingCount} {planner.ratingCount === 1 ? 'review' : 'reviews'}
                </Caption>
              </Pressable>

              {plannerPlace(planner) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
                  <MapPin size={15} color={rgb(theme.ink[500])} />
                  <Caption>{plannerPlace(planner)}</Caption>
                </View>
              ) : null}
            </View>

            <HeaderStats planner={planner} />

            {/* Beside the request, as on the web profile. */}
            <ViewInstagramButton listing={planner} />

            {canRequest ? (
              <Button label="Send Request" onPress={openRequest} />
            ) : null}
          </View>

          {/* ----------------------------------------------------- about -- */}
          <PlannerSection eyebrow="Who they are" title="About">
            <Body style={{ lineHeight: 23 }}>
              {planner.bio ||
                `${planner.agencyName} is a wedding planner${
                  planner.yearsExperience ? ` with ${planner.yearsExperience} years of experience` : ''
                }.`}
            </Body>
            {planner.yearsExperience ? (
              <Caption>
                Planning weddings for {planner.yearsExperience}{' '}
                {planner.yearsExperience === 1 ? 'year' : 'years'}
                {planner.weddingsCompleted ? `, ${planner.weddingsCompleted} weddings completed` : ''}.
              </Caption>
            ) : null}
            {specializations.length > 0 ? (
              <View style={{ gap: space(2) }}>
                <Caption style={{ fontWeight: '600' }}>Wedding types</Caption>
                <ChipRow>
                  {specializations.map((key) => (
                    <Chip key={key} label={plannerSpecializationLabel(key)} />
                  ))}
                </ChipRow>
              </View>
            ) : null}
            {planner.planningApproach ? (
              <View style={{ gap: space(1) }}>
                <Caption style={{ fontWeight: '600' }}>Planning approach</Caption>
                <Body tone="muted">{planner.planningApproach}</Body>
              </View>
            ) : null}
            {planner.introVideoUrl ? (
              <View style={{ gap: space(2) }}>
                <Caption style={{ fontWeight: '600' }}>Introduction video</Caption>
                <VideoTile
                  url={planner.introVideoUrl}
                  width={innerWidth}
                  label={`Play ${planner.agencyName}'s introduction video`}
                />
              </View>
            ) : null}
          </PlannerSection>

          {/* -------------------------------------------------- services -- */}
          <PlannerSection eyebrow="What they do" title="Services Offered">
            {canRequest ? (
              <>
                <Caption>
                  Select the services you are interested in. These will be shared with the planner
                  when you send a request.
                </Caption>
                <ServicesPicker options={serviceKeys} selected={services} onToggle={toggleService} />
                {services.length > 0 ? (
                  <Caption tone="brand">
                    {services.length} {services.length === 1 ? 'service' : 'services'} selected
                  </Caption>
                ) : null}
              </>
            ) : (
              <ChipRow>
                {serviceKeys.map((key) => (
                  <Chip key={key} label={plannerServiceLabel(key)} />
                ))}
              </ChipRow>
            )}
          </PlannerSection>

          {/* ------------------------------------------------- portfolio -- */}
          {weddings.length > 0 ? (
            <PlannerSection
              eyebrow="Portfolio"
              title="Previous Weddings"
              action="View All"
              onAction={openWeddings}
            >
              <FlatList
                horizontal
                data={weddings}
                keyExtractor={(w) => w.id}
                showsHorizontalScrollIndicator={false}
                // Bleeds to the card's edges so the next card peeks in.
                style={{ marginHorizontal: -space(4) }}
                contentContainerStyle={{ paddingHorizontal: space(4), gap: space(3) }}
                renderItem={({ item }) => (
                  <WeddingCard
                    wedding={item}
                    width={Math.min(260, width * 0.64)}
                    onPress={() => router.push(`/planners/${planner.id}/weddings/${item.id}`)}
                  />
                )}
              />
            </PlannerSection>
          ) : photos.length > 0 ? (
            <PlannerSection eyebrow="Portfolio" title="Gallery">
              <FlatList
                horizontal
                data={photos}
                keyExtractor={(uri, i) => `${i}-${uri}`}
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -space(4) }}
                contentContainerStyle={{ paddingHorizontal: space(4), gap: space(2) }}
                renderItem={({ item, index }) => (
                  <Pressable
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
                    onPress={() => setPhotoIndex(index)}
                  >
                    <Image source={{ uri: item }} style={{ width: 140, height: 140 }} />
                  </Pressable>
                )}
              />
            </PlannerSection>
          ) : null}

          {/* ------------------------------------------------- expertise -- */}
          {specializations.length > 0 || (planner.servesCities ?? []).length > 0 ? (
            <PlannerSection eyebrow="Strengths" title="Expertise">
              {specializations.length > 0 ? (
                <ChipRow>
                  {specializations.map((key) => (
                    <Chip key={key} label={plannerSpecializationLabel(key)} />
                  ))}
                </ChipRow>
              ) : null}
              {(planner.servesCities ?? []).length > 0 ? (
                <Caption>Also plans weddings in {planner.servesCities!.join(', ')}.</Caption>
              ) : null}
            </PlannerSection>
          ) : null}

          {/* --------------------------------------------------- reviews -- */}
          <PlannerSection
            eyebrow="What couples said"
            title="Reviews"
            action={planner.ratingCount > 0 ? 'Read all' : undefined}
            onAction={openReviews}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open client reviews"
              onPress={openReviews}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}
            >
              <Txt serif style={{ fontSize: 40, lineHeight: 44, color: rgb(theme.brand) }}>
                {Number(planner.ratingAvg).toFixed(1)}
              </Txt>
              <View style={{ gap: space(1), flex: 1 }}>
                <Stars value={Number(planner.ratingAvg)} size={16} />
                <Caption>
                  {planner.ratingCount === 0
                    ? 'No reviews yet'
                    : `Based on ${planner.ratingCount} client ${planner.ratingCount === 1 ? 'review' : 'reviews'}`}
                </Caption>
              </View>
              <CaretRight size={16} color={rgb(theme.ink[400])} />
            </Pressable>
          </PlannerSection>

          {/* --------------------------------------------------- package -- */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              lowest !== null ? `Packages starting from ${rupees(lowest)}. Show all packages` : 'Packages quoted on request'
            }
            disabled={packages.length === 0}
            onPress={() => setPackagesOpen(true)}
            style={({ pressed }) => [pressed && { opacity: 0.8 }]}
          >
            <Card style={{ padding: space(4), flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <View style={{ flex: 1, gap: space(1) }}>
                <Eyebrow>Total package</Eyebrow>
                {lowest !== null ? (
                  <Txt style={{ fontSize: 15, color: rgb(theme.ink[700]) }}>
                    Starting from{' '}
                    <Txt serif style={{ fontSize: 26, color: rgb(theme.brand) }}>
                      {rupees(lowest)}
                    </Txt>
                  </Txt>
                ) : (
                  <Body tone="muted">Packages are quoted on request.</Body>
                )}
                {packages.length > 0 ? (
                  <Caption tone="brand">
                    View {packages.length} {packages.length === 1 ? 'package' : 'packages'}
                  </Caption>
                ) : null}
              </View>
              {packages.length > 0 ? <CaretRight size={18} color={rgb(theme.ink[400])} /> : null}
            </Card>
          </Pressable>

          {/* ---------------------------------------------- availability -- */}
          <PlannerSection eyebrow="Pick a date" title="Availability">
            <PlannerAvailabilityCalendar plannerId={planner.id} selected={date} onSelect={setDate} />
          </PlannerSection>

          {/* --------------------------------------------------- connect -- */}
          {hasConnectLinks(planner) ? (
            <PlannerSection eyebrow="Follow their work" title="Connect">
              <ConnectLinks planner={planner} />
            </PlannerSection>
          ) : null}

          {/* ------------------------------------------------------ cta -- */}
          {canRequest ? (
            <View
              style={{
                padding: space(5),
                gap: space(3),
                backgroundColor: rgb(theme.brandSoft),
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: rgb(theme.rose[200]),
              }}
            >
              <Txt serif style={{ fontSize: 24, lineHeight: 28, color: rgb(theme.brand) }}>
                Interested in working with this planner?
              </Txt>
              <Caption>
                {selectionSummary(date, services.length) ??
                  'Send a request with your date and the services you need. The planner replies in your bookings.'}
              </Caption>
              <Button label="Send Planner Request" onPress={openRequest} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      <PhotoViewer photos={photos} index={photoIndex} onClose={() => setPhotoIndex(null)} />

      <Sheet
        visible={packagesOpen}
        title="Packages"
        subtitle={`What ${planner.agencyName} offers, and what each includes.`}
        onClose={() => setPackagesOpen(false)}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), gap: space(3) }}>
          {packages.map((pkg, i) => (
            <View
              key={`${pkg.name}-${i}`}
              style={{
                gap: space(1),
                paddingVertical: space(3),
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: rgb(theme.border),
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: '600' }}>{pkg.name}</Body>
                <Txt serif style={{ fontSize: 22, color: rgb(theme.brand) }}>
                  {rupees(pkg.price)}
                </Txt>
              </View>
              {pkg.includes?.length ? (
                <View style={{ gap: space(0.5) }}>
                  {pkg.includes.map((line, j) => (
                    <Caption key={j}>{`•  ${line}`}</Caption>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          <Button label="Close" variant="outline" onPress={() => setPackagesOpen(false)} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** What has been picked so far, for the closing banner; null when nothing has. */
function selectionSummary(date: string, serviceCount: number): string | null {
  const parts: string[] = [];
  if (date) {
    parts.push(
      new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
  }
  if (serviceCount > 0) parts.push(`${serviceCount} ${serviceCount === 1 ? 'service' : 'services'}`);
  return parts.length ? `Your request so far: ${parts.join(' and ')}.` : null;
}

/** Years in the trade and weddings run, side by side under the name. */
function HeaderStats({ planner }: { planner: PlannerProfile }) {
  const theme = useTheme();
  const stats: { value: string; label: string }[] = [];
  if (planner.yearsExperience) {
    stats.push({ value: String(planner.yearsExperience), label: planner.yearsExperience === 1 ? 'Year experience' : 'Years experience' });
  }
  if (planner.weddingsCompleted != null) {
    stats.push({ value: String(planner.weddingsCompleted), label: 'Weddings completed' });
  }
  if (stats.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.border),
        backgroundColor: rgb(theme.surface),
      }}
    >
      {stats.map((s, i) => (
        <View
          key={s.label}
          style={{
            flex: 1,
            paddingVertical: space(3),
            paddingHorizontal: space(3),
            gap: space(0.5),
            borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: rgb(theme.border),
          }}
        >
          <Txt serif style={{ fontSize: 28, lineHeight: 30, color: rgb(theme.brand) }}>
            {s.value}
          </Txt>
          <Caption>{s.label}</Caption>
        </View>
      ))}
    </View>
  );
}

/**
 * The heart on the cover: the planner saved to this account on the server
 * (`/wedding-planners/:id/favourite`), so it follows the couple to the web.
 *
 * Hire a Planner's list still draws its hearts from the shortlist kept on the
 * device, so a change here is mirrored there too; otherwise saving a planner
 * from their profile would leave the list's heart empty.
 */
function FavouriteToggle({ plannerId }: { plannerId: string }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const key = ['planner-favourite', plannerId];
  const [error, setError] = useState('');

  const favourite = useQuery({
    queryKey: key,
    queryFn: async () =>
      ((await api.get(`/wedding-planners/${plannerId}/favourite`)).data as { favourite: boolean })
        .favourite,
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const res = next
        ? await api.put(`/wedding-planners/${plannerId}/favourite`)
        : await api.delete(`/wedding-planners/${plannerId}/favourite`);
      return (res.data as { favourite: boolean }).favourite;
    },
    onMutate: (next) => {
      setError('');
      const before = qc.getQueryData<boolean>(key);
      qc.setQueryData(key, next);
      return { before };
    },
    onError: (err, _next, ctx) => {
      qc.setQueryData(key, ctx?.before ?? false);
      setError(apiMessage(err, 'That could not be saved.'));
    },
    onSuccess: async (saved) => {
      qc.setQueryData(key, saved);
      void qc.invalidateQueries({ queryKey: ['planner-favourites'] });
      const local = await loadPlannerShortlist();
      if (local.has(plannerId) !== saved) await togglePlannerShortlist(plannerId);
    },
  });

  const on = favourite.data === true;
  return (
    <View style={{ position: 'absolute', top: space(3), right: space(3), alignItems: 'flex-end', gap: space(1) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? 'Remove from saved planners' : 'Save planner'}
        accessibilityState={{ selected: on, disabled: favourite.isPending }}
        disabled={favourite.isPending || toggle.isPending}
        onPress={() => toggle.mutate(!on)}
        style={({ pressed }) => [
          {
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: rgba(theme.surface, 0.92),
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Heart size={22} weight={on ? 'fill' : 'regular'} color={rgb(theme.brand)} />
      </Pressable>
      {error ? (
        <View style={{ maxWidth: 220 }}>
          <Alert tone="critical">{error}</Alert>
        </View>
      ) : null}
    </View>
  );
}
