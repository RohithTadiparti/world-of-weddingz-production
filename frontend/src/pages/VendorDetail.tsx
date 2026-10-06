import { useState } from 'react';
import { useCategoryNames } from '../components/CategoryPicker';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Permission, can } from '../lib/permissions';
import { usePermissions } from '../store/auth';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { MapPin, Star, Storefront } from '@phosphor-icons/react';
import RequestDialog from '../components/RequestDialog';
import { formatAnswer, type FieldSpec } from '../lib/dynamic-form';
import { PRICING_LABEL } from '../components/VendorServices';
import { SocialLinksList, ViewInstagramLink } from '../components/SocialLinks';
import { SocialLink, listingSocialLinks } from '../lib/social-links';

/**
 * A single vendor's full profile (EZ1-I76).
 *
 * The listing card gives a couple a name and a cover; before they choose a
 * vendor they need the whole picture — the trade, how long the business has
 * run, its portfolio, the services and prices it offers, and what other couples
 * said. This is that page, and the request itself still runs through the
 * availability flow as a modal over this page, so the selected vendor stays in
 * context while the buyer selects a service, date and time.
 */
interface PublicVendor {
  id: string;
  name: string;
  /** The first of `categories` (EZ1-I263). */
  category: string | null;
  categories?: string[];
  otherCategory: string | null;
  description: string;
  city: string;
  portfolio: string[];
  ratingAvg: number;
  ratingCount: number;
  registeredAddress: string | null;
  tradingSince: string | null;
  socialLinks?: SocialLink[];
  website?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
}

interface Offering {
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

interface ServiceSummary {
  id: string;
  displayName: string | null;
  description: string | null;
  attributes: Record<string, unknown>;
  bookable: boolean;
  definition: { name: string; description: string | null } | null;
  category: { name: string } | null;
  serviceForm: FieldSpec[];
  offerings: Offering[];
}

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
}

function ReadMore({ children, className = '' }: { children: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = children.length > 260;
  return (
    <div className={className}>
      <p className="whitespace-pre-line">{expanded || !long ? children : `${children.slice(0, 260)}…`}</p>
      {long && (
        <button
          type="button"
          className="mt-1 min-h-11 text-sm font-medium text-brand underline underline-offset-4"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'View more'}
        </button>
      )}
    </div>
  );
}

function priceText(offering: Offering) {
  const model = PRICING_LABEL[offering.pricingModel] ?? offering.pricingModel.replace(/_/g, ' ');
  if (offering.price === null) return model;
  const amount = `${offering.currency} ${Number(offering.price).toLocaleString('en-IN')}`;
  if (offering.pricingModel === 'starting_from') return `From ${amount}`;
  return offering.unitLabel ? `${amount} ${offering.unitLabel}` : amount;
}

