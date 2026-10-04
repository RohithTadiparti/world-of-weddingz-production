import { MatchView, inView, viewCounts } from './suggestion-views';

/**
 * The tiles at the top of Matches: each figure has to be the number of rows the
 * tile shows once pressed, or the tile is a figure nobody can open.
 */
describe('suggestion views', () => {
  const now = new Date('2026-09-19T12:00:00Z').getTime();
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
  const rows = [
    { profile: { id: 'a', lastActiveAt: hoursAgo(2) }, score: 72 },
    { profile: { id: 'b', lastActiveAt: hoursAgo(30) }, score: 50 },
    { profile: { id: 'c', lastActiveAt: null }, score: 49 },
    { profile: { id: 'd', lastActiveAt: hoursAgo(23) }, score: 12 },
  ];
  const shortlisted = new Set(['c', 'd', 'not-in-the-list']);

  it('counts each view over the same list', () => {
    expect(viewCounts(rows, shortlisted, now)).toEqual({
      total: 4,
      activeToday: 2,
      highCompatibility: 2,
      shortlisted: 2,
    });
  });

  it('shows exactly as many rows as each tile says', () => {
    const counts = viewCounts(rows, shortlisted, now);
    const shown = (view: MatchView) =>
      rows.filter((r) => inView(view, r, shortlisted, now)).map((r) => r.profile.id);

    expect(shown('all')).toHaveLength(counts.total);
    expect(shown('active')).toEqual(['a', 'd']);
    expect(shown('high')).toEqual(['a', 'b']);
    expect(shown('shortlisted')).toEqual(['c', 'd']);
    expect(rows.filter((r) => inView(undefined, r, shortlisted, now))).toHaveLength(4);
  });
});
