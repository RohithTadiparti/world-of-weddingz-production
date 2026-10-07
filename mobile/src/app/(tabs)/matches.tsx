import { useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CaretDown,
  Heart,
  MagnifyingGlass,
  SlidersHorizontal,
  UserCircle,
} from "phosphor-react-native";

import { HeartBackdrop } from "@/components/heart-field";
import { NotificationBell } from "@/components/home/notification-bell";
import {
  ActingClientPicker,
  useActingClient,
} from "@/components/matches/acting-client";
import { ProfileSilhouette } from "@/components/profile-silhouette";
import { ProfileCompletionCard } from "@/components/profile-completion-card";
import {
  Alert,
  Button,
  Caption,
  EmptyState,
  Loading,
  PageSubtitle,
  PageTitle,
  SectionTitle,
} from "@/components/ui";
import { api, apiMessage } from "@/lib/api";
import { useMatchmakingGate } from "@/lib/matchmaking";
import { useAuth } from "@/store/auth";
import { rgb, space, useTheme, radius } from "@/theme";
import { Txt, typeface } from "@/theme/fonts";
import { ageText } from "@/lib/labels";

interface Profile {
  id: string;
  displayName: string;
  gender?: string | null;
  ageRange: string | null;
  age?: number | null;
  city?: string | null;
  photos: string[];
  profileCode: string;
  card?: {
    religion: string | null;
    motherTongue: string | null;
    profession: string | null;
    highestQualification?: string | null;
  };
}
interface Suggestion {
  profile: Profile;
  score: number;
  shortlisted?: boolean;
  interaction?: string;
}
type Tab = "for-you" | "nearby" | "new" | "shortlisted";
const tabs: { key: Tab; label: string }[] = [
  { key: "for-you", label: "For You" },
  { key: "nearby", label: "Nearby" },
  { key: "new", label: "New" },
  { key: "shortlisted", label: "Shortlisted" },
];

