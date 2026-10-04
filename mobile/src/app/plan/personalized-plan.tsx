import { useState } from 'react';
import { View, Image, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CaretLeft, Swap, ArrowRight } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { rupees, money } from '@/lib/format';
import { fetchWeddingDashboard } from '@/lib/wedding-plan';
import { Alert, Body, Button, Caption, Card, Loading, Screen, SectionTitle, EmptyState } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type Vendor = {
  id: string;
  name: string;
  category: string | null;
  categories?: string[];
  city?: string;
  ratingAvg: number;
  ratingCount: number;
  portfolio?: string[];
  startingPrice?: number | null;
};

const REQUIRED_SERVICES = [
  { slug: 'venue', name: 'Wedding Venue' },
  { slug: 'catering', name: 'Catering' },
  { slug: 'photography', name: 'Photography' },
  { slug: 'decor', name: 'Decoration' },
  { slug: 'makeup', name: 'Makeup' },
  { slug: 'mehendi-artist', name: 'Mehendi' },
  { slug: 'dj-music', name: 'Music / DJ' },
  { slug: 'planning', name: 'Planner' },
];

/** Cheapest listed price first; "on request" last, since it adds nothing to an estimate. */
const byPrice = (a: Vendor, b: Vendor) =>
  (a.startingPrice == null ? Infinity : Number(a.startingPrice)) -
  (b.startingPrice == null ? Infinity : Number(b.startingPrice));

