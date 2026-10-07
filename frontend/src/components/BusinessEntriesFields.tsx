import { BusinessEntry } from '../lib/business-entries';

export default function BusinessEntriesFields({ entries, onChange }: {
  entries: BusinessEntry[];
  onChange: (entries: BusinessEntry[]) => void;
}) {
  const update = (id: unknown, key: string, value: string) =>
    onChange(entries.map((entry) => entry.id === id ? { ...entry, [key]: value } : entry));
  return (
    <section className="space-y-3" aria-label="Business Entries">
      <h3 className="font-semibold text-gray-800">Business Entries</h3>
      {entries.map((entry, index) => (
        <fieldset key={String(entry.id)} className="rounded-lg border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">Business {index + 1}</legend>
          <div className="mb-3 flex justify-end gap-3">
            <button type="button" className="text-sm text-brand-dark" onClick={() => document.getElementById(`business-${entry.id}-businessName`)?.focus()}>Edit<span className="sr-only"> business {index + 1}</span></button>
            <button type="button" className="text-sm text-red-600" onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}>Remove<span className="sr-only"> business {index + 1}</span></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['businessName', 'Business Name', 160],
              ['businessType', 'Business Type', 120],
              ['businessLocation', 'Business Location', 200],
              ['businessIncome', 'Business Income (annual rupees)', 15],
            ].map(([key, label, length]) => (
              <label key={key} className="block text-sm text-gray-700">
                <span>{label}</span>
                <input
                  id={`business-${entry.id}-${key}`}
                  className="input mt-1"
                  value={String(entry[String(key)] ?? '')}
                  maxLength={Number(length)}
                  required={key === 'businessName'}
                  pattern={key === 'businessIncome' ? '^(?=.*[1-9])\\d+$' : key === 'businessName' ? '.*\\S.*' : undefined}
                  inputMode={key === 'businessIncome' ? 'numeric' : undefined}
                  onChange={(event) => update(entry.id, String(key), event.target.value)}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {!entries.length && <p role="alert" className="text-sm text-red-600">Add at least one business before saving.</p>}
      <button type="button" className="btn-outline" onClick={() => onChange([...entries, { id: crypto.randomUUID(), businessName: '', businessType: '', businessLocation: '', businessIncome: '' }])}>Add Another Business</button>
    </section>
  );
}