export default function Matches() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const acting = useActingClient();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>("for-you");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"score" | "recent" | "age">("score");
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState("");
  const { status, biodata, gate, settled } = useMatchmakingGate(
    acting.profileId,
    acting.ready,
  );
  const isProfileComplete = status?.profileCompleted && biodata?.complete;
  const clientParam = acting.profileId ? { profileId: acting.profileId } : {};
  // These map onto the existing suggestions endpoint: its active view is the
  // closest available proximity/activity signal, and New is server-sorted by creation date.
  const tabParams =
    tab === "shortlisted"
      ? { view: "shortlisted" }
      : tab === "new"
        ? { addedWithinDays: 30, sort: "recent" }
        : tab === "nearby"
          ? { view: "active" }
          : { sort };
  const {
    data,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ["suggestions", acting.profileId, tab, search, sort],
    queryFn: async () => {
      if (tab === "shortlisted") {
        const response = await api.get("/matches/shortlist", {
          params: {
            q: search.trim() || undefined,
            ...clientParam,
          },
        });
        return { data: response.data, meta: { total: response.data.length } };
      }
      return (
        await api.get("/matches/suggestions", {
          params: {
            limit: 40,
            q: search.trim() || undefined,
            ...clientParam,
            ...tabParams,
          },
        })
      ).data;
    },
    enabled: acting.ready && settled && !gate,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const suggestions: Suggestion[] = gate ? [] : (data?.data ?? []);
  const total = gate ? 0 : (data?.meta?.total ?? data?.total ?? suggestions.length);
  const shortlist = useMutation({
    mutationFn: ({ id, selected }: { id: string; selected: boolean }) =>
      selected
        ? api.delete(`/matches/shortlist/${id}`, { params: clientParam })
        : api.put(`/matches/shortlist/${id}`, {}, { params: clientParam }),
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
    },
    onError: (e) =>
      setError(apiMessage(e, "That shortlist could not be updated.")),
  });
  if (isLoading || (acting.ready && !settled))
    return (
      <HeartBackdrop style={{ padding: space(4) }}>
        <Header initial={user?.email?.[0]} />
        <Loading rows={5} />
      </HeartBackdrop>
    );
  return (
    <HeartBackdrop>
      <FlatList
        key="two"
        data={suggestions}
        numColumns={2}
        keyExtractor={(row) => row.profile.id}
        columnWrapperStyle={{ gap: space(2) }}
        contentContainerStyle={{
          padding: space(4),
          paddingBottom: space(12),
          gap: space(2),
        }}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(1) }}>
            <Header initial={user?.email?.[0]} />
            <View>
              <PageTitle style={{ fontSize: 34, lineHeight: 38 }}>
                Find Your Match
              </PageTitle>
              <PageSubtitle>
                Meaningful connections for a brighter tomorrow.
              </PageSubtitle>
            </View>
            <View style={{ gap: space(2) }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderRadius: radius.md,
                  backgroundColor: rgb(theme.surface),
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: rgb(theme.border),
                  paddingLeft: space(3),
                  minHeight: 48,
                }}
              >
                <MagnifyingGlass size={19} color={rgb(theme.brand)} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by name, location, profession..."
                  placeholderTextColor={rgb(theme.ink[400])}
                  style={typeface({
                    flex: 1,
                    fontSize: 13,
                    color: rgb(theme.ink[900]),
                    paddingHorizontal: space(2),
                  })}
                />
                {tab === "for-you" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Sort matches"
                    onPress={() => setFilterOpen((v) => !v)}
                    style={{
                      width: 40,
                      height: 40,
                      marginRight: space(1),
                      borderRadius: radius.md,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: rgb(theme.brand),
                    }}
                  >
                    <SlidersHorizontal size={18} color={rgb(theme.brandFg)} />
                  </Pressable>
                ) : null}
              </View>
              {filterOpen && tab === "for-you" ? (
                <View
                  style={{
                    flexDirection: "row",
                    gap: space(2),
                    alignItems: "center",
                    padding: space(2),
                    borderRadius: radius.md,
                    backgroundColor: rgb(theme.surfaceSunken),
                  }}
                >
                  <Caption style={{ flex: 1 }}>Sort matches</Caption>
                  {(["score", "recent", "age"] as const).map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => {
                        setSort(v);
                        setFilterOpen(false);
                      }}
                      style={{
                        paddingHorizontal: space(2),
                        paddingVertical: space(1),
                        borderRadius: radius.md,
                        backgroundColor:
                          sort === v ? rgb(theme.brand) : rgb(theme.surface),
                      }}
                    >
                      <Caption tone={sort === v ? "onBrand" : "muted"}>
                        {v === "score"
                          ? "Relevance"
                          : v === "recent"
                            ? "Newest"
                            : "Age"}
                      </Caption>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", gap: space(1) }}>
              {tabs.map((item) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === item.key }}
                  onPress={() => setTab(item.key)}
                  style={{
                    flex: 1,
                    minHeight: 36,
                    borderRadius: radius.md,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor:
                      tab === item.key
                        ? rgb(theme.brand)
                        : rgb(theme.brandSoft),
                  }}
                >
                  <Txt
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: rgb(
                        tab === item.key ? theme.brandFg : theme.brandStrong,
                      ),
                    }}
                  >
                    {item.label}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Caption>
                {total} profile{total === 1 ? "" : "s"} found
              </Caption>
              {tab === "for-you" ? (
                <Pressable
                  onPress={() => setFilterOpen(true)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space(1),
                  }}
                >
                  <Caption style={{ fontWeight: "600" }}>Sort by</Caption>
                  <Caption tone="brand">
                    {sort === "score"
                      ? "Relevance"
                      : sort === "recent"
                        ? "Newest"
                        : "Age"}
                  </Caption>
                  <CaretDown size={13} color={rgb(theme.brandStrong)} />
                </Pressable>
              ) : null}
            </View>
            <ActingClientPicker acting={acting} />
            {error ? <Alert tone="critical">{error}</Alert> : null}
            {loadError ? (
              <Alert tone="critical">
                {apiMessage(loadError, "Matches could not be loaded.")}
              </Alert>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loadError ? null : !acting.ready ? (
            <EmptyState title={acting.isFamily ? "Choose a profile" : "Choose a client"}>
              {acting.isFamily
                ? "Pick the son, daughter or relative whose matches you want to see."
                : "Pick a client to browse their matches."}
            </EmptyState>
          ) : gate ? (
            <EmptyState title="Matchmaking is closed">
              {gate}
            </EmptyState>
          ) : (
            <EmptyState title="No matches to show yet">
              Try changing your search or match tab.
            </EmptyState>
          )
        }
        renderItem={({ item }) => (
          <MatchCard
            suggestion={item}
            onOpen={() =>
              router.push({
                pathname: "/match/[id]",
                params: {
                  id: item.profile.id,
                  score: String(Math.round(item.score)),
                  shortlisted: String(Boolean(item.shortlisted)),
                  interaction: item.interaction ?? "none",
                  actingProfileId: acting.profileId ?? "",
                },
              })
            }
            onShortlist={() =>
              shortlist.mutate({
                id: item.profile.id,
                selected: Boolean(item.shortlisted),
              })
            }
            shortlistBusy={
              shortlist.isPending && shortlist.variables?.id === item.profile.id
            }
          />
        )}
      />
    </HeartBackdrop>
  );
}

