import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClipboardText,
  CurrencyInr,
  EnvelopeSimple,
  FileText,
  Heart,
  ImageSquare,
  MagnifyingGlass,
  MapPin,
  NotePencil,
  Tray,
  Users,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/dates';
import {
  PlannerRequestCard,
  PlannerRequestDetail,
  PlannerRequestStatus,
  STATUS_LABEL,
  STATUS_TABS,
  STATUS_TONE,
  budgetRange,
  guestRange,
  receivedAgo,
  requestActions,
  serviceLabel,
} from '../lib/planner-requests';
import { EmptyState, Loading } from '../components/ui/Feedback';
import ConfirmDialog from '../components/ConfirmDialog';
import BookingChat from '../components/BookingChat';
import { QuotationForm } from '../components/ProviderBookings';

/**
 * A wedding planner's incoming requests, and one of them in full.
 *
 * Laid out as a list beside a detail, because the planner's job here is
 * triage: read who is asking, for what day and what money, decide, and move
 * to the next. On a narrow screen the two take turns — the list, then the
 * request opened from it — with a way back.
 *
 * Everything the planner sees about the couple comes from the request itself.
 * Their phone number is deliberately absent (the API does not send it): talk
 * happens on the platform until the job is agreed.
 */

type Sort = 'newest' | 'oldest' | 'wedding';

