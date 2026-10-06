import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  CaretLeft,
  CaretRight,
  Check,
  ClipboardText,
  Heart,
  Link as LinkIcon,
  MapPin,
  PaperPlaneTilt,
  Play,
  SealCheck,
  Star,
} from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { listingSocialLinks, socialLinkName } from '../lib/social-links';
import { SOCIAL_ICONS, ViewInstagramLink } from '../components/SocialLinks';
import { Permission, can } from '../lib/permissions';
import { usePermissions } from '../store/auth';
import { EmptyState, Loading } from '../components/ui/Feedback';
import {
  plannerServiceLabel,
  plannerSpecializationLabel,
  videoEmbedUrl,
  videoThumbnail,
  weddingCover,
} from '../lib/planner-profile';
import {
  Card,
  Lightbox,
  Modal,
  SERVICE_ICONS,
  Stars,
  VideoModal,
  initials,
  offeredServices,
  rupees,
  usePlanner,
  usePlannerSelection,
  weddingMeta,
  type Planner,
  type PlannerSelection,
} from '../components/planner/shared';
import PlannerCalendar from '../components/planner/PlannerCalendar';
import PlannerRequestForm from '../components/planner/PlannerRequestForm';

/**
 * A wedding planner's profile, as a couple choosing one sees it.
 *
 * A showcase first and a form second: who the planner is, the weddings they
 * have run, what couples said and when they are free, with the couple's own
 * choices (the services they want, the date on the calendar, the kinds of
 * wedding they care about) gathered as they read, so the request at the end
 * arrives already filled in. Those choices are kept for the session, so
 * opening one of the planner's past weddings and coming back loses nothing.
 *
 * Only the business side of the listing is shown. The planner's phone, email
 * and address stay out: bookings, and the conversation about them, run
 * through the platform.
 */

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface ReviewSummary {
  average: number;
  total: number;
}

export default function PlannerDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const permissions = usePermissions();
  const canBook = can(permissions, Permission.BOOKING_CREATE);
  const { data: planner, isLoading } = usePlanner(id);

  if (isLoading) return <Loading rows={5} />;
  if (!planner) {
    return (
      <EmptyState title="Planner not found">
        This planner is not available. They may have been removed or are not yet approved.
      </EmptyState>
    );
  }

  return <PlannerProfile key={planner.id} planner={planner} canBook={canBook} dateFromAddress={params.get('date') ?? ''} />;
}