function Header({ initial }: { initial?: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: space(2),
      }}
    >
      <View style={{ width: 40 }} />
      <Txt
        serif
        style={{
          fontSize: 31,
          lineHeight: 34,
          fontWeight: "600",
          letterSpacing: 1,
          color: rgb(theme.brand),
        }}
      >
        WOW
      </Txt>
      <View style={{ flexDirection: "row", gap: space(1) }}>
        <NotificationBell />
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            backgroundColor: rgb(theme.brandSoft),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initial ? (
            <Txt
              style={{
                fontSize: 16,
                fontWeight: "700",
                color: rgb(theme.brandStrong),
              }}
            >
              {initial.toUpperCase()}
            </Txt>
          ) : (
            <UserCircle size={23} color={rgb(theme.brandStrong)} />
          )}
        </View>
      </View>
    </View>
  );
}

function MatchCard({
  suggestion,
  onOpen,
  onShortlist,
  shortlistBusy,
}: {
  suggestion: Suggestion;
  onOpen: () => void;
  onShortlist: () => void;
  shortlistBusy: boolean;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { profile, score } = suggestion;
  const cardWidth = (width - space(8) - space(2)) / 2;
  const facts = [ageText(profile.age, profile.ageRange), profile.city].filter(Boolean).join(" • ");
  return (
    <Pressable
      accessibilityLabel={`View ${profile.displayName}`}
      onPress={onOpen}
      style={({ pressed }) => [
        {
          width: cardWidth,
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.md,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.border),
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={{
          height: cardWidth * 1.08,
          backgroundColor: rgb(theme.surfaceSunken),
        }}
      >
        {profile.photos?.[0] ? (
          <Image
            source={{ uri: profile.photos[0] }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <ProfileSilhouette gender={profile.gender} style={{ flex: 1 }} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            suggestion.shortlisted
              ? "Remove from shortlist"
              : "Add to shortlist"
          }
          onPress={(e) => {
            e.stopPropagation();
            onShortlist();
          }}
          disabled={shortlistBusy}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 32,
            height: 32,
            borderRadius: radius.md,
            backgroundColor: rgb(theme.surface),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Heart
            size={18}
            weight={suggestion.shortlisted ? "fill" : "regular"}
            color={rgb(theme.brand)}
          />
        </Pressable>
      </View>
      <View style={{ padding: space(2), gap: 2, minHeight: 110 }}>
        <SectionTitle numberOfLines={1} style={{ fontSize: 15 }}>
          {profile.displayName}
        </SectionTitle>
        <Caption numberOfLines={1} style={{ fontSize: 11 }}>
          {facts || profile.profileCode}
        </Caption>
        {profile.card?.profession ? (
          <Caption numberOfLines={1} style={{ fontSize: 11 }}>
            {profile.card.profession}
          </Caption>
        ) : null}
        <View
          style={{
            marginTop: "auto",
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Heart size={14} weight="fill" color={rgb(theme.brand)} />
          <Caption tone="brand" style={{ fontSize: 11, fontWeight: "700" }}>
            {Math.round(score)}% Match
          </Caption>
        </View>
      </View>
    </Pressable>
  );
}
