import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { clockTime } from '@/lib/labels';
import { formatDate } from '@/shared/dates';
import { useCategoryNames } from '@/components/business/category-picker';
import { DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { Body, Button, Caption, Loading } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The couple's whole wedding, for the planner deciding what to quote (EZ1-I162).
 *
 * The request alone says who and when. A planner pricing the job needs the
 * shape of the wedding — every function with its guests and venue, and which
 * vendors the couple has already arranged against which day — so they can tell
 * what is left to source. The web queue carries the same brief under the same
 * button (ProviderBookings' WeddingBrief), from `GET /planner/requests/:id/brief`.
 *
 * Fetched only when opened: a planner's queue is many rows, and the brief is a
 * screen's worth each.
 */
interface BriefVendor {
  name: string;
  category: string | null;
  service: string | null;
  status: string;
  eventDate?: string | null;
}

interface RequestBrief {
  client: { name: string; userId?: string | null };
  request: {
    requirements: string | null;
    expectedBudget: string | null;
    currency: string;
    notes: string | null;
    forEvent: string | null;
  };
  wedding: {
    weddingDate: string | null;
    guestCount: number | null;
    venues: string[];
    cities: string[];
    functions: number;
  };
  requirement: {
    vendorsArranged: number;
    sourced: { category: string; count: number; services: string[] }[];
    toSource: string[];
    structuredNeed: boolean;
  };
  events: {
    id: string;
    name: string;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    venue: string | null;
    city: string | null;
    expectedGuests: number | null;
    budget: string | null;
    theme: string | null;
    specialRequirements: string | null;
    description: string | null;
    arrangedVendors: BriefVendor[];
  }[];
  otherVendors: BriefVendor[];
}

export function WeddingBrief({ bookingId }: { bookingId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const categoryNames = useCategoryNames();

  const { data, isPending, isError } = useQuery({
    queryKey: ['request-brief', bookingId],
    queryFn: async () =>
      (await api.get(`/planner/requests/${bookingId}/brief`)).data as RequestBrief,
    enabled: open,
    retry: false,
  });

  const category = (slug: string | null) => (slug ? (categoryNames([slug])[0] ?? slug) : null);
  const vendorLine = (v: BriefVendor) =>
    [v.name, v.service, category(v.category)].filter(Boolean).join(' · ');

  return (
    <View style={{ gap: space(2) }}>
      <Button
        label={open ? 'Hide wedding brief' : 'View wedding brief'}
        variant="outline"
        small
        onPress={() => setOpen((current) => !current)}
      />

      {open ? (
        <View
          style={{
            gap: space(2),
            backgroundColor: rgb(theme.surfaceSunken),
            borderRadius: radius.sm,
            padding: space(3),
          }}
        >
          {isPending ? (
            <Loading rows={2} />
          ) : isError || !data ? (
            <Caption tone="muted">The brief could not be loaded.</Caption>
          ) : (
            <BriefBody data={data} category={category} vendorLine={vendorLine} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function BriefBody({
  data,
  category,
  vendorLine,
}: {
  data: RequestBrief;
  category: (slug: string | null) => string | null;
  vendorLine: (v: BriefVendor) => string;
}) {
  const { wedding, request, requirement } = data;
  const places = [...wedding.venues, ...wedding.cities].slice(0, 4);
  const arranged = requirement.vendorsArranged;

  return (
    <>
      <DetailGrid>
        <DetailRow label="Wedding">{formatDate(wedding.weddingDate, 'Not set')}</DetailRow>
        {wedding.guestCount ? (
          <DetailRow label="Guests">{`Up to ${wedding.guestCount}`}</DetailRow>
        ) : null}
        {places.length > 0 ? <DetailRow label="Venues">{places.join(', ')}</DetailRow> : null}
        {request.expectedBudget && Number(request.expectedBudget) > 0 ? (
          <DetailRow label="Their budget">{money(request.expectedBudget, request.currency)}</DetailRow>
        ) : null}
        {request.forEvent ? <DetailRow label="Asked for">{request.forEvent}</DetailRow> : null}
      </DetailGrid>

      {request.requirements ? (
        <Caption>
          <Caption tone="faint">What they asked for: </Caption>
          {request.requirements}
        </Caption>
      ) : null}

      <Divider />

      {/* The requirement at a glance (EZ1-I216): what the couple has secured,
          and the core categories still open — the part being quoted for. */}
      <Body style={{ fontWeight: '600' }}>Vendor requirement</Body>
      <Caption tone="faint">{`${arranged} ${arranged === 1 ? 'vendor' : 'vendors'} arranged so far`}</Caption>
      {requirement.sourced.map((s) => (
        <Caption key={s.category}>
          {`${category(s.category)} ×${s.count}${s.services.length > 0 ? ` — ${s.services.join(', ')}` : ''}`}
        </Caption>
      ))}
      {requirement.toSource.length > 0 ? (
        <Caption>
          <Caption tone="faint">Still to source: </Caption>
          {requirement.toSource.map(category).filter(Boolean).join(', ')}
        </Caption>
      ) : (
        <Caption tone="faint">Every core category has a vendor against it.</Caption>
      )}
      {!requirement.structuredNeed ? (
        <Caption tone="faint">
          Worked out from the couple&apos;s events and bookings. The request does not capture the
          categories it needs directly.
        </Caption>
      ) : null}

      <Divider />

      {data.events.length === 0 ? (
        <Caption tone="muted">The couple has not added their functions yet.</Caption>
      ) : (
        <>
          <Body style={{ fontWeight: '600' }}>{`Functions (${wedding.functions})`}</Body>
          {data.events.map((event, index) => {
            const start = clockTime(event.startTime);
            const end = clockTime(event.endTime);
            const place = [event.venue, event.city].filter(Boolean).join(', ');
            const notes = [event.theme, event.specialRequirements, event.description]
              .filter(Boolean)
              .join(' — ');
            return (
              <View key={event.id} style={{ gap: space(0.5) }}>
                {index > 0 ? <Divider /> : null}
                <Body>{event.name}</Body>
                <Caption tone="faint">
                  {[formatDate(event.date), start ? (end ? `${start}–${end}` : start) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Caption>
                <Caption>
                  {[
                    place || 'Venue not set',
                    event.expectedGuests ? `${event.expectedGuests} guests` : null,
                    event.budget && Number(event.budget) > 0
                      ? money(event.budget, request.currency)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Caption>
                {notes ? <Caption tone="muted">{notes}</Caption> : null}
                {event.arrangedVendors.length > 0 ? (
                  <Caption>
                    <Caption tone="faint">Already booked: </Caption>
                    {event.arrangedVendors.map(vendorLine).join('; ')}
                  </Caption>
                ) : (
                  <Caption tone="faint">No vendors arranged for this day yet.</Caption>
                )}
              </View>
            );
          })}
        </>
      )}

      {data.otherVendors.length > 0 ? (
        <Caption>
          <Caption tone="faint">Other vendors already booked: </Caption>
          {data.otherVendors.map(vendorLine).join('; ')}
        </Caption>
      ) : null}

      <Caption tone="faint">
        {`Ready to price this? Send quotation, below, quotes against these requirements${
          requirement.toSource.length > 0 ? ', including the categories still to source.' : '.'
        }`}
      </Caption>
    </>
  );
}
