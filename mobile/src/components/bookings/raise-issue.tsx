import { useState } from 'react';
import { View } from 'react-native';

import { api, apiMessage } from '@/lib/api';
import { Alert, Button, Caption, Field } from '@/components/ui';
import { space } from '@/theme';

/**
 * Raising an issue on a booking from the provider's side (row 20): a vendor
 * who delivered and was paid the balance, but whose customer has not accepted
 * the delivery, can ask an officer to look at it. The same case the customer
 * raises; the server checks the booking is theirs.
 */
export function RaiseIssueForm({
  bookingId,
  onDone,
  onCancel,
}: {
  bookingId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = title.trim().length >= 5 && description.trim().length >= 10;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/verification/cases', {
        subjectType: 'booking',
        subjectId: bookingId,
        title: title.trim(),
        description: description.trim(),
      });
      onDone();
    } catch (err) {
      setError(apiMessage(err, 'That issue could not be raised.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space(2) }}>
      <Caption tone="muted">
        An officer looks into it. Money held on this booking stays frozen until they decide, and you
        can keep talking to the customer in Messages.
      </Caption>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Field label="In one line" value={title} onChangeText={setTitle} maxLength={120} editable={!busy} />
      <Field
        label="Full story"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        style={{ minHeight: 88, textAlignVertical: 'top' }}
        editable={!busy}
      />
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button label="Never mind" variant="ghost" small disabled={busy} onPress={onCancel} />
        <Button label="Raise the issue" small busy={busy} disabled={!ready || busy} onPress={() => void submit()} />
      </View>
    </View>
  );
}
