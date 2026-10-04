import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { PreferencesSection } from '@/components/biodata';
import { Alert, Body, Card, Loading, Screen, SectionTitle } from '@/components/ui';

export default function PartnerPreferences() {
  const qc = useQueryClient();

  const { data: me, isPending: loadingMe, isError: meFailed } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data as { id?: string | null },
    retry: false,
  });
  const profileId = me?.id ?? null;

  const {
    data: full,
    isFetchedAfterMount,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ['biodata-details', profileId],
    enabled: Boolean(profileId),
    queryFn: async () => (await api.get(`/profiles/${profileId}/details`)).data,
    // The form copies what it is given once, so it waits for the server rather than start from a cached copy.
    refetchOnMount: 'always',
    retry: false,
  });

  if (loadingMe || (profileId && (isPending || !isFetchedAfterMount))) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (meFailed || isError) {
    return (
      <Screen>
        <Alert tone="critical">{apiMessage(error, 'Preferences could not be loaded.')}</Alert>
      </Screen>
    );
  }

  if (!profileId) {
    return (
      <Screen>
        <Card>
          <SectionTitle>No profile yet</SectionTitle>
          <Body tone="muted">Partner preferences belong to a matrimony profile.</Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <PreferencesSection
        profileId={profileId}
        details={(full?.details ?? {}) as Record<string, unknown>}
        startEditing
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['biodata-details', profileId] });
          void qc.invalidateQueries({ queryKey: ['biodata-completion', profileId] });
        }}
      />
    </Screen>
  );
}
