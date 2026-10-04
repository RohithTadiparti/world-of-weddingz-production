import { In, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { BookingStatus, ProviderType } from '../../common/enums';
import { WeddingFacts, dateOf, venueOf } from './booking-venue';

export interface WeddingFactsRows {
  plans: { userId: string; weddingDate: string | null }[];
  events: {
    userId: string;
    name: string;
    eventDate: string | null;
    venue: string | null;
    city: string | null;
    expectedGuests: number | null;
  }[];
  /** Live vendor bookings for the accounts involved. */
  bookings: {
    userId: string;
    providerId: string;
    eventDate: string | null;
    serviceAnswers: Record<string, unknown> | null;
  }[];
  vendors: { id: string; name: string; city: string | null; categories: string[] | null }[];
}

/**
 * What each couple's wedding already says about when and where it is: their
 * plan's date, their functions, and the vendors they have booked with the
 * place each is held.
 *
 * A match-fixed couple share one wedding (EZ1-I160), so the partner's plan,
 * functions and bookings count as the couple's too — `partnerOf` maps an
 * account to its partner's. The account's own plan date wins over the
 * partner's, because it is the one they typed.
 */
export function assembleWeddingFacts(
  userIds: string[],
  partnerOf: Map<string, string>,
  rows: WeddingFactsRows,
): Map<string, WeddingFacts> {
  const vendorById = new Map(rows.vendors.map((v) => [v.id, v]));
  const facts = new Map<string, WeddingFacts>();

  for (const userId of userIds) {
    const partner = partnerOf.get(userId);
    const accounts = new Set(partner ? [userId, partner] : [userId]);
    const planDate = (id: string | undefined) =>
      id ? (rows.plans.find((p) => p.userId === id && p.weddingDate)?.weddingDate ?? null) : null;

    facts.set(userId, {
      weddingDate: planDate(userId) ?? planDate(partner),
      events: rows.events
        .filter((e) => accounts.has(e.userId))
        .map((e) => ({
          name: e.name,
          eventDate: e.eventDate ?? null,
          venue: e.venue ?? null,
          city: e.city ?? null,
          expectedGuests: e.expectedGuests ?? null,
        })),
      vendorBookings: rows.bookings
        .filter((b) => accounts.has(b.userId))
        .map((b) => {
          const vendor = vendorById.get(b.providerId);
          const isVenue = Boolean(vendor?.categories?.includes('venue'));
          const place = venueOf({
            answers: b.serviceAnswers,
            providerName: vendor?.name,
            providerCity: vendor?.city,
            providerIsVenue: isVenue,
          });
          return {
            eventDate: b.eventDate ?? dateOf(b.serviceAnswers),
            venue: place.venue,
            city: place.city,
            isVenue,
          };
        }),
    });
  }
  return facts;
}

export interface WeddingFactsRepositories {
  plans: Repository<WeddingPlan>;
  events: Repository<WeddingEvent>;
  bookings: Repository<Booking>;
  vendors: Repository<Vendor>;
}

/**
 * The wedding facts for a set of couples, read in four queries whatever the
 * number of couples, and none when there are none.
 */
export async function loadWeddingFacts(
  repos: WeddingFactsRepositories,
  userIds: string[],
  partnerOf: Map<string, string> = new Map(),
): Promise<Map<string, WeddingFacts>> {
  if (userIds.length === 0) return new Map();
  const accounts = [...new Set([...userIds, ...partnerOf.values()])];

  const [plans, events, bookings] = await Promise.all([
    repos.plans.find({ where: { userId: In(accounts) } }),
    repos.events.find({ where: { userId: In(accounts) } }),
    repos.bookings.find({
      where: {
        userId: In(accounts),
        providerType: ProviderType.VENDOR,
        status: Not(BookingStatus.CANCELLED),
      },
    }),
  ]);
  const vendorIds = [...new Set(bookings.map((b) => b.providerId))];
  const vendors = vendorIds.length
    ? await repos.vendors.find({ where: { id: In(vendorIds) } })
    : [];

  return assembleWeddingFacts(userIds, partnerOf, { plans, events, bookings, vendors });
}
