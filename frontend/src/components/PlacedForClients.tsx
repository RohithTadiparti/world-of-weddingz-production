import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { bookingStatusLabel, formatMoney, humanize, paymentStatusLabel } from '../lib/labels';

export interface PlacedBooking {
  bookingId: string;
  clientUserId: string;
  clientName: string;
  name: string;
  category: string;
  service: string | null;
  package: string | null;
  status: string;
  paymentStatus: string | null;
  amount: string;
  currency: string;
  /** The newest offer, while the vendor's price is not yet agreed. */
  quotation?: { amount: string; currency?: string; stage?: string } | null;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  guests: number | null;
  expectedBudget: string | null;
  requirements: string | null;
  createdAt: string;
}

export function usePlacedForClients(enabled = true) {
  return useQuery({
    queryKey: ['planner-bookings-placed'],
    queryFn: async () => (await api.get('/planner/bookings-placed')).data as PlacedBooking[],
    enabled,
    retry: false,
    refetchInterval: 30_000,
  });
}

const money = (value: string | number, currency: string) =>
  `${currency} ${Number(value || 0).toLocaleString('en-IN')}`;

/**
 * One vendor booking a planner placed for a client, with everything it was
 * placed with: the day, the place, the head count, the budget and the brief.
 *
 * Shared by the list below and the Booking section of the couple's booking with
 * the planner, so the two never describe the same request differently.
 */
export function PlacedBookingFacts({ booking: b }: { booking: PlacedBooking }) {
  const place = [b.venue, b.city].filter(Boolean).join(', ');
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-sm font-medium text-gray-900">
        {b.name}
        <span className="font-normal text-gray-500"> · for {b.clientName}</span>
      </p>
      <p className="text-xs text-gray-600">
        <span>{humanize(b.category)}</span>
        {[b.service, b.package].filter(Boolean).map((part) => ` · ${part}`).join('')}
      </p>
      <p className="text-xs text-gray-600">
        {[
          b.eventDate ? formatDate(b.eventDate) : 'Date not set',
          place || 'Venue not given',
          b.guests ? `${b.guests} guests` : null,
          b.expectedBudget && Number(b.expectedBudget) > 0
            ? `budget ${money(b.expectedBudget, b.currency)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {b.requirements && <p className="text-xs text-gray-500">“{b.requirements}”</p>}
      <p className="text-xs text-gray-500">
        {Number(b.amount) > 0
          ? money(b.amount, b.currency)
          : b.quotation && Number(b.quotation.amount) > 0
            ? `Quoted ${formatMoney(b.quotation.amount, b.quotation.currency ?? b.currency)}`
            : b.status === 'quotation_sent'
              ? 'Quotation with the couple'
              : 'Awaiting a quotation'}
        {` · ${bookingStatusLabel(b.status)}`}
        {/* Where the couple's money is, in the same neutral words the
            administrator reads — the planner is watching, not paying. */}
        {b.paymentStatus ? ` · ${paymentStatusLabel(b.paymentStatus, 'admin')}` : ''}
        {` · asked ${formatDate(b.createdAt)}`}
      </p>
    </div>
  );
}

/**
 * The vendors a planner has asked on their clients' behalf (EZ1-I235).
 *
 * Those bookings belong to the couples, so the planner's own queue below — the
 * work coming in against their agency — never contained them, and a planner who
 * had just booked a vendor could not see which one. Each row opens the client,
 * where the booking is followed.
 */
export default function PlacedForClients() {
  const { data, isPending, isError } = usePlacedForClients();

  if (isPending) return null;

  return (
    <section className="card">
      <h2 className="section-title">Booked for your clients</h2>
      <p className="mt-0.5 text-sm text-gray-500">
        Vendors you asked on a couple’s behalf. The booking is theirs — open the client to follow
        it.
      </p>
      {isError ? (
        <p className="mt-2 text-sm text-gray-500">These bookings could not be loaded.</p>
      ) : !data || data.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          Nothing yet. Requests you place from the Vendors page for a client appear here.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {data.map((b) => (
            <li key={b.bookingId}>
              <Link
                to={`/my-clients/${b.clientUserId}#vendors`}
                className="block py-2 hover:bg-gray-50"
              >
                <PlacedBookingFacts booking={b} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
