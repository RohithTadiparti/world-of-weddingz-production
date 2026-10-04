import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, ScrollView, Alert as RNAlert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  PencilSimple, Wallet, CaretRight, Sparkle, Buildings, Coffee, Camera, PaintBrush, Hand, MusicNote, ClipboardText, Target, ChartPieSlice, Star
} from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { fetchWeddingDashboard } from '@/lib/wedding-plan';
import { SuggestedVendors, useBudgetVendors } from '@/components/plan/suggested-vendors';
import { Alert, Body, Button, Caption, Card, EmptyState, Field, Loading, Screen, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';
import type { Channels } from '@/theme/tokens';
import { useCatalogCategories } from '@/components/business/category-picker';

type EventRow = { id: string; expectedGuests?: number | null };

const getCategoryIcon = (slug: string, theme: any) => {
  const props = { size: 24, color: rgb(theme.brand), weight: 'regular' as const };
  if (slug.includes('hall') || slug.includes('venue')) return <Buildings {...props} />;
  if (slug.includes('cater')) return <Coffee {...props} />;
  if (slug.includes('photo')) return <Camera {...props} />;
  if (slug.includes('decor')) return <Sparkle {...props} />;
  if (slug.includes('makeup')) return <PaintBrush {...props} />;
  if (slug.includes('mehendi')) return <Hand {...props} />;
  if (slug.includes('music') || slug.includes('dj')) return <MusicNote {...props} />;
  if (slug.includes('planner')) return <ClipboardText {...props} />;
  return <Star {...props} />;
};

export default function PlanBudget() {
  const qc = useQueryClient();
  const theme = useTheme();
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const dashboard = useQuery({ queryKey: ['wedding-dashboard'], queryFn: fetchWeddingDashboard, retry: false });
  const catalog = useCatalogCategories();

  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: ['wedding-dashboard'] });
    }, [qc]),
  );

  const total = dashboard.data?.budget.total ? Number(dashboard.data.budget.total) : null;
  const committed = Number(dashboard.data?.budget.committed ?? 0);
  const remaining = total === null ? 0 : Number(dashboard.data?.budget.remaining ?? 0);
  const pricing = useBudgetVendors(total || 0);

  if (dashboard.isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <Screen>
        <EmptyState title="Budget unavailable">{apiMessage(dashboard.error, 'Please try again shortly.')}</EmptyState>
      </Screen>
    );
  }

  const blocked =
    total === null
      ? 'Set your overall wedding budget to see vendors that fit.'
      : remaining < 0
        ? `Over budget by ${money(-remaining)}`
        : remaining === 0
          ? 'No remaining budget'
          : null;

  return (
    <Screen onRefresh={() => void dashboard.refetch()} refreshing={dashboard.isRefetching}>
      <BudgetHeader
        total={total}
        committed={committed}
        remaining={remaining}
        onEdit={editing ? undefined : () => setEditing(true)}
      >
        {editing ? (
          <BudgetEditor total={total} onDone={() => setEditing(false)} />
        ) : total === null ? (
          <Button small label="Set Budget" onPress={() => setEditing(true)} />
        ) : null}
      </BudgetHeader>

      {!editing && (
        <>
          <View style={{ marginTop: space(4), gap: space(2) }}>
            <SectionTitle>Find Vendors Within Your Budget</SectionTitle>
            <Caption tone="muted">Explore all wedding vendors that fit your overall budget.</Caption>
            
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(2) }}>
              {catalog.isPending ? (
                <Loading rows={2} />
              ) : (
                catalog.data?.filter(c => ['photography', 'catering', 'venue', 'decor', 'makeup', 'priest', 'transportation', 'planning', 'entertainment'].includes(c.slug)).map((c) => (
                  <Pressable
                    key={c.slug}
                    onPress={() => router.push({ pathname: '/vendors', params: { category: c.slug, fromBudget: 'true' } })}
                    style={({ pressed }) => ({
                      width: '23%',
                      backgroundColor: pressed ? rgb(theme.surfaceSunken) : rgb(theme.surface),
                      borderRadius: radius.lg,
                      padding: space(2),
                      alignItems: 'center',
                      gap: 4,
                      borderWidth: 1,
                      borderColor: rgb(theme.border),
                    })}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: rgb(theme.brandSoft), alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      {getCategoryIcon(c.slug, theme)}
                    </View>
                    <Caption style={{ textAlign: 'center', fontSize: 10, fontWeight: '600' }} numberOfLines={1}>{c.name}</Caption>
                  </Pressable>
                ))
              )}
            </View>
          </View>

          <SuggestedVendors
            fits={pricing.evaluate(total || 0)}
            loading={pricing.loading}
            error={pricing.error}
            blocked={blocked}
          />

          <Pressable onPress={() => router.push('/plan/personalized-plan')}>
            <Card style={{ marginTop: space(6), backgroundColor: rgb(theme.brandSoft), padding: space(3) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: rgb(theme.surface), alignItems: 'center', justifyContent: 'center' }}>
                  <ChartPieSlice size={20} color={rgb(theme.brand)} weight="bold" />
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '700' }}>Estimated Wedding Plan</Body>
                  <Caption tone="muted">Get a complete vendor plan that fits your budget</Caption>
                </View>
                <CaretRight size={20} color={rgb(theme.ink[400])} />
              </View>
            <Button
              style={{ marginTop: space(3) }}
              label="Get Personalized Plan"
              onPress={() => router.push('/plan/personalized-plan')}
            />
            </Card>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

