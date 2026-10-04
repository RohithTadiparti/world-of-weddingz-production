import { Alert as NativeAlert, Pressable, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  DownloadSimple,
  FileText,
  ShareNetwork,
  Trash,
  Lifebuoy,
  type IconProps,
} from 'phosphor-react-native';
import type { ComponentType } from 'react';

import { apiMessage } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { fetchPlans, fetchWeddingDashboard } from '@/lib/wedding-plan';
import { Body, Caption, Card, Loading, Screen } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type Row = {
  title: string;
  hint: string;
  icon: ComponentType<IconProps>;
  tone?: 'critical';
  onPress: () => void;
};

export default function PlanMore() {
  const theme = useTheme();
  const router = useRouter();

  const dashboard = useQuery({
    queryKey: ['wedding-dashboard'],
    queryFn: fetchWeddingDashboard,
    retry: false,
  });
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
    retry: false,
  });

  if (dashboard.isPending || plans.isPending) {
    return (
      <Screen>
        <Loading rows={3} />
      </Screen>
    );
  }

  const plan = plans.data?.[0];
  const data = dashboard.data;

  const summary = [
    'WOW Wedding Plan',
    data?.countdown.weddingDate
      ? `Wedding day: ${shortDate(data.countdown.weddingDate)}`
      : 'Wedding day: not set',
    `Guests on list: ${data?.guests.onList || 'not set'}`,
    `Plan progress: ${data?.journey.total ? `${data.journey.percent}%` : 'not started'}`,
    `Budget planned: ${Number(data?.budget.budgeted) ? money(data?.budget.budgeted) : 'not set'}`,
  ].join('\n');

  const rows: Row[] = [
    {
      title: 'Manage Plan',
      hint: 'Open your wedding plan details',
      icon: FileText,
      onPress: () => router.push({ pathname: '/plan/[id]', params: { id: plan?.id ?? 'new' } }),
    },
    {
      title: 'Share Plan',
      hint: 'Send a summary to family',
      icon: ShareNetwork,
      onPress: () => void Share.share({ message: summary }),
    },
    {
      title: 'Notifications',
      hint: 'Planning alerts and updates',
      icon: Bell,
      onPress: () => router.push('/notifications'),
    },
    {
      title: 'Help & Support',
      hint: 'Get help with your plan',
      icon: Lifebuoy,
      onPress: () => router.push({ pathname: '/support', params: { type: 'help' } }),
    },
  ];

  return (
    <Screen>
      <Caption tone="muted">Manage, share and get help with your wedding plan.</Caption>
      {dashboard.error ? (
        <Caption tone="critical">
          {apiMessage(dashboard.error, 'Some plan details could not be loaded.')}
        </Caption>
      ) : null}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((row, index) => (
          <Pressable
            key={row.title}
            onPress={row.onPress}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                paddingHorizontal: space(4),
                paddingVertical: space(3.5),
                borderBottomWidth: index === rows.length - 1 ? 0 : 1,
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
                backgroundColor:
                  row.tone === 'critical' ? rgb(theme.criticalBg) : rgb(theme.brandSoft),
              }}
            >
              <row.icon
                size={18}
                color={
                  row.tone === 'critical' ? rgb(theme.criticalFg) : rgb(theme.brandStrong)
                }
              />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Body
                style={{
                  fontWeight: '600',
                  color: row.tone === 'critical' ? rgb(theme.criticalFg) : rgb(theme.ink[900]),
                }}
              >
                {row.title}
              </Body>
              <Caption tone="faint">{row.hint}</Caption>
            </View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
