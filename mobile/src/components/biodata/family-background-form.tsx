import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { SelectField } from '@/components/form';
import { Alert, Button, Card, Field } from '@/components/ui';
import { PROFESSIONS } from '@/shared/reference';
import { space } from '@/theme';
import { ChoiceField, DependentLocation, canonical } from './choice-field';
import { capitalizeWords } from '@/lib/format';
import { FAMILY_TYPES, FAMILY_STATUSES, LIFE_STATUSES, stored } from './constants';

interface Form {
  fatherName: string;
  fatherProfession: string;
  fatherLifeStatus: string;
  motherName: string;
  motherProfession: string;
  motherLifeStatus: string;
  familyType: string;
  familyStatus: string;
  brothers: string;
  sisters: string;
  familyNetWorth: string;
  nativeCountry: string;
  nativeState: string;
  nativeDistrict: string;
  nativePlace: string;
  isNri: string;
  nriCity: string;
  nriCountry: string;
}

export function FamilyBackgroundForm({
  profileId,
  details,
  onSaved,
  onBack,
  onSkip,
  autofilledKeys,
  isGroom,
}: {
  profileId: string;
  details: Record<string, unknown>;
  onSaved: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  autofilledKeys?: Set<string>;
  isGroom: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const father = (details.father as Record<string, unknown>) ?? {};
  const mother = (details.mother as Record<string, unknown>) ?? {};
  
  const [form, setForm] = useState<Form>({
    fatherName: capitalizeWords(String(father.name ?? '')),
    fatherProfession: canonical(String(father.profession ?? ''), PROFESSIONS),
    fatherLifeStatus: String(father.lifeStatus ?? ''),
    motherName: capitalizeWords(String(mother.name ?? '')),
    motherProfession: canonical(String(mother.profession ?? ''), PROFESSIONS),
    motherLifeStatus: String(mother.lifeStatus ?? ''),
    familyType: String(details.familyType ?? ''),
    familyStatus: String(details.familyStatus ?? ''),
    brothers: stored(details.brothers),
    sisters: stored(details.sisters),
    familyNetWorth: stored(details.familyNetWorth),
    nativeCountry: String(details.nativeCountry ?? ''),
    nativeState: String(details.nativeState ?? ''),
    nativeDistrict: String(details.nativeDistrict ?? ''),
    nativePlace: capitalizeWords(String(details.nativePlace ?? '')),
    isNri: details.isNri === true ? 'yes' : 'no',
    nriCity: capitalizeWords(String(details.nriCity ?? '')),
    nriCountry: capitalizeWords(String(details.nriCountry ?? '')),
  });

  const save = useMutation({
    mutationFn: async () => {
      const nri = form.isNri === 'yes';
      const payload = {
        father: {
          name: form.fatherName.trim(),
          profession: form.fatherProfession.trim() || undefined,
          lifeStatus: form.fatherLifeStatus || undefined,
        },
        mother: {
          name: form.motherName.trim(),
          profession: form.motherProfession.trim() || undefined,
          lifeStatus: form.motherLifeStatus || undefined,
        },
        familyType: form.familyType,
        familyStatus: form.familyStatus,
        brothers: Number(form.brothers) || 0,
        sisters: Number(form.sisters) || 0,
        ...(isGroom ? { familyNetWorth: Number(form.familyNetWorth) } : {}),
        nativeCountry: form.nativeCountry || undefined,
        nativeState: form.nativeState || undefined,
        nativeDistrict: form.nativeDistrict || undefined,
        nativePlace: form.nativePlace.trim() || undefined,
        isNri: nri,
        nriCity: nri ? form.nriCity.trim() || undefined : undefined,
        nriCountry: nri ? form.nriCountry.trim() || undefined : undefined,
      };
      await api.put(`/profiles/${profileId}/details/family`, payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['biodata-details', profileId] });
      await qc.invalidateQueries({ queryKey: ['biodata-completion', profileId] });
      setError('');
      onSaved();
    },
    onError: (err) => setError(apiMessage(err, 'Family background could not be saved.')),
  });

  const set = (key: keyof Form, capitalize?: boolean) => (value: string) => {
    setErrors(e => ({ ...e, [key]: '' }));
    setForm({ ...form, [key]: capitalize ? capitalizeWords(value) : value });
  };

  function submit() {
    let newErrors: Record<string, string> = {};
    if (!form.fatherLifeStatus) newErrors.fatherLifeStatus = "Father Status is required.";
    if (!form.fatherName.trim()) newErrors.fatherName = "Father's Name is required.";
    if (!form.motherLifeStatus) newErrors.motherLifeStatus = "Mother Status is required.";
    if (!form.motherName.trim()) newErrors.motherName = "Mother's Name is required.";
    if (!form.familyType) newErrors.familyType = "Family Type is required.";
    if (!form.familyStatus) newErrors.familyStatus = "Family Status is required.";
    if (isGroom && (!form.familyNetWorth || Number(form.familyNetWorth) < 1)) {
      newErrors.familyNetWorth = 'Family Net Worth is required for groom biodata.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setError('Please fix the errors below.');
      return;
    }
    
    setErrors({});
    setError('');
    save.mutate();
  }

  return (
    <View style={{ gap: space(4) }}>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      
      <Card>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <SelectField label="Father" value={form.fatherLifeStatus} options={[{ value: 'alive', label: 'Mr.' }, { value: 'deceased', label: 'Late' }]} onChange={(v) => { setForm({ ...form, fatherLifeStatus: v, fatherProfession: v === 'deceased' ? '' : form.fatherProfession }); setErrors(e => ({ ...e, fatherLifeStatus: '' })); }} required autoFilled={autofilledKeys?.has('father.lifeStatus') || autofilledKeys?.has('fatherLifeStatus')} error={errors.fatherLifeStatus} />
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Father's Name" value={form.fatherName} onChangeText={set('fatherName', true)} required autoFilled={autofilledKeys?.has('father.name') || autofilledKeys?.has('fatherName')} autoCapitalize="words" error={errors.fatherName} />
          </View>
        </View>
        {form.fatherLifeStatus !== 'deceased' && (
          <ChoiceField label="Father's Profession" value={form.fatherProfession} options={PROFESSIONS} onChange={set('fatherProfession')} autoFilled={autofilledKeys?.has('father.profession') || autofilledKeys?.has('fatherProfession')} />
        )}
      </Card>
      
      <Card>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <SelectField label="Mother" value={form.motherLifeStatus} options={[{ value: 'alive', label: 'Mrs.' }, { value: 'deceased', label: 'Late' }]} onChange={(v) => { setForm({ ...form, motherLifeStatus: v, motherProfession: v === 'deceased' ? '' : form.motherProfession }); setErrors(e => ({ ...e, motherLifeStatus: '' })); }} required autoFilled={autofilledKeys?.has('mother.lifeStatus') || autofilledKeys?.has('motherLifeStatus')} error={errors.motherLifeStatus} />
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Mother's Name" value={form.motherName} onChangeText={set('motherName', true)} required autoFilled={autofilledKeys?.has('mother.name') || autofilledKeys?.has('motherName')} autoCapitalize="words" error={errors.motherName} />
          </View>
        </View>
        {form.motherLifeStatus !== 'deceased' && (
          <ChoiceField label="Mother's Profession" value={form.motherProfession} options={PROFESSIONS} onChange={set('motherProfession')} autoFilled={autofilledKeys?.has('mother.profession') || autofilledKeys?.has('motherProfession')} />
        )}
      </Card>
      
      <Card>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <SelectField label="Family Type" value={form.familyType} options={FAMILY_TYPES} onChange={set('familyType')} required autoFilled={autofilledKeys?.has('familyType')} error={errors.familyType} />
          </View>
          <View style={{ flex: 1 }}>
            <SelectField label="Family Status" value={form.familyStatus} options={FAMILY_STATUSES} onChange={set('familyStatus')} required autoFilled={autofilledKeys?.has('familyStatus')} error={errors.familyStatus} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Field label="No. of Brothers" value={form.brothers} onChangeText={set('brothers')} keyboardType="number-pad" maxLength={2} autoFilled={autofilledKeys?.has('brothers')} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="No. of Sisters" value={form.sisters} onChangeText={set('sisters')} keyboardType="number-pad" maxLength={2} autoFilled={autofilledKeys?.has('sisters')} />
          </View>
        </View>
        {isGroom ? <Field label="Family Net Worth" value={form.familyNetWorth} onChangeText={set('familyNetWorth')} keyboardType="number-pad" hint="Required, in Rupees" required error={errors.familyNetWorth} autoFilled={autofilledKeys?.has('familyNetWorth')} /> : null}
      </Card>

      <Card>
        <DependentLocation
          country={form.nativeCountry}
          state={form.nativeState}
          district={form.nativeDistrict}
          onChange={(next) =>
            setForm({ ...form, nativeCountry: next.country, nativeState: next.state, nativeDistrict: next.district })
          }
          labels={{ country: 'Native Country', state: 'Native State', district: 'Native District' }}
          autoFilled={autofilledKeys?.has('nativeCountry') || autofilledKeys?.has('nativeState') || autofilledKeys?.has('nativeDistrict')}
        />
        <Field label="Native Place (village / town)" value={form.nativePlace} onChangeText={set('nativePlace', true)} maxLength={120} autoFilled={autofilledKeys?.has('nativePlace')} autoCapitalize="words" />
        <SelectField
          label="Settled abroad"
          value={form.isNri}
          options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes, an NRI' }]}
          onChange={set('isNri')}
          autoFilled={autofilledKeys?.has('isNri')}
        />
        {form.isNri === 'yes' && (
          <>
            <Field label="City abroad" value={form.nriCity} onChangeText={set('nriCity', true)} maxLength={120} autoFilled={autofilledKeys?.has('nriCity')} autoCapitalize="words" />
            <Field label="Country" value={form.nriCountry} onChangeText={set('nriCountry', true)} maxLength={80} autoFilled={autofilledKeys?.has('nriCountry')} autoCapitalize="words" />
          </>
        )}
      </Card>
      
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          {onBack && (
            <Button label="Back" variant="outline" onPress={onBack} disabled={save.isPending} />
          )}
          <Button style={{ flex: 1 }} label="Save & Continue →" busy={save.isPending} onPress={submit} />
        </View>
        {onSkip && (
          <Button label="Skip this step" variant="ghost" onPress={onSkip} disabled={save.isPending} />
        )}
      </View>
    </View>
  );
}
