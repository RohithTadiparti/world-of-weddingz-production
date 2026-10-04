import { View } from 'react-native';

import { Badge } from '@/components/chrome';
import { Caption } from '@/components/ui';
import { plannerServiceLabel } from '@/shared/planner-profile';
import { space } from '@/theme';

/**
 * The services a couple ticked when they asked a planner, as chips.
 *
 * Shown on both sides of the booking: the planner reads it as the brief, the
 * couple as a record of what they asked for. Renders nothing for a request
 * without any, which is every vendor booking and older planner ones.
 */
export function RequestedServices({ services }: { services?: string[] | null }) {
  if (!services || services.length === 0) return null;
  return (
    <View style={{ gap: space(1.5) }}>
      <Caption tone="faint">Requested services</Caption>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
        {services.map((key) => (
          <Badge key={key} tone="brand">
            {plannerServiceLabel(key)}
          </Badge>
        ))}
      </View>
    </View>
  );
}
