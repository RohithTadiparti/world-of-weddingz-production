import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { space } from '@/theme';

interface AuthMe {
  email: string;
  phone: string | null;
  phoneVerifiedAt: string | null;
}

export default function AccountInformation() {
  const email = useAuth((s) => s.user?.email);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [verifyingPhone, setVerifyingPhone] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => (await api.get('/auth/me')).data as AuthMe,
    retry: false,
  });

  if (isPending) {
    return (
      <Screen>
        <Loading rows={3} />
      </Screen>
    );
  }

  return (
    <Screen>
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(3) }}>
          <View style={{ flex: 1, gap: space(0.5) }}>
            <Caption tone="faint">Email Address</Caption>
            <Body>{data?.email ?? email ?? '—'}</Body>
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(3) }}>
          <View style={{ flex: 1, gap: space(0.5) }}>
            <Caption tone="faint">Phone Number</Caption>
            <Body>{data?.phone ?? 'No number on this account'}</Body>
            {data?.phoneVerifiedAt ? <Caption tone="brand">Verified</Caption> : null}
          </View>
          {data?.phone && !data.phoneVerifiedAt ? (
            <Button
              label={verifyingPhone ? 'Cancel' : 'Verify'}
              variant="ghost"
              small
              onPress={() => {
                setError('');
                setNotice('');
                setVerifyingPhone((open) => !open);
              }}
            />
          ) : null}
        </View>
        {verifyingPhone && data?.phone ? (
          <PhoneVerify
            onDone={() => {
              setVerifyingPhone(false);
              setError('');
              setNotice('Phone number confirmed.');
            }}
            onError={(message) => {
              setNotice('');
              setError(message);
            }}
          />
        ) : null}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(3) }}>
          <View style={{ flex: 1, gap: space(0.5) }}>
            <Caption tone="faint">Password</Caption>
            <Body>••••••••</Body>
          </View>
          <Button
            label={changingPassword ? 'Cancel' : 'Change'}
            variant="ghost"
            small
            onPress={() => {
              setError('');
              setNotice('');
              setChangingPassword((open) => !open);
            }}
          />
        </View>
        {changingPassword ? (
          <ChangePassword
            onDone={() => {
              setChangingPassword(false);
              setError('');
              setNotice('Password changed. Every device has been signed out.');
            }}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

function PhoneVerify({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async () => (await api.post('/auth/phone/send-code')).data as { devCode?: string },
    onSuccess: () => setSent(true),
    onError: (err) => onError(apiMessage(err, 'That code could not be sent.')),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      await api.post('/auth/phone/verify', { code: code.trim() });
    },
    onSuccess: onDone,
    onError: (err) => onError(apiMessage(err, 'That code was not accepted.')),
  });

  return (
    <View style={{ gap: space(2), marginTop: space(2) }}>
      {!sent ? (
        <Button
          label="Send the code"
          variant="outline"
          busy={send.isPending}
          onPress={() => send.mutate()}
        />
      ) : (
        <>
          <Field
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            label="Confirm code"
            busy={confirm.isPending}
            disabled={code.trim().length < 4}
            onPress={() => confirm.mutate()}
          />
        </>
      )}
    </View>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: async () => {
      await api.post('/auth/password/change', { currentPassword, newPassword });
    },
    onSuccess: onDone,
    onError: (err) => setError(apiMessage(err, 'Your password could not be changed.')),
  });

  function submit() {
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password must match.');
      return;
    }
    setError('');
    change.mutate();
  }

  return (
    <View style={{ gap: space(2), marginTop: space(2) }}>
      <SectionTitle>Change password</SectionTitle>
      <Caption tone="muted">Changing your password signs out every device, including this one.</Caption>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Field
        label="Current password"
        value={currentPassword}
        onChangeText={setCurrent}
        secureTextEntry
        showPasswordToggle
        autoCapitalize="none"
      />
      <Field
        label="New password"
        value={newPassword}
        onChangeText={setNew}
        secureTextEntry
        showPasswordToggle
        autoCapitalize="none"
        hint="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
      />
      <Field
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirm}
        secureTextEntry
        showPasswordToggle
        autoCapitalize="none"
      />
      <Button
        label="Change password"
        busy={change.isPending}
        disabled={!currentPassword || !newPassword || !confirmPassword}
        onPress={submit}
      />
    </View>
  );
}
