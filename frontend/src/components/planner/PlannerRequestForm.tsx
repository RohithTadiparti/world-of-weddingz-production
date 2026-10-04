import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ClipboardText } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { plannerServiceLabel, plannerSpecializationLabel } from '../../lib/planner-profile';
import { WEDDING_TYPES } from '../../lib/planner-requests';
import { ReferencePhotos } from '../BookingRequestParts';
import { Modal, SERVICE_ICONS, iso, longDate, type PlannerSelection } from './shared';

/**
 * The request a couple sends a planner, opened from either call to action on
 * the profile.
 *
 * It arrives filled in with what the couple already picked on the page (the
 * date from the calendar, the ticked services, any specialisations) and every
 * part of it can still be changed here. Where the wedding is, its type, the
 * guest and budget ranges travel as the request's planner brief, which the
 * planner's request page lays out; the specialisations have no field of their
 * own, so they travel at the end of the requirements.
 */

const MAX_REQUIREMENTS = 4000;
const MIN_REQUIREMENTS = 10;

/** A whole positive number from a field, or undefined. */
const whole = (v: string) => (v.trim() && Number(v) > 0 ? Math.round(Number(v)) : undefined);

interface Props {
  plannerId: string;
  plannerName: string;
  /** Prefills the wedding location; the couple can change it. */
  plannerCity?: string | null;
  services: string[];
  selection: PlannerSelection;
  onSelectionChange: (next: PlannerSelection) => void;
  onSent: () => void;
  onClose: () => void;
}

