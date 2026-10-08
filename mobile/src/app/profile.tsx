import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { formatDate } from '@/shared/dates';
import { ROLE_LABEL } from '@/shared/permissions';
import { DetailGrid, DetailRow } from '@/components/chrome';
import { ChoiceField } from '@/components/biodata/choice-field';
import { STATES_BY_COUNTRY, districtsForState, DISTRICTS_BY_STATE } from '@/shared/locations';
import {
  adultDobMaxIso,
  dobInputToIso,
  DobField,
  isoToDobInput,
  SelectField,
  Textarea,
} from '@/components/form';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Eyebrow,
  Field,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { space } from '@/theme';
import { genderForIndividualRole } from '@/lib/labels';

/**
 * My Profile: what the platform holds about the person, not their business.
 *
 * The web app's Profile page, less the parts that only mean something to
 * somebody in the matches. A vendor and a verification officer have no biodata,
 * so the visibility control and the steward fields are not here — they were
 * noise on the web page too (EZ1-I85, EZ1-I93) and the same argument settles it
 * for this app.
 *
 * Read first, edit on request. A page that opens as a form invites an accidental
 * edit of a field somebody only came to check.
 */
interface MeResponse {
  displayName?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  city?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  bio?: string | null;
}

const EMPTY = {
  displayName: '',
  gender: '',
  dateOfBirth: '',
  state: '',
  city: '',
  address: '',
  contactPhone: '',
  bio: '',
};

function getStateForCity(city: string | null | undefined): string {
  if (!city) return '';
  for (const [state, cities] of Object.entries(DISTRICTS_BY_STATE)) {
    if (cities.includes(city)) return state;
  }
  return '';
}

/** The server's own rule, applied in the field so a typo costs no round trip. */
const MOBILE_10 = /^[6-9]\d{9}$/;

/**
 * What is wrong with a typed date of birth, if anything.
 *
 * While it is still being typed, a partial date is not an error yet. On
 * save it is: a date the app cannot read is never sent to the server as typed.
 */
