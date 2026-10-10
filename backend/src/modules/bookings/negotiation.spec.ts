import { BookingStatus, QuotationStatus } from '../../common/enums';
import {
  NegotiationEventLike,
  awaitingRequote,
  customerAsk,
  deriveEvents,
  negotiationView,
  requestEvents,
} from './negotiation';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute));

const step = (over: Partial<NegotiationEventLike>): NegotiationEventLike => ({
  kind: 'quotation_sent',
  amount: null,
  currency: 'INR',
  actorRole: 'provider',
  quotationId: null,
  note: null,
  occurredAt: at(0),
  ...over,
});

/**
 * Row 16: the vendor's listed 25,000, the customer's 20,000 budget, the
 * vendor's 22,000 counter and the price finally accepted, each with a status
 * and a time.
 */
describe('negotiationView', () => {
  const opening = [
    step({ kind: 'listed_price', amount: '25000.00', occurredAt: at(0) }),
    step({ kind: 'budget', amount: '20000.00', actorRole: 'customer', occurredAt: at(0) }),
  ];

  it('reads listed price, budget, counteroffer and final accepted price in order', () => {
    const events = [
      ...opening,
      step({ kind: 'quotation_sent', amount: '22000.00', quotationId: 'q1', occurredAt: at(5) }),
      step({ kind: 'quotation_accepted', amount: '22000.00', actorRole: 'customer', quotationId: 'q1', occurredAt: at(9) }),
    ];
    const view = negotiationView(events);
    expect(view.entries.map((e) => [e.label, e.amount, e.status])).toEqual([
      ["Vendor's listed price", '25000.00', 'listed'],
      ["Customer's requested budget", '20000.00', 'requested'],
      ['Vendor quotation', '22000.00', 'accepted'],
      ['Final accepted price', '22000.00', 'accepted'],
    ]);
    expect(view.entries.every((e) => e.at instanceof Date)).toBe(true);
    expect(view.finalPrice).toEqual({
      amount: '22000.00',
      currency: 'INR',
      at: at(9),
      source: 'quotation',
    });
    expect(view.requoteRequested).toBe(false);
  });

  it('marks a rejected counter as waiting on a requote, then a revised one as a counteroffer', () => {
    const rejected = [
      ...opening,
      step({ kind: 'quotation_sent', amount: '22000.00', quotationId: 'q1', occurredAt: at(5) }),
      step({ kind: 'quotation_rejected', amount: '22000.00', actorRole: 'customer', quotationId: 'q1', occurredAt: at(7) }),
    ];
    const view = negotiationView(rejected);
    expect(view.requoteRequested).toBe(true);
    expect(view.finalPrice).toBeNull();
    expect(view.entries[2].statusLabel).toBe('Rejected - requote requested');

    const revised = negotiationView([
      ...rejected,
      step({ kind: 'quotation_sent', amount: '21000.00', quotationId: 'q2', occurredAt: at(8) }),
    ]);
    expect(revised.requoteRequested).toBe(false);
    expect(revised.entries[4]).toMatchObject({
      label: 'Vendor counteroffer (revised quotation)',
      status: 'awaiting_customer',
    });
  });

  it('calls a superseded or lapsed quotation what it is', () => {
    const view = negotiationView(
      [
        step({ kind: 'quotation_sent', amount: '30000.00', quotationId: 'q1', occurredAt: at(1) }),
        step({ kind: 'quotation_sent', amount: '28000.00', quotationId: 'q2', occurredAt: at(2) }),
      ],
      [
        { id: 'q1', amount: '30000.00', currency: 'INR', status: QuotationStatus.SUPERSEDED, responseNote: null, respondedAt: null, createdAt: at(1) },
        { id: 'q2', amount: '28000.00', currency: 'INR', status: QuotationStatus.EXPIRED, responseNote: null, respondedAt: null, createdAt: at(2) },
      ],
    );
    expect(view.entries.map((e) => e.status)).toEqual(['superseded', 'expired']);
  });

  it('records a price the vendor accepted without a quotation as the final price', () => {
    const view = negotiationView([
      ...opening,
      step({ kind: 'request_accepted', amount: '20000.00', occurredAt: at(3) }),
    ]);
    expect(view.finalPrice).toMatchObject({ amount: '20000.00', source: 'request' });
  });
});

describe('requestEvents / deriveEvents', () => {
  const booking = {
    id: 'b1',
    status: BookingStatus.PAYMENT_PENDING,
    amount: '22000.00',
    currency: 'INR',
    estimatedAmount: '25000.00',
    expectedBudget: '20000.00',
    createdAt: at(0),
    updatedAt: at(9),
  };

  it('writes the listed price and the budget a request starts from', () => {
    expect(requestEvents(booking).map((e) => [e.kind, e.amount])).toEqual([
      ['listed_price', '25000.00'],
      ['budget', '20000.00'],
    ]);
    expect(requestEvents({ ...booking, estimatedAmount: null, expectedBudget: '0' })).toEqual([]);
  });

  it('rebuilds the history from the booking and its quotations', () => {
    const events = deriveEvents(booking, [
      { id: 'q1', amount: '22000.00', currency: 'INR', status: QuotationStatus.ACCEPTED, responseNote: null, respondedAt: at(9), createdAt: at(5) },
    ]);
    expect(events.map((e) => e.kind)).toEqual([
      'listed_price',
      'budget',
      'quotation_sent',
      'quotation_accepted',
    ]);
  });

  it('derives an agreed price with no accepted quotation as accepted at the request', () => {
    const events = deriveEvents({ ...booking, amount: '20000.00' }, []);
    expect(events[events.length - 1]).toMatchObject({ kind: 'request_accepted', amount: '20000.00' });
  });
});

describe('awaitingRequote', () => {
  it('is true only for a requested booking whose newest quotation was rejected', () => {
    const rows = [
      { status: QuotationStatus.SUPERSEDED, createdAt: at(1) },
      { status: QuotationStatus.REJECTED, createdAt: at(2) },
    ];
    expect(awaitingRequote(BookingStatus.REQUESTED, rows)).toBe(true);
    expect(awaitingRequote(BookingStatus.QUOTATION_SENT, rows)).toBe(false);
    expect(awaitingRequote(BookingStatus.REQUESTED, [])).toBe(false);
    expect(
      awaitingRequote(BookingStatus.REQUESTED, [...rows, { status: QuotationStatus.WITHDRAWN, createdAt: at(3) }]),
    ).toBe(false);
  });
});

describe('customerAsk', () => {
  it('prefers the budget the customer named over the listed price', () => {
    expect(customerAsk({ estimatedAmount: '25000', expectedBudget: '20000' })).toEqual({
      amount: '20000.00',
      basis: 'budget',
    });
    expect(customerAsk({ estimatedAmount: '25000', expectedBudget: null })).toEqual({
      amount: '25000.00',
      basis: 'listed',
    });
    expect(customerAsk({})).toBeNull();
  });
});
