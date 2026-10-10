import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Share,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Heart, MapPin, SealCheck, ShareNetwork, Star } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { money, rupees } from '@/lib/format';
import { loadVendorShortlist, toggleVendorShortlist } from '@/lib/plan-shortlist';
import { type FieldSpec } from '@/shared/dynamic-form';
import {
  SocialLinksList,
  ViewInstagramButton,
  hasSocialLinks,
  type SocialLinks,
} from '@/components/social-links';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type Tab = 'overview' | 'photos' | 'reviews' | 'packages';

type Vendor = {
  id: string;
  name: string;
  category: string | null;
  categories: string[];
  city: string;
  description: string;
  ratingAvg: number;
  ratingCount: number;
  portfolio: string[];
  startingPrice: number | null;
  verifiedAt: string | null;
} & SocialLinks;

type Service = {
  id: string;
  displayName?: string | null;
  description?: string | null;
  definition?: { name: string; description?: string | null } | null;
  active?: boolean;
  bookable?: boolean;
  bookingForm?: FieldSpec[];
  offerings?: { id: string; name: string; price: string | null; currency?: string; active?: boolean }[];
};

const serviceName = (s: Service) => s.displayName || s.definition?.name || 'Service';

/** What `/vendors/search` shows as "From ₹X": the cheapest live offering. */
function cheapestOffering(services: Service[]): number | null {
  const prices = services
    .filter((s) => s.active !== false)
    .flatMap((s) => s.offerings ?? [])
    .filter((o) => o.active !== false && o.price != null)
    .map((o) => Number(o.price));
  return prices.length ? Math.min(...prices) : null;
}

type MyBooking = { id: string; providerId?: string; status: string; createdAt?: string };


type Review = {
  id: string;
  rating: number;
  comment?: string | null;
};

