import { useState, useEffect } from 'react';
import { View, ScrollView, Alert as NativeAlert, Pressable } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, apiMessage } from '@/lib/api';
import {
  PersonalForm,
  MaritalHistoryForm,
  EducationCareerForm,
  FamilyBackgroundForm,
  HoroscopeSection,
  PreferencesSection,
  UploadFlow,
} from '@/components/biodata';
import { ProfileCompletionCard } from '@/components/profile-completion-card';
import { DetailGrid, DetailRow } from '@/components/chrome';
import {
  Body,
  Button,
  Caption,
  Card,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { radius, space } from '@/theme';
import { ageFrom, genderForIndividualRole, GENDER_LABEL } from '@/lib/labels';
import { formatPlace } from '@/lib/format';
import { useAuth } from '@/store/auth';

interface BiodataResponse {
  profileId: string;
  details: Record<string, unknown> | null;
  dateOfBirth: string | null;
  profile?: {
    displayName?: string | null;
    gender?: string | null;
    dateOfBirth?: string | null;
    city?: string | null;
    managingFor?: string | null;
  };
}

export default function BiodataWizard() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const params = useLocalSearchParams<{ profileId?: string | string[] }>();

  const [step, setStep] = useState(0);
  const [autofilledKeys, setAutofilledKeys] = useState<Set<string>>(new Set());

  const { data: me, isPending: loadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: async () =>
      (await api.get('/users/me')).data as { id?: string | null; gender?: string | null; managingFor?: string | null; displayName?: string | null; dateOfBirth?: string | null; city?: string | null },
    retry: false,
  });
  // A family member can open a managed person's biodata by profile id.  Never
  // fall back to the family account after a profile was explicitly selected:
  // that is how one relative's fields leaked into another one's form.
  const selectedProfileId = Array.isArray(params.profileId) ? params.profileId[0] : params.profileId;
  // A family account's own profile holds the parent's details. The biodata is
  // the son's, daughter's or relative's, so it never falls back to the account.
  const isFamily = user?.role === 'family';
  const { data: relatives, isPending: loadingRelatives } = useQuery({
    queryKey: ['actable-profiles'],
    enabled: isFamily && !selectedProfileId,
    queryFn: async () => {
      const data = (await api.get('/agents/profiles/actable')).data;
      return (Array.isArray(data) ? data : (data?.data ?? [])) as { id: string; displayName: string }[];
    },
    retry: false,
  });
  const onlyRelative = relatives?.length === 1 ? relatives[0].id : null;
  const profileId = selectedProfileId ?? (isFamily ? onlyRelative : (me?.id ?? null));
  const isOwnProfile = profileId !== null && profileId === me?.id;

  const { data: full, isPending } = useQuery({
    queryKey: ['biodata-details', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details`)).data as BiodataResponse,
    retry: false,
  });

  const { data: photos } = useQuery({
    queryKey: ['biodata-photos', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/photos`)).data as {
        photos: string[];
        primaryPhotoUrl?: string | null;
      },
    retry: false,
  });

  const { data: completion } = useQuery({
    queryKey: ['biodata-completion', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/completion`)).data as { percent: number, complete: boolean },
    retry: false,
  });

  // Skip selection screen if already has details
  useEffect(() => {
    if (step === 0 && full !== undefined) {
      const hasDetails = Object.keys(full?.details ?? {}).length > 0;
      if (hasDetails) {
        setStep(1);
      }
    }
  }, [step, full]);

  // Expo can keep this route mounted while a family member changes the target
  // profile. Reset route-local UI state; the query keys already isolate the
  // server data, and this prevents the previous person's draft/highlights
  // surviving for one render.
  useEffect(() => {
    setStep(0);
    setAutofilledKeys(new Set());
  }, [profileId]);

  if (loadingMe || (profileId && isPending) || (isFamily && !selectedProfileId && loadingRelatives)) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (!profileId && isFamily) {
    return (
      <Screen>
        <Card style={{ gap: space(3) }}>
          <SectionTitle>Whose biodata?</SectionTitle>
          <Body tone="muted">
            A biodata is for the person you are finding a match for, not for you.
          </Body>
          {(relatives ?? []).length === 0 ? (
            <Caption tone="faint">
              No family profiles yet. Add your son, daughter or relative on the website under
              Family Profiles.
            </Caption>
          ) : (
            (relatives ?? []).map((relative) => (
              <Button
                key={relative.id}
                variant="outline"
                label={relative.displayName}
                onPress={() => router.setParams({ profileId: relative.id })}
              />
            ))
          )}
        </Card>
      </Screen>
    );
  }

  if (!profileId) {
    return (
      <Screen>
        <Card>
          <SectionTitle>No profile yet</SectionTitle>
          <Body tone="muted">
            This account has no matrimony profile.
          </Body>
        </Card>
      </Screen>
    );
  }

  const d = (full?.details ?? {}) as Record<string, unknown>;
  // A self-managed bride/groom's role is canonical. Managed profiles can be
  // either gender, so they intentionally keep their persisted value.
  const fixedGender = isOwnProfile ? genderForIndividualRole(user?.role) : null;
  const targetGender = String(fixedGender ?? full?.profile?.gender ?? full?.profile?.managingFor ?? me?.gender ?? me?.managingFor ?? '').toLowerCase();
  const isGroom = targetGender === 'groom' || targetGender === 'male' || targetGender === 'm';
  const showMarital = d.maritalStatus && d.maritalStatus !== 'never_married';

  // Photographs are on the first step: the server will not save the basic
  // information until the profile has three of them, so asking for them later
  // meant step one could never be saved by somebody new.
  const steps = [
    { id: 'personal', title: 'Basic Information & Photos' },
    ...(showMarital ? [{ id: 'marital', title: 'Marital History' }] : []),
    { id: 'education', title: 'Education & Career' },
    { id: 'family', title: 'Family Background' },
    { id: 'horoscope', title: 'Horoscope' },
    { id: 'preferences', title: 'Partner Preferences' },
    { id: 'summary', title: 'Review Your Biodata' },
  ];

  const totalSteps = steps.length;
  // Make sure step doesn't exceed totalSteps if marital status changes back to never_married
  const currentStepIndex = Math.min(step - 1, totalSteps - 1);
  const currentStep = steps[currentStepIndex];

  const refresh = () => {
    for (const key of ['biodata-details', 'biodata-completion', 'biodata-photos']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const nextStep = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      router.back();
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  if (step === 0) {
    return (
      <Screen scroll={false}>
        <UploadFlow
          profileId={profileId}
          onCustom={() => setStep(1)}
          onExtracted={(data) => {
            const flatData = {
              ...data,
              ...(data.education || {}),
              father: data.family?.father ?? data.father,
              mother: data.family?.mother ?? data.mother,
            };
            delete flatData.education;
            delete flatData.family;

            const keys = new Set<string>();
            const traverse = (obj: any, prefix = '') => {
              if (!obj || typeof obj !== 'object') return;
              for (const [k, v] of Object.entries(obj)) {
                if (v) {
                  keys.add(prefix ? `${prefix}.${k}` : k);
                  traverse(v, prefix ? `${prefix}.${k}` : k);
                }
              }
            };
            traverse(flatData);
            setAutofilledKeys(keys);

            // Update local cache
            qc.setQueryData(['me'], (old: any) => ({
              ...old,
              displayName: data.firstName ? `${data.firstName} ${data.lastName ?? ''}`.trim() : old?.displayName,
              dateOfBirth: data.dateOfBirth ?? old?.dateOfBirth,
              gender: data.gender ?? old?.gender,
            }));

            qc.setQueryData(['biodata-details', profileId], (old: any) => {
              return {
                ...old,
                details: {
                  ...(old?.details ?? {}),
                  ...flatData,
                }
              };
            });
            setStep(1);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: space(2) }}>
        <SectionTitle>{currentStep.title}</SectionTitle>
        <Caption tone="muted" style={{ fontWeight: '600' }}>
          Step {currentStepIndex + 1} of {totalSteps}
        </Caption>
      </View>
      {completion && step > 0 && currentStep.id !== 'summary' && (
        <View style={{ marginBottom: space(4) }}>
          <ProfileCompletionCard percent={completion.percent} hideAction />
        </View>
      )}

      {currentStep.id === 'personal' && (
        <PersonalForm
          key={`personal-${profileId}`}
          profileId={profileId}
          me={me as Record<string, unknown>}
          full={full}
          syncAccount={isOwnProfile}
          fixedGender={fixedGender}
          photos={photos?.photos ?? []}
          onPhotoAdded={(url) => {
            void api.post(`/profiles/${profileId}/details/photos`, { url }).then(refresh).catch((err) => {
              console.error('Failed to add photo:', err);
              // The server's own words: an AI-generated photo is refused with
              // what to upload instead, which a generic "try again" would hide.
              NativeAlert.alert('Photo not added', apiMessage(err, 'Your photo could not be uploaded. Please try again.'));
            });
          }}
          onPhotoRemoved={(url) => {
            void api.delete(`/profiles/${profileId}/details/photos`, { data: { url } }).then(refresh).catch((err) => {
              console.error('Failed to remove photo:', err);
              NativeAlert.alert('Remove Failed', 'Your photo could not be removed. Please try again.');
            });
          }}
          primaryPhotoUrl={photos?.primaryPhotoUrl ?? null}
          onMakePrimary={(url) => {
            void api.put(`/profiles/${profileId}/details/primary-photo`, { url }).then(refresh).catch(() => {
              NativeAlert.alert('Not Changed', 'That photo could not be set as your profile photo. Please try again.');
            });
          }}
          onSaved={nextStep}
          onBack={prevStep}
          autofilledKeys={autofilledKeys}
        />
      )}

      {currentStep.id === 'marital' && (
        <MaritalHistoryForm
          key={`marital-${profileId}`}
          profileId={profileId}
          details={d}
          onSaved={nextStep}
          onBack={prevStep}
          onSkip={nextStep}
          autofilledKeys={autofilledKeys}
        />
      )}

      {currentStep.id === 'education' && (
        <EducationCareerForm
          key={`education-${profileId}`}
          profileId={profileId}
          details={d}
          onSaved={nextStep}
          onBack={prevStep}
          onSkip={nextStep}
          autofilledKeys={autofilledKeys}
        />
      )}

      {currentStep.id === 'family' && (
        <FamilyBackgroundForm
          key={`family-${profileId}`}
          profileId={profileId}
          details={d}
          isGroom={isGroom}
          onSaved={nextStep}
          onBack={prevStep}
          onSkip={nextStep}
          autofilledKeys={autofilledKeys}
        />
      )}

      {currentStep.id === 'horoscope' && (
        <HoroscopeSection
          key={`horoscope-${profileId}`}
          profileId={profileId}
          details={d}
          onSaved={() => {
            refresh();
            nextStep();
          }}
          onBack={prevStep}
          onSkip={nextStep}
          isWizard
        />
      )}

      {currentStep.id === 'preferences' && (
        <PreferencesSection
          key={`preferences-${profileId}`}
          profileId={profileId}
          details={d}
          onSaved={() => {
            refresh();
            nextStep();
          }}
          onBack={prevStep}
          onSkip={nextStep}
          isWizard
        />
      )}

      {currentStep.id === 'summary' && (
        <View style={{ gap: space(4) }}>
          {completion && (
            <ProfileCompletionCard percent={completion.percent} hideAction />
          )}

          <Card style={{ padding: space(3), gap: space(1) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SectionTitle>Basic Information</SectionTitle>
              <Pressable onPress={() => setStep(steps.findIndex(s => s.id === 'personal') + 1)}><Caption tone="brand">Edit</Caption></Pressable>
            </View>
            <View style={{ marginTop: space(2) }}>
              <DetailGrid>
                <DetailRow label="Name">{`${d.firstName ?? ''} ${d.lastName ?? ''}`.trim()}</DetailRow>
                <DetailRow label="Date of Birth">{String(full?.profile?.dateOfBirth ?? full?.dateOfBirth ?? me?.dateOfBirth ?? '—').slice(0, 10)}</DetailRow>
                <DetailRow label="Age">{ageFrom(full?.profile?.dateOfBirth ?? full?.dateOfBirth ?? me?.dateOfBirth) ?? '—'}</DetailRow>
                <DetailRow label="Gender">{GENDER_LABEL[fixedGender ?? String(full?.profile?.gender ?? me?.gender ?? '').toLowerCase()] ?? '—'}</DetailRow>
                <DetailRow label="Height">{String(d.height ?? '—')}</DetailRow>
                <DetailRow label="Complexion">{String(d.complexion ?? '—')}</DetailRow>
                <DetailRow label="Marital Status">{String(d.maritalStatus ?? '—').replace(/_/g, ' ')}</DetailRow>
                <DetailRow label="Religion">{String(d.religion ?? '—')}</DetailRow>
                <DetailRow label="Caste">{String(d.caste ?? '—')}</DetailRow>
                {d.subcaste ? <DetailRow label="Subcaste">{String(d.subcaste)}</DetailRow> : null}
              </DetailGrid>
            </View>
          </Card>

          <Card style={{ padding: space(3), gap: space(1) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SectionTitle>Family Details</SectionTitle>
              <Pressable onPress={() => setStep(steps.findIndex(s => s.id === 'family') + 1)}><Caption tone="brand">Edit</Caption></Pressable>
            </View>
            <View style={{ marginTop: space(2) }}>
              <DetailGrid>
                <DetailRow label="Father">
                  {(d.father as any)?.lifeStatus === 'deceased' ? `Late ${(d.father as any)?.name ?? '—'}` : `Mr. ${(d.father as any)?.name ?? '—'}`}
                </DetailRow>
                {(d.father as any)?.lifeStatus !== 'deceased' && (d.father as any)?.profession ? (
                  <DetailRow label="Profession">{String((d.father as any)?.profession)}</DetailRow>
                ) : null}
                <DetailRow label="Mother">
                  {(d.mother as any)?.lifeStatus === 'deceased' ? `Late ${(d.mother as any)?.name ?? '—'}` : `Mrs. ${(d.mother as any)?.name ?? '—'}`}
                </DetailRow>
                {(d.mother as any)?.lifeStatus !== 'deceased' && (d.mother as any)?.profession ? (
                  <DetailRow label="Profession">{String((d.mother as any)?.profession)}</DetailRow>
                ) : null}
                {d.brothers ? <DetailRow label="Brothers">{String(d.brothers)}</DetailRow> : null}
                {d.sisters ? <DetailRow label="Sisters">{String(d.sisters)}</DetailRow> : null}
              </DetailGrid>
            </View>
          </Card>

          <Card style={{ padding: space(3), gap: space(1) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SectionTitle>Education & Career</SectionTitle>
              <Pressable onPress={() => setStep(steps.findIndex(s => s.id === 'education') + 1)}><Caption tone="brand">Edit</Caption></Pressable>
            </View>
            <View style={{ marginTop: space(2) }}>
              <DetailGrid>
                <DetailRow label="Education">{String(d.highestQualification ?? '—')}</DetailRow>
                {d.college ? <DetailRow label="College">{String(d.college)}</DetailRow> : null}
                <DetailRow label="Occupation">{String(d.occupationStatus ?? '—').replace(/_/g, ' ')}</DetailRow>
                {d.profession ? <DetailRow label="Profession">{String(d.profession)}</DetailRow> : null}
                {d.companyName ? <DetailRow label="Company">{String(d.companyName)}</DetailRow> : null}
                {d.annualIncome ? <DetailRow label="Income">{String(d.annualIncome)}</DetailRow> : null}
                {d.workCountry || d.workCity ? <DetailRow label="Work Location">{[d.workCity, d.workState, d.workCountry].filter(Boolean).join(', ')}</DetailRow> : null}
              </DetailGrid>
            </View>
          </Card>
          
          <Card style={{ padding: space(3), gap: space(1) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SectionTitle>Location & Personal Details</SectionTitle>
              <Pressable onPress={() => setStep(steps.findIndex(s => s.id === 'personal') + 1)}><Caption tone="brand">Edit</Caption></Pressable>
            </View>
            <View style={{ marginTop: space(2) }}>
              <DetailGrid>
                {d.city || d.country ? <DetailRow label="Current Location">{[d.city, d.state, d.country].filter(Boolean).join(', ')}</DetailRow> : null}
                {d.diet ? <DetailRow label="Diet">{String(d.diet)}</DetailRow> : null}
                {d.smoking ? <DetailRow label="Smoking">{String(d.smoking)}</DetailRow> : null}
                {d.drinking ? <DetailRow label="Drinking">{String(d.drinking)}</DetailRow> : null}
                {d.languages ? <DetailRow label="Languages">{Array.isArray(d.languages) ? d.languages.join(', ') : String(d.languages)}</DetailRow> : null}
              </DetailGrid>
            </View>
          </Card>

          <Card style={{ padding: space(3), gap: space(1) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SectionTitle>Horoscope</SectionTitle>
              <Pressable onPress={() => setStep(steps.findIndex(s => s.id === 'horoscope') + 1)}><Caption tone="brand">Edit</Caption></Pressable>
            </View>
            <View style={{ marginTop: space(2) }}>
              <DetailGrid>
                <DetailRow label="Time of Birth">{String(d.timeOfBirth ?? '—')}</DetailRow>
                <DetailRow label="Place of Birth">{formatPlace((d.horoscope as Record<string, unknown> | undefined)?.birthPlace) || '—'}</DetailRow>
                {d.rasi ? <DetailRow label="Rasi">{String(d.rasi)}</DetailRow> : null}
                {d.star ? <DetailRow label="Star">{String(d.star)}</DetailRow> : null}
                {d.padam ? <DetailRow label="Padam">{String(d.padam)}</DetailRow> : null}
                {d.gothram ? <DetailRow label="Gothram">{String(d.gothram)}</DetailRow> : null}
                {d.horoscopeMatch ? <DetailRow label="Match Preference">{String(d.horoscopeMatch)}</DetailRow> : null}
              </DetailGrid>
            </View>
          </Card>

          <Card style={{ padding: space(3), gap: space(1) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SectionTitle>Partner Preferences</SectionTitle>
              <Pressable onPress={() => setStep(steps.findIndex(s => s.id === 'preferences') + 1)}><Caption tone="brand">Edit</Caption></Pressable>
            </View>
            <View style={{ marginTop: space(2) }}>
              <DetailGrid>
                {(d.partnerPreferences as any)?.ageMin || (d.partnerPreferences as any)?.ageMax ? <DetailRow label="Preferred age">{`${(d.partnerPreferences as any)?.ageMin ?? ''} to ${(d.partnerPreferences as any)?.ageMax ?? ''}`}</DetailRow> : null}
                {(d.partnerPreferences as any)?.heightMin || (d.partnerPreferences as any)?.heightMax ? <DetailRow label="Height">{`${(d.partnerPreferences as any)?.heightMin ?? ''} to ${(d.partnerPreferences as any)?.heightMax ?? ''}`}</DetailRow> : null}
                {(d.partnerPreferences as any)?.maritalStatus ? <DetailRow label="Marital Status">{Array.isArray((d.partnerPreferences as any).maritalStatus) ? (d.partnerPreferences as any).maritalStatus.join(', ') : String((d.partnerPreferences as any).maritalStatus)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.religion ? <DetailRow label="Religion">{String((d.partnerPreferences as any).religion)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.caste ? <DetailRow label="Caste">{Array.isArray((d.partnerPreferences as any).caste) ? (d.partnerPreferences as any).caste.join(', ') : String((d.partnerPreferences as any).caste)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.motherTongue ? <DetailRow label="Mother Tongue">{Array.isArray((d.partnerPreferences as any).motherTongue) ? (d.partnerPreferences as any).motherTongue.join(', ') : String((d.partnerPreferences as any).motherTongue)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.education ? <DetailRow label="Education">{Array.isArray((d.partnerPreferences as any).education) ? (d.partnerPreferences as any).education.join(', ') : String((d.partnerPreferences as any).education)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.occupation ? <DetailRow label="Occupation">{Array.isArray((d.partnerPreferences as any).occupation) ? (d.partnerPreferences as any).occupation.join(', ') : String((d.partnerPreferences as any).occupation)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.nri ? <DetailRow label="NRI Preference">{String((d.partnerPreferences as any).nri)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.location ? <DetailRow label="Location">{Array.isArray((d.partnerPreferences as any).location) ? (d.partnerPreferences as any).location.join(', ') : String((d.partnerPreferences as any).location)}</DetailRow> : null}
                {(d.partnerPreferences as any)?.otherInfo ? <DetailRow label="Looking for Anything Else">{String((d.partnerPreferences as any).otherInfo)}</DetailRow> : null}
              </DetailGrid>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Button label="Back" variant="outline" onPress={prevStep} />
            <Button style={{ flex: 1 }} label="Complete Biodata" onPress={() => {
              if (completion && !completion.complete) {
                // Not completed - require completion
                NativeAlert.alert("Incomplete", "Please fill all mandatory fields (marked with *) across all steps to complete your Biodata.");
              } else {
                router.back();
              }
            }} />
          </View>
        </View>
      )}
    </Screen>
  );
}
