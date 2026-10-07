import { describe, expect, it } from 'vitest';
import { formatPlace } from './locations';

/** The place of birth printed "[object Object]" on a viewed profile (QA test 20). */
describe('formatPlace', () => {
  it('reads a stored location object as city and state', () => {
    expect(formatPlace({ country: 'India', state: 'Telangana', city: 'Hanumakonda' })).toBe(
      'Hanumakonda, Telangana',
    );
  });

  it('names a country other than India', () => {
    expect(formatPlace({ country: 'Australia', state: 'Victoria', city: 'Melbourne' })).toBe(
      'Melbourne, Victoria, Australia',
    );
  });

  it('falls back to the village, mandal or district when no city was chosen', () => {
    expect(formatPlace({ state: 'Andhra Pradesh', district: 'Guntur', village: 'Tenali' })).toBe(
      'Tenali, Andhra Pradesh',
    );
    expect(formatPlace({ state: 'Andhra Pradesh', district: 'Guntur' })).toBe('Guntur, Andhra Pradesh');
  });

  it('keeps an older plain-text place as it was written', () => {
    expect(formatPlace('  Hyderabad, Telangana ')).toBe('Hyderabad, Telangana');
  });

  it('returns nothing for an empty or unusable value', () => {
    expect(formatPlace(null)).toBe('');
    expect(formatPlace(undefined)).toBe('');
    expect(formatPlace({})).toBe('');
    expect(formatPlace({ country: 'India' })).toBe('');
    expect(formatPlace(42)).toBe('');
    expect(formatPlace(['Hyderabad'])).toBe('');
  });

  it('does not repeat a place named twice', () => {
    expect(formatPlace({ city: 'Delhi', state: 'Delhi' })).toBe('Delhi');
  });
});
