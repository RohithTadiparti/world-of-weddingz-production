import { useState } from 'react';
import { ImageBroken } from '@phosphor-icons/react';
import { Lightbox } from './planner/shared';
import { SocialLinksList } from './SocialLinks';
import { catalogSummary, uniquePortfolio, uniqueSocialLinks, SummaryService } from '../lib/catalog-rules';
import { SocialLink, listingSocialLinks } from '../lib/social-links';

/**
 * The read-only pieces of a submitted listing, shared by the vendor's own
 * Review & Submit and by the administrator's and officer's verification view.
 *
 * One component for both, because they had drifted: the review listed Instagram
 * twice and the verification view did not list social links at all, and each
 * showed a different part of the catalog.
 */

/**
 * Every service with its category, and every price with its name, details and
 * description. A switched-off service or a retired price is still shown, and
 * marked, because a reviewer has to see everything on the listing.
 */
export function CatalogSummaryList({ services }: { services: readonly SummaryService[] }) {
  const rows = catalogSummary(services);
  if (rows.length === 0) {
    return <p className="text-sm text-amber-700">No services added yet.</p>;
  }
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.serviceId} className="rounded-sm bg-gray-50 p-3">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Category</dt>
              <dd className="text-gray-900">{row.categoryName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Service</dt>
              <dd className="font-medium text-gray-900">
                {row.serviceName}
                {!row.active && (
                  <span className="ml-2 text-xs font-normal text-amber-700">switched off</span>
                )}
              </dd>
            </div>
          </dl>
          {row.serviceDescription && (
            <p className="mt-1 text-xs text-gray-600">{row.serviceDescription}</p>
          )}
          {row.prices.length > 0 ? (
            <ul className="mt-2 divide-y divide-gray-200 border-t border-gray-200">
              {row.prices.map((price) => (
                <li key={price.id} className="py-2">
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Pricing name</dt>
                      <dd className="text-gray-900">
                        {price.name}
                        {!price.active && (
                          <span className="ml-2 text-xs text-gray-400">retired</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">
                        Pricing details
                      </dt>
                      <dd className="tabular-nums text-gray-800">{price.details}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-gray-500">Description</dt>
                      <dd className="whitespace-pre-wrap text-gray-700">
                        {price.description ?? 'Not provided'}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-amber-700">Pricing is missing for this service.</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** A listing's social links, each platform and address once. */
export function SubmittedSocialLinks({
  listing,
}: {
  listing: Parameters<typeof listingSocialLinks>[0];
}) {
  const links: SocialLink[] = uniqueSocialLinks(listingSocialLinks(listing));
  if (links.length === 0) {
    return <p className="text-sm text-gray-500">None added.</p>;
  }
  return <SocialLinksList links={links} />;
}

/**
 * Portfolio photographs that open, full size, in a lightbox.
 *
 * They were bare thumbnails on Review & Submit, with no way to see a photo at
 * any size, and a link that failed to load (an expired signed address, a file
 * that is not an image) left an empty box. A thumbnail that fails now says so
 * and still offers the file in a new tab.
 */
export function PortfolioGallery({ urls, title = 'Portfolio' }: { urls: readonly string[]; title?: string }) {
  const photos = uniquePortfolio(urls);
  const [open, setOpen] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (photos.length === 0) return <p className="text-sm text-amber-700">No photos added yet.</p>;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {photos.map((url, i) =>
          broken[url] ? (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-sm border border-gray-200 text-xs text-gray-600 hover:border-brand"
              >
                <ImageBroken size={18} aria-hidden />
                Open file {i + 1}
              </a>
            </li>
          ) : (
            <li key={url}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                className="block overflow-hidden rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                aria-label={`Open photo ${i + 1} of ${photos.length}`}
              >
                <img
                  src={url}
                  alt=""
                  className="h-20 w-28 object-cover"
                  loading="lazy"
                  onError={() => setBroken((b) => ({ ...b, [url]: true }))}
                />
              </button>
            </li>
          ),
        )}
      </ul>
      {open !== null && (
        <Lightbox
          photos={photos.filter((url) => !broken[url])}
          start={Math.max(
            0,
            photos.filter((url) => !broken[url]).indexOf(photos[open]),
          )}
          title={title}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
