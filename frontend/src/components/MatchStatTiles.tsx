/** Which tile is pressed. Mirrors the server's `view` on /matches/suggestions. */
export type MatchView = 'all' | 'active' | 'high' | 'shortlisted';

/** The figures behind the tiles, as the suggestions endpoint returns them. */
export interface MatchViewCounts {
  total: number;
  activeToday: number;
  highCompatibility: number;
  shortlisted: number;
}

export const VIEW_TILES: { view: MatchView; label: string; count: keyof MatchViewCounts }[] = [
  { view: 'all', label: 'Total matches', count: 'total' },
  { view: 'active', label: 'Active today', count: 'activeToday' },
  { view: 'high', label: 'High compatibility', count: 'highCompatibility' },
  { view: 'shortlisted', label: 'Shortlisted', count: 'shortlisted' },
];

/**
 * The four figures at the top of Matches, each of which opens what it counts.
 *
 * They were read-only numbers worked out from whatever was on the page, so
 * none of them was a count of anything the reader could then look at (and
 * "Active today" only ever counted the dozen cards loaded). Now the server
 * counts them over the list the page is cut from, and pressing one narrows
 * that list to exactly those rows. The pressed tile stays marked so the reader
 * knows which list they are looking at.
 */
export default function MatchStatTiles({
  counts,
  value,
  onChange,
}: {
  /** Undefined until the first answer: a dash, not a nought nobody measured. */
  counts?: MatchViewCounts;
  value: MatchView;
  onChange: (view: MatchView) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Show matches">
      {VIEW_TILES.map((tile) => {
        const active = tile.view === value;
        return (
          <button
            key={tile.view}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tile.view)}
            className={`rounded-[--radius-lg] border p-4 text-left shadow-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              active
                ? 'border-brand bg-brand-light ring-1 ring-brand'
                : 'border-gray-200 bg-surface hover:border-brand/50'
            }`}
          >
            <p
              className={`text-2xl font-semibold tracking-[-0.02em] ${
                active ? 'text-brand-dark' : 'text-gray-900'
              }`}
            >
              {counts ? counts[tile.count] : '–'}
            </p>
            <p className={`mt-0.5 text-xs ${active ? 'text-brand-dark' : 'text-gray-500'}`}>
              {tile.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}
