import { describe, expect, it } from 'vitest';
import {
  MAX_SLOT_CAPACITY,
  PRICING_DESCRIPTION_MAX,
  PRICING_DESCRIPTION_MIN,
  catalogStep,
  catalogSummary,
  offeringErrors,
  offeringPriceDetails,
  slotCapacityError,
  slotServiceLabel,
  titleCaseWords,
  uniquePortfolio,
  uniqueSocialLinks,
} from './catalog-rules';

const fifty = 'A full day of candid coverage with two photographers.';

describe('titleCaseWords', () => {
  it.each([
    ['pre-wedding-shoot', 'Pre-wedding-shoot'],
    ['full day shoot', 'Full Day Shoot'],
    ['  full   day\tshoot  ', 'Full Day Shoot'],
    ['DJ night', 'DJ Night'],
    ['mehendi - bride only', 'Mehendi - Bride Only'],
    ['2 day package', '2 Day Package'],
    ['', ''],
    ['   ', ''],
  ])('%j becomes %j (same rule as the server)', (input, expected) => {
    expect(titleCaseWords(input)).toBe(expected);
  });
});

describe('offeringErrors', () => {
  const ok = { name: 'Full day', description: fifty, pricingModel: 'fixed', price: '85000' };

  it('accepts a complete price', () => {
    expect(offeringErrors(ok)).toEqual({});
  });

  it('refuses a blank or space-only name', () => {
    expect(offeringErrors({ ...ok, name: '   ' }).name).toBe('Pricing name is required');
  });

  it('requires an amount above zero unless the model is quote-only', () => {
    expect(offeringErrors({ ...ok, price: '0' }).price).toBe(
      'Pricing amount must be greater than 0',
    );
    expect(offeringErrors({ ...ok, price: '' }).price).toBe(
      'Pricing amount must be greater than 0',
    );
    expect(offeringErrors({ ...ok, pricingModel: 'custom_quote', price: '' }).price).toBeUndefined();
  });

  it('requires a 50 to 500 character description, trimmed', () => {
    expect(offeringErrors({ ...ok, description: '  ' }).description).toBe(
      'Description is required',
    );
    expect(offeringErrors({ ...ok, description: 'x'.repeat(PRICING_DESCRIPTION_MIN - 1) }).description).toBe(
      `Description must be at least ${PRICING_DESCRIPTION_MIN} characters (49 now)`,
    );
    expect(offeringErrors({ ...ok, description: 'x'.repeat(PRICING_DESCRIPTION_MAX + 1) }).description).toBe(
      `Description must be at most ${PRICING_DESCRIPTION_MAX} characters`,
    );
  });
});

describe('slotCapacityError', () => {
  it('accepts 1 to 20 and nothing else', () => {
    expect(MAX_SLOT_CAPACITY).toBe(20);
    expect(slotCapacityError('1')).toBeNull();
    expect(slotCapacityError('20')).toBeNull();
    expect(slotCapacityError('21')).toBe('A window can take at most 20 bookings');
    expect(slotCapacityError('0')).toBe('A window must take at least 1 booking');
    expect(slotCapacityError('2.5')).toBe('Capacity must be a whole number of bookings');
    expect(slotCapacityError('')).toBe('Capacity must be a whole number of bookings');
  });
});

describe('slotServiceLabel', () => {
  const services = [
    { id: 's1', displayName: null, definition: { name: 'Candid photography' } },
    { id: 's2', displayName: 'Drone coverage', definition: { name: 'Aerial photography' } },
  ];
  it('names the service a window was published for', () => {
    expect(slotServiceLabel('s1', services)).toBe('Candid photography');
    expect(slotServiceLabel('s2', services)).toBe('Drone coverage');
  });
  it('says so when a window is for every service, or the service is gone', () => {
    expect(slotServiceLabel(null, services)).toBe('All services');
    expect(slotServiceLabel('gone', services)).toBe('A removed service');
  });
});

describe('offeringPriceDetails', () => {
  it('reads the model, amount, unit, quantities and package contents', () => {
    expect(
      offeringPriceDetails({
        pricingModel: 'per_person',
        price: '450',
        currency: 'INR',
        unitLabel: 'per plate',
        minQuantity: 100,
        maxQuantity: 500,
        isPackage: true,
        inclusions: ['Starters', 'Dessert'],
      }),
    ).toBe('Per person · INR 450 per plate · 100 to 500 · Package: Starters, Dessert');
    expect(offeringPriceDetails({ pricingModel: 'custom_quote', price: null, currency: 'INR' })).toBe(
      'Custom quote',
    );
    expect(offeringPriceDetails({ pricingModel: 'starting_from', price: '9000', currency: 'INR' })).toBe(
      'Starting from · From INR 9,000',
    );
  });
});

