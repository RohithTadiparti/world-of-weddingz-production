import { useEffect, useState } from 'react';
import { View, Image, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Heart, MapPin, CheckCircle } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { rupees } from '@/lib/format';
import { loadVendorShortlist, toggleVendorShortlist } from '@/lib/plan-shortlist';
import {
  Alert,
  Caption,
  Card,
  Loading,
  SectionTitle,
  Body,
} from '@/components/ui';
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
  verifiedAt?: string | null;
};

export function useBudgetVendors(remainingBudget: number) {
  const query = useQuery({
    queryKey: ['vendors', 'recommended', remainingBudget],
    queryFn: async () => (await api.get('/vendors/search', { params: { limit: 20 } })).data,
    retry: false,
  });

  const vendors: Vendor[] = query.data?.data ?? [];

  const evaluate = (remaining: number) => {
    if (remaining <= 0 || vendors.length === 0) return [];
    
    // "Price on request" has no price to fit anything.
    return vendors
      .filter((v) => v.startingPrice != null && Number(v.startingPrice) <= remaining)
      .slice(0, 5);
  };

  return {
    loading: query.isPending,
    error: query.error,
    evaluate,
  };
}

export function SuggestedVendors({
  fits,
  loading,
  error,
  blocked,
}: {
  fits: Vendor[];
  loading: boolean;
  error: Error | null;
  blocked: string | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadVendorShortlist().then(setShortlist);
  }, []);

  if (blocked) {
    return (
      <View style={{ marginTop: space(4) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <SectionTitle>Recommended for You</SectionTitle>
        </View>
        <Card style={{ padding: space(4), alignItems: 'center' }}>
          <Caption tone="muted" style={{ textAlign: 'center' }}>{blocked}</Caption>
        </Card>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ marginTop: space(4) }}>
        <SectionTitle>Recommended for You</SectionTitle>
        <Loading rows={2} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ marginTop: space(4) }}>
        <SectionTitle>Recommended for You</SectionTitle>
        <Alert tone="critical">{apiMessage(error, 'Could not load vendor suggestions.')}</Alert>
      </View>
    );
  }

  if (fits.length === 0) {
    return (
      <View style={{ marginTop: space(4) }}>
        <SectionTitle>Recommended for You</SectionTitle>
        <Card style={{ padding: space(4), alignItems: 'center' }}>
          <Caption tone="muted" style={{ textAlign: 'center' }}>
            No vendors found that fit your remaining budget.
          </Caption>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ marginTop: space(4), gap: space(2) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <View>
          <SectionTitle>Recommended for You</SectionTitle>
          <Caption tone="faint">Top picks based on your budget</Caption>
        </View>
        <Pressable onPress={() => router.push('/vendors')}>
          <Caption style={{ color: rgb(theme.brand), fontWeight: '600' }}>View All {'>'}</Caption>
        </Pressable>
      </View>
      
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(3), paddingRight: space(4) }}>
        {fits.map((v) => (
          <View key={v.id} style={{ width: 240 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${v.name}, view details`}
            onPress={() => router.push({ pathname: '/vendors/[id]', params: { id: v.id } })}
          >
            <Card style={{ padding: space(0), overflow: 'hidden', gap: 0 }}>
              {v.portfolio?.[0] ? (
                <Image
                  source={{ uri: v.portfolio[0] }}
                  style={{ width: '100%', height: 140 }}
                />
              ) : (
                <View
                  style={{
                    width: '100%',
                    height: 140,
                    backgroundColor: rgb(theme.surfaceSunken),
                  }}
                />
              )}
              
              <View style={{ padding: space(3), gap: space(1) }}>
                <Body style={{ fontWeight: '700' }} numberOfLines={1}>{v.name}</Body>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MapPin size={14} color={rgb(theme.ink[400])} />
                  <Caption tone="muted">{v.city || 'Anywhere'}</Caption>
                </View>

                <Body style={{ fontWeight: '700', marginTop: space(1) }}>
                  {v.startingPrice ? `${rupees(v.startingPrice)} / event` : 'Price on request'}
                </Body>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, backgroundColor: rgb(theme.positiveBg), alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <CheckCircle size={12} color={rgb(theme.positiveFg)} weight="fill" />
                  <Caption style={{ color: rgb(theme.positiveFg), fontSize: 11, fontWeight: '600' }}>Fits within your budget</Caption>
                </View>

                <View style={{ backgroundColor: rgb(theme.brand), paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', marginTop: space(2) }}>
                  <Caption style={{ color: rgb(theme.brandFg), fontWeight: '600' }}>View Details</Caption>
                </View>
              </View>
            </Card>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shortlist.has(v.id) ? `Remove ${v.name} from shortlist` : `Shortlist ${v.name}`}
            onPress={() => void toggleVendorShortlist(v.id).then(setShortlist)}
            style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'white', padding: 6, borderRadius: 20 }}
          >
            <Heart size={16} color={rgb(theme.brand)} weight={shortlist.has(v.id) ? 'fill' : 'regular'} />
          </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
