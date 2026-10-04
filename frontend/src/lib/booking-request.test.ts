import { describe, expect, it } from 'vitest';
import {
  estimateSummary,
  estimateTotal,
  offeringPrice,
  requestFormFields,
  requirementsRequired,
} from './booking-request';
import type { FieldSpec } from './dynamic-form';

describe('estimateTotal', () => {
  it('multiplies a per-day price by the number of days', () => {
    // The reported case: guest mehendi at 12,000 a day, ten days.
    expect(estimateTotal({ pricingModel: 'per_day', price: '12000.00' }, 10)).toBe(120000);
  });

  it.each(['per_person', 'per_item', 'per_hour', 'per_session'])('multiplies %s', (model) => {
    expect(estimateTotal({ pricingModel: model, price: '250.50' }, 4)).toBe(1002);
  });

  it('has no total until a per-unit quantity is given', () => {
    expect(estimateTotal({ pricingModel: 'per_day', price: '12000' }, null)).toBeNull();
    expect(estimateTotal({ pricingModel: 'per_day', price: '12000' }, 0)).toBeNull();
  });

  it('ignores the quantity on a fixed or starting-from price', () => {
    expect(estimateTotal({ pricingModel: 'fixed', price: '18000' }, 10)).toBe(18000);
    expect(estimateTotal({ pricingModel: 'starting_from', price: '5000' }, 3)).toBe(5000);
  });

  it('has no total for a quote-only price', () => {
    expect(estimateTotal({ pricingModel: 'custom_quote', price: null }, 2)).toBeNull();
    expect(estimateTotal({ pricingModel: 'no_public_price', price: '100' }, 2)).toBeNull();
  });
});

describe('offeringPrice', () => {
  it('reads the unit price, not a total', () => {
    expect(
      offeringPrice({ pricingModel: 'per_day', price: '12000', currency: 'INR', unitLabel: 'per day' }),
    ).toBe(`INR ${(12000).toLocaleString()} per day`);
  });
});

describe('requirementsRequired', () => {
  it.each(['venue', 'catering', 'flower-decors', 'florist'])('is required for %s', (slug) => {
    expect(requirementsRequired([slug], false)).toBe(true);
  });

  it('is optional for a mehendi artist', () => {
    expect(requirementsRequired(['mehendi-artist'], false)).toBe(false);
    expect(requirementsRequired([null, undefined], false)).toBe(false);
  });

  it('is optional where the service asks its own questions', () => {
    expect(requirementsRequired(['catering'], true)).toBe(false);
  });
});

describe('requestFormFields', () => {
  const field = (key: string): FieldSpec => ({
    key,
    label: key,
    helpText: null,
    type: 'text',
    required: true,
    constraints: {},
  });

  it('drops "Date of the function", which the chosen date answers', () => {
    const keys = requestFormFields([field('event_date'), field('guest_count')]).map((f) => f.key);
    expect(keys).toEqual(['guest_count']);
  });
});

describe('estimateSummary', () => {
  it('reads the total and the unit × quantity it came from', () => {
    expect(estimateSummary('120000.00', 10, 'INR')).toEqual({
      total: `INR ${(120000).toLocaleString('en-IN')}`,
      breakdown: `INR ${(12000).toLocaleString('en-IN')} × 10`,
    });
  });

  it('has no breakdown for a single unit or a fixed price', () => {
    expect(estimateSummary('18000.00', null)?.breakdown).toBeNull();
    expect(estimateSummary('18000.00', 1)?.breakdown).toBeNull();
  });

  it('is absent where nothing was estimated', () => {
    expect(estimateSummary(null, 3)).toBeNull();
    expect(estimateSummary('0.00', 3)).toBeNull();
  });
});
