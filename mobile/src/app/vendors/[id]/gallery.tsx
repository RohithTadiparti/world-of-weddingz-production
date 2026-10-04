import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { EmptyState, Loading, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

export default function VendorGallery() {
  const theme = useTheme(); const router = useRouter(); const { width } = useWindowDimensions(); const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({ queryKey: ['vendor', id], queryFn: async () => (await api.get(`/vendors/${id}`)).data as { portfolio: string[] }, enabled: Boolean(id), retry: false });
  if (query.isPending) return <View style={{ flex: 1, padding: space(4) }}><Loading rows={4} /></View>;
  if (query.error || !query.data) return <View style={{ flex: 1, padding: space(4) }}><EmptyState title="Gallery unavailable">{apiMessage(query.error, 'Please try again shortly.')}</EmptyState></View>;
  const size = (width - space(10)) / 3;
  return <ScrollView style={{ flex: 1, backgroundColor: rgb(theme.canvas) }} contentContainerStyle={{ padding: space(4), gap: space(3) }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}><Pressable onPress={() => router.back()}><ArrowLeft size={21} color={rgb(theme.ink[800])} /></Pressable><SectionTitle>Photos</SectionTitle></View><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>{query.data.portfolio.map((photo) => <Image key={photo} source={{ uri: photo }} style={{ width: size, height: size, borderRadius: radius.md }} />)}</View></ScrollView>;
}