describe('catalogSummary', () => {
  it('lists category, service, pricing name, details and description for every price', () => {
    const rows = catalogSummary([
      {
        id: 's1',
        displayName: null,
        description: 'Service words',
        active: true,
        definition: { name: 'Lehenga' },
        category: { name: 'Bridal Wear' },
        offerings: [
          {
            id: 'o1',
            name: 'Pre-wedding-shoot',
            description: fifty,
            pricingModel: 'fixed',
            price: '15000',
            currency: 'INR',
            unitLabel: null,
            active: true,
          },
          {
            id: 'o2',
            name: 'Retired',
            description: null,
            pricingModel: 'fixed',
            price: '1',
            currency: 'INR',
            unitLabel: null,
            active: false,
          },
        ],
      },
      {
        id: 's2',
        displayName: 'My sherwani',
        description: null,
        active: true,
        definition: { name: 'Sherwani' },
        category: null,
        offerings: [],
      },
    ]);
    expect(rows).toEqual([
      {
        serviceId: 's1',
        categoryName: 'Bridal Wear',
        serviceName: 'Lehenga',
        serviceDescription: 'Service words',
        active: true,
        prices: [
          {
            id: 'o1',
            name: 'Pre-wedding-shoot',
            details: 'Fixed price · INR 15,000',
            description: fifty,
            active: true,
          },
          {
            id: 'o2',
            name: 'Retired',
            details: 'Fixed price · INR 1',
            description: null,
            active: false,
          },
        ],
      },
      {
        serviceId: 's2',
        categoryName: 'Uncategorised',
        serviceName: 'My sherwani',
        serviceDescription: null,
        active: true,
        prices: [],
      },
    ]);
  });
});

describe('uniqueSocialLinks', () => {
  it('shows one link per platform and address, however it was written', () => {
    const links = uniqueSocialLinks([
      { platform: 'instagram', url: 'https://www.instagram.com/everafter/' },
      { platform: 'instagram', url: 'https://instagram.com/everafter' },
      { platform: 'instagram', url: 'https://www.instagram.com/everafter?igsh=abc' },
      { platform: 'facebook', url: 'https://www.facebook.com/everafter' },
      { platform: 'facebook', url: 'https://www.facebook.com/everafter/' },
      { platform: 'website', url: 'https://Everafter.in' },
      { platform: 'website', url: 'https://everafter.in/' },
      { platform: 'instagram', url: 'https://www.instagram.com/second/' },
    ]);
    expect(links.map((l) => `${l.platform} ${l.url}`)).toEqual([
      'instagram https://www.instagram.com/everafter/',
      'facebook https://www.facebook.com/everafter',
      'website https://Everafter.in',
      'instagram https://www.instagram.com/second/',
    ]);
  });

  it('keeps the same address under two different platforms', () => {
    expect(
      uniqueSocialLinks([
        { platform: 'website', url: 'https://everafter.in' },
        { platform: 'other', url: 'https://everafter.in', label: 'Shop' },
      ]),
    ).toHaveLength(2);
  });
});

describe('uniquePortfolio', () => {
  it('drops blanks and repeats, keeping order', () => {
    expect(uniquePortfolio(['a.jpg', '', 'b.jpg', 'a.jpg', null as unknown as string])).toEqual([
      'a.jpg',
      'b.jpg',
    ]);
    expect(uniquePortfolio(undefined)).toEqual([]);
  });
});

describe('catalogStep', () => {
  it('reads readiness and the precise reasons from the server checklist', () => {
    expect(
      catalogStep({
        items: [
          {
            key: 'catalog',
            complete: false,
            missing: 'Bridal Wear: pricing is missing for Lehenga; Groom Wear: add at least one service',
            issues: ['Bridal Wear: pricing is missing for Lehenga', 'Groom Wear: add at least one service'],
          },
        ],
      }),
    ).toEqual({
      ready: false,
      issues: ['Bridal Wear: pricing is missing for Lehenga', 'Groom Wear: add at least one service'],
    });
  });

  it('splits the joined message from a server without the issues list', () => {
    expect(
      catalogStep({ items: [{ key: 'catalog', complete: false, missing: 'A; B' }] }),
    ).toEqual({ ready: false, issues: ['A', 'B'] });
  });

  it('is ready when the item is complete, and not before the checklist has loaded', () => {
    expect(catalogStep({ items: [{ key: 'catalog', complete: true, missing: null }] })).toEqual({
      ready: true,
      issues: [],
    });
    expect(catalogStep(undefined)).toEqual({ ready: false, issues: [] });
  });
});
