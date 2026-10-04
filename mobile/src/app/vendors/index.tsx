import { useEffect, useState } from "react";
import { Image, Pressable, TextInput, View, ScrollView } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Heart,
  MagnifyingGlass,
  SealCheck,
  SlidersHorizontal,
  Star,
  Wallet,
  CheckCircle,
  MapPin,
} from "phosphor-react-native";

import { api, apiMessage } from "@/lib/api";
import { useCatalogCategories, useCategoryNames } from "@/components/business/category-picker";
import { rupees, money } from "@/lib/format";
import { fetchWeddingDashboard } from "@/lib/wedding-plan";
import { loadVendorShortlist, toggleVendorShortlist } from "@/lib/plan-shortlist";
import { ViewInstagramButton, type SocialLinks } from "@/components/social-links";
import {
  Alert,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
  Body
} from "@/components/ui";
import { rgb, space, useTheme, radius } from "@/theme";

type Vendor = {
  id: string;
  name: string;
  category: string | null;
  categories?: string[];
  city?: string;
  description?: string;
  ratingAvg: number;
  ratingCount: number;
  portfolio?: string[];
  startingPrice?: number | null;
  verifiedAt?: string | null;
} & SocialLinks;

type VendorPage = {
  data: Vendor[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

/** The orders `GET /vendors/search` knows (`VendorSort`). */
const SORTS = [
  { value: "recommended", label: "Recommended" },
  { value: "rating", label: "Top rated" },
  { value: "reviews", label: "Most reviewed" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "recent", label: "Newest" },
];

const RATINGS = [
  { value: 0, label: "Any rating" },
  { value: 3, label: "3+" },
  { value: 4, label: "4+" },
  { value: 4.5, label: "4.5+" },
];

const PAGE_SIZE = 20;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: space(3),
        paddingVertical: space(2),
        borderRadius: 20,
        backgroundColor: active ? rgb(theme.brandSoft) : rgb(theme.surface),
        borderWidth: 1,
        borderColor: active ? rgb(theme.brand) : rgb(theme.border),
      }}
    >
      <Caption tone={active ? "brand" : "muted"}>{label}</Caption>
    </Pressable>
  );
}

