import { describe, expect, it } from 'vitest';
import { tabCount } from './interest-tabs';

describe('tabCount', () => {
  it('prefers the server count', () => {
    expect(tabCount({ counts: { received: 3 }, received: [] }, 'received')).toBe(3);
  });

  it('falls back to the rows for a list the server does not count', () => {
    expect(tabCount({ counts: { received: 0 }, blocked: [{}, {}] }, 'blocked')).toBe(2);
  });

  it('is zero for a list that is absent', () => {
    expect(tabCount({ counts: {} }, 'blocked')).toBe(0);
  });
});
