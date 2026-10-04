import PhotoUploader from './PhotoUploader';
import { QUANTITY_MODELS, estimateTotal, offeringPrice } from '../lib/booking-request';

/** One published price on the service being requested. */
export interface Offering {
  id: string;
  name: string;
  description: string | null;
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  isPackage: boolean;
  inclusions: string[];
}

/** Whether the chosen price counts something, so "How many" is asked. */
export function takesQuantity(offering: Offering | undefined): boolean {
  return Boolean(offering && QUANTITY_MODELS.includes(offering.pricingModel));
}

/** The total for the price and quantity chosen, as it reads on the form. */
export function totalLabel(offering: Offering, quantity: string): string | null {
  const total = estimateTotal(offering, quantity ? Number(quantity) : null);
  return total === null ? null : `${offering.currency} ${total.toLocaleString()}`;
}

/** A price card is a toggle: choose it once, choose it again to ask for a quote. */
export function nextOfferingId(currentId: string, clickedId: string): string {
  return currentId === clickedId ? '' : clickedId;
}

/**
 * The service's prices, "How many" where the price counts something, and the
 * total that follows from both.
 */
export function OfferingPicker({
  offerings,
  offeringId,
  quantity,
  onPick,
  onQuantity,
}: {
  offerings: Offering[];
  offeringId: string;
  quantity: string;
  onPick: (id: string) => void;
  onQuantity: (value: string) => void;
}) {
  const offering = offerings.find((o) => o.id === offeringId);
  const total = offering ? totalLabel(offering, quantity) : null;

  return (
    <>
      <div>
        <p className="label">Pick a price</p>
        <div className="space-y-2">
          {offerings.map((o) => (
            <button
              key={o.id}
              type="button"
              // A listed price is a helpful starting point, not a commitment.
              // Clicking the current choice again deliberately returns to a
              // quote-only request.
              onClick={() => onPick(nextOfferingId(offeringId, o.id))}
              aria-pressed={offeringId === o.id}
              className={`block w-full rounded-sm border px-3 py-2 text-left text-sm ${
                offeringId === o.id ? 'border-brand bg-brand-light' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-gray-900">
                  {o.name}
                  {o.isPackage && (
                    <span className="ml-2 rounded-sm bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
                      Package
                    </span>
                  )}
                </span>
                <span className="text-gray-700">{offeringPrice(o)}</span>
              </span>
              {o.description && <span className="mt-0.5 block text-xs text-gray-500">{o.description}</span>}
              {o.inclusions.length > 0 && (
                <span className="mt-0.5 block text-xs text-gray-500">
                  Includes: {o.inclusions.join(', ')}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {offering && takesQuantity(offering) && (
        <label className="block text-sm">
          <span className="text-gray-700">
            How many{offering.unitLabel ? ` (${offering.unitLabel})` : ''}?
          </span>
          <input
            className="input mt-1 max-w-[12rem]"
            type="number"
            min={offering.minQuantity ?? 1}
            max={offering.maxQuantity ?? undefined}
            value={quantity}
            onChange={(e) => onQuantity(e.target.value)}
            required
          />
          {(offering.minQuantity || offering.maxQuantity) && (
            <span className="mt-1 block text-xs text-gray-500">
              They take
              {offering.minQuantity ? ` from ${offering.minQuantity}` : ''}
              {offering.maxQuantity ? ` up to ${offering.maxQuantity}` : ''}.
            </span>
          )}
        </label>
      )}

      {/* The unit price times "How many": what the vendor is told the buyer saw. */}
      {offering && total && (
        <p className="flex items-baseline justify-between rounded-sm bg-surface-sunken px-3 py-2 text-sm">
          <span className="text-gray-700">
            {offering.pricingModel === 'starting_from' ? 'Starting from' : 'Estimated total'}
            {takesQuantity(offering) && quantity ? ` (${offeringPrice(offering)} × ${quantity})` : ''}
          </span>
          <span className="font-medium text-gray-900">{total}</span>
        </p>
      )}
      {!offering && offerings.length > 0 && (
        <p className="text-xs leading-relaxed text-gray-500">
          Pick a listed price, or leave all options clear to ask this vendor for a quote.
        </p>
      )}
    </>
  );
}

/** How many reference photos one request carries. Kept in step with the API. */
export const MAX_REFERENCE_IMAGES = 6;

/**
 * Designs the buyer already has — a mehendi pattern, a stage they liked —
 * uploaded one at a time and sent with the request for the vendor to see.
 */
export function ReferencePhotos({
  urls,
  onChange,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
}) {
  return (
    <div className="text-sm">
      <p className="text-gray-700">Reference photos</p>
      {urls.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {urls.map((url) => (
            <li key={url} className="relative">
              <img src={url} alt="Reference design" className="h-20 w-20 rounded-sm object-cover" />
              <button
                type="button"
                className="absolute right-0.5 top-0.5 rounded-sm bg-black/60 px-1.5 text-xs text-white"
                onClick={() => onChange(urls.filter((u) => u !== url))}
                aria-label="Remove this photo"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {urls.length < MAX_REFERENCE_IMAGES && (
        <div className="mt-1">
          <PhotoUploader
            label={urls.length > 0 ? 'Add another photo' : 'Upload a photo'}
            onUploaded={(url) => onChange([...urls, url])}
          />
        </div>
      )}
      <span className="mt-1 block text-xs text-gray-500">
        Optional. Designs you have in mind, up to {MAX_REFERENCE_IMAGES}.
      </span>
    </div>
  );
}