export default function Vendors() {
  const theme = useTheme();
  const router = useRouter();
  const openVendor = (id: string) => router.push({ pathname: "/vendors/[id]", params: { id } });
  const params = useLocalSearchParams();
  const initialCategory = Array.isArray(params.category) ? params.category[0] : params.category || "";
  const fromBudget = params.fromBudget === "true";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [filters, setFilters] = useState(false);
  const [city, setCity] = useState("");
  const [sort, setSort] = useState("recommended");
  const [minRating, setMinRating] = useState(0);
  const [withinBudget, setWithinBudget] = useState(false);
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadVendorShortlist().then(setShortlist);
  }, []);

  const catalog = useCatalogCategories();
  const names = useCategoryNames();

  const q = useInfiniteQuery({
    queryKey: ["vendors", category, city, search, sort, minRating],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<VendorPage>("/vendors/search", {
          params: {
            category: category || undefined,
            city: city || undefined,
            search: search || undefined,
            sort,
            minRating: minRating || undefined,
            page: pageParam,
            limit: PAGE_SIZE,
          },
        })
      ).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    retry: false,
  });

  const dashboard = useQuery({ 
    queryKey: ['wedding-dashboard'], 
    queryFn: fetchWeddingDashboard, 
    enabled: fromBudget,
    retry: false 
  });

  const loaded: Vendor[] = q.data?.pages.flatMap((p) => p.data) ?? [];
  const total = q.data?.pages[0]?.meta.total ?? 0;
  const totalBudget = dashboard.data?.budget.total ? Number(dashboard.data.budget.total) : null;
  const committed = Number(dashboard.data?.budget.committed ?? 0);
  const remaining = totalBudget === null ? 0 : Number(dashboard.data?.budget.remaining ?? 0);
  // "Price on request" is not a price that fits anything.
  const fits = (v: Vendor) => v.startingPrice != null && Number(v.startingPrice) <= remaining;
  const vendors = withinBudget ? loaded.filter(fits) : loaded;

  const categoryName = category ? names([category])[0] : "Vendors";
  const filtered = Boolean(city || (!fromBudget && category) || sort !== "recommended" || minRating);

  return (
    <Screen>
      <Stack.Screen options={{ title: fromBudget ? categoryName : "Vendors" }} />
      {!fromBudget && <PageSubtitle>Find the best vendors for your special day</PageSubtitle>}

      {fromBudget && totalBudget !== null && (
        <Card style={{ backgroundColor: rgb(theme.brandSoft), marginBottom: space(4), padding: space(3) }}>
          <View style={{ flexDirection: 'row', gap: space(3), marginBottom: space(3) }}>
            <View
              style={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: rgb(theme.surface),
                borderRadius: radius.md,
              }}
            >
              <Wallet size={20} color={rgb(theme.brand)} weight="fill" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Caption style={{ fontWeight: '600', color: rgb(theme.ink[900]) }}>Your Wedding Budget</Caption>
              <Body style={{ fontSize: 24, lineHeight: 30, fontWeight: '700', color: rgb(theme.brandStrong) }}>
                {money(totalBudget)}
              </Body>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space(4) }}>
            <Caption tone="muted">Committed <Body style={{ fontSize: 13, fontWeight: '600' }}>{money(committed)}</Body></Caption>
            <Caption tone="muted">Remaining <Body style={{ fontSize: 13, fontWeight: '600', color: remaining >= 0 ? rgb(theme.positiveFg) : rgb(theme.criticalFg) }}>{money(remaining)}</Body></Caption>
          </View>
        </Card>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), marginBottom: space(3) }}>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: rgb(theme.surface),
            borderRadius: radius.md,
            paddingLeft: space(3),
            borderWidth: 1,
            borderColor: rgb(theme.border),
          }}
        >
          <MagnifyingGlass size={18} color={rgb(theme.ink[400])} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${categoryName.toLowerCase()}...`}
            placeholderTextColor={rgb(theme.ink[400])}
            style={{ flex: 1, padding: space(3), color: rgb(theme.ink[900]) }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={filters ? "Hide filters" : "Show filters"}
          onPress={() => setFilters(!filters)}
          style={{
            padding: space(3),
            borderRadius: radius.md,
            backgroundColor: filters || filtered ? rgb(theme.brand) : rgb(theme.surface),
            borderWidth: 1,
            borderColor: filters || filtered ? rgb(theme.brand) : rgb(theme.border),
          }}
        >
          <SlidersHorizontal size={18} color={filters || filtered ? rgb(theme.brandFg) : rgb(theme.ink[700])} />
        </Pressable>
      </View>

      {filters ? (
        <Card style={{ marginBottom: space(3) }}>
          <Caption>Location</Caption>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Any city"
            placeholderTextColor={rgb(theme.ink[400])}
            style={{ paddingVertical: space(2), color: rgb(theme.ink[900]) }}
          />
          {!fromBudget && (
            <View style={{ marginTop: space(2) }}>
              <Caption>Category</Caption>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  {catalog.data?.map((item) => (
                    <Chip
                      key={item.slug}
                      label={item.name}
                      active={category === item.slug}
                      onPress={() => setCategory(category === item.slug ? "" : item.slug)}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
          <View style={{ marginTop: space(2) }}>
            <Caption>Sort by</Caption>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(2) }}>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                {SORTS.map((s) => (
                  <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />
                ))}
              </View>
            </ScrollView>
          </View>
          <View style={{ marginTop: space(2) }}>
            <Caption>Rating</Caption>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              {RATINGS.map((r) => (
                <Chip key={r.value} label={r.label} active={minRating === r.value} onPress={() => setMinRating(r.value)} />
              ))}
            </View>
          </View>
          {filtered && (
            <Button
              label="Clear filters"
              variant="ghost"
              small
              onPress={() => {
                setCity("");
                if (!fromBudget) setCategory("");
                setSort("recommended");
                setMinRating(0);
              }}
            />
          )}
        </Card>
      ) : null}

      {fromBudget && totalBudget !== null && !q.isPending && !q.error && (
        <View style={{ flexDirection: 'row', gap: space(2), marginBottom: space(3) }}>
          <Chip label={`All (${total})`} active={!withinBudget} onPress={() => setWithinBudget(false)} />
          <Chip
            label={`Within budget (${loaded.filter(fits).length}${q.hasNextPage ? '+' : ''})`}
            active={withinBudget}
            onPress={() => setWithinBudget(true)}
          />
        </View>
      )}

      {q.isPending ? (
        <Loading rows={3} />
      ) : q.error ? (
        <Alert tone="critical">
          {apiMessage(q.error, "Vendors could not be loaded.")}
        </Alert>
      ) : vendors.length ? (
        <View style={{ gap: space(3) }}>
          {vendors.map((v) => (
            <View key={v.id}>
              {/*
                The card holds two tappable areas side by side rather than one
                Pressable around everything: View Instagram must open Instagram
                and not the vendor, and a screen reader reads a Pressable as one
                button, so a link inside it would be out of reach.
              */}
              <Card style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${v.name}, view details`}
                  onPress={() => openVendor(v.id)}
                >
                  {v.portfolio?.[0] ? (
                    <Image
                      source={{ uri: v.portfolio[0] }}
                      style={{ width: '100%', height: 160 }}
                    />
                  ) : (
                    <View
                      style={{
                        width: '100%',
                        height: 160,
                        backgroundColor: rgb(theme.surfaceSunken),
                      }}
                    />
                  )}
                  
                  <View style={{ padding: space(3), gap: space(2) }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{v.name}</Body>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <MapPin size={14} color={rgb(theme.ink[400])} />
                          <Caption tone="muted">{v.city || 'Anywhere'}</Caption>
                        </View>
                      </View>
                      {v.verifiedAt && <SealCheck size={18} color={rgb(theme.positiveFg)} weight="fill" />}
                    </View>

                    <Body style={{ fontWeight: '700' }}>
                      {v.startingPrice ? `${rupees(v.startingPrice)} / event` : 'Price on request'}
                    </Body>
                    
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      {fromBudget && totalBudget !== null && fits(v) ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: rgb(theme.positiveBg), paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                          <CheckCircle size={14} color={rgb(theme.positiveFg)} weight="fill" />
                          <Caption style={{ color: rgb(theme.positiveFg), fontSize: 12, fontWeight: '600' }}>Fits within your budget</Caption>
                        </View>
                      ) : (
                        <View />
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Star size={14} color={rgb(theme.brand)} weight="fill" />
                        <Caption style={{ fontWeight: '600' }}>{Number(v.ratingAvg).toFixed(1)} <Caption tone="muted">({v.ratingCount})</Caption></Caption>
                      </View>
                    </View>
                  </View>
                </Pressable>
                <View style={{ paddingHorizontal: space(3), paddingBottom: space(3), gap: space(2) }}>
                  <ViewInstagramButton listing={v} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${v.name}, view details`}
                    onPress={() => openVendor(v.id)}
                    style={{ backgroundColor: rgb(theme.brand), paddingVertical: 10, borderRadius: radius.md, alignItems: 'center' }}
                  >
                    <Caption style={{ color: rgb(theme.brandFg), fontWeight: '600' }}>View Details</Caption>
                  </Pressable>
                </View>
              </Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={shortlist.has(v.id) ? `Remove ${v.name} from shortlist` : `Shortlist ${v.name}`}
                onPress={() => void toggleVendorShortlist(v.id).then(setShortlist)}
                style={{ position: 'absolute', top: 12, right: 12, backgroundColor: 'white', padding: 8, borderRadius: 20 }}
              >
                <Heart size={20} color={rgb(theme.brand)} weight={shortlist.has(v.id) ? 'fill' : 'regular'} />
              </Pressable>
            </View>
          ))}
          {q.hasNextPage ? (
            <Button
              label={`Load more (${loaded.length} of ${total})`}
              variant="outline"
              busy={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          ) : (
            <Caption tone="muted" style={{ textAlign: 'center' }}>
              {`Showing all ${total} vendor${total === 1 ? '' : 's'}`}
            </Caption>
          )}
        </View>
      ) : withinBudget && loaded.length ? (
        <EmptyState title="Nothing within budget yet">
          {q.hasNextPage ? 'Load more vendors, or see all of them.' : 'No vendor here has a listed price within what remains.'}
        </EmptyState>
      ) : (
        <EmptyState title="No vendors found">
          Try another category, city, or search term.
        </EmptyState>
      )}
      {withinBudget && !vendors.length && q.hasNextPage ? (
        <Button
          label={`Load more (${loaded.length} of ${total})`}
          variant="outline"
          busy={q.isFetchingNextPage}
          onPress={() => void q.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}
