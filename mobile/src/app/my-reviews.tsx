import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { isPlannerAccount, usePlannerListing } from '@/lib/planner-listing';
import { BusinessSwitcher } from '@/components/business/switcher';
import {
  Body,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
} from '@/components/ui';
import { selectPermissions, useAuth } from '@/store/auth';
import { useBusinesses } from '@/store/business';
import { rgb, space, useTheme } from '@/theme';

/**
 * A provider's own reviews (EZ1-I103), on a phone.
 *
 * A vendor's are per business, behind the switcher. A planner has one listing
 * and reads theirs from `/wedding-planners/:id/reviews/mine`, which carries the
 * day each reviewed booking was for.
 *
 * Each one shows the service, the package and the booking it is about, its
 * rating, its comment and its date. The reviewer is never named — a vendor who
 * could work out which customer left three stars could take it up with them,
 * and the prospect of that conversation is what stops the next honest review
 * being written.
 */
interface OwnerReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  bookingId: string | null;
  /** A vendor's review names the service and package; a planner's does not. */
  serviceName?: string | null;
  offeringName?: string | null;
  /** The day the reviewed booking was for, when the server returns it. */
  eventDate?: string | null;
}

export default function MyReviews() {
  const { activeId } = useBusinesses();
  const permissions = useAuth(selectPermissions);
  // A planner has no business to switch between: their reviews hang off the one
  // planner listing, and the vendor read answered them with nothing.
  const isPlanner = isPlannerAccount(permissions);
  const planner = usePlannerListing(isPlanner);
  const listingId = isPlanner ? (planner.data?.id ?? null) : activeId;

  const { data, isPending } = useQuery({
    queryKey: ['my-reviews', isPlanner ? 'planner' : 'vendor', listingId],
    enabled: Boolean(listingId),
    queryFn: async () => {
      if (isPlanner) {
        // The owner's read: the reviews, with the event each is about, and a
        // rating summary beside them.
        const body = (await api.get(`/wedding-planners/${listingId}/reviews/mine`)).data as {
          reviews: OwnerReview[];
        };
        return body.reviews;
      }
      return (await api.get(`/vendors/${listingId}/reviews/mine`)).data as OwnerReview[];
    },
    retry: false,
  });

  const reviews = data ?? [];

  return (
    <Screen>
      <PageSubtitle>
        What customers said after a completed booking. Names are left out, and you cannot edit or
        remove a review — if one breaks the rules, raise it on Support.
      </PageSubtitle>

      {isPlanner ? null : <BusinessSwitcher />}

      {isPlanner && planner.isLoading ? (
        <Loading rows={3} />
      ) : !listingId ? (
        <Card>
          <Caption tone="faint">
            {isPlanner
              ? 'Write your listing first. Reviews arrive against it once couples have completed a booking with you.'
              : 'Pick a business above to see its reviews.'}
          </Caption>
        </Card>
      ) : isPending ? (
        <Loading rows={3} />
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews yet">
          A review can only be written after a booking is completed, so these arrive with the work.
        </EmptyState>
      ) : (
        reviews.map((review) => (
          <Card key={review.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <Stars rating={review.rating} />
              <Caption tone="faint" style={{ flex: 1, textAlign: 'right' }}>
                {shortDate(review.createdAt)}
              </Caption>
            </View>
            <Caption tone="faint">
              {[
                review.serviceName ? `Service: ${review.serviceName}` : null,
                review.offeringName ? `Package: ${review.offeringName}` : null,
                // The day it was about, rather than a truncated booking id
                // nobody can match to a wedding.
                review.eventDate ? `Event ${shortDate(review.eventDate)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Caption>
            {review.comment ? (
              <Body tone="muted">{review.comment}</Body>
            ) : (
              <Caption tone="faint">Rated, with nothing written.</Caption>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

function Stars({ rating }: { rating: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`${rating} out of 5`}
      style={{ flexDirection: 'row', gap: space(0.5) }}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={15}
          weight={star <= rating ? 'fill' : 'regular'}
          color={rgb(star <= rating ? theme.cautionFg : theme.ink[300])}
        />
      ))}
    </View>
  );
}
