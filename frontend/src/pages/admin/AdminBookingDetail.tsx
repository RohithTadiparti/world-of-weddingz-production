import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { BOOKING_STATUS_LABEL, CASE_STATUS_LABEL } from '../../lib/permissions';
import {
  BUSINESS_STATUS_LABEL,
  formatMoney,
  humanize,
  labelFrom,
  milestoneLabel,
  paymentStatusLabel,
  roleLabel,
} from '../../lib/labels';
import { EmptyState, Loading } from '../../components/ui/Feedback';

/**
 * One booking, with everybody attached to it (EZ1-I173).
 *
 * The list answers "who booked whom for what"; this answers "and then what
 * happened" — the lifecycle, every payment, any dispute, and a way through to
 * the customer's and provider's own detail pages. All of it is the one
 * `/admin/bookings/:id` read the console already had.
 */

interface Party {
  id: string;
  /** The customer's display name, when the server resolves one. */
  name?: string | null;
  email?: string;
  phone?: string | null;
  role?: string;
  managedByAgentId?: string | null;
}

interface Provider {
  id: string;
  ownerUserId?: string;
  name?: string;
  category?: string;
  status?: string | null;
  type?: string;
}

interface Payment {
  id: string;
  milestone: string;
  status: string;
  amount: string;
  payoutAmount: string;
  currency: string;
  createdAt: string;
}

interface Dispute {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface BookingDetail {
  booking: {
    id: string;
    status: string;
    amount: string;
    currency: string;
    eventDate: string | null;
    createdAt: string;
    requirements: string | null;
    providerType: string;
    quantity: number | null;
  };
  client: Party | null;
  agent: Party | null;
  provider: Provider;
  service: { id: string; name: string | null } | null;
  payments: Payment[];
  disputes: Dispute[];
  /**
   * The wedding event behind the booking, and the names the list rows already
   * carry — read when the server sends them, so a booking without its own
   * event or service link still says what it was for.
   */
  context?: {
    eventName: string | null;
    eventDate: string | null;
    venue: string | null;
    city: string | null;
    guests?: number | null;
  } | null;
  customerName?: string | null;
  serviceName?: string | null;
  /** The newest offer, so an unpriced booking shows what was quoted. */
  quotation?: { amount: string; currency?: string; stage?: string } | null;
}

// The ordinary forward path, so the timeline can show what is done, where the
// booking is now, and what is still ahead. Disputed and cancelled sit off this
// line and are shown as the current state rather than a step.
const LIFECYCLE = [
  'requested',
  'quotation_sent',
  'quotation_accepted',
  'payment_pending',
  'pending',
  'confirmed',
  'in_progress',
  'completed',
];

const money = (v: string, ccy = 'INR') =>
  `${ccy === 'INR' ? '₹' : `${ccy} `}${Number(v ?? 0).toLocaleString('en-IN')}`;

export default function AdminBookingDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<BookingDetail>({
    queryKey: ['admin-booking-detail', id],
    queryFn: async () => (await api.get(`/admin/bookings/${id}`)).data,
    retry: false,
  });

