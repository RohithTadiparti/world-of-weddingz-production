import { describe, expect, it } from 'vitest';
import {
  PAYMENT_STATUS_LABELS,
  SELLER_STATUS_LABEL,
  bookingAmountLabel,
  bookingStatusLabel,
  formatMoney,
  humanize,
  labelFrom,
  milestoneLabel,
  partialListNote,
  paymentStatusLabel,
  quotationStatusLabel,
  roleLabel,
  TASK_STATUS_LABEL,
} from './labels';

/**
 * The words pages print for stored values. These exist because a missing map
 * entry used to print the enum itself — "pending payout", "final", "₹0" for a
 * booking nobody had priced.
 */
describe('humanize', () => {
  it('sentence-cases an enum and drops the underscores', () => {
    expect(humanize('pending_payout')).toBe('Pending payout');
  });

  it.each([null, undefined, ''])('falls back for %j', (value) => {
    expect(humanize(value, 'Not given')).toBe('Not given');
  });
});

describe('paymentStatusLabel', () => {
  const statuses = [
    'initiated',
    'held_in_escrow',
    'disputed',
    'pending_payout',
    'released',
    'refunded',
    'partially_settled',
    'failed',
  ];

  it.each(['provider', 'buyer', 'admin'] as const)('has words for every state, for the %s', (audience) => {
    for (const status of statuses) {
      const label = PAYMENT_STATUS_LABELS[audience][status];
      expect(label).toBeTruthy();
      expect(label).not.toContain('_');
    }
  });

  it('tells each side of pending_payout its own sentence', () => {
    expect(paymentStatusLabel('pending_payout', 'provider')).toBe('Owed to you');
    expect(paymentStatusLabel('pending_payout', 'admin')).toBe('Awaiting payout');
    expect(paymentStatusLabel('pending_payout', 'buyer')).not.toBe(
      paymentStatusLabel('released', 'buyer'),
    );
  });

  it('never prints a raw enum for an unknown state', () => {
    expect(paymentStatusLabel('on_hold')).toBe('On hold');
  });
});

describe('milestoneLabel and bookingStatusLabel', () => {
  it('names the final instalment the balance', () => {
    expect(milestoneLabel('final')).toBe('Balance');
    expect(milestoneLabel('second')).toBe('Second instalment');
  });

  it('uses the shared booking wording', () => {
    expect(bookingStatusLabel('quotation_sent')).toBe('Quotation received');
    expect(SELLER_STATUS_LABEL.quotation_sent).toBe('Quotation sent');
    expect(SELLER_STATUS_LABEL.completed).toBe('Completed');
  });
});

describe('roleLabel and quotationStatusLabel', () => {
  it('reads a role as a persona', () => {
    expect(roleLabel('in_person')).toBe('Verification officer');
    expect(roleLabel('something_new')).toBe('Something new');
  });

  it('says a rejected quotation the way its declined stage does', () => {
    expect(quotationStatusLabel('rejected')).toBe(quotationStatusLabel('declined'));
    expect(quotationStatusLabel('superseded')).toBe('Replaced by a revised quotation');
  });
});

describe('labelFrom', () => {
  it('prefers the map and humanises anything else', () => {
    expect(labelFrom(TASK_STATUS_LABEL, 'pending')).toBe('To do');
    expect(labelFrom(TASK_STATUS_LABEL, 'on_hold')).toBe('On hold');
    expect(labelFrom(TASK_STATUS_LABEL, null, 'Unknown')).toBe('Unknown');
  });
});

describe('bookingAmountLabel', () => {
  it('shows the agreed amount', () => {
    expect(bookingAmountLabel({ amount: '120000', currency: 'INR' })).toBe(formatMoney(120000));
  });

  it('shows the latest quotation on an unpriced booking', () => {
    expect(
      bookingAmountLabel({
        amount: '0',
        currency: 'INR',
        quotation: { amount: '50000', currency: 'INR' },
      }),
    ).toBe(`Quoted ${formatMoney(50000)}`);
  });

  it.each([
    { amount: '0', currency: 'INR' },
    { amount: null, currency: 'INR', quotation: null },
    { amount: '0.00', currency: 'INR', quotation: { amount: '0' } },
  ])('never reads ₹0 for an unpriced booking (%j)', (booking) => {
    expect(bookingAmountLabel(booking)).toBe('Not yet priced');
  });
});

describe('partialListNote', () => {
  it('explains a count larger than the rows loaded', () => {
    expect(partialListNote(100, 240)).toBe('Showing the latest 100 of 240');
  });

  it.each([
    [40, 40],
    [40, 12],
    [40, undefined],
    [40, null],
  ])('says nothing when %i rows cover %j', (loaded, total) => {
    expect(partialListNote(loaded, total)).toBeNull();
  });
});
