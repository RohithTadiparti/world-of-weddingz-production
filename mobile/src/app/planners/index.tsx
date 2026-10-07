import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, MagnifyingGlass, MapPin, SlidersHorizontal, Star } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { loadPlannerShortlist, togglePlannerShortlist } from '@/lib/plan-shortlist';
import { ViewInstagramButton, type SocialLinks } from '@/components/social-links';
import {
  Alert,
  Body,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
} from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type Planner = {
  id: string;
  agencyName: string;
  city?: string;
  bio?: string;
  yearsExperience: number;
  ratingAvg: number;
  ratingCount: number;
  portfolio?: string[];
  packages?: { name: string; price: number }[];
} & SocialLinks;

export default function HirePlanner() {
  const theme = useTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(false);
  const [city, setCity] = useState('');
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadPlannerShortlist().then(setShortlist);
  }, []);

  const query = useQuery({
    queryKey: ['planners', city],
    queryFn: async () =>
      (
        await api.get('/wedding-planners/search', {
          params: {
            city: city || undefined,
            // The API has no name search, so the box below filters this page: take the most it gives.
            limit: 100,
          },
        })
      ).data as { data?: Planner[] } | Planner[],
    retry: false,
  });

  const planners: Planner[] = Array.isArray(query.data)
    ? query.data
    : (query.data?.data ?? []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return planners;
    return planners.filter((p) => p.agencyName.toLowerCase().includes(q));
  }, [planners, search]);

  return (
    <Screen>
      <PageSubtitle>Find an expert to run the wedding day by day.</PageSubtitle>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.md,
          paddingLeft: space(3),
          borderWidth: 1,
          borderColor: rgb(theme.border),
        }}
      >
        <MagnifyingGlass size={18} color={rgb(theme.brand)} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search planners..."
          placeholderTextColor={rgb(theme.ink[400])}
          style={{ flex: 1, padding: space(3), color: rgb(theme.ink[900]) }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={filters ? 'Hide filters' : 'Show filters'}
          onPress={() => setFilters((open) => !open)}
          style={{
            marginRight: space(1),
            padding: space(2),
            borderRadius: radius.md,
            backgroundColor: rgb(theme.brand),
          }}
        >
          <SlidersHorizontal size={18} color={rgb(theme.brandFg)} />
        </Pressable>
      </View>

      {filters ? (
        <Card>
          <Caption>City</Caption>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Any city"
            placeholderTextColor={rgb(theme.ink[400])}
            style={{ paddingVertical: space(2), color: rgb(theme.ink[900]) }}
          />
        </Card>
      ) : null}

      {query.isPending ? (
        <Loading rows={3} />
      ) : query.error ? (
        <Alert tone="critical">{apiMessage(query.error, 'Planners could not be loaded.')}</Alert>
      ) : filtered.length === 0 ? (
        <EmptyState title="No planners found">Try another city or search term.</EmptyState>
      ) : (
        filtered.map((planner) => {
          const saved = shortlist.has(planner.id);
          const photo = planner.portfolio?.[0];
          const price = planner.packages?.length
            ? Math.min(...planner.packages.map((p) => p.price).filter(Number.isFinite))
            : null;
          const openPlanner = () =>
            router.push({ pathname: '/planners/[id]', params: { id: planner.id } });
          return (
            <Card key={planner.id} style={{ gap: space(2), padding: space(2), borderRadius: radius.md }}>
              {/* The photo and the details both open the planner; only the details
                  are announced, so a screen reader hears one link per card. */}
              <Pressable onPress={openPlanner} accessible={false}>
                {photo ? (
                  <Image
                    source={{ uri: photo }}
                    style={{ width: '100%', height: 140, borderRadius: radius.md }}
                  />
                ) : (
                  <View
                    style={{
                      width: '100%',
                      height: 140,
                      borderRadius: radius.md,
                      backgroundColor: rgb(theme.surfaceSunken),
                    }}
                  />
                )}
              </Pressable>
              <View style={{ flexDirection: 'row', gap: space(2), paddingHorizontal: space(1) }}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${planner.agencyName}: view profile and availability`}
                  onPress={openPlanner}
                  style={{ flex: 1, gap: 3 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Body style={{ fontWeight: '700' }}>{planner.agencyName}</Body>
                  </View>
                  <Caption>
                    <Star size={12} color={rgb(theme.brand)} weight="fill" />{' '}
                    {Number(planner.ratingAvg).toFixed(1)} ({planner.ratingCount}) · Wedding Planner
                  </Caption>
                  <Caption tone="faint">
                    <MapPin size={12} color={rgb(theme.ink[400])} />{' '}
                    {planner.city || 'Location on request'}
                    {planner.yearsExperience
                      ? ` · ${planner.yearsExperience} yrs`
                      : ''}
                  </Caption>
                  {price !== null && Number.isFinite(price) ? (
                    <Caption tone="brand">From ₹{price.toLocaleString('en-IN')}</Caption>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={saved ? 'Remove from shortlist' : 'Add to shortlist'}
                  hitSlop={8}
                  onPress={() => void togglePlannerShortlist(planner.id).then(setShortlist)}
                >
                  <Heart
                    size={22}
                    weight={saved ? 'fill' : 'regular'}
                    color={rgb(theme.brand)}
                  />
                </Pressable>
              </View>
              {/* A sibling of the card's Pressables, so it opens Instagram, not the planner. */}
              <ViewInstagramButton listing={planner} style={{ marginHorizontal: space(1) }} />
            </Card>
          );
        })
      )}
    </Screen>
  );
}
