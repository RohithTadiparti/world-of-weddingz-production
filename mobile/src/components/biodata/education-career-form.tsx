import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { SelectField } from '@/components/form';
import { Alert, Body, Button, Card, Field, Caption } from '@/components/ui';
import { CITIES, QUALIFICATIONS } from '@/shared/reference';
import { space } from '@/theme';
import { ChoiceField, canonical } from './choice-field';
import { capitalizeWords } from '@/lib/format';
import {
  OCCUPATION_STATUS,
  OTHER_INCOME_LIMIT,
  OTHER_INCOME_SOURCES,
  stored,
} from './constants';

interface OtherIncome {
  source: string;
  details: string;
  annualIncome: string;
}

interface Form {
  highestQualification: string;
  course: string;
  institution: string;
  collegePlace: string;
  occupationStatus: string;
  company: string;
  designation: string;
  workLocation: string;
  salary: string;
  businessName: string;
  businessIncome: string;
  businessLocation: string;
  otherIncome: OtherIncome[];
  incomeVisible: string;
}

/** Digits only, as the web form takes them (EZ1-I59). */
const digits = (value: string) => value.replace(/\D/g, '');

export function EducationCareerForm({
  profileId,
  details,
  onSaved,
  onBack,
  onSkip,
  autofilledKeys,
}: {
  profileId: string;
  details: Record<string, unknown>;
  onSaved: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  autofilledKeys?: Set<string>;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const emp = (details.employment as Record<string, unknown>) ?? {};
  const bus = (details.business as Record<string, unknown>) ?? {};
  const other = Array.isArray(details.otherIncome)
    ? (details.otherIncome as Record<string, unknown>[])
    : [];

  // The web form's keys. This form used to write `location`, `name` and
  // `income` instead, so those are still read for anything saved from here.
  const [form, setForm] = useState<Form>({
    highestQualification: canonical(String(details.highestQualification ?? ''), QUALIFICATIONS),
    course: capitalizeWords(String(details.course ?? '')),
    institution: capitalizeWords(String(details.institution ?? '')),
    collegePlace: capitalizeWords(String(details.collegePlace ?? '')),
    occupationStatus: String(details.occupationStatus ?? ''),
    company: capitalizeWords(String(emp.company ?? '')),
    designation: capitalizeWords(String(emp.designation ?? '')),
    workLocation: capitalizeWords(String(emp.workLocation ?? emp.location ?? '')),
    salary: stored(emp.salary),
    businessName: capitalizeWords(String(bus.businessName ?? bus.name ?? '')),
    businessIncome: stored(bus.businessIncome ?? bus.income),
    businessLocation: capitalizeWords(String(bus.businessLocation ?? bus.location ?? '')),
    otherIncome: other.map((row) => ({
      source: String(row.source ?? ''),
      details: String(row.details ?? ''),
      annualIncome: stored(row.annualIncome),
    })),
    incomeVisible: details.incomeVisible ? 'yes' : 'no',
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        highestQualification: form.highestQualification.trim(),
        course: form.course.trim(),
        institution: form.institution.trim() || undefined,
        collegePlace: form.collegePlace.trim() || undefined,
        occupationStatus: form.occupationStatus || undefined,
        employment:
          form.occupationStatus === 'employed'
            ? {
                company: form.company.trim() || undefined,
                designation: form.designation.trim() || undefined,
                workLocation: form.workLocation.trim() || undefined,
                salary: digits(form.salary) || undefined,
              }
            : undefined,
        business:
          form.occupationStatus === 'self_employed'
            ? {
                businessName: form.businessName.trim() || undefined,
                businessIncome: digits(form.businessIncome) || undefined,
                businessLocation: form.businessLocation.trim() || undefined,
              }
            : undefined,
        // Rows left without a source are ones somebody added and abandoned.
        otherIncome: form.otherIncome
          .filter((row) => row.source)
          .map((row) => ({
            source: row.source,
            details: row.details.trim() || undefined,
            annualIncome: digits(row.annualIncome) || undefined,
          })),
        // Sent every time: the server treats a missing value as "hide", so
        // leaving it out quietly hid income somebody had chosen to show.
        incomeVisible: form.incomeVisible === 'yes',
      };
      await api.put(`/profiles/${profileId}/details/education`, payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['biodata-details', profileId] });
      await qc.invalidateQueries({ queryKey: ['biodata-completion', profileId] });
      setError('');
      onSaved();
    },
    onError: (err) => setError(apiMessage(err, 'Education & career could not be saved.')),
  });

  const set = (key: keyof Form, capitalize?: boolean) => (value: string) => {
    setErrors((e) => ({ ...e, [key]: '' }));
    setForm({ ...form, [key]: capitalize ? capitalizeWords(value) : value });
  };
  const numeric = (key: keyof Form) => (value: string) => {
    setErrors((e) => ({ ...e, [key]: '' }));
    setForm({ ...form, [key]: digits(value) });
  };
  const setIncome = (i: number, key: keyof OtherIncome) => (value: string) =>
    setForm({
      ...form,
      otherIncome: form.otherIncome.map((row, j) => (j === i ? { ...row, [key]: value } : row)),
    });

  function submit() {
    const newErrors: Record<string, string> = {};
    if (!form.highestQualification.trim()) newErrors.highestQualification = 'Highest qualification is required.';
    if (!form.course.trim()) newErrors.course = 'Course is required.';
    if (!form.occupationStatus) newErrors.occupationStatus = 'Occupation status is required.';

    if (form.occupationStatus === 'employed') {
      if (!form.company.trim()) newErrors.company = 'Company is required.';
      if (!form.designation.trim()) newErrors.designation = 'Designation is required.';
    }
    if (form.occupationStatus === 'self_employed' && !form.businessName.trim()) {
      newErrors.businessName = 'Business name is required.';
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
        <ChoiceField label="Highest Qualification" value={form.highestQualification} options={QUALIFICATIONS} onChange={set('highestQualification')} required autoFilled={autofilledKeys?.has('highestQualification')} />
        {errors.highestQualification ? <Caption tone="critical">{errors.highestQualification}</Caption> : null}
        <Field label="Course" value={form.course} onChangeText={set('course', true)} required autoFilled={autofilledKeys?.has('course')} autoCapitalize="words" error={errors.course} />
        <Field label="Institution / College" value={form.institution} onChangeText={set('institution', true)} autoFilled={autofilledKeys?.has('institution')} autoCapitalize="words" />
        <Field label="College Place" value={form.collegePlace} onChangeText={set('collegePlace', true)} autoFilled={autofilledKeys?.has('collegePlace')} autoCapitalize="words" />
      </Card>

      <Card>
        <SelectField
          label="Occupation Status"
          value={form.occupationStatus}
          options={OCCUPATION_STATUS}
          onChange={set('occupationStatus')}
          required
          autoFilled={autofilledKeys?.has('occupationStatus')}
          error={errors.occupationStatus}
        />

        {form.occupationStatus === 'employed' && (
          <View style={{ gap: space(2), marginTop: space(2) }}>
            <Field label="Company" value={form.company} onChangeText={set('company', true)} required autoFilled={autofilledKeys?.has('employment.company') || autofilledKeys?.has('company')} autoCapitalize="words" error={errors.company} />
            <Field label="Designation" value={form.designation} onChangeText={set('designation', true)} required autoFilled={autofilledKeys?.has('employment.designation') || autofilledKeys?.has('designation')} autoCapitalize="words" error={errors.designation} />
            <ChoiceField label="Work Location" value={form.workLocation} options={CITIES} onChange={set('workLocation', true)} autoFilled={autofilledKeys?.has('employment.workLocation') || autofilledKeys?.has('employment.location') || autofilledKeys?.has('workLocation')} />
            <Field label="Salary (Annual)" value={form.salary} onChangeText={numeric('salary')} keyboardType="number-pad" autoFilled={autofilledKeys?.has('employment.salary') || autofilledKeys?.has('salary')} />
          </View>
        )}

        {form.occupationStatus === 'self_employed' && (
          <View style={{ gap: space(2), marginTop: space(2) }}>
            <Field label="Business Name" value={form.businessName} onChangeText={set('businessName', true)} required autoFilled={autofilledKeys?.has('business.businessName') || autofilledKeys?.has('business.name') || autofilledKeys?.has('businessName')} autoCapitalize="words" error={errors.businessName} />
            <Field label="Business Location" value={form.businessLocation} onChangeText={set('businessLocation', true)} autoFilled={autofilledKeys?.has('business.businessLocation') || autofilledKeys?.has('business.location') || autofilledKeys?.has('businessLocation')} autoCapitalize="words" />
            <Field label="Business Income (Annual)" value={form.businessIncome} onChangeText={numeric('businessIncome')} keyboardType="number-pad" autoFilled={autofilledKeys?.has('business.businessIncome') || autofilledKeys?.has('business.income') || autofilledKeys?.has('businessIncome')} />
          </View>
        )}
      </Card>

      {/*
        Optional, whatever the occupation: plenty of people have a job and a
        business on the side, or rent from a property, and the occupation has
        room for only one answer.
      */}
      <Card>
        <Body style={{ fontWeight: '600' }}>Other Sources of Income (optional)</Body>
        {form.otherIncome.map((row, i) => (
          <View key={i} style={{ gap: space(2), marginTop: space(2) }}>
            <SelectField
              label="Source"
              value={row.source}
              options={OTHER_INCOME_SOURCES}
              onChange={setIncome(i, 'source')}
            />
            <Field label="Details" value={row.details} onChangeText={setIncome(i, 'details')} maxLength={160} />
            <Field
              label="Annual Income"
              value={row.annualIncome}
              onChangeText={setIncome(i, 'annualIncome')}
              keyboardType="number-pad"
            />
            <Button
              label="Remove"
              variant="ghost"
              onPress={() =>
                setForm({ ...form, otherIncome: form.otherIncome.filter((_, j) => j !== i) })
              }
            />
          </View>
        ))}
        {form.otherIncome.length < OTHER_INCOME_LIMIT && (
          <Button
            label={`+ Add ${form.otherIncome.length ? 'another' : 'a'} source of income`}
            variant="outline"
            style={{ marginTop: space(2) }}
            onPress={() =>
              setForm({
                ...form,
                otherIncome: [...form.otherIncome, { source: '', details: '', annualIncome: '' }],
              })
            }
          />
        )}
      </Card>

      <Card>
        <SelectField
          label="Show income on the biodata?"
          value={form.incomeVisible}
          options={[
            { value: 'no', label: 'No, keep it private' },
            { value: 'yes', label: 'Yes' },
          ]}
          onChange={set('incomeVisible')}
        />
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
