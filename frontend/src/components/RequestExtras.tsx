import { estimateSummary } from '../lib/booking-request';

/**
 * What the buyer sent with a request, as both sides read it back: the total
 * they were shown, and the designs they attached. The vendor's booking detail
 * and the buyer's own Bookings page render the same two pieces.
 */

/**
 * The estimate, with "unit × qty" where a quantity went into it.
 *
 * Labelled as an estimate throughout: `amount` is what is owed and stays zero
 * until a quotation is accepted, and the two must never read as one figure.
 */
export function RequestEstimate({
  estimatedAmount,
  quantity,
  currency,
  label = 'Estimated total',
  note,
}: {
  estimatedAmount?: string | null;
  quantity?: number | null;
  currency?: string;
  label?: string;
  note?: string;
}) {
  const summary = estimateSummary(estimatedAmount, quantity, currency);
  if (!summary) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="text-gray-800">
        {summary.total}
        {summary.breakdown && <span className="text-gray-500"> ({summary.breakdown})</span>}
      </span>
      {note && <span className="basis-full text-gray-500">{note}</span>}
    </div>
  );
}

/** The reference photos as thumbnails, each opening full size in a new tab. */
export function ReferenceThumbs({ urls }: { urls?: string[] | null }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt="Reference design" className="h-20 w-20 rounded-sm object-cover" />
        </a>
      ))}
    </div>
  );
}
