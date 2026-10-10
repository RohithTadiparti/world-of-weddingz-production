import { ComponentType, FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IconProps } from '@phosphor-icons/react';
import { Lifebuoy, WarningCircle, Hourglass, CheckCircle } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import PhotoUploader from '../components/PhotoUploader';
import { formatDateTime } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';
import { useAuth } from '../store/auth';
import { CASE_ACTION_LABEL, isProvider } from '../lib/permissions';
import {
  type CaseHistoryEntry,
  canClose,
  canReply,
  raiserTimeline,
  supportBucket,
  supportPrefill,
  supportStatusLabel,
} from '../lib/support-cases';

interface SupportCase {
  id: string;
  subjectType: string;
  subjectId: string | null;
  title: string;
  description: string;
  status: string;
  evidence?: string[];
  createdAt: string;
  history?: CaseHistoryEntry[];
  /** The officer's investigation and the resolution, once there is one (EZ1-I49). */
  findings?: string | null;
  settlementOutcome?: string | null;
  settlementNotes?: string | null;
  /** The category-specific action the case was resolved with (EZ1-I181). */
  resolutionAction?: string | null;
  resolvedAt?: string | null;
}

const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-800',
  triaged: 'bg-sky-50 text-sky-800',
  allocated: 'bg-sky-50 text-sky-800',
  in_progress: 'bg-sky-50 text-sky-800',
  waiting_for_information: 'bg-amber-50 text-amber-800',
  resolution_submitted: 'bg-sky-50 text-sky-800',
  admin_review: 'bg-sky-50 text-sky-800',
  reassigned: 'bg-amber-50 text-amber-800',
  resolved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-gray-100 text-gray-600',
  escalated: 'bg-red-50 text-red-700',
  closed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-600',
};

const OUTCOME_LABEL: Record<string, string> = {
  release: 'Released to the provider',
  refund: 'Refunded to the customer',
  partial: 'Partially settled',
  no_action: 'No action needed',
};

/**
 * Somewhere to say something has gone wrong.
 *
 * Vendors had nowhere at all: an argument about a booking could only be raised
 * from inside that booking, and anything else — a listing that will not
 * verify, a payout that has not arrived, a client behaving badly — had no
 * route into the platform except email.
 *
 * Raising a case against a booking freezes any escrow held on it, so the
 * subject is asked for deliberately rather than inferred: freezing somebody's
 * money by accident is not a small mistake.
 */
/** The three buckets the overview card counts and filters by. */
type Bucket = 'raised' | 'open' | 'pending' | 'resolved' | 'escalated';

export default function Support() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  // "Raise an issue" elsewhere links to /support?new=1, which opens the form
  // straight away rather than leaving the reader on the list to find the button.
  const [raising, setRaising] = useState(() => searchParams.get('new') === '1');
  // Seeded from the param so the case is open in the first paint — a link
  // that opens the page with nothing expanded and a row to find is only half
  // a link. The effect below then strips the param so a reload starts clean.
  const [open, setOpen] = useState<string | null>(() => searchParams.get('case'));
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setRaising(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    const caseId = searchParams.get('case');
    if (!caseId) return;
    setOpen(caseId);
    const next = new URLSearchParams(searchParams);
    next.delete('case');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (raising) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [raising]);
  const [filter, setFilter] = useState<Bucket | null>(() => {
    const value = searchParams.get('status');
    return value === 'raised' || value === 'open' || value === 'pending' || value === 'resolved' || value === 'escalated'
      ? value
      : null;
  });

  const { data: cases, isLoading } = useQuery({
    queryKey: ['support-cases', 'raised'],
    queryFn: async () => (await api.get('/verification/cases', { params: { scope: 'raised' } })).data,
    retry: false,
    // Cases move while the page is open (allocated, waiting on you, resolved);
    // the notifications socket refreshes this too.
    refetchInterval: 20_000,
  });

  const rows: SupportCase[] = cases?.data ?? [];
  // Open is the just-raised state; resolved covers every terminal status;
  // pending is everything in between (being triaged, investigated, waited on).
  const openCases = rows.filter((c) => supportBucket(c.status) === 'open');
  const done = rows.filter((c) => supportBucket(c.status) === 'resolved');
  const pending = rows.filter((c) => supportBucket(c.status) === 'pending');
  const escalated = rows.filter((c) => c.status === 'escalated');

  const sectionProps = {
    open,
    setOpen,
    onChanged: async (message: string) => {
      setError('');
      setNotice(message);
      await qc.invalidateQueries({ queryKey: ['support-cases'] });
    },
    onError: (message: string) => {
      setNotice('');
      setError(message);
    },
  };

  const showAll = filter === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="page-title">Support</h1>
          <p className="page-subtitle">
            Anything that has gone wrong. A booking, a payment, a listing that will not verify.
            Somebody reads every one of these.
          </p>
        </div>
        <button className="btn" onClick={() => setRaising(!raising)}>
          {raising ? 'Cancel' : 'Raise an issue'}
        </button>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {raising && (
        <div ref={formRef} className="scroll-mt-6">
          <RaiseCase
            onDone={async (message) => {
              setError('');
              setNotice(message);
              setRaising(false);
              await qc.invalidateQueries({ queryKey: ['support-cases'] });
            }}
            onError={(message) => {
              setNotice('');
              setError(message);
            }}
          />
        </div>
      )}

      {isLoading && <Loading rows={3} />}

      {!isLoading && rows.length === 0 && !raising && (
        <p className="card text-sm text-gray-400">
          Nothing raised. That is the state you want to be in.
        </p>
      )}

      {!isLoading && rows.length > 0 && (
        <IssuesCard
          total={rows.length}
          openCount={openCases.length}
          pendingCount={pending.length}
          resolvedCount={done.length}
          filter={filter}
          setFilter={setFilter}
        />
      )}

      {(showAll || filter === 'open') && openCases.length > 0 && (
        <Section title="Open" cases={openCases} {...sectionProps} />
      )}
      {filter === 'raised' && rows.length > 0 && (
        <Section title="Raised" cases={rows} {...sectionProps} />
      )}
      {(showAll || filter === 'pending') && pending.length > 0 && (
        <Section title="In progress" cases={pending} {...sectionProps} />
      )}
      {(showAll || filter === 'resolved') && done.length > 0 && (
        <Section title="Resolved" cases={done} {...sectionProps} />
      )}
      {(showAll || filter === 'escalated') && escalated.length > 0 && (
        <Section title="Escalated to Admin" cases={escalated} {...sectionProps} />
      )}
    </div>
  );
}