export default function PlannerRequests() {
  const { bookingId } = useParams<{ bookingId?: string }>();
  const [tab, setTab] = useState<PlannerRequestStatus | 'all'>('new');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const { data: requests = [], isLoading } = useQuery<PlannerRequestCard[]>({
    queryKey: ['planner-requests'],
    queryFn: async () => (await api.get('/bookings/planner-requests')).data,
    retry: false,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  // Opened from a link straight to one request: show the tab it sits in, so
  // the card it came from is visible and highlighted in the list.
  const opened = requests.find((r) => r.id === bookingId);
  useEffect(() => {
    if (opened && tab !== 'all' && opened.status !== tab) setTab(opened.status);
    // Only when the opened request changes, not every time the tab does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.id, opened?.status]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests
      .filter((r) => tab === 'all' || r.status === tab)
      .filter((r) => {
        if (!q) return true;
        return [r.client.name, r.location, r.requestNumber, r.weddingDate && formatDate(r.weddingDate)]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sort === 'wedding') {
          const at = a.weddingDate ? Date.parse(a.weddingDate) : Infinity;
          const bt = b.weddingDate ? Date.parse(b.weddingDate) : Infinity;
          return at - bt;
        }
        const diff = Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
        return sort === 'newest' ? diff : -diff;
      });
  }, [requests, tab, query, sort]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">
            <Link to="/my-clients" className="hover:text-brand">
              My Clients
            </Link>{' '}
            / Requests
          </p>
          <h1 className="page-title mt-1">
            Planner Requests
            {(counts.new ?? 0) > 0 && (
              <span className="ml-2 align-middle font-sans text-base text-gray-500">
                ({counts.new} new)
              </span>
            )}
          </h1>
          <p className="page-subtitle">
            Couples who have asked you to plan their wedding. Review each request, then accept,
            quote or decline.
          </p>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]">
        {/* The list. Hidden on a narrow screen while a request is open. */}
        <section className={`card p-0 ${bookingId ? 'hidden lg:block' : ''}`} aria-label="Requests">
          <div className="border-b border-gray-200 px-4 pt-3">
            <div className="-mb-px flex gap-4 overflow-x-auto" role="tablist">
              {STATUS_TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.key)}
                    className={`shrink-0 border-b-2 pb-2.5 text-sm transition-colors ${
                      active
                        ? 'border-brand font-medium text-brand'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {t.label}
                    <span className="ml-1 tabular-nums text-gray-500">({counts[t.key] ?? 0})</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 border-b border-gray-200 p-3">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                className="input w-full py-1.5 pl-8 text-sm"
                placeholder="Search by name, place or date"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search requests"
              />
            </div>
            <select
              className="input w-32 py-1.5 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort requests"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="wedding">Wedding date</option>
            </select>
          </div>

          {isLoading ? (
            <div className="p-4">
              <Loading rows={4} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Tray} title={query ? 'No matches' : 'Nothing here'}>
                {query
                  ? 'No request in this tab matches that search.'
                  : tab === 'new'
                    ? 'No new requests. Couples find you through Hire a Planner; their requests land here.'
                    : 'No requests in this state.'}
              </EmptyState>
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-15rem)] space-y-2 overflow-y-auto p-3 lg:min-h-[24rem]">
              {rows.map((r) => (
                <li key={r.id}>
                  <RequestCardLink request={r} selected={r.id === bookingId} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The request. On a narrow screen, only once one is chosen. */}
        <section className={bookingId ? '' : 'hidden lg:block'} aria-label="Request details">
          {bookingId ? (
            <RequestDetail bookingId={bookingId} />
          ) : (
            <div className="card flex min-h-[24rem] items-center justify-center">
              <EmptyState icon={ClipboardText} title="Choose a request">
                Pick a request on the left to see the couple, their wedding and what they are
                asking you for.
              </EmptyState>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ list card

function RequestCardLink({ request: r, selected }: { request: PlannerRequestCard; selected: boolean }) {
  return (
    <Link
      to={`/my-clients/requests/${r.id}`}
      aria-current={selected ? 'true' : undefined}
      className={`flex gap-3 rounded-[--radius-md] border p-3 transition-colors ${
        selected
          ? 'border-brand bg-brand-soft/60'
          : 'border-gray-200 bg-surface hover:border-gray-300 hover:bg-surface-sunken/50'
      }`}
    >
      <Avatar name={r.client.name} photo={r.client.photo} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-serif text-lg leading-tight text-gray-900">
            {r.client.name ?? 'A couple'}
          </p>
          <span className={`${STATUS_TONE[r.status]} shrink-0 px-2 py-0.5 text-[0.6875rem]`}>
            {STATUS_LABEL[r.status]}
          </span>
        </div>
        <dl className="mt-1.5 space-y-0.5 text-[0.8125rem] text-gray-600">
          <IconLine icon={<CalendarBlank size={14} aria-hidden />} label="Wedding date">
            {formatDate(r.weddingDate, 'Date not set')}
          </IconLine>
          <IconLine icon={<MapPin size={14} aria-hidden />} label="Location">
            {r.location ?? 'Place not set'}
          </IconLine>
          <div className="flex items-center justify-between gap-2">
            <IconLine icon={<CurrencyInr size={14} aria-hidden />} label="Budget">
              {budgetRange(r.budgetMin, r.budgetMax, 'Budget not shared')}
            </IconLine>
            <span className="shrink-0 text-xs text-gray-500">{receivedAgo(r.receivedAt)}</span>
          </div>
        </dl>
      </div>
    </Link>
  );
}

function IconLine({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="shrink-0 text-gray-400">
        {icon}
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function Avatar({
  name,
  photo,
  size,
}: {
  name: string | null;
  photo: string | null;
  size: 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'h-20 w-20 text-2xl sm:h-24 sm:w-24' : 'h-14 w-14 text-lg';
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className={`${box} shrink-0 rounded-full object-cover ring-1 ring-gray-200`}
        loading="lazy"
      />
    );
  }
  const initials = (name ?? '?')
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-serif text-brand-strong`}
    >
      {initials || '?'}
    </span>
  );
}

// ------------------------------------------------------------------- detail

type DetailTab = 'details' | 'conversation' | 'activity';

