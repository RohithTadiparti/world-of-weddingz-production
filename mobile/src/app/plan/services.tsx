import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Car,
  EnvelopeSimple,
  HandsPraying,
  House,
  MusicNotes,
  PaintBrush,
  Sparkle,
  type IconProps,
} from 'phosphor-react-native';
import type { ComponentType } from 'react';

import { Body, Caption, Card, Screen } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

const SERVICES: {
  title: string;
  hint: string;
  category: string;
  icon: ComponentType<IconProps>;
}[] = [
  {
    title: 'Makeup & Styling',
    hint: 'Bridal and family makeup',
    category: 'makeup',
    icon: PaintBrush,
  },
  {
    title: 'Mehendi Artists',
    hint: 'Henna for the wedding day',
    category: 'mehendi-artist',
    icon: Sparkle,
  },
  {
    title: 'Music & Entertainment',
    hint: 'DJ, band and anchors',
    category: 'entertainment',
    icon: MusicNotes,
  },
  {
    title: 'Invitations',
    hint: 'Printed and digital invites',
    category: 'invitations',
    icon: EnvelopeSimple,
  },
  {
    title: 'Transportation',
    hint: 'Cars and guest travel',
    category: 'transportation',
    icon: Car,
  },
  {
    title: 'Priest & Rituals',
    hint: 'Ceremony and rituals',
    category: 'priest',
    icon: HandsPraying,
  },
  {
    title: 'Accommodation',
    hint: 'Guest stays nearby',
    category: 'guest-accommodation',
    icon: House,
  },
];

export default function PlanServices() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <Caption tone="muted">Browse vendors for the extras around your ceremony days.</Caption>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {SERVICES.map((service, index) => (
          <Pressable
            key={service.category}
            onPress={() =>
              router.push({
                pathname: '/vendors',
                params: { category: service.category },
              })
            }
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                paddingHorizontal: space(4),
                paddingVertical: space(3.5),
                borderBottomWidth: index === SERVICES.length - 1 ? 0 : 1,
                borderBottomColor: rgb(theme.border),
              },
              pressed && { backgroundColor: rgb(theme.surfaceSunken) },
            ]}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: rgb(theme.brandSoft),
              }}
            >
              <service.icon size={18} color={rgb(theme.brandStrong)} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontWeight: '600' }}>{service.title}</Body>
              <Caption tone="faint">{service.hint}</Caption>
            </View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