  if (isLoading) return <Loading rows={6} />;
  if (error || !data)
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState title="Booking not found">
          {apiMessage(error, 'That booking could not be opened.')}
        </EmptyState>
      </div>
    );

  const { booking, client, agent, provider, service, payments, disputes } = data;
  // When and where, as the server derives them (linked function, then the
  // booking form, then the wedding) — the same date the booking lists show.
  const context = data.context ?? null;
  const event = context
    ? { name: context.eventName, venue: context.venue, city: context.city }
    : null;
  const eventDate = context?.eventDate ?? booking.eventDate ?? null;
  const customerName = client?.name ?? data.customerName ?? null;
  const serviceName = service?.name ?? data.serviceName ?? null;
  const providerRoute =
    provider.ownerUserId && provider.type === 'planner'
      ? `/admin/planners/${provider.ownerUserId}`
      : provider.ownerUserId
        ? `/admin/vendors/${provider.ownerUserId}`
        : null;
  const currentIndex = LIFECYCLE.indexOf(booking.status);
  const offTrack = booking.status === 'disputed' || booking.status === 'cancelled';

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Booking #{booking.id.slice(0, 8)}</h1>
          <p className="page-subtitle">
            Placed {formatDate(booking.createdAt)}
            {eventDate ? ` · event ${formatDate(eventDate)}` : ''}
          </p>
        </div>
        <span
          className={`pill ${
            offTrack ? 'bg-critical-bg text-critical-fg' : 'bg-brand-soft text-brand-strong'
          }`}
        >
          {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Booked by">
          {client ? (
            <>
              {customerName && <Row label="Name">{customerName}</Row>}
              <Row label="Email">{client.email ?? 'Not given'}</Row>
              <Row label="Mobile">{client.phone ?? 'Not given'}</Row>
              <Row label="Account">{client.role ? roleLabel(client.role) : 'Not given'}</Row>
              <Link className="btn-outline btn-sm mt-2" to={`/admin/clients/${client.id}`}>
                Open client
              </Link>
            </>
          ) : (
            <p className="text-sm text-gray-400">Customer record missing.</p>
          )}
        </Section>

        <Section title="Booked with">
          <Row label="Name">{provider.name ?? provider.id.slice(0, 8)}</Row>
          <Row label="Category">{humanize(provider.category ?? provider.type, 'Not given')}</Row>
          {provider.status && (
            <Row label="Status">{labelFrom(BUSINESS_STATUS_LABEL, provider.status)}</Row>
          )}
          {providerRoute && (
            <Link className="btn-outline btn-sm mt-2" to={providerRoute}>
              Open provider
            </Link>
          )}
        </Section>

        <Section title="Service & money">
          <Row label="Service">
            {serviceName ?? (booking.providerType === 'planner' ? 'Wedding planning' : 'No service chosen')}
          </Row>
          {booking.quantity != null && <Row label="Quantity">{String(booking.quantity)}</Row>}
          {/* The agreed total, else the latest offer, else honestly unpriced. */}
          <Row label="Amount">
            {Number(booking.amount) > 0
              ? formatMoney(booking.amount, booking.currency)
              : data.quotation && Number(data.quotation.amount) > 0
                ? `Quoted ${formatMoney(data.quotation.amount, data.quotation.currency ?? booking.currency)}`
                : 'Not yet priced'}
          </Row>
          <Row label="Event">{event?.name ?? 'Not linked to an event'}</Row>
          {eventDate && <Row label="Date">{formatDate(eventDate)}</Row>}
          {(event?.venue || event?.city) && (
            <Row label="Venue">{[event?.venue, event?.city].filter(Boolean).join(', ')}</Row>
          )}
          {agent && (
            <>
              <Row label="Via agency">{agent.email ?? '—'}</Row>
              <Link className="btn-outline btn-sm mt-2" to={`/admin/agents/${agent.id}`}>
                Open agency
              </Link>
            </>
          )}
        </Section>
      </div>

      {booking.requirements && (
        <Section title="What the buyer asked for">
          <p className="whitespace-pre-wrap text-sm text-gray-700">{booking.requirements}</p>
        </Section>
      )}

      <Section title="Timeline">
        {offTrack ? (
          <p className="alert-critical">
            This booking is {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {LIFECYCLE.map((stage, i) => {
              const done = currentIndex >= 0 && i < currentIndex;
              const here = i === currentIndex;
              return (
                <li
                  key={stage}
                  className={`rounded-sm px-3 py-1 text-xs ${
                    here
                      ? 'bg-brand text-brand-fg'
                      : done
                        ? 'bg-positive-bg text-positive-fg'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {BOOKING_STATUS_LABEL[stage] ?? stage}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section title="Payments">
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Instalment</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3 text-right">Payout</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 text-gray-600">{formatDate(p.createdAt)}</td>
                    <td className="py-2 pr-3">{milestoneLabel(p.milestone)}</td>
                    <td className="py-2 pr-3 text-right">{money(p.amount, p.currency)}</td>
                    <td className="py-2 pr-3 text-right text-gray-600">
                      {money(p.payoutAmount, p.currency)}
                    </td>
                    <td className="py-2">
                      <span className="pill bg-gray-100 text-gray-600">
                        {paymentStatusLabel(p.status, 'admin')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {disputes.length > 0 && (
        <Section title="Disputes & cases">
          <div className="divide-y">
            {disputes.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-gray-800">{d.title}</span>
                <span className="pill bg-critical-bg text-critical-fg">
                  {labelFrom(CASE_STATUS_LABEL, d.status)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );

  function BackLink() {
    return (
      <button
        onClick={() => navigate('/admin/bookings')}
        className="btn-ghost btn-sm -ml-2 text-gray-500"
      >
        <CaretLeft size={15} aria-hidden /> Back to bookings
      </button>
    );
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="section-title mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}