function BudgetHeader({
  total,
  committed,
  remaining,
  onEdit,
  children,
}: {
  total: number | null;
  committed: number;
  remaining: number;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const over = total !== null && remaining < 0;
  return (
    <Card style={{ backgroundColor: rgb(theme.brandSoft), gap: space(4) }}>
      <View style={{ flexDirection: 'row', gap: space(3) }}>
        <View
          style={{
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: rgb(theme.surface),
            borderRadius: radius.md,
          }}
        >
          <Wallet size={24} color={rgb(theme.brand)} weight="fill" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Caption style={{ fontWeight: '600', color: rgb(theme.ink[900]) }}>Total Wedding Budget</Caption>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <Body style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', color: rgb(theme.brandStrong) }}>
              {total !== null ? money(total) : 'Not set'}
            </Body>
            {onEdit && total !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit Budget"
                onPress={onEdit}
                hitSlop={8}
                style={{
                  width: 30,
                  height: 30,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: rgb(theme.surface),
                  borderRadius: 15,
                }}
              >
                <PencilSimple size={16} color={rgb(theme.brand)} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Stat first label="Committed" value={money(committed)} />
        <Stat
          label={over ? 'Over budget by' : 'Remaining'}
          value={total !== null ? money(Math.abs(remaining)) : '—'}
          color={total === null ? undefined : over ? theme.criticalFg : remaining > 0 ? theme.positiveFg : undefined}
        />
      </View>
      {over ? (
        <Caption tone="critical">Your current bookings have exceeded your overall wedding budget.</Caption>
      ) : null}
      {children}
    </Card>
  );
}

function Stat({ label, value, color, first }: { label: string; value: string; color?: Channels; first?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: space(1),
        paddingLeft: first ? 0 : space(3),
        borderLeftWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderColor: rgb(theme.borderStrong),
      }}
    >
      <Caption tone="muted" numberOfLines={1}>
        {label}
      </Caption>
      <Body numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: rgb(color ?? theme.ink[900]) }}>
        {value}
      </Body>
    </View>
  );
}

function BudgetEditor({ total, onDone }: { total: number | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(total !== null ? String(total) : '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => api.put('/planner/budget', { budget: value ? Number(value) : null }),
    onSuccess: async () => {
      setError('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['wedding-dashboard'] }),
        qc.invalidateQueries({ queryKey: ['plans'] }),
      ]);
      onDone();
    },
    onError: (err) => setError(apiMessage(err, 'That budget could not be saved.')),
  });

  return (
    <View style={{ gap: space(2) }}>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Field
        label="Total wedding budget (₹)"
        value={value}
        onChangeText={(v) => setValue(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="e.g. 1500000"
        hint={total !== null ? 'Leave blank to clear the budget.' : undefined}
      />
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button style={{ flex: 1 }} small variant="outline" label="Cancel" disabled={save.isPending} onPress={onDone} />
        <Button
          style={{ flex: 1 }}
          small
          label="Save Budget"
          busy={save.isPending}
          onPress={() => {
            if (value || total === null) {
              save.mutate();
              return;
            }
            RNAlert.alert(
              'Clear your budget?',
              'Your overall wedding budget will be removed. Bookings stay as they are.',
              [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Clear budget', style: 'destructive', onPress: () => save.mutate() },
              ],
            );
          }}
        />
      </View>
    </View>
  );
}
