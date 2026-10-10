import { describe, expect, it } from 'vitest';
import {
  chatOpenFor,
  completionBlocker,
  customerAsk,
  deliveryDecision,
  isRequoteRequested,
  negotiationActor,
  paymentBucket,
  pricingModelLabel,
  releaseCondition,
  sellerActions,
} from './booking-rules';

const keys = (list: { key: string }[]) => list.map((a) => a.key);

describe('sellerActions (row 17)', () => {
  it('offers only Requote or Cancel once the customer rejected the quotation', () => {
    const b = {
      status: 'requested',
      estimatedAmount: '25000',
      expectedBudget: '20000',
      quotation: { stage: 'declined' },
      requoteRequested: true,
    };
    const actions = sellerActions(b, { canQuote: true });
    expect(keys(actions)).toEqual(['requote', 'cancel']);
    expect(actions[0].label).toBe('Quotation rejected - Requote');
    expect(actions.some((a) => a.key === 'accept_request')).toBe(false);
  });

  it("accepts a fresh request at the customer's budget, never the listed price", () => {
    const actions = sellerActions(
      { status: 'requested', estimatedAmount: '25000', expectedBudget: '20000' },
      { canQuote: true },
    );
    expect(keys(actions)).toEqual(['accept_request', 'send_quote', 'decline']);
    expect(actions[0]).toMatchObject({ amount: 20000, path: 'accept' });
    expect(actions[0].label).toContain('20,000');
  });

  it('withholds Accept once any quotation exists', () => {
    expect(customerAsk({ status: 'requested', expectedBudget: '20000', quotation: { stage: 'withdrawn' } })).toBeNull();
  });

  it('falls back to the server-less stage when the flag is absent', () => {
    expect(isRequoteRequested({ status: 'requested', quotation: { stage: 'declined' } })).toBe(true);
    expect(isRequoteRequested({ status: 'quotation_sent', quotation: { stage: 'declined' } })).toBe(false);
  });
});

describe('delivered booking awaiting acceptance (row 20)', () => {
  const delivered = {
    status: 'completed_pending_final_payment',
    collectedMilestones: ['advance', 'second', 'final'],
    deliveredAt: '2026-10-01T10:00:00Z',
    deliveryAcceptedAt: null,
  };

  it('shows Mark as completed disabled with the reason, beside Raise an issue', () => {
    const actions = sellerActions(delivered, { canQuote: true });
    expect(keys(actions)).toEqual(['complete', 'raise_issue']);
    expect(actions[0].disabledReason).toMatch(/not accepted the delivery/);
  });

  it('enables Mark as completed once the delivery is accepted', () => {
    expect(completionBlocker({ ...delivered, deliveryAcceptedAt: '2026-10-02T10:00:00Z' })).toBeNull();
  });

  it('says the balance is missing before it is paid', () => {
    expect(completionBlocker({ ...delivered, collectedMilestones: ['advance', 'second'] })).toMatch(/final balance/);
  });
});

describe('deliveryDecision (row 21)', () => {
  const awaiting = {
    status: 'completed_pending_final_payment',
    deliveredAt: '2026-10-01T10:00:00Z',
    deliveryAcceptedAt: null,
  };

  it('disables Accept delivery while the customer is raising an issue', () => {
    const d = deliveryDecision(awaiting, { canRaise: true, disputing: true });
    expect(d.showAccept).toBe(true);
    expect(d.acceptDisabledReason).toMatch(/raising an issue/);
  });

  it('disables Accept delivery while an issue is open', () => {
    expect(deliveryDecision({ ...awaiting, status: 'disputed' }, { canRaise: true }).acceptDisabledReason).toMatch(
      /issue is open/,
    );
  });

  it('disables Raise an issue while accepting, and after acceptance', () => {
    expect(deliveryDecision(awaiting, { canRaise: true, accepting: true }).raiseDisabledReason).toMatch(/accepting/);
    const accepted = deliveryDecision(
      { ...awaiting, status: 'completed', deliveryAcceptedAt: '2026-10-02T10:00:00Z' },
      { canRaise: true },
    );
    expect(accepted.showAccept).toBe(false);
    expect(accepted.raiseDisabledReason).toMatch(/accepted the delivery/);
  });
});

describe('labels and buckets', () => {
  it('names the pricing model beside a service', () => {
    expect(pricingModelLabel('fixed')).toBe('Fixed price');
    expect(pricingModelLabel('fixed,per_hour')).toBe('Fixed price / Per hour');
    expect(pricingModelLabel(null)).toBeNull();
  });

  it('opens chat for both sides after the advance and closes it on completion (rows 18/19)', () => {
    expect(chatOpenFor({ status: 'confirmed', collectedMilestones: ['advance'] })).toBe(true);
    expect(chatOpenFor({ status: 'payment_pending', collectedMilestones: [] })).toBe(false);
    expect(chatOpenFor({ status: 'completed', collectedMilestones: ['advance', 'second', 'final'] })).toBe(false);
  });

  it('sorts payment rows into the Payments page tabs', () => {
    expect(paymentBucket('held_in_escrow')).toBe('escrow');
    expect(paymentBucket('disputed')).toBe('escrow');
    expect(paymentBucket('pending_payout')).toBe('available');
    expect(paymentBucket('released')).toBe('paid');
    expect(paymentBucket('refunded')).toBe('refunded');
    expect(releaseCondition({ milestone: 'advance', status: 'held_in_escrow' })).toMatch(/start the work/);
    expect(releaseCondition({ milestone: 'final', status: 'disputed' })).toMatch(/Frozen/);
  });

  it('says who moved on each negotiation step for the reader', () => {
    expect(negotiationActor('customer', 'provider')).toBe('Customer');
    expect(negotiationActor('provider', 'provider')).toBe('You');
    expect(negotiationActor('provider', 'customer')).toBe('Vendor');
  });
});