function RequestDetail({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>('details');
  const [quoting, setQuoting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ tone: 'positive' | 'critical'; text: string } | null>(null);

  useEffect(() => {
    setTab('details');
    setQuoting(false);
    setDeclining(false);
    setNotice(null);
  }, [bookingId]);

  const { data: r, isLoading, error } = useQuery<PlannerRequestDetail>({
    queryKey: ['planner-request', bookingId],
    queryFn: async () => (await api.get(`/bookings/planner-requests/${bookingId}`)).data,
    retry: false,
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['planner-request', bookingId] });
    qc.invalidateQueries({ queryKey: ['planner-requests'] });
    qc.invalidateQueries({ queryKey: ['planner-clients'] });
    qc.invalidateQueries({ queryKey: ['planner-clients-summary'] });
  }, [qc, bookingId]);

  const accept = useMutation({
    mutationFn: async () => (await api.put(`/bookings/planner-requests/${bookingId}/accept`)).data,
    onSuccess: (data: PlannerRequestDetail) => {
      qc.setQueryData(['planner-request', bookingId], data);
      refresh();
      setNotice({
        tone: 'positive',
        text: 'Request accepted. Send your quotation next so the couple can see your price.',
      });
      // The next step is the price, so it opens straight away.
      setQuoting(true);
    },
    onError: (err) => setNotice({ tone: 'critical', text: apiMessage(err, 'Could not accept it.') }),
  });

  const decline = useMutation({
    mutationFn: async () =>
      api.put(`/bookings/${bookingId}/cancel`, { reason: reason.trim() || undefined }),
    onSuccess: () => {
      setDeclining(false);
      setReason('');
      refresh();
      setNotice({ tone: 'positive', text: 'Request declined. The couple has been told.' });
    },
    onError: (err) => setNotice({ tone: 'critical', text: apiMessage(err, 'Could not decline it.') }),
  });

  if (isLoading) {
    return (
      <div className="card">
        <Loading rows={6} />
      </div>
    );
  }
  if (error || !r) {
    return (
      <div className="card">
        <EmptyState icon={WarningCircle} title="Request not found">
          {apiMessage(error, 'This request is not on your listing, or it no longer exists.')}
        </EmptyState>
        <Link to="/my-clients/requests" className="btn-outline btn-sm mt-3">
          Back to requests
        </Link>
      </div>
    );
  }

  const actions = requestActions(r);
  const anyAction = actions.accept || actions.quote || actions.decline;

  return (
    <div className="card space-y-5 p-4 sm:p-6">
      {/* Way back, and the reference. */}
      <div className="flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-gray-700 hover:text-brand"
          onClick={() => navigate('/my-clients/requests')}
        >
          <ArrowLeft size={16} aria-hidden /> Back to Requests
        </button>
        <span className="font-mono text-xs text-gray-500">Request #{r.requestNumber}</span>
      </div>

      {/* Who is asking. */}
      <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center">
        <Avatar name={r.client.name} photo={r.client.photo} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-[1.75rem] leading-tight text-gray-900">
              {r.client.name ?? 'A couple'}
            </h2>
            <span className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>
          </div>
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <MapPin size={16} className="text-brand" aria-hidden />
            {r.client.city ?? r.location ?? 'City not shared'}
          </p>
          {r.client.email && (
            <p className="flex min-w-0 items-center gap-2 text-sm text-gray-700">
              <EnvelopeSimple size={16} className="shrink-0 text-brand" aria-hidden />
              <a href={`mailto:${r.client.email}`} className="truncate hover:underline">
                {r.client.email}
              </a>
            </p>
          )}
        </div>
        <div className="shrink-0 rounded-[--radius-md] bg-brand-soft/70 px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-brand-strong">
            <CalendarBlank size={16} aria-hidden /> Request received
          </p>
          <p className="mt-0.5 text-gray-700">{formatDateTime(r.receivedAt)}</p>
          {r.acceptedAt && (
            <p className="mt-1 text-xs text-gray-500">Accepted {formatDateTime(r.acceptedAt)}</p>
          )}
        </div>
      </header>

      <StatusTrail status={r.status} />

      {notice && (
        <p className={notice.tone === 'positive' ? 'alert-positive' : 'alert-critical'} role="status">
          {notice.text}
        </p>
      )}

      {/* Sections of the request. */}
      <div className="grid grid-cols-3 gap-1 rounded-[--radius-md] bg-surface-sunken p-1" role="tablist">
        {(
          [
            ['details', 'Request Details'],
            ['conversation', 'Conversation'],
            ['activity', 'Activity'],
          ] as [DetailTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-[--radius-sm] px-2 py-2 text-sm transition-colors ${
              tab === key ? 'bg-brand text-brand-fg shadow-btn' : 'text-gray-700 hover:bg-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab r={r} />}
      {tab === 'conversation' && <BookingChat bookingId={r.id} />}
      {tab === 'activity' && <ActivityTab bookingId={r.id} />}

      {/* What the planner can do now. */}
      {anyAction ? (
        <section className="rounded-[--radius-md] border border-brand/15 bg-brand-soft/40 p-4">
          <h3 className="flex items-center gap-2 font-serif text-xl text-brand">
            <ClipboardText size={20} aria-hidden /> Request Actions
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <ActionButton
              tone="positive"
              icon={<CheckCircle size={26} weight="light" aria-hidden />}
              title={r.status === 'new' ? 'Accept Request' : 'Accepted'}
              hint={r.status === 'new' ? 'Take it on, then quote' : 'You have taken this on'}
              disabled={!actions.accept || accept.isPending}
              onClick={() => accept.mutate()}
            />
            <ActionButton
              tone="brand"
              icon={<FileText size={26} weight="light" aria-hidden />}
              title={actions.quote === 'revise' ? 'Send Revised Quotation' : 'Send Quotation'}
              hint={
                r.status === 'requote_requested'
                  ? 'The couple asked for a new price'
                  : actions.quote === 'revise'
                    ? 'Replaces the offer they have'
                    : 'Send package and pricing'
              }
              disabled={!actions.quote}
              onClick={() => setQuoting(true)}
            />
            <ActionButton
              tone="critical"
              icon={<XCircle size={26} weight="light" aria-hidden />}
              title="Decline Request"
              hint="Close this request"
              disabled={!actions.decline}
              onClick={() => setDeclining(true)}
            />
          </div>
        </section>
      ) : (
        <ClosedNote r={r} />
      )}

      {quoting && (
        <Modal
          title={actions.quote === 'revise' ? 'Send a revised quotation' : 'Send a quotation'}
          onClose={() => setQuoting(false)}
        >
          <p className="text-sm text-gray-600">
            For {r.client.name ?? 'the couple'}
            {r.weddingDate ? `, ${formatDate(r.weddingDate)}` : ''}. They asked for{' '}
            {r.services.length > 0 ? r.services.map(serviceLabel).join(', ') : 'wedding planning'}; budget{' '}
            {budgetRange(r.budgetMin, r.budgetMax).toLowerCase()}.
          </p>
          <QuotationForm
            bookingId={r.id}
            onDone={() => {
              setQuoting(false);
              refresh();
              setNotice({
                tone: 'positive',
                text: 'Quotation sent. The couple can accept it or ask for a new price.',
              });
            }}
          />
        </Modal>
      )}

      {declining && (
        <ConfirmDialog
          title="Decline this request?"
          body={`${r.client.name ?? 'The couple'} will be told you cannot take their wedding on. This cannot be undone.`}
          confirmLabel={decline.isPending ? 'Declining…' : 'Decline request'}
          busy={decline.isPending}
          onConfirm={() => decline.mutate()}
          onDismiss={() => setDeclining(false)}
        >
          <label className="mt-3 block text-sm">
            <span className="text-gray-700">
              Reason <span className="text-gray-400">(optional, shown to the couple)</span>
            </span>
            <textarea
              className="input mt-1"
              rows={3}
              maxLength={500}
              placeholder="For example: already booked on that date"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Where the request is on its way from received to agreed. */
function StatusTrail({ status }: { status: PlannerRequestStatus }) {
  if (status === 'declined' || status === 'closed') return null;
  const steps = ['Received', 'Accepted', status === 'requote_requested' ? 'Re-quote asked' : 'Quoted'];
  const reached = status === 'new' ? 0 : status === 'accepted' ? 1 : 2;
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Request progress">
      {steps.map((label, i) => {
        const done = i <= reached;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] ${
                done ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 text-gray-500'
              }`}
            >
              {i + 1}
            </span>
            <span className={done ? 'font-medium text-gray-900' : 'text-gray-500'}>{label}</span>
            {i < steps.length - 1 && (
              <span className={`h-px flex-1 ${i < reached ? 'bg-brand' : 'bg-gray-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DetailsTab({ r }: { r: PlannerRequestDetail }) {
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Panel icon={<Heart size={20} aria-hidden />} title="Wedding Details">
        <dl className="space-y-4">
          <Fact label="Preferred wedding date" icon={<CalendarBlank size={18} aria-hidden />}>
            <span className="flex flex-wrap items-center gap-2">
              {formatDate(r.weddingDate, 'Not set')}
              <AvailabilityPill availability={r.availability} />
            </span>
          </Fact>
          <Fact label="Wedding location" icon={<MapPin size={18} aria-hidden />}>
            {r.location ?? 'Not shared'}
          </Fact>
          <div className="grid gap-4 border-t border-gray-200 pt-4 sm:grid-cols-2">
            <Fact label="Expected guest count" icon={<Users size={18} aria-hidden />}>
              {guestRange(r.guestCountMin, r.guestCountMax)}
            </Fact>
            <Fact label="Budget range" icon={<CurrencyInr size={18} aria-hidden />}>
              {budgetRange(r.budgetMin, r.budgetMax)}
            </Fact>
          </div>
          <Fact label="Wedding type" icon={<Heart size={18} aria-hidden />}>
            {r.weddingType ? `${r.weddingType} wedding` : 'Not shared'}
          </Fact>
          <div>
            <dt className="text-sm text-gray-500">Additional requirements</dt>
            <dd className="mt-1.5 flex gap-2.5 rounded-[--radius-md] bg-surface-sunken p-3 text-sm leading-relaxed text-gray-800">
              <NotePencil size={18} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
              <span className="whitespace-pre-line">
                {r.requirements?.trim() || r.notes?.trim() || 'Nothing further from the couple.'}
              </span>
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="space-y-4">
        <Panel
          icon={<ClipboardText size={20} aria-hidden />}
          title={`Selected Services (${r.services.length})`}
        >
          {r.services.length === 0 ? (
            <p className="text-sm text-gray-600">
              The couple did not pick specific services. Treat it as a general request for wedding
              planning.
            </p>
          ) : (
            <ul className="space-y-2">
              {r.services.map((s) => (
                <li
                  key={s}
                  className="flex items-center gap-3 rounded-[--radius-md] border border-brand/20 bg-brand-soft/40 px-3 py-2.5 text-sm text-gray-900"
                >
                  <CheckCircle size={18} weight="fill" className="shrink-0 text-brand" aria-hidden />
                  {serviceLabel(s)}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={<ImageSquare size={20} aria-hidden />}
          title="Reference Images"
          aside={
            r.referenceImages.length > 0
              ? `${r.referenceImages.length} attachment${r.referenceImages.length === 1 ? '' : 's'}`
              : undefined
          }
        >
          {r.referenceImages.length === 0 ? (
            <p className="text-sm text-gray-600">No inspiration images were attached.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {r.referenceImages.map((url, i) => (
                <li key={url}>
                  <button
                    type="button"
                    onClick={() => setViewing(i)}
                    className="group block aspect-square w-full overflow-hidden rounded-[--radius-md] ring-1 ring-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    aria-label={`View reference image ${i + 1} full size`}
                  >
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {r.quotation && <QuotationPanel q={r.quotation} />}
      </div>

      {viewing !== null && (
        <Lightbox urls={r.referenceImages} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

const QUOTE_STAGE: Record<NonNullable<PlannerRequestDetail['quotation']>['stage'], string> = {
  sent: 'Waiting on the couple',
  requoted: 'Revised offer waiting on the couple',
  accepted: 'Accepted by the couple',
  declined: 'Declined — the couple asked for a new price',
  withdrawn: 'Withdrawn by you',
  expired: 'Expired before the couple answered',
  superseded: 'Replaced by a newer offer',
};

function QuotationPanel({ q }: { q: NonNullable<PlannerRequestDetail['quotation']> }) {
  return (
    <Panel icon={<FileText size={20} aria-hidden />} title="Your Quotation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-serif text-2xl text-gray-900">
          ₹{Number(q.amount).toLocaleString('en-IN')}
        </p>
        <p className="text-xs text-gray-500">
          Sent {formatDateTime(q.sentAt)}
          {q.count > 1 ? ` · offer ${q.count}` : ''}
        </p>
      </div>
      <p className="mt-1 text-sm text-gray-700">{QUOTE_STAGE[q.stage]}</p>
      {q.responseNote && (
        <p className="mt-2 rounded-[--radius-md] bg-surface-sunken p-3 text-sm text-gray-700">
          “{q.responseNote}”
        </p>
      )}
    </Panel>
  );
}

function AvailabilityPill({ availability: a }: { availability: PlannerRequestDetail['availability'] }) {
  switch (a.state) {
    case 'available':
      return (
        <span className="pill-positive">
          <CheckCircle size={14} aria-hidden /> Available
          {a.openings > 1 ? ` · ${a.openings} openings` : ''}
        </span>
      );
    case 'booked':
      return (
        <span className="pill-critical">
          <XCircle size={14} aria-hidden /> Already booked
          {a.otherBookings > 1 ? ` (${a.otherBookings})` : ''}
        </span>
      );
    case 'unpublished':
      return (
        <span className="pill-caution" title="You have not published an opening on this date">
          <WarningCircle size={14} aria-hidden /> Not on your calendar
        </span>
      );
    case 'past':
      return <span className="pill-neutral">Date has passed</span>;
    default:
      return null;
  }
}

function Panel({
  icon,
  title,
  aside,
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[--radius-md] border border-gray-200 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-serif text-xl text-gray-900">
          <span className="text-brand">{icon}</span>
          {title}
        </h3>
        {aside && <span className="text-xs text-gray-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-2.5 text-[1.0625rem] text-gray-900">
        <span className="shrink-0 text-gray-500">{icon}</span>
        {children}
      </dd>
    </div>
  );
}

function ActionButton({
  tone,
  icon,
  title,
  hint,
  disabled,
  onClick,
}: {
  tone: 'positive' | 'brand' | 'critical';
  icon: ReactNode;
  title: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const tones = {
    positive: 'bg-emerald-700 text-white hover:bg-emerald-800 border-transparent',
    brand: 'bg-brand text-brand-fg hover:bg-brand-500 border-transparent',
    critical: 'bg-surface text-critical-fg border-critical-fg/50 hover:bg-critical-bg',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-[--radius-md] border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${tones[tone]}`}
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs opacity-85">{hint}</span>
      </span>
    </button>
  );
}

/** Why there is nothing left to do here, and where the job went. */
function ClosedNote({ r }: { r: PlannerRequestDetail }) {
  if (r.status === 'declined' || r.status === 'closed') {
    return (
      <p className="alert-neutral">
        {r.status === 'declined' ? 'You declined this request' : 'This request is closed'}
        {r.cancelledAt ? ` on ${formatDate(r.cancelledAt)}` : ''}.
        {r.cancellationReason ? ` Reason: ${r.cancellationReason}` : ''}
      </p>
    );
  }
  return (
    <div className="alert-positive flex flex-wrap items-center justify-between gap-3">
      <span>
        The couple agreed your price of ₹{Number(r.amount).toLocaleString('en-IN')}. The wedding
        now continues from your client list.
      </span>
      <Link to={`/my-clients/${r.client.userId}`} className="btn-outline btn-sm">
        Open client
      </Link>
    </div>
  );
}

function ActivityTab({ bookingId }: { bookingId: string }) {
  const { data = [], isLoading } = useQuery<{ at: string; label: string; detail: string | null }[]>({
    queryKey: ['booking-history', bookingId],
    queryFn: async () => (await api.get(`/bookings/${bookingId}/history`)).data,
  });
  if (isLoading) return <Loading rows={3} />;
  if (data.length === 0) return <p className="text-sm text-gray-600">Nothing has happened yet.</p>;
  return (
    <ol className="space-y-3 border-l border-gray-200 pl-4">
      {data.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden />
          <p className="text-sm font-medium text-gray-900">{e.label}</p>
          {e.detail && <p className="text-sm text-gray-600">{e.detail}</p>}
          <p className="text-xs text-gray-500">{formatDateTime(e.at)}</p>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------- overlays

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="card my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">{title}</h2>
          <button type="button" className="btn-ghost p-1.5" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A reference image at full size, with the others a key press away. */
function Lightbox({
  urls,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const many = urls.length > 1;
  const go = useCallback(
    (step: number) => onIndex((index + step + urls.length) % urls.length),
    [index, onIndex, urls.length],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && many) go(1);
      if (e.key === 'ArrowLeft' && many) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, many, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reference image ${index + 1} of ${urls.length}`}
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={22} />
      </button>
      {many && (
        <button
          type="button"
          className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Previous image"
        >
          <CaretLeft size={24} />
        </button>
      )}
      <figure className="flex max-h-full max-w-5xl flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <img src={urls[index]} alt="" className="max-h-[80vh] max-w-full object-contain" />
        <figcaption className="mt-3 flex items-center gap-4 text-sm text-white/80">
          {index + 1} / {urls.length}
          <a href={urls[index]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            Open original
          </a>
        </figcaption>
      </figure>
      {many && (
        <button
          type="button"
          className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="Next image"
        >
          <CaretRight size={24} />
        </button>
      )}
    </div>
  );
}
