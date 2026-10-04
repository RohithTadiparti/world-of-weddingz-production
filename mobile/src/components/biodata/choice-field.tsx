import { useState } from 'react';

import { SelectField } from '@/components/form';
import { Field } from '@/components/ui';
import { COUNTRIES, OTHER, isOffList } from '@/shared/reference';
import { districtsForState, statesForCountry } from '@/shared/locations';

/** Matches a stored value to its list spelling, so a legacy "hindu" reopens as "Hindu". */
export const canonical = (value: string, options: readonly string[]): string =>
  options.find((o) => o.toLowerCase() === value.trim().toLowerCase()) ?? value;

/**
 * The web ChoiceField on mobile: the list is the fast path, "Other" opens a text
 * box, and a stored value that is not on the list reopens as "Other" filled in.
 */
export function ChoiceField({
  label,
  value,
  onChange,
  options,
  allowOther = true,
  placeholder = 'Not stated',
  required,
  autoFilled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  allowOther?: boolean;
  placeholder?: string;
  required?: boolean;
  autoFilled?: boolean;
}) {
  const [otherPicked, setOtherPicked] = useState(false);
  const showOther = allowOther && (otherPicked || isOffList(value, options));
  const list = allowOther && !options.includes(OTHER) ? [...options, OTHER] : options;

  return (
    <>
      <SelectField
        label={label}
        value={showOther ? OTHER : value}
        placeholder={placeholder}
        required={required}
        autoFilled={autoFilled}
        options={[{ value: '', label: placeholder }, ...list.map((o) => ({ value: o, label: o }))]}
        onChange={(next) => {
          setOtherPicked(next === OTHER && allowOther);
          onChange(next === OTHER && allowOther ? '' : next);
        }}
      />
      {showOther ? (
        <Field
          label={`${label} (other)`}
          value={value}
          onChangeText={onChange}
          placeholder={`Type the ${label.toLowerCase()}`}
          maxLength={60}
          required={required}
          autoFilled={autoFilled}
        />
      ) : null}
    </>
  );
}

/** Country → State → District, where changing a parent clears its children. */
export function DependentLocation({
  country,
  state,
  district,
  onChange,
  labels = { country: 'Country', state: 'State', district: 'District' },
  required,
  autoFilled,
}: {
  country: string;
  state: string;
  district: string;
  onChange: (next: { country: string; state: string; district: string }) => void;
  labels?: { country: string; state: string; district: string };
  required?: boolean;
  autoFilled?: boolean;
}) {
  return (
    <>
      <ChoiceField
        label={labels.country}
        value={country}
        options={COUNTRIES}
        onChange={(v) => onChange({ country: v, state: '', district: '' })}
        required={required}
        autoFilled={autoFilled}
      />
      <ChoiceField
        key={`state-${country}`}
        label={labels.state}
        value={state}
        options={statesForCountry(country)}
        onChange={(v) => onChange({ country, state: v, district: '' })}
        required={required}
        autoFilled={autoFilled}
      />
      <ChoiceField
        key={`district-${country}-${state}`}
        label={labels.district}
        value={district}
        options={districtsForState(state)}
        onChange={(v) => onChange({ country, state, district: v })}
        required={required}
        autoFilled={autoFilled}
      />
    </>
  );
}
