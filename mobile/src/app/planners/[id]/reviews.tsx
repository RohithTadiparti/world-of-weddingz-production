import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { apiMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { Body, Caption, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { usePlannerProfile, usePlannerReviews } from '@/components/planner/data';
import { Stars } from '@/components/planner/parts';
import { rgb, space, useTheme } from '@/theme';
import { Txt } from '@/theme/fonts';

/**
 * What couples wrote about a planner, newest as the server sends them.
 *
 * Deliberately plain: the average, the count, then each review. The rating
 * breakdown and category scores the summary endpoint also returns are left
 * out; a couple deciding wants to read what people said, not a dashboard.
 */
export default function PlannerReviewsScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const planner = usePlannerProfile(id);
  const reviews = usePlannerReviews(id);

  const avg = Number(planner.data?.ratingAvg ?? 0);
  const count = planner.data?.ratingCount ?? reviews.data?.length ?? 0;

  return (
    <Screen>
      {planner.data ? (
        <Card style={{ padding: space(4), flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <Txt serif style={{ fontSize: 44, lineHeight: 48, color: rgb(theme.brand) }}>
            {avg.toFixed(1)}
          </Txt>
          <View style={{ flex: 1, gap: space(1) }}>
            <Body style={{ fontWeight: '600' }} numberOfLines={1}>
              {planner.data.agencyName}
            </Body>
            <Stars value={avg} size={16} />
            <Caption>
              {count} client {count === 1 ? 'review' : 'reviews'}
            </Caption>
          </View>
        </Card>
      ) : null}

      {reviews.isPending ? (
        <Loading rows={3} />
      ) : reviews.error ? (
        <EmptyState title="Reviews unavailable">
          {apiMessage(reviews.error, 'Please try again shortly.')}
        </EmptyState>
      ) : (reviews.data ?? []).length === 0 ? (
        <EmptyState title="No reviews yet">
          Couples review a planner once their wedding is done.
        </EmptyState>
      ) : (
        (reviews.data ?? []).map((review) => (
          <Card key={review.id} style={{ padding: space(4), gap: space(2) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <Stars value={review.rating} />
              <Caption style={{ flex: 1 }}>{review.rating}/5</Caption>
              {review.createdAt ? <Caption tone="faint">{shortDate(review.createdAt)}</Caption> : null}
            </View>
            <Body tone={review.comment ? 'default' : 'faint'}>
              {review.comment || 'No written comment.'}
            </Body>
          </Card>
        ))
      )}
    </Screen>
  );
}
