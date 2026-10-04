import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { SELLER_STATUS_LABEL } from '@/lib/bookings';
import { BOOKING_STATUS_LABEL } from '@/shared/permissions';
import { useCategoryNames } from '@/components/business/category-picker';
import { Divider } from '@/components/chrome';
import { Body, Caption, Card, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

export interface PlacedBooking {
  bookingId: string;
  clientUserId: string;
  clientName: string;
  name: string;
  /** The listing's first category, or the provider type when there is no listing. */
  category: string;
  /** Every category the listing is under, when the server returns them. */
  categories?: string[] | null;
  service: string | null;
  package: string | null;
  status: string;
  paymentStatus: string | null;
  amount: string;
  currency: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  guests: number | null;
  expectedBudget: string | null;
  requirements: string | null;
  createdAt: string;
}

export function usePlacedForClients(enabled = true) {
  return useQuery({
    queryKey: ['planner-bookings-placed'],
    queryFn: async () => (await api.get('/planner/bookings-placed')).data as PlacedBooking[],
    enabled,
    retry: false,
    refetchInterval: 30_000,
  });
}

const statusLabel = (status: string) =>
  BOOKING_STATUS_LABEL[status] ?? SELLER_STATUS_LABEL[status] ?? status.replace(/_/g, ' ');

/**
 * One vendor booking a planner placed for a client, with everything it was
 * placed with: the day, the place, the head count, the budget and the brief.
 * Shared by the list and the couple's booking detail, as on the web.
 */
export function PlacedBookingFacts({ booking: b }: { booking: PlacedBooking }) {
  const categoryNames = useCategoryNames();
  const place = [b.venue, b.city].filter(Boolean).join(', ');
  /*
   * The server falls back to the provider type when a booking has no vendor
   * listing behind it, so `category` can be the word "planner" or "vendor".
   * That is not a category: a planner is said as planning, and a bare "vendor"
   * is left out rather than printed as though it described the service.
   */
  const categories =
    b.category === 'planner'
      ? ['Wedding planning']
      : b.category === 'vendor'
        ? []
        : categoryNames(b.categories && b.categories.length > 0 ? b.categories : [b.category]);
  return (
    <View style={{ gap: space(0.5) }}>
      <Body numberOfLines={2}>{`${b.name} · for ${b.clientName}`}</Body>
      <Caption tone="faint" numberOfLines={2}>
        {[categories.join(', '), b.service, b.package].filter(Boolean).join(' · ')}
      </Caption>
      <Caption>
        {[
          b.eventDate ? shortDate(b.eventDate) : 'Date not set',
          place || 'Venue not given',
          b.guests ? `${b.guests} guests` : null,
          b.expectedBudget && Number(b.expectedBudget) > 0
            ? `budget ${money(b.expectedBudget, b.currency)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Caption>
      {b.requirements ? <Caption tone="muted">{`“${b.requirements}”`}</Caption> : null}
      <Caption tone="faint">
        {[
          Number(b.amount) > 0
            ? money(b.amount, b.currency)
            : b.status === 'quotation_sent'
              ? 'Quotation with the couple'
              : 'Awaiting a quotation',
          statusLabel(b.status),
          `asked ${shortDate(b.createdAt)}`,
        ].join(' · ')}
      </Caption>
    </View>
  );
}

/**
 * The vendors a planner has asked on their clients' behalf (EZ1-I235).
 *
 * Those bookings belong to the couples, so the queue below — the work coming
 * in against the planner's own agency — never contained them, and a planner who
 * had just booked a vendor could not see which one. The same list the web
 * Bookings page shows.
 */
export function PlacedForClients() {
  const { data, isPending, isError } = usePlacedForClients();
  if (isPending) return null;

  return (
    <Card>
      <SectionTitle>Booked for your clients</SectionTitle>
      <Caption tone="faint">
        Vendors you asked on a couple’s behalf. The booking is theirs; the couple sees it too.
      </Caption>
      {isError ? (
        <Caption tone="muted">These bookings could not be loaded.</Caption>
      ) : !data || data.length === 0 ? (
        <Caption tone="muted">
          Nothing yet. Requests you place for a client from the Vendors page appear here.
        </Caption>
      ) : (
        data.map((b, index) => (
          <View key={b.bookingId} style={{ gap: space(1) }}>
            {index > 0 ? <Divider /> : null}
            <PlacedBookingFacts booking={b} />
          </View>
        ))
      )}
    </Card>
  );
}