/**
 * The overview card (EZ1-I208): four counts derived from the cases already
 * loaded — the whole picture in a glance — each a button that filters the list
 * below to that bucket. The active tile stays lit; clicking it again, or the
 * "All" tile, clears the filter. Empty buckets are shown but not clickable:
 * there is nothing to filter to.
 */
function IssuesCard({
  total,
  openCount,
  pendingCount,
  resolvedCount,
  filter,
  setFilter,
}: {
  total: number;
  openCount: number;
  pendingCount: number;
  resolvedCount: number;
  filter: Bucket | null;
  setFilter: (b: Bucket | null) => void;
}) {
  const tiles: {
    key: Bucket | null;
    label: string;
    count: number;
    icon: ComponentType<IconProps>;
    chip: string;
    ring: string;
  }[] = [
    { key: null, label: 'All issues', count: total, icon: Lifebuoy, chip: 'bg-rose-50 text-rose-700', ring: 'ring-rose-300' },
    { key: 'open', label: 'Open', count: openCount, icon: WarningCircle, chip: 'bg-amber-50 text-amber-800', ring: 'ring-amber-300' },
    { key: 'pending', label: 'Pending', count: pendingCount, icon: Hourglass, chip: 'bg-sky-50 text-sky-800', ring: 'ring-sky-300' },
    { key: 'resolved', label: 'Resolved', count: resolvedCount, icon: CheckCircle, chip: 'bg-emerald-50 text-emerald-800', ring: 'ring-emerald-300' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(({ key, label, count, icon: Glyph, chip, ring }) => {
        const active = filter === key;
        // "All" is always selectable; a bucket tile only when it has cases.
        const clickable = key === null || count > 0;
        return (
          <button
            key={label}
            type="button"
            disabled={!clickable}
            aria-pressed={active}
            onClick={() => setFilter(key)}
            className={`card flex items-center gap-3 text-left shadow-card transition duration-200 ease-out ${
              clickable ? 'hover:-translate-y-0.5 hover:shadow-lifted' : 'cursor-default opacity-70'
            } ${active ? `ring-2 ${ring}` : ''}`}
          >
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-md] ${chip}`}>
              <Glyph size={22} weight="duotone" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[1.5rem] font-semibold leading-none tabular-nums text-gray-900">
                {count}
              </span>
              <span className="mt-1 block text-sm font-medium text-gray-600">{label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Section({
  title,
  cases,
  open,
  setOpen,
  onChanged,
  onError,
}: {
  title: string;
  cases: SupportCase[];
  open: string | null;
  setOpen: (id: string | null) => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const myUserId = useAuth((s) => s.user?.id ?? null);
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title} ({cases.length})
      </h2>
      <div className="card divide-y p-0">
        {cases.map((c) => (
          <div key={c.id} className="p-4">
            <button
              className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
              onClick={() => setOpen(open === c.id ? null : c.id)}
            >
              <span className="min-w-0">
                <span className="block font-medium text-gray-900">{c.title}</span>
                <span className="block text-xs text-gray-500">
                  {c.subjectType.replace(/_/g, ' ')} · raised {formatDateTime(c.createdAt)}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-sm px-2 py-1 text-xs ${
                  STATUS_TONE[c.status] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {supportStatusLabel(c.status)}
              </span>
            </button>

            {open === c.id && (
              <div className="mt-3 space-y-2 border-t pt-3 text-sm">
                <p className="whitespace-pre-wrap text-gray-700">{c.description}</p>
                {/* The officer's findings and the resolution, once submitted, so
                    the vendor can see the answer rather than only the status
                    word (EZ1-I49). */}
                {(c.findings || c.settlementOutcome || c.settlementNotes || c.resolutionAction) && (
                  <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-2">
                    <p className="text-xs font-medium text-emerald-900">
                      Resolution{c.resolvedAt ? ` · ${formatDateTime(c.resolvedAt)}` : ''}
                    </p>
                    {c.resolutionAction && (
                      <p className="mt-0.5 text-sm font-medium text-emerald-900">
                        {CASE_ACTION_LABEL[c.resolutionAction] ?? c.resolutionAction.replace(/_/g, ' ')}
                      </p>
                    )}
                    {c.settlementOutcome && (
                      <p className="mt-0.5 text-sm text-emerald-900">
                        {OUTCOME_LABEL[c.settlementOutcome] ?? c.settlementOutcome.replace(/_/g, ' ')}
                      </p>
                    )}
                    {c.findings && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                        {c.findings}
                      </p>
                    )}
                    {c.settlementNotes && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                        {c.settlementNotes}
                      </p>
                    )}
                  </div>
                )}
                {c.evidence && c.evidence.length > 0 && (
                  <p className="flex flex-wrap gap-2">
                    {c.evidence.map((url, i) => (
                      <a
                        key={url}
                        className="text-xs text-brand underline"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Attachment {i + 1}
                      </a>
                    ))}
                  </p>
                )}
                {c.history && c.history.length > 0 && (
                  <ol className="space-y-1 border-l-2 border-gray-200 pl-3">
                    {/* Each step once (EZ1-I193), the raiser's own replies
                        marked as theirs. The desk's internal notes never reach
                        this page; the server strips them. */}
                    {raiserTimeline(c.history, myUserId).map((h, i) => (
                      <li key={i} className="text-xs text-gray-600">
                        <span className="font-medium text-gray-800">{h.label}</span> ·{' '}
                        {formatDateTime(h.at)}
                        {h.note ? `: ${h.note}` : ''}
                      </li>
                    ))}
                  </ol>
                )}
                <CaseActions item={c} onChanged={onChanged} onError={onError} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What the person who raised a case can do with it: reply (with more proof)
 * while it is open, and close it — accepting an answer or withdrawing it. The
 * desk could park a case on the vendor ("Waiting on you") and there was no way
 * to answer from here.
 */
function CaseActions({
  item,
  onChanged,
  onError,
}: {
  item: SupportCase;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const replyable = canReply(item.status);
  const closable = canClose(item.status);
  if (!replyable && !closable) return null;

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      setMessage('');
      setEvidence([]);
      await onChanged(done);
    } catch (err) {
      onError(apiMessage(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      {replyable && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim().length < 2) return;
            void act(
              () =>
                api.put(`/verification/cases/${item.id}/reply`, {
                  message: message.trim(),
                  evidence: evidence.length ? evidence : undefined,
                }),
              'Reply sent. Whoever is working on it has been told.',
            );
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-gray-700">
              {item.status === 'waiting_for_information' ? 'Answer the question above' : 'Add a reply'}
            </span>
            <textarea
              className="input mt-1"
              rows={2}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {evidence.map((url, i) => (
              <span key={url} className="rounded-sm bg-gray-100 px-2 py-1 text-xs">
                Attachment {i + 1}
              </span>
            ))}
            {evidence.length < 10 && (
              <PhotoUploader kind="attachment" label="Attach" onUploaded={(url) => setEvidence([...evidence, url])} />
            )}
            <button className="btn btn-sm" disabled={busy || message.trim().length < 2}>
              Send reply
            </button>
          </div>
        </form>
      )}
      {closable && (
        <button
          type="button"
          className="btn-outline btn-sm"
          disabled={busy}
          onClick={() =>
            void act(
              () => api.put(`/verification/cases/${item.id}/close`, {}),
              supportBucket(item.status) === 'resolved' ? 'Case closed.' : 'Case withdrawn and closed.',
            )
          }
        >
          {supportBucket(item.status) === 'resolved' ? 'Close case' : 'Withdraw and close'}
        </button>
      )}
    </div>
  );
}

/**
 * What a case can be raised about, and who it is offered to (EZ1-I149).
 *
 * `audience` narrows a category to the people it makes sense for: a vendor's
 * complaints are about their listing, availability and payouts, never about a
 * match or a matchmaking profile — those belong to the couples and agents on
 * the other side of the marketplace. `undefined` means everyone sees it.
 * Staff (officers, admins) see the full list so they can raise on any subject.
 */
type Audience = 'provider' | 'seeker';
const SUBJECTS: { value: string; label: string; hint?: string; audience?: Audience[] }[] = [
  {
    value: 'booking',
    label: 'A booking',
    hint: 'Any money held on it is frozen until this is settled.',
  },
  { value: 'payment', label: 'A payment or payout' },
  { value: 'vendor', label: 'My business listing', audience: ['provider'] },
  { value: 'availability', label: 'Availability', audience: ['provider'] },
  { value: 'profile', label: 'A profile', audience: ['seeker'] },
  { value: 'match', label: 'A match', audience: ['seeker'] },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
];

function subjectsFor(role?: string) {
  const provider = isProvider(role);
  const seeker = role === 'bride' || role === 'groom' || role === 'family' || role === 'agent';
  return SUBJECTS.filter((s) => {
    if (!s.audience) return true;
    if (provider) return s.audience.includes('provider');
    if (seeker) return s.audience.includes('seeker');
    // Staff and anyone unclassified see everything.
    return true;
  });
}

function RaiseCase({
  onDone,
  onError,
}: {
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const role = useAuth((s) => s.user?.role);
  const subjects = subjectsFor(role);
  // "Contact support" on a refused listing arrives already about that listing
  // (?subject=vendor&business=…, row 27).
  const [searchParams] = useSearchParams();
  const [prefill] = useState(() => supportPrefill(searchParams));
  const [subjectType, setSubjectType] = useState(() =>
    subjects.some((s) => s.value === prefill.subjectType) ? prefill.subjectType : 'other',
  );
  const [subjectId, setSubjectId] = useState(prefill.subjectId);
  const { data: businesses = [] } = useQuery({
    queryKey: ['vendor-me'],
    queryFn: async () => (await api.get('/vendors/me')).data as { id: string; name: string; status: string }[],
    enabled: role === 'vendor' && subjectType === 'vendor',
    retry: false,
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const subject = subjects.find((s) => s.value === subjectType);
  const needsSubject = subjectType === 'booking' || subjectType === 'payment';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/verification/cases', {
        subjectType,
        subjectId: subjectId.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
        evidence: evidence.length > 0 ? evidence : undefined,
      });
      onDone('Raised. You will see it move through the stages here.');
      setTitle('');
      setDescription('');
      setSubjectId('');
      setEvidence([]);
    } catch (err) {
      onError(apiMessage(err, 'That could not be raised.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">What is it about?</span>
          <select
            className="input mt-1"
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value);
              setSubjectId('');
            }}
          >
            {subjects.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {subject?.hint && (
            <span className="mt-1 block text-xs text-amber-700">{subject.hint}</span>
          )}
        </label>
        {subjectType === 'vendor' && businesses.length > 0 && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Which listing?</span>
            <select className="input mt-1" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Not about one listing</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              The administrator and officer see this listing in full with your case.
            </span>
          </label>
        )}
        {needsSubject && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Which one?</span>
            <input
              className="input mt-1"
              placeholder="Booking reference"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            />
            <span className="mt-1 block text-xs text-gray-500">
              The reference on the booking. Leave it blank if you are not sure.
            </span>
          </label>
        )}
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">In one line</span>
        <input
          className="input mt-1"
          minLength={5}
          maxLength={200}
          placeholder="The hall we were shown is not the hall we were given"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">What happened?</span>
        <textarea
          className="input mt-1"
          rows={4}
          minLength={10}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-gray-500">
          Dates, names, amounts. An investigation run on two sentences is a coin toss.
        </span>
      </label>

      <div className="text-sm">
        <span className="font-medium text-gray-700">Anything you can show us</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {evidence.map((url, i) => (
            <span key={url} className="flex items-center gap-1 rounded-sm bg-gray-100 px-2 py-1 text-xs">
              Attachment {i + 1}
              <button
                type="button"
                className="text-gray-500 hover:text-red-600"
                onClick={() => setEvidence(evidence.filter((e) => e !== url))}
              >
                ×
              </button>
            </span>
          ))}
          {evidence.length < 10 && (
            <PhotoUploader
              kind="attachment"
              label="Attach"
              onUploaded={(url) => setEvidence([...evidence, url])}
            />
          )}
        </div>
      </div>

      <button className="btn" disabled={busy}>
        {busy ? 'Raising…' : 'Raise it'}
      </button>
    </form>
  );
}
