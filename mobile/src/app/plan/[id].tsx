import { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CaretRight } from "phosphor-react-native";

import { api, apiMessage } from "@/lib/api";
import { humanise, money, shortDate } from "@/lib/format";
import { fetchPlans, fetchWeddingDashboard } from "@/lib/wedding-plan";
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Field,
  Loading,
  SectionTitle,
  Screen,
} from "@/components/ui";
import { rgb, space, useTheme, radius } from "@/theme";

type EventRow = {
  id: string;
  eventType?: string | null;
  venue?: string | null;
  city?: string | null;
};
type BookingRow = { id: string; providerName?: string | null; status: string };

const ACTIONS: { title: string; hint: string; to: string }[] = [
  { title: "Budget", hint: "Planned vs committed", to: "/plan/budget" },
  { title: "Guest List", hint: "Guests and RSVPs", to: "/plan/guests" },
  { title: "Vendors", hint: "Find and book vendors", to: "/vendors" },
  { title: "Hire a Planner", hint: "Get expert guidance", to: "/planners" },
  { title: "Events", hint: "Create and track events", to: "/events" },
  { title: "Bookings", hint: "Payments and escrow", to: "/plan/bookings" },
  { title: "Additional Services", hint: "Makeup, music and more", to: "/plan/services" },
];

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  return ((data as { data?: T[] } | undefined)?.data ?? []) as T[];
}

export default function WeddingPlan() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [date, setDate] = useState("");
  const [error, setError] = useState("");

  const plans = useQuery({ queryKey: ["plans"], queryFn: fetchPlans, retry: false });
  const dashboard = useQuery({
    queryKey: ["wedding-dashboard"],
    queryFn: fetchWeddingDashboard,
    retry: false,
  });
  const events = useQuery({
    queryKey: ["events"],
    queryFn: async () => (await api.get("/events")).data,
    retry: false,
  });
  const bookings = useQuery({
    queryKey: ["my-bookings"],
    queryFn: async () => (await api.get("/bookings", { params: { limit: 100 } })).data,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => api.post("/planner/plan", { weddingDate: date.trim() }),
    onSuccess: async () => {
      setDate("");
      setError("");
      await qc.invalidateQueries({ queryKey: ["plans"] });
      await qc.invalidateQueries({ queryKey: ["wedding-dashboard"] });
    },
    onError: (e) => setError(apiMessage(e, "The plan could not be created.")),
  });

  if (plans.isPending || dashboard.isPending)
    return (
      <Screen>
        <Loading rows={5} />
      </Screen>
    );
  if (plans.error || dashboard.error || !dashboard.data)
    return (
      <Screen>
        <EmptyState title="Wedding plan unavailable">
          {apiMessage(plans.error ?? dashboard.error, "Please try again shortly.")}
        </EmptyState>
      </Screen>
    );

  const plan = plans.data?.find((p) => p.id === id) ?? plans.data?.[0];
  const data = dashboard.data;
  const eventRows = rows<EventRow>(events.data);
  const weddingType = eventRows.find((e) => e.eventType)?.eventType;
  const place = eventRows.find((e) => e.venue || e.city);
  const location = place ? [place.venue, place.city].filter(Boolean).join(", ") : null;
  const plannerBooking = plan?.plannerBookingId
    ? rows<BookingRow>(bookings.data).find((b) => b.id === plan.plannerBookingId)
    : undefined;
  const plannerStatus = plan?.plannerUserId
    ? `Engaged${plannerBooking?.providerName ? ` · ${plannerBooking.providerName}` : ""}`
    : plannerBooking
      ? `Requested · ${humanise(plannerBooking.status)}`
      : "No planner";
  const budgeted = Number(data.budget.budgeted || 0);
  const committed = Number(data.budget.committed || 0);

  const refresh = () => {
    void plans.refetch();
    void dashboard.refetch();
    void events.refetch();
    void bookings.refetch();
  };

  return (
    <Screen onRefresh={refresh} refreshing={dashboard.isRefetching}>
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {!plan ? (
        <Card style={{ gap: space(2) }}>
          <SectionTitle>Start your wedding plan</SectionTitle>
          <Caption tone="muted">Set the wedding date you are planning towards.</Caption>
          <Field
            label="Wedding date (YYYY-MM-DD)"
            value={date}
            onChangeText={setDate}
            placeholder="2026-12-01"
          />
          <Button
            label="Create plan"
            busy={create.isPending}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())}
            onPress={() => create.mutate()}
          />
        </Card>
      ) : null}

      <Card style={{ gap: space(2), borderRadius: radius.md }}>
        <Fact label="Wedding Type" value={weddingType ? humanise(weddingType) : "Not set"} />
        <Fact
          label="Wedding Date"
          value={data.countdown.weddingDate ? shortDate(data.countdown.weddingDate) : "Not set"}
        />
        <Fact label="Location" value={location || "Not set"} />
        <Fact
          label="Guest Count"
          value={data.guests.onList ? `${data.guests.onList} on list` : "Not set"}
        />
        <Fact label="Planner" value={plannerStatus} />
        <Fact
          label="Progress"
          value={
            data.journey.total
              ? `${data.journey.percent}% · ${data.journey.done}/${data.journey.total} done`
              : "Not started"
          }
        />
        <Fact
          label="Budget"
          value={
            budgeted
              ? `${money(committed)} committed of ${money(budgeted)}`
              : committed
                ? `${money(committed)} committed · budget not set`
                : "Not set"
          }
        />
      </Card>

      <View style={{ gap: space(2) }}>
        <SectionTitle>Plan</SectionTitle>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {ACTIONS.map((action, index) => (
            <Pressable
              key={action.title}
              onPress={() => router.push(action.to as never)}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: space(4),
                  paddingVertical: space(3),
                  borderBottomWidth: index === ACTIONS.length - 1 ? 0 : 1,
                  borderBottomColor: rgb(theme.border),
                },
                pressed && { backgroundColor: rgb(theme.surfaceSunken) },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={{ fontWeight: "600" }}>{action.title}</Body>
                <Caption tone="faint">{action.hint}</Caption>
              </View>
              <CaretRight size={18} color={rgb(theme.ink[400])} />
            </Pressable>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
      <Caption tone="faint">{label}</Caption>
      <Caption style={{ fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{value}</Caption>
    </View>
  );
}
