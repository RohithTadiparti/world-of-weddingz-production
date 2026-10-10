import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Permission, can } from '../lib/permissions';
import { CategoryNames, useCatalogCategories } from '../components/CategoryPicker';
import { usePermissions } from '../store/auth';
import { ViewInstagramLink } from '../components/SocialLinks';
import type { SocialLink } from '../lib/social-links';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { SealCheck, Star, Storefront } from '@phosphor-icons/react';

interface Vendor {
  id: string;
  name: string;
  /** The first of `categories` (EZ1-I263). */
  category: string | null;
  categories?: string[];
  city?: string;
  description?: string;
  ratingAvg: number;
  ratingCount: number;
  /**
   * Already on the wire and never read.
   *
   * A directory of wedding vendors with no photographs in it is a directory
   * nobody browses. The first portfolio image is the cover.
   */
  portfolio?: string[];
  /** The cheapest published offering, for a "From ₹X" line (EZ1-I164). */
  startingPrice?: number | null;
  /** Set once an officer has verified the business, for the badge (EZ1-I164). */
  verifiedAt?: string | null;
  /** Read only for the View Instagram button; see `listingInstagramUrl`. */
  socialLinks?: SocialLink[] | null;
  instagramUrl?: string | null;
}

/** The sort options the grid offers, mirrored server-side (EZ1-I164). */
const SORTS: { value: string; label: string }[] = [
  { value: '', label: 'Recommended' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'reviews', label: 'Most reviewed' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'recent', label: 'Recently added' },
];

/** A removable active-filter pill (EZ1-I164). */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-sunken px-2.5 py-1 text-xs text-gray-700">
      {label}
      <button
        type="button"
        className="text-gray-400 hover:text-gray-700"
        onClick={onClear}
        aria-label={`Clear ${label}`}
      >
        ×
      </button>
    </span>
  );
}


/**
 * The vendor marketplace.
 *
 * A request now carries a date and a published window, because a booking
 * without one is a conversation rather than a commitment: the vendor cannot
 * tell whether they are free, and two couples can be told yes for the same
 * Saturday. Price is deliberately absent — the vendor quotes against the
 * requirements, and a number typed here before anyone has read them is fiction.
 */
