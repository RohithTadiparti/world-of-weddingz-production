import { describe, expect, it } from 'vitest';
import { canAcceptCustomerRequest } from './booking-progress';
import { agreedWithoutQuotation } from '../components/BookingSummary';

describe('canAcceptCustomerRequest', () => {
  it('offers Accept when the customer chose a package total or gave a budget', () => {
    expect(canAcceptCustomerRequest({ status: 'requested', estimatedAmount: '1000.00' })).toBe(true);
    expect(canAcceptCustomerRequest({ status: 'requested', expectedBudget: '50000' })).toBe(true);
  });

  it('withholds Accept from an amount-only request, which must be quoted instead', () => {
    expect(
      canAcceptCustomerRequest({ status: 'requested', estimatedAmount: null, expectedBudget: null }),
    ).toBe(false);
  });

  it('withholds Accept once the request has moved on', () => {
    expect(canAcceptCustomerRequest({ status: 'quotation_sent', estimatedAmount: '1000' })).toBe(false);
  });
});

describe('agreedWithoutQuotation', () => {
  it('names where a price agreed without a quotation came from', () => {
    expect(agreedWithoutQuotation({ quoted: null, priceSource: 'listed' })).toBe('listed price, no quotation');
    expect(agreedWithoutQuotation({ quoted: null, priceSource: 'direct', listedPrice: false })).toBe(
      'amount set on the request, no quotation',
    );
    expect(agreedWithoutQuotation({ quoted: null, priceSource: 'budget' })).toContain('budget');
  });

  it('is null for a quoted or unpriced booking', () => {
    expect(agreedWithoutQuotation({ quoted: '900', priceSource: 'quotation' })).toBeNull();
    expect(agreedWithoutQuotation({ quoted: null, priceSource: null })).toBeNull();
  });

  it('falls back to listedPrice for an older server', () => {
    expect(agreedWithoutQuotation({ quoted: null, listedPrice: true })).toBe('listed price, no quotation');
    expect(agreedWithoutQuotation({ quoted: null, listedPrice: false })).toBeNull();
  });
});
