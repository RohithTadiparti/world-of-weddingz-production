import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { PlannerListing } from '@/lib/planner-listing';
import { formatDate } from '@/shared/dates';
import { Badge, SectionHeader, StatTile, TileGrid } from '@/components/chrome';
import { Body, Button, Caption, Card, Loading, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * A wedding planner's half of Home (EZ1-I39, EZ1-I184).
 *
 * A planner is a provider who is not a vendor, and their home opens onto the
 * weddings they were hired to run rather than onto a shop window. The figures
 * come off `/planner/overview` and the list off `/planner/clients` — the same
 * two reads the web dashboard is built from, so a wedding on this screen can
 * never sit beside a zero count.
 *
 * The bookings, money and recent-work cards that follow are the provider home's
 * own, because a planner's incoming queue and escrow are read exactly the way a
 * vendor's are.
 */
interface Overview {
  weddings: number;
  active: number;
  upcoming: number;
  completed: number;
  clients: number;
  bookings: { total: number; confirmed: number; pending: number };
  escrowHeld: string;
  tasks: { total: number; done: number; overdue: number };
  currency: string;
}

interface ClientBook {
  clients: {
    userId: string;
    planId: string;
    name: string;
    status: string;
    weddingDate: string | null;
    location: string | null;
  }[];
  requests: unknown[];
}

/** The agency card, where a vendor has their business card. */
export function PlannerAgencyCard({
  listing,
  loading,
}: {
  listing: PlannerListing | null;
  loading: boolean;
}) {
  const router = useRouter();

  if (loading) return <Loading rows={1} />;

  // Signing up made an account; the listing is what couples find, and nothing
  // said it had not been written.
  if (!listing) {
    return (
      <Card>
        <SectionTitle>Your agency is not listed yet</SectionTitle>
        <Body tone="muted">
          Couples find planners through the listing. Once it is written it goes to an administrator
          for review.
        </Body>
        <Button label="Create your listing" onPress={() => router.push('/business-details')} />
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <SectionTitle style={{ flex: 1 }} numberOfLines={2}>
          {listing.agencyName}
        </SectionTitle>
        <Badge tone={listing.isApproved ? 'positive' : 'caution'}>
          {listing.isApproved ? 'Live in search' : 'Awaiting review'}
        </Badge>
      </View>
      {listing.city ? <Caption tone="faint">{listing.city}</Caption> : null}
    </Card>
  );
}

/** The book at a glance: how many weddings, what is waiting, what is coming. */
export function PlannerBook() {
  const router = useRouter();
  const live = { retry: false, refetchOnMount: 'always' as const, refetchInterval: 30_000 };

  const overview = useQuery({
    queryKey: ['planner-overview'],
    queryFn: async () => (await api.get('/planner/overview')).data as Overview,
    ...live,
  });

  const book = useQuery({
    queryKey: ['planner-clients-summary'],
    queryFn: async () => (await api.get('/planner/clients')).data as ClientBook,
    ...live,
  });

  const o = overview.data;
  const requests = book.data?.requests?.length ?? 0;
  // The next few weddings by date, so the card leads with what is coming rather
  // than only how many there are (EZ1-I52). A wedding that has happened is not
  // coming.
  const upcoming = (book.data?.clients ?? [])
    .filter((client) => client.weddingDate && client.status !== 'completed')
    .sort((a, b) => (a.weddingDate ?? '').localeCompare(b.weddingDate ?? ''))
    .slice(0, 4);

  return (
    <View style={{ gap: space(4) }}>
      <View style={{ gap: space(2) }}>
        <SectionHeader title="Your weddings" />
        {overview.isLoading ? (
          <Loading rows={2} />
        ) : (
          <TileGrid>
            <StatTile
              label="Weddings"
              value={o?.weddings}
              hint={o ? `${o.clients} client${o.clients === 1 ? '' : 's'}` : undefined}
            />
            <StatTile label="Active" value={o?.active} hint="Planning under way" />
            <StatTile label="Upcoming" value={o?.upcoming} hint="Not started yet" />
            <StatTile
              label="Requests waiting"
              value={book.isLoading ? undefined : requests}
              tone={requests > 0 ? 'caution' : undefined}
              hint={requests > 0 ? 'Couples waiting on your answer' : undefined}
              // The planner's own queue, with the brief each couple sent, rather
              // than the generic bookings list the vendor works from.
              onPress={() => router.push('/planner-requests')}
            />
            <StatTile
              label="Vendor bookings"
              value={o?.bookings.total}
              hint={o ? `${o.bookings.confirmed} confirmed · ${o.bookings.pending} pending` : undefined}
            />
            <StatTile
              label="Overdue tasks"
              value={o?.tasks.overdue}
              tone={(o?.tasks.overdue ?? 0) > 0 ? 'critical' : undefined}
              hint={o ? `${o.tasks.done} of ${o.tasks.total} done` : undefined}
            />
            <StatTile
              label="Escrow held"
              value={o ? money(o.escrowHeld, o.currency) : undefined}
              hint="Yours once the work is signed off"
              onPress={() => router.push('/accounts')}
            />
          </TileGrid>
        )}
      </View>

      <Card>
        <SectionTitle>Coming up</SectionTitle>
        {book.isLoading ? (
          <Loading rows={2} />
        ) : upcoming.length === 0 ? (
          <Caption tone="faint">No dated weddings on your book yet.</Caption>
        ) : (
          upcoming.map((client) => (
            <View
              key={client.planId}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}
            >
              <View style={{ flex: 1, gap: space(0.5) }}>
                <Body numberOfLines={1}>{client.name}</Body>
                {client.location ? (
                  <Caption tone="faint" numberOfLines={1}>
                    {client.location}
                  </Caption>
                ) : null}
              </View>
              <Caption tone="faint">{formatDate(client.weddingDate)}</Caption>
            </View>
          ))
        )}
        <Button
          label="Open My Weddings"
          variant="outline"
          onPress={() => router.push('/planner-clients')}
        />
      </Card>
    </View>
  );
}
