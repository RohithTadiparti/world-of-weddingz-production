import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import {
  STATUS_TABS,
  type PlannerRequestCard,
  type PlannerRequestStatus,
} from '@/lib/planner-requests';
import { formatDate } from '@/shared/dates';
import { FilterChips } from '@/components/chrome';
import { SelectField } from '@/components/form';
import { ListScreen } from '@/components/layout';
import { RequestCard } from '@/components/planner-requests/parts';
import { Alert, Field, PageSubtitle, PageTitle } from '@/components/ui';
import { space } from '@/theme';

type Sort = 'newest' | 'oldest' | 'wedding';

/**
 * A wedding planner's incoming requests (the web client's Planner Requests).
 *
 * The planner's job here is triage: who is asking, for what day and what
 * money, then open one and decide. The tabs are the web's, in the order a
 * planner works through them, and open on New because that is the queue that
 * is waiting on them. The couple's phone number is never on these cards — the
 * API does not send it, and talk stays on the platform until the job is agreed.
 */
export default function PlannerRequests() {
  const router = useRouter();
  const [tab, setTab] = useState<PlannerRequestStatus | 'all'>('new');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const requests = useQuery({
    queryKey: ['planner-requests'],
    queryFn: async () => (await api.get('/bookings/planner-requests')).data as PlannerRequestCard[],
    retry: false,
    refetchOnMount: 'always',
  });
  const all = useMemo(() => requests.data ?? [], [requests.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const r of all) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((r) => tab === 'all' || r.status === tab)
      .filter((r) => {
        if (!q) return true;
        // Name, place, reference, and the date both as stored and as shown.
        return [r.client.name, r.location, r.requestNumber, r.weddingDate, r.weddingDate && formatDate(r.weddingDate)]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sort === 'wedding') {
          // Undated requests last: there is nothing to plan them around.
          const at = a.weddingDate ? Date.parse(a.weddingDate) : Infinity;
          const bt = b.weddingDate ? Date.parse(b.weddingDate) : Infinity;
          return at - bt;
        }
        const diff = Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
        return sort === 'newest' ? diff : -diff;
      });
  }, [all, tab, query, sort]);

  const fresh = counts.new ?? 0;

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1), marginTop: space(2) }}>
            <PageTitle>Planner Requests{fresh > 0 ? ` (${fresh} new)` : ''}</PageTitle>
            <PageSubtitle>
              Couples who have asked you to plan their wedding. Review each request, then accept,
              quote or decline.
            </PageSubtitle>
          </View>

          {requests.isError ? (
            <Alert tone="critical">{apiMessage(requests.error, 'Your requests could not be loaded.')}</Alert>
          ) : null}

          {/* "All" is a tab of its own, so pressing the active chip keeps it. */}
          <FilterChips
            options={STATUS_TABS.map((t) => ({
              key: t.key,
              label: t.label,
              count: requests.isLoading ? undefined : (counts[t.key] ?? 0),
            }))}
            value={tab}
            onChange={(key) => {
              if (key) setTab(key as PlannerRequestStatus | 'all');
            }}
          />
          <Field
            label="Search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, place or date"
            autoCorrect={false}
          />
          <SelectField
            label="Order by"
            value={sort}
            onChange={(value) => setSort(value as Sort)}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'wedding', label: 'Wedding date' },
            ]}
          />
        </>
      }
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={(r) => (
        <RequestCard
          request={r}
          onPress={() => router.push({ pathname: '/planner-requests/[id]', params: { id: r.id } })}
        />
      )}
      loading={requests.isLoading}
      emptyTitle={query ? 'No matches' : 'Nothing here'}
      emptyBody={
        query
          ? 'No request in this tab matches that search.'
          : tab === 'new'
            ? 'No new requests. Couples find you through Hire a Planner; their requests land here.'
            : 'No requests in this state.'
      }
      onRefresh={() => void requests.refetch()}
      refreshing={requests.isRefetching}
    />
  );
}
