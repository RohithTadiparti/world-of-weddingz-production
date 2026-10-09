import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { api, apiMessage, signOutLocally } from '@/lib/api';
import {
  Alert,
  Button,
  Caption,
  Field,
  PageSubtitle,
  PageTitle,
  Screen,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { space } from '@/theme';

/**
 * Where an account still on its temporary password lands.
 *
 * The platform created some accounts for the people they are for — a couple
 * after a match was fixed, an officer taken on — and emailed a temporary
 * password. Until that password is replaced the server refuses everything
 * else, so this screen is deliberately the only thing reachable: no tabs, no
 * skip. The gate in the root layout keeps them here.
 *
 * Changing the password also ends the session it was used to open, which is
 * why the last step is signing back in rather than carrying on.
 */
export default function SetPassword() {
  const router = useRouter();
  const email = useAuth((s) => s.user?.email);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: async () => {
      await api.post('/auth/password/change', { currentPassword: current, newPassword: next });
    },
    onSuccess: async () => {
      // The server has just revoked every session for this account, including
      // the one this screen is running in, so the refresh token in the keystore
      // is a spent credential. Clearing it keeps the next launch honest instead
      // of presenting a token the server has retired.
      await signOutLocally();
      router.replace('/login');
    },
    onError: (err) => setError(apiMessage(err, 'That password could not be set.')),
  });

  function submit() {
    if (next === current) {
      setError('New password must be different from your current password.');
      return;
    }
    if (next !== confirm) {
      setError('New password and confirm password must match.');
      return;
    }
    setError('');
    change.mutate();
  }

  return (
    <Screen>
      <View style={{ gap: space(1), marginBottom: space(2) }}>
        <PageTitle>Choose your password</PageTitle>
        <PageSubtitle>
          Replace the temporary password we emailed {email ?? 'you'} with one of your own. The
          temporary one stops working the moment you do.
        </PageSubtitle>
      </View>

      {error ? <Alert tone="critical">{error}</Alert> : null}

      <Field
        label="Temporary password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        showPasswordToggle
        autoCapitalize="none"
        autoComplete="current-password"
        onSubmitEditing={submit}
        returnKeyType="next"
      />
      <Field
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        showPasswordToggle
        autoCapitalize="none"
        hint="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        showPasswordToggle
        autoCapitalize="none"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      <Button
        label="Set password and sign in again"
        busy={change.isPending}
        disabled={!current || !next || !confirm}
        onPress={submit}
      />
      <Caption tone="muted">
        Setting your password signs out every device, including this one.
      </Caption>
    </Screen>
  );
}