export function ServiceInformation({ service }: { service: ServiceSummary }) {
  const fields = service.serviceForm.filter((field) => service.attributes[field.key] !== undefined);
  const files = fields.filter((field) => field.type === 'file');
  const details = fields.filter((field) => field.type !== 'file');

  return (
    <div className="space-y-5">
      {(service.description || service.definition?.description) && (
        <section>
          <h3 className="label mb-1">About</h3>
          <ReadMore className="max-w-3xl text-sm leading-6 text-gray-700">
            {service.description || service.definition?.description || ''}
          </ReadMore>
        </section>
      )}

      {details.length > 0 && (
        <section>
          <h3 className="label mb-2">Venue / service information</h3>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {details.map((field) => (
              <div key={field.key} className="border-t border-gray-200 pt-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{field.label}</dt>
                <dd className="mt-1 text-sm text-gray-800">
                  {field.type === 'url' ? (
                    <a href={String(service.attributes[field.key])} target="_blank" rel="noreferrer" className="text-brand underline">
                      View link
                    </a>
                  ) : (
                    formatAnswer(field, service.attributes[field.key])
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {files.length > 0 && (
        <section>
          <h3 className="label mb-2">Service photos &amp; files</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {files.map((field) => {
              const url = String(service.attributes[field.key]);
              return (
                <a key={field.key} href={url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden border border-gray-200 bg-surface-sunken">
                  <img src={url} alt={field.label} loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-xs text-white">{field.label}</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3 className="label mb-2">Packages &amp; pricing</h3>
        {service.offerings.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {service.offerings.map((offering) => (
              <article key={offering.id} className="border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium text-gray-900">{offering.name}</h4>
                    {offering.isPackage && <p className="mt-1 text-xs font-medium uppercase tracking-wide text-brand">Package</p>}
                  </div>
                  <p className="shrink-0 text-right text-sm font-medium tabular-nums text-brand-dark">{priceText(offering)}</p>
                </div>
                {offering.description && <ReadMore className="mt-2 text-sm leading-6 text-gray-700">{offering.description}</ReadMore>}
                {(offering.minQuantity || offering.maxQuantity) && (
                  <p className="mt-2 text-xs text-gray-500">
                    {offering.minQuantity ? `Minimum ${offering.minQuantity}` : ''}
                    {offering.minQuantity && offering.maxQuantity ? ' · ' : ''}
                    {offering.maxQuantity ? `Maximum ${offering.maxQuantity}` : ''}
                  </p>
                )}
                {offering.inclusions.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-700">
                    {offering.inclusions.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Pricing is available on request.</p>
        )}
      </section>
    </div>
  );
}


export default function VendorDetail() {
  const { id = '' } = useParams();
  const categoryNames = useCategoryNames();
  const permissions = usePermissions();
  const canBook = can(permissions, Permission.BOOKING_CREATE);
  /*
   * A planner engaged on a wedding may raise the request for the couple
   * (EZ1-I235). The booking is still the couple's -- the planner is recorded
   * as who placed it -- so the same controls are offered, and the request
   * form asks which client it is for.
   */
  const canRequestForClient = can(permissions, Permission.BOOKING_REQUEST_FOR_CLIENT);
  const canAsk = canBook || canRequestForClient;
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestDate, setRequestDate] = useState('');

  function openRequest(date = '') {
    setRequestDate(date);
    setRequestOpen(true);
  }

  const { data: vendor, isLoading } = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () => (await api.get(`/vendors/${id}`)).data as PublicVendor,
    enabled: Boolean(id),
    retry: false,
  });

  const { data: services = [] } = useQuery({
    queryKey: ['vendor-services', id],
    queryFn: async () => (await api.get(`/vendors/${id}/services`)).data as ServiceSummary[],
    enabled: Boolean(id),
    retry: false,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['vendor-reviews', id],
    queryFn: async () => (await api.get(`/vendors/${id}/reviews`)).data as Review[],
    enabled: Boolean(id),
    retry: false,
  });

  // Available slots for the next two months, so the profile shows availability
  // rather than only offering it inside the booking flow (EZ1-I131, EZ1-I142).
  const today = new Date();
  const to = new Date(today.getTime() + 60 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const { data: slots = [] } = useQuery({
    queryKey: ['vendor-availability', id],
    queryFn: async () =>
      (
        await api.get(`/vendors/${id}/availability`, {
          params: { from: iso(today), to: iso(to) },
        })
      ).data as { id: string; date: string; startTime: string; endTime: string; remaining: number }[],
    enabled: Boolean(id),
    retry: false,
  });

  // Check availability for one required date (EZ1-I131). Mirrors the Hire a
  // Planner flow: name a date, ask, and see whether the vendor is free before
  // proceeding — the piece a planner needs, since a planner cannot open the
  // buyer-only request dialog. On demand rather than on load; the same public
  // endpoint, narrowed to that single day.
  const [checkDate, setCheckDate] = useState('');
  const [checkedDate, setCheckedDate] = useState('');
  const {
    data: dayCheck,
    isFetching: checking,
    refetch: runCheck,
  } = useQuery({
    queryKey: ['vendor-availability-check', id, checkDate],
    enabled: false,
    queryFn: async () =>
      (
        await api.get(`/vendors/${id}/availability`, {
          params: { from: checkDate, to: checkDate },
        })
      ).data as { id: string; date: string; remaining: number }[],
  });
  const dayOpen = (dayCheck ?? []).filter((s) => s.date === checkedDate && s.remaining > 0);
  const dayOpenings = dayOpen.reduce((n, s) => n + s.remaining, 0);

  if (isLoading) return <Loading rows={4} />;
  if (!vendor) {
    return (
      <EmptyState title="Vendor not found">
        This vendor is not available. It may have been removed or is not yet approved.
      </EmptyState>
    );
  }

  const category = categoryNames(vendor.categories?.length ? vendor.categories : [vendor.category]).join(', ');

  return (
    <div className="space-y-6">
      <Link to="/vendors" className="text-sm text-brand-dark underline">
        ← All vendors
      </Link>

      {/* Cover + headline */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-surface">
        <div className="relative aspect-[16/6] bg-surface-sunken">
          {vendor.portfolio?.[0] ? (
            <img src={vendor.portfolio[0]} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-gray-300">
              <Storefront size={32} weight="light" aria-hidden />
            </span>
          )}
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="page-title">{vendor.name}</h1>
              <p className="text-sm text-gray-500">
                {[category, vendor.city].filter(Boolean).join(' · ')}
              </p>
            </div>
            {vendor.ratingCount > 0 && (
              <span className="flex items-center gap-1 text-sm text-gray-600">
                <Star size={14} weight="fill" className="text-caution-fg" aria-hidden />
                <span className="font-mono">{vendor.ratingAvg}</span>
                <span className="text-gray-400">({vendor.ratingCount})</span>
              </span>
            )}
          </div>
          {vendor.tradingSince && (
            <p className="mt-1 text-xs text-gray-500">
              Trading since {new Date(vendor.tradingSince).toLocaleDateString()}
            </p>
          )}
          {vendor.registeredAddress && (
            <p className="mt-1 flex items-start gap-1 text-xs text-gray-500">
              <MapPin size={13} weight="light" className="mt-0.5 shrink-0" aria-hidden />
              <span>{vendor.registeredAddress}</span>
            </p>
          )}
          {vendor.description && (
            <ReadMore className="mt-3 max-w-3xl text-sm leading-6 text-gray-700">{vendor.description}</ReadMore>
          )}
          {/* Where the vendor's work can be seen beyond this page. */}
          <SocialLinksList links={listingSocialLinks(vendor)} className="mt-3" />
          {/* The same pair as the planner profile: Instagram beside the request. */}
          <div className="mt-4 flex flex-col gap-2 empty:hidden sm:flex-row">
            <ViewInstagramLink listing={vendor} className="w-full sm:w-auto" />
            {canAsk && (
              <button className="btn w-full sm:w-auto" onClick={() => openRequest()}>
                Check availability &amp; request
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Availability on the profile itself (EZ1-I131, EZ1-I142): the next open
          dates, so a buyer or planner sees when the vendor is free before asking. */}
      <div>
        <h2 className="section-title mb-2">Upcoming availability</h2>

        {/* Check a required date before proceeding (EZ1-I131). */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-gray-600">Check a date</span>
            <input
              className="input mt-1"
              type="date"
              min={iso(today)}
              value={checkDate}
              onChange={(e) => setCheckDate(e.target.value)}
            />
          </label>
          <button
            className="btn-outline btn-sm"
            disabled={!checkDate || checking}
            onClick={async () => {
              await runCheck();
              setCheckedDate(checkDate);
            }}
          >
            {checking ? 'Checking…' : 'Check availability'}
          </button>
        </div>
        {checkedDate && !checking && (
          <div className="mb-3">
            <p
              className={`rounded-sm p-3 text-sm ${
                dayOpen.length > 0
                  ? 'bg-brand-light text-brand-dark'
                  : 'bg-surface-sunken text-gray-600'
              }`}
            >
              {dayOpen.length > 0
                ? `Free on ${new Date(checkedDate).toLocaleDateString()} — ${dayOpenings} opening${
                    dayOpenings === 1 ? '' : 's'
                  } left.`
                : /*
                     Never a promise the reader cannot act on, and never a dead
                     end either.

                     This once told everybody "you can still send a request"
                     with the button gated on booking:create, so an agent or a
                     planner read an instruction they had no way to follow
                     (EZ1-I179). Making the sentence conditional fixed that and
                     introduced the opposite fault: a planner now saw a bare
                     "no opening" and nothing about what to do next, which came
                     straight back as EZ1-I235. So each reader is told what is
                     actually true for them.
                   */
                  `No published opening on ${new Date(checkedDate).toLocaleDateString()}.${
                    canAsk
                      ? ' You can still send a request and the vendor will confirm.'
                      : ' The couple can still request this date from their own account,' +
                        ' and the vendor confirms it there.'
                  }`}
            </p>
            {dayOpen.length === 0 && canAsk && (
              <button
                className="btn btn-sm mt-2"
                onClick={() => openRequest(checkedDate)}
              >
                Send request
              </button>
            )}
          </div>
        )}

        {slots.length === 0 ? (
          <div className="card space-y-3">
            <p className="text-sm text-gray-500">
              No open dates published for the next two months.
              {canAsk
                ? ' You can still send a request and the vendor will confirm.'
                : ' The couple can still request a date from their own account, and the vendor' +
                  ' confirms it there.'}
            </p>
            {canAsk && (
              <button
                className="btn btn-sm"
                onClick={() => openRequest()}
              >
                Send request
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.slice(0, 24).map((s) => (
              <span
                key={s.id}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700"
                title={`${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)} · ${s.remaining} open`}
              >
                {new Date(s.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                <span className="ml-1 text-gray-400">
                  {s.startTime.slice(0, 5)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Portfolio gallery beyond the cover */}
      {vendor.portfolio.length > 1 && (
        <div>
          <h2 className="section-title mb-2">Photos</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {vendor.portfolio.slice(1).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="" loading="lazy" className="aspect-square w-full rounded-sm object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Service data is catalog driven: any public SERVICE field configured by
          the vendor is rendered through ServiceInformation, rather than a
          category-specific component with a fixed set of fields. */}
      {services.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="section-title">Service details</h2>
            <p className="mt-1 text-sm text-gray-600">Explore what this vendor offers, including current packages and pricing.</p>
          </div>
          <div className="space-y-4">
            {services.map((svc) => (
              <article key={svc.id} className="card space-y-5">
                <div className="border-b border-gray-200 pb-3">
                  <h3 className="section-title">
                    {svc.displayName ?? svc.definition?.name ?? 'Service'}
                  </h3>
                  {svc.category?.name && (
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">{svc.category.name}</p>
                  )}
                </div>
                <ServiceInformation service={svc} />
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {reviews.length > 0 && (
        <div>
          <h2 className="section-title mb-2">Reviews</h2>
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="card">
                <div className="flex items-center gap-1 text-sm text-gray-600">
                  <Star size={13} weight="fill" className="text-caution-fg" aria-hidden />
                  <span className="font-mono">{r.rating}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.comment && <p className="mt-1 text-sm text-gray-700">{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {requestOpen && (
        <RequestDialog
          vendor={vendor}
          initialDate={requestDate}
          onClose={() => setRequestOpen(false)}
        />
      )}
    </div>
  );
}