export default function VendorDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId?: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void loadVendorShortlist().then(setShortlist);
  }, []);

  const query = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () => (await api.get(`/vendors/${id}`)).data as Vendor,
    enabled: Boolean(id),
    retry: false,
  });

  const services = useQuery({
    queryKey: ['vendor-services', id],
    queryFn: async () => (await api.get(`/vendors/${id}/services`)).data as Service[],
    enabled: Boolean(id),
    retry: false,
  });

  // The same list the Bookings screen reads: a chat with a vendor lives on a booking.
  const myBookings = useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () =>
      (await api.get('/bookings', { params: { limit: 100 } })).data as
        | { data?: MyBooking[] }
        | MyBooking[],
    enabled: Boolean(id),
    retry: false,
  });

  const reviews = useQuery({
    queryKey: ['vendor-reviews', id],
    queryFn: async () =>
      (await api.get(`/vendors/${id}/reviews`)).data as { data?: Review[] } | Review[],
    enabled: Boolean(id) && tab === 'reviews',
    retry: false,
  });

  const serviceRows = Array.isArray(services.data) ? services.data : [];
  if (query.isPending) {
    return (
      <View style={{ flex: 1, padding: space(4) }}>
        <Loading rows={4} />
      </View>
    );
  }

  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, padding: space(4) }}>
        <EmptyState title="Vendor unavailable">
          {apiMessage(query.error, 'This listing may no longer be available.')}
        </EmptyState>
      </View>
    );
  }

  const vendor = query.data;
  const startingPrice = vendor.startingPrice ?? cheapestOffering(serviceRows);
  const bookingRows: MyBooking[] = Array.isArray(myBookings.data)
    ? myBookings.data
    : (myBookings.data?.data ?? []);
  const withVendor = bookingRows.filter((b) => b.providerId === vendor.id);
  const existing = withVendor.find((b) => b.status !== 'cancelled') ?? withVendor[0];
  const photos = vendor.portfolio ?? [];
  const saved = shortlist.has(vendor.id);
  const reviewRows: Review[] = Array.isArray(reviews.data)
    ? reviews.data
    : (reviews.data?.data ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={{ height: width * 0.68, backgroundColor: rgb(theme.surfaceSunken) }}>
          {photos[0] ? (
            <Image source={{ uri: photos[0] }} style={{ width, height: '100%' }} resizeMode="cover" />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={{
              position: 'absolute',
              top: space(5),
              left: space(3),
              padding: space(2),
              borderRadius: radius.md,
              backgroundColor: rgb(theme.surface),
            }}
          >
            <ArrowLeft size={20} color={rgb(theme.ink[800])} />
          </Pressable>
          <View
            style={{
              position: 'absolute',
              top: space(5),
              right: space(3),
              flexDirection: 'row',
              gap: space(2),
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Shortlist vendor"
              onPress={() => void toggleVendorShortlist(vendor.id).then(setShortlist)}
              style={{ padding: space(2), borderRadius: radius.md, backgroundColor: rgb(theme.surface) }}
            >
              <Heart
                size={20}
                weight={saved ? 'fill' : 'regular'}
                color={rgb(theme.brand)}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share vendor"
              onPress={() => void Share.share({ message: vendor.name })}
              style={{ padding: space(2), borderRadius: radius.md, backgroundColor: rgb(theme.surface) }}
            >
              <ShareNetwork size={20} color={rgb(theme.brand)} />
            </Pressable>
          </View>
          {photos.length > 0 ? (
            <View
              style={{
                position: 'absolute',
                bottom: space(3),
                right: space(3),
                paddingHorizontal: space(2),
                paddingVertical: space(1),
                borderRadius: radius.md,
                backgroundColor: 'rgba(0,0,0,0.55)',
              }}
            >
              <Caption style={{ color: '#fff' }}>1/{photos.length}</Caption>
            </View>
          ) : null}
        </View>

        <View style={{ padding: space(4), gap: space(4) }}>
          <View style={{ gap: space(1) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
              <SectionTitle>{vendor.name}</SectionTitle>
              {vendor.verifiedAt ? (
                <SealCheck size={18} color={rgb(theme.positiveFg)} weight="fill" />
              ) : null}
            </View>
            <Caption>
              <Star size={13} color={rgb(theme.brand)} weight="fill" />{' '}
              {Number(vendor.ratingAvg).toFixed(1)} · {vendor.ratingCount}{' '}
              {vendor.ratingCount === 1 ? 'review' : 'reviews'}
            </Caption>
            <Caption>
              <MapPin size={13} color={rgb(theme.ink[400])} />{' '}
              {vendor.city || 'Location on request'}
            </Caption>
            {/* Under the headline, as on the planner profile. */}
            <ViewInstagramButton listing={vendor} style={{ marginTop: space(2) }} />
          </View>

          {notice ? <Alert tone="positive">{notice}</Alert> : null}
          {error ? <Alert tone="critical">{error}</Alert> : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {(
              [
                ['overview', 'Overview'],
                ['photos', 'Photos'],
                ['reviews', 'Reviews'],
                ['packages', 'Packages'],
              ] as const
            ).map(([key, label]) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(key)}
                  style={{
                    paddingHorizontal: space(3),
                    paddingVertical: space(1.5),
                    borderRadius: radius.md,
                    backgroundColor: active ? rgb(theme.brand) : rgb(theme.surfaceSunken),
                  }}
                >
                  <Caption
                    style={{
                      color: active ? rgb(theme.brandFg) : rgb(theme.ink[700]),
                      fontWeight: '600',
                    }}
                  >
                    {label}
                  </Caption>
                </Pressable>
              );
            })}
          </View>

          {tab === 'overview' ? (
            <>
              {vendor.description || hasSocialLinks(vendor) ? (
                <Card>
                  <SectionTitle>About</SectionTitle>
                  {vendor.description ? <Caption>{vendor.description}</Caption> : null}
                  <SocialLinksList links={vendor} />
                </Card>
              ) : null}
              {startingPrice !== null ? (
                <Card>
                  <Caption>Starting Price</Caption>
                  <SectionTitle>{rupees(startingPrice)}</SectionTitle>
                  <Pressable onPress={() => setTab('packages')}>
                    <Caption tone="brand" style={{ fontWeight: '600', marginTop: space(1) }}>
                      View Packages
                    </Caption>
                  </Pressable>
                </Card>
              ) : null}
            </>
          ) : null}

          {tab === 'photos' ? (
            photos.length <= 1 ? (
              <EmptyState title="No more photos">This vendor has not added a full gallery yet.</EmptyState>
            ) : (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/vendors/[id]/gallery', params: { id: vendor.id } })
                }
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                  {photos.map((photo) => (
                    <Image
                      key={photo}
                      source={{ uri: photo }}
                      style={{ width: (width - space(10)) / 3, height: 92, borderRadius: radius.md }}
                    />
                  ))}
                </View>
              </Pressable>
            )
          ) : null}

          {tab === 'reviews' ? (
            reviews.isPending ? (
              <Loading rows={2} />
            ) : reviewRows.length === 0 ? (
              <EmptyState title="No reviews yet">Be the first couple to leave feedback.</EmptyState>
            ) : (
              reviewRows.map((review) => (
                <Card key={review.id} style={{ gap: space(1) }}>
                  <Caption>
                    <Star size={12} color={rgb(theme.brand)} weight="fill" /> {review.rating}/5
                  </Caption>
                  <Caption>{review.comment || 'No written comment.'}</Caption>
                </Card>
              ))
            )
          ) : null}

          {tab === 'packages' ? (
            services.isPending ? (
              <Loading rows={2} />
            ) : serviceRows.length === 0 ? (
              <EmptyState title="No packages listed">Ask the vendor when you request a booking.</EmptyState>
            ) : (
              serviceRows.map((service) => (
                <Card key={service.id} style={{ gap: space(2) }}>
                  <Body style={{ fontWeight: '700' }}>{serviceName(service)}</Body>
                  {service.description || service.definition?.description ? (
                    <Caption>{service.description || service.definition?.description}</Caption>
                  ) : null}
                  {(service.offerings ?? []).map((offering) => (
                    <View
                      key={offering.id}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: space(2),
                      }}
                    >
                      <Caption style={{ flex: 1 }}>{offering.name}</Caption>
                      <Caption tone="brand">
                        {offering.price ? money(offering.price, offering.currency) : 'On request'}
                      </Caption>
                    </View>
                  ))}
                </Card>
              ))
            )
          ) : null}

        </View>
      </ScrollView>

      {(
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: space(3),
            flexDirection: 'row',
            gap: space(2),
            backgroundColor: rgb(theme.surface),
          }}
        >
          <Button
            label="Chat"
            variant="outline"
            onPress={() => {
              if (existing) {
                router.push({ pathname: '/plan/bookings', params: { highlight: existing.id } });
                return;
              }
              setError('');
              setNotice(
                'Messages with a vendor open on your booking. Send a booking request and you can chat with them from Bookings.',
              );
            }}
            style={{ flex: 1 }}
          />
          <Button
            label="Request Booking"
            // Check Availability & Request is its own screen (row 14).
            onPress={() => {
              setNotice('');
              setError('');
              router.push({
                pathname: '/vendors/[id]/request',
                params: { id: vendor.id, ...(eventId ? { eventId } : {}) },
              });
            }}
            style={{ flex: 1.5 }}
          />
        </View>
      )}
    </View>
  );
}
