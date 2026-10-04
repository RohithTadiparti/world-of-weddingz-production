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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Heart, MapPin, SealCheck, ShareNetwork, Star } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { hhmm, money, rupees } from '@/lib/format';
import { loadVendorShortlist, toggleVendorShortlist } from '@/lib/plan-shortlist';
import { cleanAnswers, validateAnswers, type Answers, type FieldSpec } from '@/shared/dynamic-form';
import { WowCalendar } from '@/components/common/WowCalendar';
import { DynamicForm } from '@/components/dynamic-form';
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
  Field,
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

type Slot = { id: string; startTime: string; endTime: string; remaining: number };

type Review = {
  id: string;
  rating: number;
  comment?: string | null;
};

export default function VendorDetail() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId?: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState(false);
  const [eventDate, setEventDate] = useState('');
  const [budget, setBudget] = useState('');
  const [requirements, setRequirements] = useState('');
  const [vendorServiceId, setVendorServiceId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
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
  const bookableServices = serviceRows.filter((s) => s.bookable !== false);
  const selectedService = serviceRows.find((s) => s.id === vendorServiceId);
  // The server answers the form's event date from the slot or chosen date.
  const formFields = (selectedService?.bookingForm ?? []).filter(
    (f) => !(eventDate && f.key === 'event_date'),
  );

  useEffect(() => {
    if (bookableServices.length === 1 && !vendorServiceId) {
      setVendorServiceId(bookableServices[0].id);
    }
  }, [bookableServices, vendorServiceId]);

  const availability = useQuery({
    queryKey: ['vendor-availability', id, eventDate, vendorServiceId],
    queryFn: async () =>
      (
        await api.get(`/vendors/${id}/availability`, {
          params: { from: eventDate, to: eventDate, vendorServiceId: vendorServiceId || undefined },
        })
      ).data as Slot[],
    enabled: Boolean(id && eventDate && requesting),
    retry: false,
  });

  const request = useMutation({
    mutationFn: async () => {
      const serviceAnswers = cleanAnswers(formFields, answers);
      const response = await api.post('/bookings', {
        providerType: 'vendor',
        providerId: id,
        ...(eventDate ? { eventDate } : {}),
        ...(eventId ? { eventId } : {}),
        ...(vendorServiceId ? { vendorServiceId } : {}),
        ...(slotId ? { slotId } : {}),
        ...(Object.keys(serviceAnswers).length ? { serviceAnswers } : {}),
        ...(budget ? { expectedBudget: Number(budget) } : {}),
        ...(requirements.trim() ? { requirements: requirements.trim() } : {}),
      });
      return response.data as { id: string };
    },
    onSuccess: async (data) => {
      setRequesting(false);
      setNotice('');
      setError('');
      await qc.invalidateQueries({ queryKey: ['my-bookings'] });
      await qc.invalidateQueries({ queryKey: ['wedding-dashboard'] });
      await qc.invalidateQueries({ queryKey: ['event-workspace'] });
      router.push({ pathname: '/plan/bookings', params: { highlight: data.id } });
    },
    onError: (err) => {
      const body = (err as { response?: { status?: number; data?: Record<string, any> } }).response;
      const existingId = body?.data?.bookingId ?? body?.data?.error?.bookingId;
      if (body?.status === 409 && existingId) {
        router.push({ pathname: '/plan/bookings', params: { highlight: existingId } });
        return;
      }
      if (slotId) {
        setSlotId('');
        void qc.invalidateQueries({ queryKey: ['vendor-availability', id] });
      }
      setError(apiMessage(err, 'That request could not be sent.'));
    },
  });

  const submit = () => {
    const found = validateAnswers(formFields, answers);
    setAnswerErrors(found);
    if (Object.keys(found).length === 0) request.mutate();
  };

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

          {requesting ? (
            <Card style={{ gap: space(3) }}>
              <SectionTitle>Request Booking</SectionTitle>
              {services.isPending ? (
                <Loading rows={1} />
              ) : services.error ? (
                <Caption tone="critical">
                  {apiMessage(services.error, 'Services could not be loaded.')}
                </Caption>
              ) : serviceRows.length > 0 && bookableServices.length === 0 ? (
                <Caption tone="muted">
                  None of this vendor&apos;s services can be booked right now.
                </Caption>
              ) : bookableServices.length > 0 ? (
                <View style={{ gap: space(1) }}>
                  <Caption style={{ fontWeight: '600' }}>Service</Caption>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                    {bookableServices.map((s) => {
                      const active = vendorServiceId === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => {
                            setVendorServiceId(s.id);
                            setSlotId('');
                            setAnswers({});
                            setAnswerErrors({});
                          }}
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
                            }}
                          >
                            {serviceName(s)}
                          </Caption>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              <WowCalendar
                label="Event date"
                value={eventDate}
                onChange={(date) => {
                  setEventDate(date);
                  setSlotId('');
                }}
                minimumDate={new Date().toISOString().slice(0, 10)}
              />
              {eventDate && availability.isFetching ? (
                <Loading rows={1} />
              ) : eventDate && availability.error ? (
                <Caption tone="critical">
                  {apiMessage(availability.error, 'Availability could not be loaded.')}
                </Caption>
              ) : eventDate && availability.data && availability.data.length > 0 ? (
                <View style={{ gap: space(1) }}>
                  <Caption style={{ fontWeight: '600' }}>Available slots</Caption>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                    {availability.data.map((slot) => {
                      const active = slotId === slot.id;
                      return (
                        <Pressable
                          key={slot.id}
                          onPress={() => setSlotId(slot.id)}
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
                            }}
                          >
                            {hhmm(slot.startTime)} – {hhmm(slot.endTime)} · {slot.remaining} left
                          </Caption>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : eventDate && availability.data && availability.data.length === 0 ? (
                <Caption tone="muted">
                  No slots published for this date. You can still send a request.
                </Caption>
              ) : null}
              <DynamicForm
                fields={formFields}
                answers={answers}
                errors={answerErrors}
                onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
              />
              <Field
                label="Budget (optional)"
                value={budget}
                onChangeText={setBudget}
                keyboardType="number-pad"
              />
              <Field
                label="Notes"
                value={requirements}
                onChangeText={setRequirements}
                placeholder="Tell them briefly what you need"
              />
              <Button
                label="Send request"
                busy={request.isPending}
                disabled={
                  request.isPending ||
                  services.isPending ||
                  (bookableServices.length > 0 && !vendorServiceId) ||
                  (Boolean(eventDate) && availability.isFetching) ||
                  (Boolean(availability.data?.length) && !slotId)
                }
                onPress={submit}
              />
              <Button label="Cancel" variant="outline" onPress={() => setRequesting(false)} />
            </Card>
          ) : null}
        </View>
      </ScrollView>

      {!requesting ? (
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
            onPress={() => {
              setRequesting(true);
              setNotice('');
              setError('');
            }}
            style={{ flex: 1.5 }}
          />
        </View>
      ) : null}
    </View>
  );
}