export default function Vendors() {
  const [category, setCategory] = useState('');
  const { data: catalogCategories = [] } = useCatalogCategories();
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('');
  const navigate = useNavigate();
  // Only buyers place bookings. A planner browses this page to find and
  // recommend vendors for the weddings they run, but the couple (or their
  // agent) is who actually books — so a planner sees the listings without the
  // "Check availability" booking action (EZ1-I29).
  const permissions = usePermissions();
  const canBook = can(permissions, Permission.BOOKING_CREATE);
  /*
   * A planner engaged on a wedding may raise the request for the couple
   * (EZ1-I235). The booking belongs to the couple either way; the planner is
   * recorded as who placed it, which is why this is a separate capability from
   * BOOKING_CREATE rather than a grant of it.
   */
  const canRequestForClient = can(permissions, Permission.BOOKING_REQUEST_FOR_CLIENT);
  const canAsk = canBook || canRequestForClient;
  const [params] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', category, city, search, sort],
    queryFn: async () =>
      (
        await api.get('/vendors/search', {
          params: {
            ...(category ? { category } : {}),
            ...(city ? { city } : {}),
            ...(search ? { search } : {}),
            ...(sort ? { sort } : {}),
          },
        })
      ).data,
  });

  const vendors: Vendor[] = data?.data ?? [];
  const hasFilters = Boolean(category || city || search);
  const clearFilters = () => {
    setCategory('');
    setCity('');
    setSearch('');
  };

  /*
   * Arriving from the vendor detail page's "Send request" (EZ1-I76), open that
   * vendor's request form straight away.
   *
   * The lookup used to be `vendors.find(...)` against whatever this page had
   * loaded, and that list is filtered, sorted and paginated. A buyer who had a
   * category or city filter set, or whose vendor sat past the first page, hit
   * `undefined` — so nothing opened, nothing was said, and the click was
   * swallowed. From the buyer's side that is exactly the reported "there is no
   * way to initiate it" (EZ1-I179): the detail page tells them they may send a
   * request, and pressing the button appears to do nothing.
   *
   * Fetching the vendor by id when the list does not hold it makes the handoff
   * independent of whatever the list happens to be showing.
   */
  useEffect(() => {
    // The request is a full page of its own now (row 14): an old
    // ?request= link is handed straight to it, with any date and event.
    const wanted = params.get('request');
    if (!wanted) return;
    const next = new URLSearchParams();
    for (const key of ['date', 'eventId']) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const query = next.toString();
    navigate(`/vendors/${wanted}/request${query ? `?${query}` : ''}`, { replace: true });
  }, [params, navigate]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Vendors</h1>
        <p className="page-subtitle">
          Pick a window that suits you and tell them what you need. They come back with a price.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-gray-700">Search</span>
          <input
            className="input mt-1 max-w-[14rem]"
            value={search}
            placeholder="Vendor name"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">City</span>
          <input
            className="input mt-1 max-w-[12rem]"
            value={city}
            placeholder="Any"
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Category</span>
          <select
            className="input mt-1 max-w-xs"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {catalogCategories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Sort</span>
          <select
            className="input mt-1 max-w-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Active filters, each removable on its own, with one control to clear
          the lot — so it is always visible what the grid is narrowed by. */}
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <FilterChip label={`Name: ${search}`} onClear={() => setSearch('')} />}
          {city && <FilterChip label={`City: ${city}`} onClear={() => setCity('')} />}
          {category && (
            <FilterChip
              label={catalogCategories.find((c) => c.slug === category)?.name ?? category}
              onClear={() => setCategory('')}
            />
          )}
          <button className="text-sm text-brand-dark underline" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {isLoading && <Loading rows={3} />}
      {!isLoading && vendors.length === 0 && (
        <div className="card">
          <EmptyState icon={Storefront} title="No vendors found">
            Try a different city, or clear the category and see everything that is available.
            {hasFilters && (
              <span className="mt-3 block">
                <button className="btn-outline btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              </span>
            )}
          </EmptyState>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          // The whole card opens the vendor, through the name's link stretched
          // over it (after:inset-0) rather than a card that is one big <a>: the
          // View Instagram button is a link of its own, and a link inside a
          // link is invalid HTML that browsers split apart unpredictably.
          <article
            key={v.id}
            className="group/vendor relative flex flex-col overflow-hidden rounded-lg border border-gray-200
              bg-surface transition-[border-color,box-shadow] duration-200
              hover:border-gray-300 hover:shadow-card"
          >
            {/*
              The cover. Where a vendor has uploaded nothing, the space still
              gets held: a grid where some cards have a picture and others start
              with a headline has no rhythm at all, and the empty tile is also
              honest about which vendors have bothered.
            */}
            <div className="relative aspect-[3/2] overflow-hidden bg-surface-sunken">
              {v.portfolio?.[0] ? (
                <img
                  src={v.portfolio[0]}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out
                    group-hover/vendor:scale-[1.03]"
                />
              ) : (
                /*
                  No photograph yet.

                  A flat grey box repeated across a grid reads as a page that
                  failed to load. One quiet jade wash and the trade's own glyph
                  says the same thing — nothing uploaded here — while still
                  giving the grid something to look at. Deliberately one tint
                  rather than one per category: a directory that changes colour
                  every tile has no accent, it has a palette.
                */
                <span className="grid h-full w-full place-items-center bg-surface-sunken text-gray-300">
                  <Storefront size={24} weight="light" aria-hidden />
                </span>
              )}
            </div>

            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="section-title truncate">
                  <Link
                    to={`/vendors/${v.id}`}
                    aria-label={`View ${v.name}`}
                    className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none
                      focus-visible:after:ring-2 focus-visible:after:ring-brand"
                  >
                    {v.name}
                  </Link>
                </h2>
                {v.ratingCount > 0 && (
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-gray-600">
                    <Star size={13} weight="fill" className="text-caution-fg" aria-hidden />
                    <span className="font-mono">{v.ratingAvg}</span>
                    <span className="text-gray-400">({v.ratingCount})</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-gray-500">
                <CategoryNames slugs={v.categories?.length ? v.categories : [v.category]} />
                {v.city ? ' \u00b7 ' + v.city : ''}
              </p>
              {/* Only approved listings reach search, but a verified badge says
                  an officer actually visited — worth surfacing (EZ1-I164). */}
              {v.verifiedAt && (
                <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-sm bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-strong">
                  <SealCheck size={12} weight="fill" aria-hidden /> Verified
                </span>
              )}
              {v.description && (
                <p className="mt-2 line-clamp-2 flex-1 text-sm text-gray-600">{v.description}</p>
              )}
              {/*
                The footer is pinned to the bottom (mt-auto) so a card with no
                description keeps the same height as one with two lines, and the
                price sits directly above the actions on every tile.

                Quiet by default, accented on hover. Twelve filled buttons in a
                grid is the accent shouting from every tile at once; the action
                is still obvious, and the card that the pointer is actually on
                is the one that looks pressable.

                View details is the only action on a card now (EZ1-I226).

                A card carried a Request quote button straight into the booking
                form, so a buyer could ask a vendor for a price having seen a
                name, a city and a starting figure — not the services, the
                portfolio, the reviews or what the vendor is actually free to
                do. The request belongs after the vendor has been read, so it
                lives on the profile, where the form can also ask which service
                is wanted before showing the availability for it.
              */}
              <div className="mt-auto flex flex-col gap-2 pt-4">
                {typeof v.startingPrice === 'number' && (
                  <p className="text-sm text-gray-700">
                    From{' '}
                    <span className="font-medium">₹{v.startingPrice.toLocaleString('en-IN')}</span>
                  </p>
                )}
                {/* Above the stretched card link (z-10), so it opens Instagram, not the vendor. */}
                <ViewInstagramLink listing={v} className="relative z-10 w-full" />
                <span className="btn btn-sm w-full transition-colors">
                  View details
                </span>
                {!canAsk && (
                  <p className="rounded-sm bg-surface-sunken px-2 py-1.5 text-center text-xs text-gray-500">
                    Browse to recommend — the couple places the booking.
                  </p>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {/*
        Scrolled to, not just rendered. The form sits under the vendor grid, so
        a buyer handed here from a vendor's page landed at the top of a list of
        forty others with the thing they asked for somewhere off-screen
        (EZ1-I179).
      */}
    </div>
  );
}
