import { useEffect, useRef, useState } from 'react';
import { HeightParts, heightPartsError, heightPartsFromCm, feetInchesToCm } from '../lib/height';

/**
 * Height as feet and inches, stored as whole centimetres.
 *
 * The two boxes sit inside the caller's field label, so each carries its own
 * accessible name rather than a nested label of its own.
 *
 * They are text boxes (a number box lets "5." and "e" through and spins on
 * scroll), so `min`/`max` mean nothing to the browser here; `pattern` is what
 * makes it refuse "abc" or "8.1" and block the form from submitting.
 */
export default function HeightInput({ value, onChange, required = false }: {
  value: unknown;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const externalValue = value === null || value === undefined ? '' : String(value);
  const externalValueRef = useRef(externalValue);
  const [parts, setParts] = useState<HeightParts>(() => heightPartsFromCm(value));
  const [touched, setTouched] = useState(false);

  // Sync saved/loaded data, but never derive the inputs from centimetres while
  // a person is editing one side. That was what erased the other side whenever
  // a partial or invalid edit could not yet be converted.
  useEffect(() => {
    if (externalValueRef.current === externalValue) return;
    externalValueRef.current = externalValue;
    setParts(heightPartsFromCm(value));
    setTouched(false);
  }, [externalValue, value]);

  const update = (next: HeightParts) => {
    setParts(next);
    setTouched(true);
    const cm = feetInchesToCm(next.feet, next.inches);
    if (cm !== null) onChange(String(cm));
    // A partially edited pair must keep the last saved canonical value until
    // it becomes valid. Clearing both is the one intentional empty state.
    else if (!next.feet && !next.inches) onChange('');
  };
  const error = touched ? heightPartsError(parts, required) : null;
  return <>
    <div className="mt-1 flex gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input className={`input min-w-0${error ? ' border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`} aria-label="Height in feet" type="text" inputMode="numeric"
          value={parts.feet} required={required} pattern="[3-8]" maxLength={1} placeholder="5"
          title="Feet, from 3 to 8"
          onBlur={() => setTouched(true)}
          onChange={(event) => update({ ...parts, feet: event.target.value })} />
        <span className="text-sm text-ink-600">ft</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input className={`input min-w-0${error ? ' border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`} aria-label="Height in inches" type="text" inputMode="numeric"
          value={parts.inches} required={required} pattern="[0-9]|1[01]" maxLength={2} placeholder="6"
          title="Inches, from 0 to 11"
          onBlur={() => setTouched(true)}
          onChange={(event) => update({ ...parts, inches: event.target.value })} />
        <span className="text-sm text-ink-600">in</span>
      </div>
    </div>
    {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
  </>;
}
