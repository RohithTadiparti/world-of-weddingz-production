import { MAX_CATEGORIES, categoryCountProblem, requestedCategories } from './vendor-categories';

describe('requestedCategories', () => {
  it('reads the list trimmed, lower-cased and without repeats, keeping the order', () => {
    expect(requestedCategories({ categories: [' Venue', 'catering', 'venue', ''] })).toEqual([
      'venue',
      'catering',
    ]);
  });

  // App builds from before EZ1-I263 send one category; they must keep saving.
  it('reads the single category older app builds send as a list of one', () => {
    expect(requestedCategories({ category: 'decor' })).toEqual(['decor']);
  });

  it('prefers the list when both arrive', () => {
    expect(requestedCategories({ categories: ['venue'], category: 'decor' })).toEqual(['venue']);
  });

  it('says nothing when the request does not mention categories', () => {
    expect(requestedCategories({})).toBeUndefined();
  });

  it('keeps an explicitly empty list, so it can be refused rather than ignored', () => {
    expect(requestedCategories({ categories: [] })).toEqual([]);
  });
});

describe('categoryCountProblem', () => {
  it('refuses a business with no category', () => {
    expect(categoryCountProblem([])).toMatch(/at least one/);
  });

  it('accepts one to five', () => {
    for (let n = 1; n <= MAX_CATEGORIES; n += 1) {
      expect(categoryCountProblem(Array.from({ length: n }, (_, i) => `c${i}`))).toBeNull();
    }
  });

  it('refuses a sixth', () => {
    expect(categoryCountProblem(['a', 'b', 'c', 'd', 'e', 'f'])).toMatch(/at most 5/);
  });
});
