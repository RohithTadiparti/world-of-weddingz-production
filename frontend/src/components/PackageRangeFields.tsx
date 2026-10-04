import { Coins } from '@phosphor-icons/react';

interface Props {
  minimum: string;
  maximum: string;
  onMinimumChange: (rupees: string) => void;
  onMaximumChange: (rupees: string) => void;
  hint?: string;
}

// Form drafts and API filters stay in rupees; only the displayed unit is lakhs.
const inLakhs = (rupees: string) => rupees === '' ? '' : String(Number(rupees) / 100000);
const inRupees = (lakhs: string) => lakhs === '' ? '' : String(Math.round(Number(lakhs) * 100000));

export default function PackageRangeFields({ minimum, maximum, onMinimumChange, onMaximumChange, hint }: Props) {
  const inverted = minimum !== '' && maximum !== '' && Number(minimum) > Number(maximum);
  const invalid = [minimum, maximum].some((value) => value !== '' &&
    (!Number.isSafeInteger(Number(value)) || Number(value) < 0));

  return (
    <section aria-label="Package Preference" className="col-span-full rounded-lg border border-pink-200 bg-pink-50/70 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-pink-100 text-pink-700">
          <Coins size={25} aria-hidden="true" />
        </span>
        <div>
          <h3 className="font-semibold text-pink-700">Package Preference</h3>
          <p className="mt-0.5 text-sm text-gray-500">Preferred annual package/salary range</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        {[
          { label: 'Minimum Package (Annual)', value: minimum, change: onMinimumChange, placeholder: 'e.g., 5', min: 0 },
          { label: 'Maximum Package (Annual)', value: maximum, change: onMaximumChange, placeholder: 'e.g., 30', min: Number(minimum || 0) / 100000 },
        ].map((field) => (
          <label key={field.label} className="block min-w-0 text-sm text-gray-800">
            <span>{field.label}</span>
            <div className="relative mt-1.5">
              <input
                className="input w-full bg-white pr-28"
                type="number"
                inputMode="decimal"
                min={field.min}
                max={Number.MAX_SAFE_INTEGER / 100000}
                step={0.00001}
                placeholder={field.placeholder}
                value={inLakhs(field.value)}
                onChange={(event) => field.change(inRupees(event.target.value))}
                aria-invalid={invalid || inverted || undefined}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500">Lakhs (INR)</span>
            </div>
          </label>
        ))}
      </div>
      {(invalid || inverted) && <p role="alert" className="mt-2 text-sm text-red-600">Enter a valid non-negative range. Minimum cannot exceed maximum.</p>}
      {hint && <p className="mt-2 text-xs text-gray-500">{hint}</p>}
    </section>
  );
}