export default function PlannerRequestForm({
  plannerId,
  plannerName,
  plannerCity,
  services,
  selection,
  onSelectionChange,
  onSent,
  onClose,
}: Props) {
  const [requirements, setRequirements] = useState('');
  const [location, setLocation] = useState(plannerCity ?? '');
  const [weddingType, setWeddingType] = useState('');
  const [guestMin, setGuestMin] = useState('');
  const [guestMax, setGuestMax] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<{ id?: string; date: string } | null>(null);
  const [existing, setExisting] = useState('');

  const today = iso(new Date());
  const toggleService = (key: string) =>
    onSelectionChange({
      ...selection,
      services: selection.services.includes(key)
        ? selection.services.filter((k) => k !== key)
        : [...selection.services, key],
    });

  // The note the planner reads: the couple's own words first, then the facts
  // that have no column of their own.
  const extras = [
    selection.specializations.length
      ? `Specialisation: ${selection.specializations.map(plannerSpecializationLabel).join(', ')}`
      : '',
  ].filter(Boolean);
  const composed = [requirements.trim(), ...extras].filter(Boolean).join('\n\n');
  const tooLong = composed.length > MAX_REQUIREMENTS;
  // The server refuses a note under ten characters, so a two-word one is
  // caught here, with a reason, rather than bounced back as a bare error.
  const tooShort = composed.length > 0 && composed.length < MIN_REQUIREMENTS;
  const [triedShort, setTriedShort] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tooShort) {
      setTriedShort(true);
      return;
    }
    if (tooLong || busy) return;
    const gMin = whole(guestMin);
    const gMax = whole(guestMax);
    const bMin = whole(budgetMin);
    const bMax = whole(budgetMax);
    if (gMin && gMax && gMin > gMax) return setError('The smaller guest count is above the larger.');
    if (bMin && bMax && bMin > bMax) return setError('The lower budget is above the upper one.');
    setBusy(true);
    setError('');
    setExisting('');
    try {
      const { data } = await api.post('/bookings', {
        providerType: 'planner',
        providerId: plannerId,
        ...(selection.date ? { eventDate: selection.date } : {}),
        ...(selection.services.length ? { requestedServices: selection.services.slice(0, 16) } : {}),
        ...(composed ? { requirements: composed } : {}),
        ...(images.length ? { referenceImages: images } : {}),
        // Empty budget fields mean "quote me": a number is never invented on
        // the couple's behalf. The server takes the top of the range as the
        // expected budget.
        plannerBrief: {
          location: location.trim() || undefined,
          weddingType: weddingType || undefined,
          guestCountMin: gMin,
          guestCountMax: gMax,
          budgetMin: bMin,
          budgetMax: bMax,
        },
      });
      setSent({ id: (data as { id?: string } | undefined)?.id, date: selection.date });
      onSent();
    } catch (err) {
      const body = (
        err as {
          response?: { status?: number; data?: { bookingId?: string; code?: string; error?: { code?: string; bookingId?: string } } };
        }
      ).response;
      const code = body?.data?.error?.code ?? body?.data?.code;
      const bookingId = body?.data?.error?.bookingId ?? body?.data?.bookingId;
      if (code === 'DUPLICATE_BOOKING_REQUEST') {
        setExisting(bookingId ?? 'unknown');
      } else {
        setError(apiMessage(err, 'That request could not be sent.'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal title="Request sent" onClose={onClose}>
        <div className="space-y-4 text-center">
          <CheckCircle size={44} weight="light" className="mx-auto text-positive-fg" aria-hidden />
          <p className="text-[0.9375rem] leading-relaxed text-gray-700">
            Your request has gone to <span className="font-medium text-gray-900">{plannerName}</span>
            {sent.date ? ` for ${longDate(sent.date)}` : ''}. They will reply in Bookings, where you can follow
            it and pay into escrow once they confirm.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to={sent.id ? `/bookings?highlight=${sent.id}` : '/bookings'} className="btn">
              Go to Bookings
            </Link>
            <button type="button" className="btn-outline" onClick={onClose}>
              Back to profile
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Send a request"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="planner-request" className="btn" disabled={busy || tooLong}>
            {busy ? 'Sending…' : 'Submit request'}
          </button>
        </div>
      }
    >
      <form id="planner-request" onSubmit={submit} className="space-y-5">
        <label className="block">
          <span>Planner</span>
          <input className="input" value={plannerName} readOnly aria-readonly="true" />
        </label>

        <label className="block">
          <span>Selected wedding date</span>
          <input
            className="input"
            type="date"
            min={today}
            value={selection.date}
            onChange={(e) => onSelectionChange({ ...selection, date: e.target.value })}
          />
        </label>

        <fieldset>
          <legend className="label">Selected services</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((key) => {
              const Icon = SERVICE_ICONS[key] ?? ClipboardText;
              const on = selection.services.includes(key);
              return (
                <label
                  key={key}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 border px-3 py-2 text-sm transition-colors ${
                    on ? 'border-brand bg-brand-soft text-brand-strong' : 'border-gray-200 text-gray-700 hover:border-brand'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-brand"
                    checked={on}
                    onChange={() => toggleService(key)}
                  />
                  <Icon size={18} weight="light" aria-hidden className="shrink-0" />
                  <span className="min-w-0">{plannerServiceLabel(key)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {selection.specializations.length > 0 && (
          <div>
            <p className="label">Specialisation</p>
            <div className="flex flex-wrap gap-2">
              {selection.specializations.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="pill-brand"
                  onClick={() =>
                    onSelectionChange({
                      ...selection,
                      specializations: selection.specializations.filter((k) => k !== key),
                    })
                  }
                  aria-label={`Remove ${plannerSpecializationLabel(key)}`}
                >
                  {plannerSpecializationLabel(key)} <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block">
          <span>Additional wedding requirements</span>
          <textarea
            className="input min-h-[7rem]"
            value={requirements}
            maxLength={MAX_REQUIREMENTS}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder="Tell the planner about your wedding: events, style, venue ideas, anything they should know."
          />
        </label>
        {tooLong && <p className="text-xs text-critical-fg">Please shorten your requirements a little.</p>}
        {tooShort && triedShort && (
          <p className="text-xs text-critical-fg">Tell the planner what you need, at least a sentence.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span>Wedding location</span>
            <input
              className="input"
              maxLength={120}
              placeholder="City, state"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label className="block">
            <span>Wedding type (optional)</span>
            <select className="input" value={weddingType} onChange={(e) => setWeddingType(e.target.value)}>
              <option value="">Choose…</option>
              {WEDDING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <RangeField
            label="Guest count (optional)"
            min={guestMin}
            max={guestMax}
            onMin={setGuestMin}
            onMax={setGuestMax}
            placeholders={['From', 'To']}
          />
          <RangeField
            label="Budget in ₹ (optional)"
            min={budgetMin}
            max={budgetMax}
            onMin={setBudgetMin}
            onMax={setBudgetMax}
            placeholders={['From', 'Up to']}
          />
        </div>

        <ReferencePhotos urls={images} onChange={setImages} />

        {existing && (
          <div className="alert-caution space-y-1 text-sm">
            <p>You already have a request with this planner that is still open.</p>
            <Link
              to={existing === 'unknown' ? '/bookings' : `/bookings?highlight=${existing}`}
              className="font-medium underline underline-offset-4"
            >
              View it in Bookings
            </Link>
          </div>
        )}
        {error && <p className="alert-critical">{error}</p>}
      </form>
    </Modal>
  );
}

/** Two number fields, low and high, under one label. */
function RangeField({
  label,
  min,
  max,
  onMin,
  onMax,
  placeholders,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  placeholders: [string, string];
}) {
  const fields: [string, (v: string) => void, string][] = [
    [min, onMin, placeholders[0]],
    [max, onMax, placeholders[1]],
  ];
  return (
    <fieldset className="block">
      <legend className="label">{label}</legend>
      <div className="flex items-center gap-2">
        {fields.map(([value, set, ph]) => (
          <input
            key={ph}
            className="input min-w-0 flex-1"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={ph}
            aria-label={`${label}: ${ph}`}
            value={value}
            onChange={(e) => set(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
        ))}
      </div>
    </fieldset>
  );
}
