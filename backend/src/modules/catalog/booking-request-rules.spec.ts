import { estimateAmount, requirementsRequired } from './booking-request-rules';

describe('estimateAmount', () => {
  it('multiplies a per-day price by the number of days', () => {
    // The reported case: guest mehendi at 12,000 a day, ten days.
    expect(estimateAmount({ pricingModel: 'per_day', price: '12000.00' }, 10)).toBe(120000);
  });

  it('multiplies every per-unit model', () => {
    for (const model of ['per_person', 'per_item', 'per_hour', 'per_session']) {
      expect(estimateAmount({ pricingModel: model, price: '250.50' }, 4)).toBe(1002);
    }
  });

  it('gives no total for a per-unit price without a quantity', () => {
    expect(estimateAmount({ pricingModel: 'per_day', price: '12000' }, null)).toBeNull();
    expect(estimateAmount({ pricingModel: 'per_day', price: '12000' }, 0)).toBeNull();
  });

  it('ignores the quantity on a fixed or starting-from price', () => {
    expect(estimateAmount({ pricingModel: 'fixed', price: '18000' }, 10)).toBe(18000);
    expect(estimateAmount({ pricingModel: 'starting_from', price: '5000' }, 3)).toBe(5000);
  });

  it('gives no total for a quote-only price', () => {
    expect(estimateAmount({ pricingModel: 'custom_quote', price: null }, 2)).toBeNull();
    expect(estimateAmount({ pricingModel: 'no_public_price', price: '100' }, 2)).toBeNull();
  });
});

describe('requirementsRequired', () => {
  it('asks venue, catering and florist for a brief', () => {
    expect(requirementsRequired(['venue'], false)).toBe(true);
    expect(requirementsRequired(['catering'], false)).toBe(true);
    expect(requirementsRequired(['flower-decors'], false)).toBe(true);
    expect(requirementsRequired(['florist'], false)).toBe(true);
  });

  it('leaves it optional for a mehendi artist and the rest', () => {
    expect(requirementsRequired(['mehendi-artist'], false)).toBe(false);
    expect(requirementsRequired(['photography', 'makeup'], false)).toBe(false);
    expect(requirementsRequired([null, undefined, ''], false)).toBe(false);
  });

  it('is required when any of a vendor’s categories needs it', () => {
    expect(requirementsRequired(['decor', 'catering'], false)).toBe(true);
  });

  it('leaves it optional where the service asks its own questions', () => {
    expect(requirementsRequired(['venue'], true)).toBe(false);
  });
});