function PlannerProfile({
  planner: p,
  canBook,
  dateFromAddress,
}: {
  planner: Planner;
  canBook: boolean;
  dateFromAddress: string;
}) {
  const { selection, setSelection, toggle, clear } = usePlannerSelection(p.id, dateFromAddress);
  const [requesting, setRequesting] = useState(false);
  const services = offeredServices(p);

  const { data: summary } = useQuery({
    queryKey: ['planner-review-summary', p.id],
    queryFn: async () => (await api.get(`/wedding-planners/${p.id}/reviews/summary`)).data as ReviewSummary,
    retry: false,
  });
  const rating = summary?.total ? summary.average : p.ratingAvg;
  const ratingCount = summary?.total ?? p.ratingCount;

  const openRequest = () => setRequesting(true);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-4">
      <Link to="/wedding-planners" className="inline-block text-sm text-gray-600 hover:text-brand">
        ← All planners
      </Link>

      <Masthead planner={p} rating={rating} ratingCount={ratingCount} canBook={canBook} onRequest={openRequest} />
      <AboutCard planner={p} />
      <ServicesCard
        services={services}
        selected={selection.services}
        onToggle={(key) => toggle('services', key)}
        interactive={canBook}
      />
      <PortfolioCard planner={p} />
      <ExpertiseCard
        specializations={p.specializations ?? []}
        selected={selection.specializations}
        onToggle={(key) => toggle('specializations', key)}
        interactive={canBook}
      />
      <ReviewsCard plannerId={p.id} rating={rating} ratingCount={ratingCount} />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <PackagesCard planner={p} />
        <Card title="Availability" subtitle="Pick a date to see whether the planner is free.">
          <PlannerCalendar
            plannerId={p.id}
            value={selection.date}
            onChange={(date) => setSelection((s) => ({ ...s, date }))}
          />
        </Card>
        <ConnectCard planner={p} />
      </div>

      {canBook && (
        <RequestBanner
          count={selection.services.length}
          onRequest={openRequest}
        />
      )}

      {requesting && (
        <PlannerRequestForm
          plannerId={p.id}
          plannerName={p.agencyName}
          plannerCity={p.city ?? null}
          services={services}
          selection={selection}
          onSelectionChange={(next: PlannerSelection) => setSelection(next)}
          onSent={clear}
          onClose={() => setRequesting(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Masthead                                                                  */
/* ------------------------------------------------------------------------ */

function Masthead({
  planner: p,
  rating,
  ratingCount,
  canBook,
  onRequest,
}: {
  planner: Planner;
  rating: number;
  ratingCount: number;
  canBook: boolean;
  onRequest: () => void;
}) {
  // The cover is the first wedding's lead photograph, else the first loose
  // portfolio photo; with neither, a plain band rather than a broken image.
  const cover = (p.weddings ?? []).map(weddingCover).find(Boolean) ?? p.portfolio?.[0] ?? null;
  const place = [p.city, p.state].filter(Boolean).join(', ');

  return (
    <section className="overflow-hidden rounded-[--radius-lg] border border-gray-200 bg-surface shadow-card">
      <div className="relative h-36 bg-brand-soft sm:h-56">
        {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
        {canBook && <FavouriteButton plannerId={p.id} name={p.agencyName} />}
      </div>

      <div className="px-5 pb-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
            <div
              aria-hidden
              className="-mt-12 grid h-24 w-24 shrink-0 place-items-center border-4 border-surface bg-surface-sunken shadow-card sm:-mt-14 sm:h-28 sm:w-28"
            >
              <span className="font-serif text-[2.25rem] leading-none tracking-[0.06em] text-brand">
                {initials(p.agencyName)}
              </span>
            </div>
            <div className="min-w-0 sm:pb-1">
              <p className="eyebrow tracking-[0.22em]">Wedding planner</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="break-words font-serif text-[2rem] font-normal leading-[1.1] text-brand sm:text-[2.5rem]">
                  {p.agencyName}
                </h1>
                <span className="pill-brand">
                  <SealCheck size={13} weight="fill" aria-hidden />
                  Verified
                </span>
              </div>
            </div>
          </div>

          {/* Instagram beside the request, for everyone: it is where a couple
              judges a planner's taste, and a provider browsing can look too. */}
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <ViewInstagramLink listing={p} className="w-full sm:w-auto" />
            {canBook && (
              <button type="button" className="btn w-full shrink-0 sm:w-auto" onClick={onRequest}>
                <PaperPlaneTilt size={16} aria-hidden />
                Send Request
              </button>
            )}
          </div>
        </div>

        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
          <li className="flex items-center gap-1.5">
            {ratingCount > 0 ? (
              <>
                <Star size={16} weight="fill" className="text-gold" aria-hidden />
                <span className="font-medium text-gray-900">{rating.toFixed(1)}</span>
                <a href="#reviews" className="text-gray-600 underline-offset-4 hover:text-brand hover:underline">
                  ({ratingCount} review{ratingCount === 1 ? '' : 's'})
                </a>
              </>
            ) : (
              <span className="text-gray-500">No reviews yet</span>
            )}
          </li>
          {place && (
            <li className="flex items-center gap-1.5">
              <MapPin size={16} weight="light" aria-hidden />
              {place}
            </li>
          )}
          {p.yearsExperience > 0 && (
            <li className="flex items-center gap-1.5">
              <Briefcase size={16} weight="light" aria-hidden />
              {p.yearsExperience}+ Years Experience
            </li>
          )}
          {(p.weddingsCompleted ?? 0) > 0 && (
            <li className="flex items-center gap-1.5">
              <Check size={16} weight="bold" className="text-gold" aria-hidden />
              {p.weddingsCompleted} Weddings Completed
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

/**
 * The heart on the cover. Saved planners are listed for the couple elsewhere;
 * here it is a toggle that answers at once and is put back if the server
 * refuses.
 */
function FavouriteButton({ plannerId, name }: { plannerId: string; name: string }) {
  const qc = useQueryClient();
  const key = ['planner-favourite', plannerId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get(`/wedding-planners/${plannerId}/favourite`)).data as { favourite: boolean },
    retry: false,
  });
  const saved = Boolean(data?.favourite);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (next: boolean) =>
      (next
        ? await api.put(`/wedding-planners/${plannerId}/favourite`)
        : await api.delete(`/wedding-planners/${plannerId}/favourite`)
      ).data as { favourite: boolean },
    onMutate: (next) => {
      setError('');
      qc.setQueryData(key, { favourite: next });
    },
    onError: (err, next) => {
      qc.setQueryData(key, { favourite: !next });
      setError(apiMessage(err, 'Could not update your saved planners.'));
    },
    onSuccess: (res) => {
      qc.setQueryData(key, res);
      qc.invalidateQueries({ queryKey: ['planner-favourites'] });
    },
  });

  return (
    <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => mutation.mutate(!saved)}
        disabled={mutation.isPending}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${name} from saved planners` : `Save ${name}`}
        className="grid h-11 w-11 place-items-center rounded-full border border-gray-200 bg-surface/95 text-brand shadow-card hover:bg-surface"
      >
        <Heart size={22} weight={saved ? 'fill' : 'regular'} aria-hidden />
      </button>
      {error && <p className="max-w-[14rem] bg-surface px-2 py-1 text-xs text-critical-fg">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* About                                                                     */
/* ------------------------------------------------------------------------ */

function AboutCard({ planner: p }: { planner: Planner }) {
  const [playing, setPlaying] = useState(false);
  const specs = p.specializations ?? [];
  const video = p.introVideoUrl ?? '';
  const embed = video ? videoEmbedUrl(video) : null;
  const still = video ? videoThumbnail(video) : null;

  if (!p.bio && !p.planningApproach && !specs.length && !video && !(p.yearsExperience > 0)) return null;

  return (
    <Card title="About the Planner">
      <div className={`grid gap-6 ${video ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
        <div className="min-w-0 space-y-5 text-[0.9375rem] leading-[1.8] text-gray-700">
          {p.bio && <p className="whitespace-pre-line">{p.bio}</p>}

          <dl className="space-y-4">
            {p.yearsExperience > 0 && (
              <div>
                <dt className="label">Experience</dt>
                <dd>
                  {p.yearsExperience} year{p.yearsExperience === 1 ? '' : 's'} planning weddings
                  {(p.weddingsCompleted ?? 0) > 0 ? `, ${p.weddingsCompleted} completed` : ''}
                  {(p.servesCities?.length ?? 0) > 0 ? `. Serves ${p.servesCities!.join(', ')}` : ''}.
                </dd>
              </div>
            )}
            {specs.length > 0 && (
              <div>
                <dt className="label">Wedding types</dt>
                <dd className="flex flex-wrap gap-2">
                  {specs.map((s) => (
                    <span key={s} className="pill-neutral">
                      {plannerSpecializationLabel(s)}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {p.planningApproach && (
              <div>
                <dt className="label">Planning approach</dt>
                <dd className="whitespace-pre-line">{p.planningApproach}</dd>
              </div>
            )}
          </dl>
        </div>

        {video && (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group relative block aspect-video w-full self-start overflow-hidden bg-gray-900"
            aria-label={`Play ${p.agencyName}'s introduction video`}
          >
            {still && <img src={still} alt="" className="h-full w-full object-cover opacity-85" />}
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-surface/95 text-brand shadow-card transition-transform group-hover:scale-105">
                <Play size={24} weight="fill" aria-hidden />
              </span>
            </span>
            <span className="absolute bottom-0 left-0 bg-black/60 px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-white">
              Introduction video
            </span>
          </button>
        )}
      </div>

      {playing && (
        <VideoModal url={video} embed={embed} title={`Meet ${p.agencyName}`} onClose={() => setPlaying(false)} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Services                                                                  */
/* ------------------------------------------------------------------------ */

function ServicesCard({
  services,
  selected,
  onToggle,
  interactive,
}: {
  services: string[];
  selected: string[];
  onToggle: (key: string) => void;
  interactive: boolean;
}) {
  return (
    <Card
      title="Services Offered"
      subtitle={
        interactive
          ? 'Select the services you are interested in. These will be shared with the planner when you send a request.'
          : undefined
      }
      action={
        interactive && selected.length > 0 ? (
          <span className="pill-brand">{selected.length} selected</span>
        ) : undefined
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {services.map((key) => {
          const Icon = SERVICE_ICONS[key] ?? ClipboardText;
          const on = selected.includes(key);
          const body = (
            <>
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center ${
                  on ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-brand'
                }`}
              >
                <Icon size={20} weight="light" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">{plannerServiceLabel(key)}</span>
            </>
          );
          return (
            <li key={key}>
              {interactive ? (
                <label
                  className={`flex h-full min-h-[4rem] cursor-pointer items-center gap-3 border p-3 transition-colors ${
                    on ? 'border-brand bg-brand-soft' : 'border-gray-200 hover:border-brand'
                  }`}
                >
                  {body}
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-brand"
                    checked={on}
                    onChange={() => onToggle(key)}
                  />
                </label>
              ) : (
                <div className="flex h-full min-h-[4rem] items-center gap-3 border border-gray-200 p-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Portfolio                                                                 */
/* ------------------------------------------------------------------------ */

function PortfolioCard({ planner: p }: { planner: Planner }) {
  const weddings = p.weddings ?? [];
  const photos = p.portfolio ?? [];
  const track = useRef<HTMLUListElement>(null);
  const [photo, setPhoto] = useState<number | null>(null);

  if (!weddings.length && !photos.length) return null;

  const scroll = (dir: number) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  // A planner who has not written up any weddings yet may still have loose
  // photographs from before weddings existed; those are shown as they are.
  if (!weddings.length) {
    return (
      <Card title="Portfolio">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((url, i) => (
            <li key={url}>
              <button
                type="button"
                onClick={() => setPhoto(i)}
                className="group block aspect-square w-full overflow-hidden bg-surface-sunken"
                aria-label={`Open photo ${i + 1} of ${photos.length}`}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </button>
            </li>
          ))}
        </ul>
        {photo !== null && (
          <Lightbox photos={photos} start={photo} title={p.agencyName} onClose={() => setPhoto(null)} />
        )}
      </Card>
    );
  }

  const arrow =
    'grid h-10 w-10 place-items-center border border-gray-200 text-gray-700 hover:border-brand hover:text-brand';

  return (
    <Card
      title="Portfolio / Previous Weddings"
      action={
        <div className="flex items-center gap-2">
          {weddings.length > 1 && (
            <>
              <button type="button" className={arrow} onClick={() => scroll(-1)} aria-label="Previous weddings">
                <CaretLeft size={16} aria-hidden />
              </button>
              <button type="button" className={arrow} onClick={() => scroll(1)} aria-label="More weddings">
                <CaretRight size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
      }
    >
      <ul
        ref={track}
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]"
        aria-label="Previous weddings"
      >
        {weddings.map((w) => {
          const cover = weddingCover(w);
          return (
            <li key={w.id} className="w-[78%] shrink-0 snap-start sm:w-[45%] lg:w-[calc(25%-0.75rem)]">
              <Link
                to={`/wedding-planners/${p.id}/weddings/${w.id}`}
                className="group block h-full border border-gray-200 bg-surface transition-colors hover:border-brand"
              >
                <div className="aspect-[4/3] overflow-hidden bg-surface-sunken">
                  {cover && (
                    <img
                      src={cover}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <div className="p-3">
                  <p className="font-serif text-lg leading-tight text-gray-900 group-hover:text-brand">{w.title}</p>
                  {weddingMeta(w) && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-gray-600">
                      <MapPin size={13} weight="light" className="mt-px shrink-0" aria-hidden />
                      <span className="min-w-0">{weddingMeta(w)}</span>
                    </p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        to={`/wedding-planners/${p.id}/weddings`}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        View All Weddings
        <ArrowRight size={14} aria-hidden />
      </Link>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Expertise                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The kinds of wedding the planner specialises in. Picking one adds it to the
 * request, so a couple planning a Telugu destination wedding can say so with
 * two taps instead of a sentence.
 */
function ExpertiseCard({
  specializations,
  selected,
  onToggle,
  interactive,
}: {
  specializations: string[];
  selected: string[];
  onToggle: (key: string) => void;
  interactive: boolean;
}) {
  if (!specializations.length) return null;
  return (
    <Card
      title="Expertise"
      subtitle={interactive ? 'Pick the kind of wedding you are planning and it will be added to your request.' : undefined}
    >
      <div className="flex flex-wrap gap-2">
        {specializations.map((key) => {
          const on = selected.includes(key);
          const label = plannerSpecializationLabel(key);
          return interactive ? (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={on}
              className={`inline-flex min-h-10 items-center gap-1.5 border px-4 py-2 text-sm transition-colors ${
                on ? 'border-brand bg-brand text-brand-fg' : 'border-gray-200 text-gray-800 hover:border-brand hover:text-brand'
              }`}
            >
              {on && <Check size={14} weight="bold" aria-hidden />}
              {label}
            </button>
          ) : (
            <span key={key} className="inline-flex min-h-10 items-center border border-gray-200 px-4 py-2 text-sm text-gray-800">
              {label}
            </span>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Reviews                                                                   */
/* ------------------------------------------------------------------------ */

function ReviewsCard({ plannerId, rating, ratingCount }: { plannerId: string; rating: number; ratingCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Reviews" id="reviews">
      {ratingCount > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border border-gray-200 p-4 text-left transition-colors hover:border-brand"
        >
          <span className="font-serif text-[2.5rem] leading-none text-gray-900">{rating.toFixed(1)}</span>
          <span className="flex flex-col gap-1">
            <Stars value={rating} size={18} />
            <span className="text-sm text-gray-600">
              {ratingCount} review{ratingCount === 1 ? '' : 's'}
            </span>
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand">
            Read reviews
            <ArrowRight size={14} aria-hidden />
          </span>
        </button>
      ) : (
        <p className="text-sm text-gray-500">
          No reviews yet. Couples can review a planner once their booking is complete.
        </p>
      )}
      {open && <ReviewsModal plannerId={plannerId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function ReviewsModal({ plannerId, onClose }: { plannerId: string; onClose: () => void }) {
  const { data: reviews = [], isLoading, isError } = useQuery({
    queryKey: ['planner-reviews', plannerId],
    queryFn: async () => (await api.get(`/wedding-planners/${plannerId}/reviews`)).data as Review[],
    retry: false,
  });
  return (
    <Modal title="Client reviews" onClose={onClose} size="lg">
      {isLoading ? (
        <Loading rows={3} />
      ) : isError ? (
        <p className="text-sm text-gray-600">The reviews could not be loaded. Please try again.</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-gray-600">No written reviews yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {reviews.map((r) => (
            <li key={r.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-3">
                <Stars value={r.rating} />
                <span className="text-xs text-gray-500">
                  {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              {r.comment && <p className="mt-2 text-[0.9375rem] leading-relaxed text-gray-700">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */
/* Bottom row: packages, availability, connect                               */
/* ------------------------------------------------------------------------ */

function PackagesCard({ planner: p }: { planner: Planner }) {
  const [open, setOpen] = useState(false);
  const packages = [...(p.packages ?? [])].sort((a, b) => Number(a.price) - Number(b.price));
  const from = packages.length ? Number(packages[0].price) : null;

  return (
    <Card title="Total Package">
      {from !== null ? (
        <>
          <p className="eyebrow">Starting from</p>
          <p className="mt-1 font-serif text-[2.25rem] leading-none text-gray-900 tabular-nums">{rupees(from)}</p>
          <p className="mt-2 text-sm text-gray-600">
            {packages.length} package{packages.length === 1 ? '' : 's'} to choose from. The final price depends on
            your date, guest count and services.
          </p>
          <button type="button" className="btn-outline mt-5 w-full" onClick={() => setOpen(true)}>
            View packages
          </button>
        </>
      ) : (
        <p className="text-sm text-gray-600">
          Pricing on request. Send a request with your date and services and the planner will quote.
        </p>
      )}

      {open && (
        <Modal title="Packages" onClose={() => setOpen(false)} size="lg">
          <ul className="grid gap-4 sm:grid-cols-2">
            {packages.map((k, i) => (
              <li key={`${k.name}-${i}`} className="flex flex-col border border-gray-200 p-4">
                <h3 className="font-serif text-[1.375rem] leading-tight text-brand">{k.name}</h3>
                <p className="mt-1 text-lg font-medium tabular-nums text-gray-900">{rupees(Number(k.price))}</p>
                {(k.includes?.length ?? 0) > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-gray-200 pt-3 text-sm text-gray-700">
                    {k.includes!.map((item) => (
                      <li key={item} className="flex gap-2">
                        <Check size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </Card>
  );
}

function ConnectCard({ planner }: { planner: Planner }) {
  // Only https links on a real host leave the page; anything else is not a link.
  const links = listingSocialLinks(planner);
  if (!links.length) return null;
  return (
    <Card title="Connect" subtitle="See more of their work.">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3">
        {links.map((link) => {
          const Icon = SOCIAL_ICONS[link.platform] ?? LinkIcon;
          const name = socialLinkName(link);
          return (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex aspect-square flex-col items-center justify-center gap-1.5 border border-gray-200 p-2 text-center text-gray-700 transition-colors hover:border-brand hover:text-brand"
                aria-label={`${name} (opens in a new tab)`}
              >
                <Icon size={26} weight="light" aria-hidden />
                <span className="max-w-full truncate text-xs">{name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RequestBanner({ count, onRequest }: { count: number; onRequest: () => void }) {
  return (
    <aside className="z-10 flex flex-col gap-4 rounded-[--radius-lg] border border-brand/30 bg-surface p-5 shadow-lifted sm:sticky sm:bottom-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <p className="font-serif text-xl leading-tight text-brand">Interested in working with this planner?</p>
        <p className="mt-1 text-sm text-gray-600">
          Select the services you need and send a request to get started.
          {count > 0 && <span className="font-medium text-gray-900"> {count} selected.</span>}
        </p>
      </div>
      <button type="button" className="btn w-full shrink-0 sm:w-auto" onClick={onRequest}>
        <PaperPlaneTilt size={16} aria-hidden />
        Send Planner Request
      </button>
    </aside>
  );
}
