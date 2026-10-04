import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { SelectField } from '@/components/form';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { space } from '@/theme';

const VISIBILITY = [
  { value: 'public', label: 'Public' },
  { value: 'matches_only', label: 'Matches only' },
  { value: 'private', label: 'Private' },
];

export default function PrivacySafety() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: async () =>
      (await api.get('/users/me')).data as { displayName?: string | null; visibility?: string | null },
    retry: false,
  });

  const visibility = draft ?? data?.visibility ?? 'matches_only';

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/users/me/profile', {
        displayName: data?.displayName?.trim() || 'Profile',
        visibility,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      setDraft(null);
      setError('');
      setNotice('Visibility saved.');
    },
    onError: (err) => {
      setNotice('');
      setError(apiMessage(err, 'Visibility could not be saved.'));
    },
  });

  if (isPending) {
    return (
      <Screen>
        <Loading rows={3} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <Alert tone="critical">Privacy settings could not be loaded.</Alert>
        <Button label="Retry" variant="outline" onPress={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      <Card>
        <SectionTitle>Profile Visibility</SectionTitle>
        <Caption tone="muted">
          Public is visible under the normal rules. Matches only stays restricted until an interest
          is accepted. Private is hidden from suggestions.
        </Caption>
        <SelectField
          label="Who can see your profile"
          value={visibility}
          options={VISIBILITY}
          onChange={setDraft}
        />
        <Button
          label="Save"
          busy={save.isPending}
          disabled={visibility === (data?.visibility ?? 'matches_only')}
          onPress={() => save.mutate()}
        />
      </Card>

      <Card>
        <SectionTitle>Safety Tips</SectionTitle>
        <Body tone="muted">Meet in a public place for a first meeting.</Body>
        <Body tone="muted">Do not share bank details, OTPs or government ID numbers in chat.</Body>
        <Body tone="muted">Use Block on Interests if a conversation is no longer welcome.</Body>
        <Body tone="muted" style={{ marginTop: space(1) }}>
          Report serious concerns from Contact Support so an investigator can look at them.
        </Body>
      </Card>
    </Screen>
  );
}
