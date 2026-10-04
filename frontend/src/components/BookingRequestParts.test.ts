import { describe, expect, it } from 'vitest';
import { nextOfferingId } from './BookingRequestParts';

describe('price selection', () => {
  it('clears the selected price when the same card is selected again', () => {
    expect(nextOfferingId('price-1', 'price-1')).toBe('');
  });

  it('switches cleanly to a different listed price', () => {
    expect(nextOfferingId('price-1', 'price-2')).toBe('price-2');
  });
});