function dobError(value: string, final = false): string | undefined {
  if (!value) return undefined;
  const iso = dobInputToIso(value);
  if (!iso) {
    if (value.length === 10) return 'Enter a valid date of birth';
    return final ? 'Enter the full date of birth as DD/MM/YYYY' : undefined;
  }
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (iso > todayIso) {
    return 'A date of birth cannot be in the future';
  }
  if (iso > adultDobMaxIso()) return 'You must be at least 18 years old.';
  return undefined;
}

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export default function Profile() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isFamilyMember = user?.role === 'family';
  const fixedGender = genderForIndividualRole(user?.role);

  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data as MeResponse,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      displayName: data.displayName ?? '',
      gender: fixedGender ?? data.gender ?? '',
      state: getStateForCity(data.city),
      dateOfBirth: isoToDobInput(data.dateOfBirth ?? ''),
      city: data.city ?? '',
      address: data.address ?? '',
      contactPhone: data.contactPhone ?? '',
      bio: data.bio ?? '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      // Blank optional fields are omitted rather than sent empty, which the
      // validators read as malformed rather than absent.
      const payload: Record<string, string> = { displayName: form.displayName.trim() };
      for (const key of ['gender', 'dateOfBirth', 'city', 'address', 'contactPhone', 'bio'] as const) {
        const value = form[key].trim();
        if (key === 'gender' && fixedGender) {
          payload.gender = fixedGender;
          continue;
        }
        if (!value) continue;
        if (key === 'dateOfBirth') {
          // Checked complete in submit(); never sent as typed.
          const iso = dobInputToIso(value);
          if (iso) payload[key] = iso;
        } else {
          payload[key] = value;
        }
      }
      await api.put('/users/me/profile', payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      setEditing(false);
      setError('');
      setNotice('Saved. This is what we hold for you now.');
    },
    onError: (err) => setError(apiMessage(err, 'Your profile could not be saved.')),
  });

  function submit() {
    setNotice('');
    setError('');
    const errors: Record<string, string> = {};
    if (!form.displayName.trim()) errors.displayName = 'Tell us what to call you';
    const dateOfBirthError = dobError(form.dateOfBirth.trim(), true);
    if (dateOfBirthError) errors.dateOfBirth = dateOfBirthError;
    if (form.contactPhone.trim()) {
      const digits = form.contactPhone.replace(/[\s-]/g, '').replace(/^\+91/, '');
      if (!MOBILE_10.test(digits)) errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    save.mutate();
  }

  const set = (key: keyof typeof EMPTY) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    // The mark clears the moment they start fixing the field it is on.
    setFieldErrors((fe) => (fe[key] ? { ...fe, [key]: '' } : fe));
  };

  function setDateOfBirth(value: string) {
    setForm((f) => ({ ...f, dateOfBirth: value }));
    setFieldErrors((fe) => ({ ...fe, dateOfBirth: dobError(value) ?? '' }));
  }

  if (isPending) {
    return (
      <Screen>
        <Loading rows={3} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Eyebrow>Signed in as</Eyebrow>
        <SectionTitle>{user?.email ?? 'Signed in'}</SectionTitle>
        <Caption tone="faint">
          {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
          {user?.isVerified ? ' · email confirmed' : ' · email not confirmed'}
        </Caption>
      </Card>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}
      {isFamilyMember ? (
        <Alert tone="caution">
          Important: you are logged in as a Family Member. These are your own details as the
          parent or guardian, and they are never shown in matches. The bride or groom you are
          finding a match for has their own profile and biodata under Family Profiles.
        </Alert>
      ) : null}

      {editing ? (
        <Card>
          <SectionTitle>{isFamilyMember ? 'Family Member Details' : 'Edit your details'}</SectionTitle>
          <Field
            label={isFamilyMember ? 'Name (Your)' : 'Name'}
            value={form.displayName}
            onChangeText={set('displayName')}
            error={fieldErrors.displayName}
            placeholder="The name people see"
          />
          {isFamilyMember ? (
            <Field label="Email Address (Your)" value={user?.email ?? ''} editable={false} />
          ) : null}
          <SelectField
            label={isFamilyMember ? 'Gender (Your)' : 'Gender'}
            value={form.gender}
            options={GENDERS}
            onChange={set('gender')}
            disabled={Boolean(fixedGender)}
            hint={fixedGender ? 'Set from your registered role.' : undefined}
          />
          <DobField
            label={isFamilyMember ? 'Date of Birth (Your)' : 'Date of birth'}
            value={form.dateOfBirth}
            onChange={setDateOfBirth}
            error={fieldErrors.dateOfBirth}
          />
          <ChoiceField
            label="State"
            value={form.state}
            options={STATES_BY_COUNTRY['India'] ?? []}
            onChange={(newState) => {
              setForm((f) => ({
                ...f,
                state: newState,
                city: districtsForState(newState).includes(f.city) ? f.city : '',
              }));
            }}
            placeholder="Choose…"
          />
          <ChoiceField label={isFamilyMember ? 'City (Your)' : 'City'} value={form.city} options={districtsForState(form.state)} onChange={set('city')} placeholder="Choose…" />
          <Field label={isFamilyMember ? 'Address (Your)' : 'Address'} value={form.address} onChangeText={set('address')} />
          <Field
            label={isFamilyMember ? 'Mobile Number (Your)' : 'Contact number'}
            value={form.contactPhone}
            onChangeText={set('contactPhone')}
            error={fieldErrors.contactPhone}
            keyboardType="phone-pad"
            placeholder="10-digit mobile number"
          />
          <Textarea label="About you" value={form.bio} onChange={set('bio')} rows={4} />

          <View style={{ gap: space(2) }}>
            <Button label="Save" busy={save.isPending} onPress={submit} />
            <Button
              label="Cancel"
              variant="outline"
              disabled={save.isPending}
              onPress={() => {
                setEditing(false);
                setFieldErrors({});
                setError('');
              }}
            />
          </View>
        </Card>
      ) : (
        <Card>
          <SectionTitle>{isFamilyMember ? 'Family Member Details' : 'Your details'}</SectionTitle>
          <DetailGrid>
            {isFamilyMember ? <DetailRow label="Email Address (Your)">{user?.email || '—'}</DetailRow> : null}
            <DetailRow label={isFamilyMember ? 'Name (Your)' : 'Name'}>{data?.displayName || '—'}</DetailRow>
            <DetailRow label={isFamilyMember ? 'Gender (Your)' : 'Gender'}>
              {GENDERS.find((g) => g.value === (fixedGender ?? data?.gender))?.label ?? '—'}
            </DetailRow>
            <DetailRow label={isFamilyMember ? 'Date of Birth (Your)' : 'Date of birth'}>{formatDate(data?.dateOfBirth, '—')}</DetailRow>
            <DetailRow label="State">{getStateForCity(data?.city) || '—'}</DetailRow>
            <DetailRow label={isFamilyMember ? 'City (Your)' : 'City'}>{data?.city || '—'}</DetailRow>
            <DetailRow label={isFamilyMember ? 'Address (Your)' : 'Address'}>{data?.address || '—'}</DetailRow>
            <DetailRow label={isFamilyMember ? 'Mobile Number (Your)' : 'Contact number'}>{data?.contactPhone || '—'}</DetailRow>
          </DetailGrid>
          {data?.bio ? <Body tone="muted">{data.bio}</Body> : null}
          <Button label="Edit profile" onPress={() => setEditing(true)} />
        </Card>
      )}

      <PageSubtitle>
        Your email address and what your account may do are set by the platform. Everything else on
        this page is yours to change.
      </PageSubtitle>
    </Screen>
  );
}
