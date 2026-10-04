import { useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, IdentificationCard } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { SelectField } from '@/components/form';
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
import { rgb, space, useTheme } from '@/theme';

const TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'passport', label: 'Passport' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'pan', label: 'PAN' },
];

interface IdentityView {
  profileId: string;
  idType: string | null;
  last4: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
}

interface AadhaarStatus {
  verifiedAt: string | null;
  last4: string | null;
  session: { id: string; status: string } | null;
}

export default function IdentityVerification() {
  const theme = useTheme();
  const qc = useQueryClient();
  const [idType, setIdType] = useState('aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: me, isPending: loadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data as { id?: string | null },
    retry: false,
  });
  const profileId = me?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['identity', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/users/profiles/${profileId}/identity`)).data as IdentityView,
    retry: false,
  });

  const { data: aadhaar } = useQuery({
    queryKey: ['identity-aadhaar', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/identity/aadhaar`)).data as AadhaarStatus,
    retry: false,
  });

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['identity', profileId] });
    await qc.invalidateQueries({ queryKey: ['identity-aadhaar', profileId] });
    await qc.invalidateQueries({ queryKey: ['biodata-completion', profileId] });
  }

  async function submitDocument() {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/users/profiles/${profileId}/identity`, { idType, idNumber });
      setIdNumber('');
      setNotice('Document recorded. An officer confirms it in person.');
      await refresh();
    } catch (err) {
      setError(apiMessage(err, 'That document could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/profiles/${profileId}/identity/aadhaar/send-otp`, {
        aadhaarNumber: idNumber,
      });
      setNotice('A code was sent to the number on this Aadhaar.');
    } catch (err) {
      setError(apiMessage(err, 'The code could not be sent.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmOtp() {
    if (!profileId || !aadhaar?.session?.id) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/profiles/${profileId}/identity/aadhaar/verify-otp`, {
        sessionId: aadhaar.session.id,
        code: otp,
      });
      setOtp('');
      setNotice('Aadhaar confirmed.');
      await refresh();
    } catch (err) {
      setError(apiMessage(err, 'That code could not be confirmed.'));
    } finally {
      setBusy(false);
    }
  }

  if (loadingMe || (profileId && isPending)) {
    return (
      <Screen>
        <Loading rows={3} />
      </Screen>
    );
  }

  if (!profileId) {
    return (
      <Screen>
        <Card>
          <SectionTitle>No profile yet</SectionTitle>
          <Body tone="muted">Identity verification belongs to a matrimony profile.</Body>
        </Card>
      </Screen>
    );
  }

  const verified = Boolean(data?.verifiedAt || aadhaar?.verifiedAt);
  const onFile = Boolean(data?.submittedAt);

  if (verified) {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', paddingVertical: space(8), gap: space(3) }}>
          <CheckCircle size={64} weight="fill" color={rgb(theme.positiveFg)} />
          <SectionTitle>Verified</SectionTitle>
          <Body tone="muted" style={{ textAlign: 'center' }}>
            Your identity has been verified.
          </Body>
        </Card>
        <Card>
          <Row
            label="ID Proof"
            value={
              data?.idType
                ? `${TYPES.find((t) => t.value === data.idType)?.label ?? data.idType} ending ${data.last4 ?? '—'}`
                : 'Verified'
            }
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      <Card>
        <SectionTitle>ID Proof</SectionTitle>
        {onFile ? (
          <Body>
            {TYPES.find((t) => t.value === data?.idType)?.label ?? data?.idType} ending{' '}
            {data?.last4}. Awaiting an officer.
          </Body>
        ) : (
          <>
            <Caption tone="muted">
              One document, one profile. The number is checked, hashed and discarded. Only the last
              four digits are kept.
            </Caption>
            <SelectField label="Document" value={idType} options={TYPES} onChange={setIdType} />
            <Field
              label="Number"
              value={idNumber}
              onChangeText={setIdNumber}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Button
              label="Record this document"
              busy={busy}
              disabled={idNumber.trim().length < 8}
              onPress={() => void submitDocument()}
            />
          </>
        )}
      </Card>

      {idType === 'aadhaar' && !verified ? (
        <Card>
          <SectionTitle>Aadhaar OTP</SectionTitle>
          <Caption tone="muted">Confirm the Aadhaar with the code sent to the registered mobile.</Caption>
          {!onFile ? (
            <Field
              label="Aadhaar number"
              value={idNumber}
              onChangeText={setIdNumber}
              keyboardType="number-pad"
            />
          ) : null}
          <Button
            label="Send code"
            variant="outline"
            busy={busy}
            disabled={idNumber.trim().length < 8 && !onFile}
            onPress={() => void sendOtp()}
          />
          {aadhaar?.session ? (
            <>
              <Field
                label="Code"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Button
                label="Confirm code"
                busy={busy}
                disabled={otp.trim().length < 4}
                onPress={() => void confirmOtp()}
              />
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <IdentificationCard size={20} color={rgb(theme.brandStrong)} />
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: '600' }}>{label}</Body>
        <Caption tone="muted">{value}</Caption>
      </View>
      <Caption tone="brand">Verified</Caption>
    </View>
  );
}