export default function PersonalizedPlan() {
  const theme = useTheme();
  const router = useRouter();

  const dashboard = useQuery({ queryKey: ['wedding-dashboard'], queryFn: fetchWeddingDashboard, retry: false });
  const [swaps, setSwaps] = useState<Record<string, number>>({});
  
  const vendorsQuery = useQuery({
    queryKey: ['vendors', 'all'],
    queryFn: async () => (await api.get('/vendors/search', { params: { limit: 100 } })).data,
    retry: false,
  });

  if (dashboard.isPending || vendorsQuery.isPending) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: space(4) }}>
          <Loading rows={4} />
          <Body tone="muted">Creating your wedding plan...</Body>
          <Caption tone="faint">Finding vendors within your budget...</Caption>
        </View>
      </Screen>
    );
  }

  if (dashboard.error || vendorsQuery.error) {
    return (
      <Screen>
        <Alert tone="critical">{apiMessage(dashboard.error || vendorsQuery.error, 'Could not generate plan.')}</Alert>
      </Screen>
    );
  }

  const vendors: Vendor[] = vendorsQuery.data?.data ?? [];
  const totalBudget = dashboard.data?.budget.total ? Number(dashboard.data.budget.total) : 0;
  const committed = Number(dashboard.data?.budget.committed ?? 0);
  const availableBudget = totalBudget - committed;

  // Group vendors by category
  const grouped: Record<string, Vendor[]> = {};
  for (const req of REQUIRED_SERVICES) {
    grouped[req.slug] = vendors
      .filter((v) => (v.categories?.length ? v.categories : [v.category]).includes(req.slug))
      .sort(byPrice);
  }

  // Construct the plan based on selected swaps
  let currentTotal = 0;
  const currentPlan: { service: typeof REQUIRED_SERVICES[0], vendor: Vendor | null, alternatives: number }[] = [];

  for (const req of REQUIRED_SERVICES) {
    const list = grouped[req.slug] || [];
    if (list.length > 0) {
      const idx = swaps[req.slug] || 0;
      const selected = list[idx % list.length];
      currentPlan.push({ service: req, vendor: selected, alternatives: list.length - 1 });
      currentTotal += Number(selected.startingPrice || 0);
    }
  }

  const overBudget = currentTotal > availableBudget;
  const remaining = availableBudget - currentTotal;

  if (currentPlan.length === 0) {
    return (
      <Screen>
        <EmptyState title="No complete plan found">
          We couldn't find a complete plan within your current budget. Try increasing your budget or view individual vendor categories.
        </EmptyState>
        <Button style={{ marginTop: space(4) }} label="View All Vendors" onPress={() => router.push('/vendors')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space(4), gap: space(2) }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: space(2) }}>
          <CaretLeft size={24} color={rgb(theme.ink[900])} />
        </Pressable>
        <SectionTitle>Estimated Wedding Plan</SectionTitle>
      </View>

      <Card style={{ backgroundColor: rgb(theme.brandSoft), marginBottom: space(4), padding: space(3) }}>
        <Caption style={{ fontWeight: '600', color: rgb(theme.ink[900]) }}>Based on your overall wedding budget</Caption>
        <Body style={{ fontSize: 24, lineHeight: 30, fontWeight: '700', color: rgb(theme.brandStrong), marginTop: 4 }}>
          {money(totalBudget)}
        </Body>
        {committed > 0 && (
          <Caption tone="muted" style={{ marginTop: space(1) }}>Available (after existing bookings): {money(availableBudget)}</Caption>
        )}
      </Card>

      <SectionTitle style={{ marginBottom: space(3) }}>Suggested Wedding Services</SectionTitle>

      <View style={{ gap: space(3) }}>
        {currentPlan.map((item) => {
          if (!item.vendor) return null;
          return (
            <Card key={item.service.slug} style={{ padding: space(3) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Caption style={{ fontWeight: '700', color: rgb(theme.ink[800]) }}>{item.service.name}</Caption>
                {item.alternatives > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Change ${item.service.name}`}
                    onPress={() => setSwaps({ ...swaps, [item.service.slug]: (swaps[item.service.slug] || 0) + 1 })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: rgb(theme.surfaceSunken), paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm }}
                  >
                    <Swap size={14} color={rgb(theme.brand)} />
                    <Caption style={{ color: rgb(theme.brand), fontWeight: '600', fontSize: 11 }}>Change ({item.alternatives})</Caption>
                  </Pressable>
                )}
              </View>

              <Pressable
                onPress={() => router.push({ pathname: '/vendors/[id]', params: { id: item.vendor!.id } })}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: space(2) }}
              >
                {item.vendor.portfolio?.[0] ? (
                  <Image source={{ uri: item.vendor.portfolio[0] }} style={{ width: 48, height: 48, borderRadius: radius.sm, marginRight: space(3) }} />
                ) : (
                  <View style={{ width: 48, height: 48, borderRadius: radius.sm, marginRight: space(3), backgroundColor: rgb(theme.surfaceSunken) }} />
                )}
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }} numberOfLines={1}>{item.vendor.name}</Body>
                  <Caption tone="faint">{item.vendor.city || 'Anywhere'}</Caption>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Body style={{ fontWeight: '700', color: rgb(theme.brand) }}>
                    {item.vendor.startingPrice ? rupees(item.vendor.startingPrice) : 'On request'}
                  </Body>
                  <ArrowRight size={14} color={rgb(theme.ink[400])} style={{ marginTop: 4 }} />
                </View>
              </Pressable>
            </Card>
          );
        })}
      </View>

      <Card style={{ marginTop: space(4), marginBottom: space(6), padding: space(4), backgroundColor: rgb(theme.surface), borderWidth: 2, borderColor: overBudget ? rgb(theme.criticalFg) : rgb(theme.positiveFg) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(2) }}>
          <Body style={{ fontWeight: '700' }}>Estimated Total</Body>
          <Body style={{ fontSize: 20, fontWeight: '800' }}>{money(currentTotal)}</Body>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Caption style={{ fontWeight: '600', color: overBudget ? rgb(theme.criticalFg) : rgb(theme.positiveFg) }}>
            {overBudget ? 'Over Budget by' : 'Remaining'}
          </Caption>
          <Caption style={{ fontWeight: '700', color: overBudget ? rgb(theme.criticalFg) : rgb(theme.positiveFg) }}>
            {money(Math.abs(remaining))}
          </Caption>
        </View>
        {overBudget && (
          <Caption tone="critical" style={{ marginTop: space(2), textAlign: 'center' }}>
            Identify services where lower-priced alternatives may be available by tapping "Change".
          </Caption>
        )}
      </Card>
    </Screen>
  );
}
