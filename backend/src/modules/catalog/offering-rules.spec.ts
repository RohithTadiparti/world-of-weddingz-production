import { PricingModel } from '../../common/enums';
import {
  PRICING_DESCRIPTION_MAX,
  PRICING_DESCRIPTION_MIN,
  normaliseOfferingText,
  offeringProblems,
  titleCaseWords,
} from './offering-rules';

const fifty = 'A full day of candid coverage with two photographers.'; // 52 characters

describe('titleCaseWords (pricing name)', () => {
  it.each([
    ['pre-wedding-shoot', 'Pre-wedding-shoot'],
    ['full day shoot', 'Full Day Shoot'],
    ['  full   day\tshoot  ', 'Full Day Shoot'],
    ['DJ night', 'DJ Night'],
    ['gold PACKAGE', 'Gold PACKAGE'],
    ['mehendi - bride only', 'Mehendi - Bride Only'],
    ['2 day package', '2 Day Package'],
    ['éclair counter', 'Éclair Counter'],
    ['Already Title', 'Already Title'],
  ])('%j becomes %j', (input, expected) => {
    expect(titleCaseWords(input)).toBe(expected);
  });

  it('returns an empty string for blank input', () => {
    expect(titleCaseWords('   ')).toBe('');
    expect(titleCaseWords('')).toBe('');
  });
});

describe('offeringProblems', () => {
  const base = {
    name: 'Full day',
    description: fifty,
    pricingModel: PricingModel.FIXED,
    price: '85000',
  };

  it('accepts a complete priced offering', () => {
    expect(offeringProblems(base)).toEqual({});
  });

  it('requires a pricing name and refuses one that is only spaces', () => {
    expect(offeringProblems({ ...base, name: '' }).name).toBe('Pricing name is required');
    expect(offeringProblems({ ...base, name: '    ' }).name).toBe('Pricing name is required');
    expect(offeringProblems({ ...base, name: undefined }).name).toBe('Pricing name is required');
  });

  it('requires an amount greater than zero on a priced model', () => {
    expect(offeringProblems({ ...base, price: '0' }).price).toBe(
      'Pricing amount must be greater than 0',
    );
    expect(offeringProblems({ ...base, price: '-5' }).price).toBe(
      'Pricing amount must be greater than 0',
    );
    expect(offeringProblems({ ...base, price: '' }).price).toBe(
      'Pricing amount must be greater than 0',
    );
    expect(offeringProblems({ ...base, price: 'abc' }).price).toBe(
      'Pricing amount must be greater than 0',
    );
    expect(offeringProblems({ ...base, price: '0.01' }).price).toBeUndefined();
  });

  it('does not ask for an amount on a quote-only model', () => {
    expect(
      offeringProblems({ ...base, pricingModel: PricingModel.CUSTOM_QUOTE, price: undefined }),
    ).toEqual({});
    expect(
      offeringProblems({ ...base, pricingModel: PricingModel.NO_PUBLIC_PRICE, price: null }),
    ).toEqual({});
  });

  it('requires a description of 50 to 500 characters, measured after trimming', () => {
    expect(offeringProblems({ ...base, description: '' }).description).toBe(
      'Description is required',
    );
    expect(offeringProblems({ ...base, description: '     ' }).description).toBe(
      'Description is required',
    );
    const short = 'x'.repeat(PRICING_DESCRIPTION_MIN - 1);
    expect(offeringProblems({ ...base, description: short }).description).toBe(
      `Description must be at least ${PRICING_DESCRIPTION_MIN} characters (${short.length} now)`,
    );
    // Padding does not count towards the minimum.
    expect(
      offeringProblems({ ...base, description: `   ${short}      ` }).description,
    ).toBeDefined();
    expect(
      offeringProblems({ ...base, description: 'x'.repeat(PRICING_DESCRIPTION_MIN) }).description,
    ).toBeUndefined();
    expect(
      offeringProblems({ ...base, description: 'x'.repeat(PRICING_DESCRIPTION_MAX) }).description,
    ).toBeUndefined();
    expect(
      offeringProblems({ ...base, description: 'x'.repeat(PRICING_DESCRIPTION_MAX + 1) })
        .description,
    ).toBe(`Description must be at most ${PRICING_DESCRIPTION_MAX} characters`);
  });
});

describe('normaliseOfferingText', () => {
  it('title-cases the name and trims the description', () => {
    expect(
      normaliseOfferingText({ name: '  pre-wedding-shoot ', description: `  ${fifty}  ` }),
    ).toEqual({ name: 'Pre-wedding-shoot', description: fifty });
  });
});
