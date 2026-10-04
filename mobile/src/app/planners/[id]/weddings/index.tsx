import { View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiMessage } from '@/lib/api';
import { EmptyState, Loading, PageSubtitle, Screen } from '@/components/ui';
import { usePlannerProfile } from '@/components/planner/data';
import { WeddingCard } from '@/components/planner/media';
import { space } from '@/theme';

/**
 * Every wedding in a planner's portfolio, two to a row. The profile shows them
 * as a strip to swipe; this is the whole set at once, for a couple who wants to
 * compare.
 */
export default function PlannerWeddingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePlannerProfile(id);

  if (query.isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen>
        <EmptyState title="Portfolio unavailable">
          {apiMessage(query.error, 'Please try again shortly.')}
        </EmptyState>
      </Screen>
    );
  }

  const weddings = query.data.weddings ?? [];
  // Screen gutter each side, and one gap between the two columns.
  const card = (width - space(8) - space(3)) / 2;

  return (
    <Screen>
      <PageSubtitle>Weddings planned by {query.data.agencyName}.</PageSubtitle>
      {weddings.length === 0 ? (
        <EmptyState title="No weddings yet">This planner has not added a wedding to their portfolio.</EmptyState>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
          {weddings.map((w) => (
            <WeddingCard
              key={w.id}
              wedding={w}
              width={card}
              onPress={() => router.push(`/planners/${query.data.id}/weddings/${w.id}`)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
