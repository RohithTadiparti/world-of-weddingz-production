import type { MatchView } from '../components/MatchStatTiles';

/** The filters a link into Matches is allowed to preset. */
export type MatchesLinkFilters = Partial<Record<'sort' | 'minScore' | 'city' | 'addedWithinDays', string>>;

export interface MatchesNavState {
  /** The server-side tile view; anything a link does not name is 'all'. */
  view: MatchView;
  /** Filters to apply on top of the defaults. */
  filters: MatchesLinkFilters;
  /** A section of the page to bring into view once it renders. */
  focus?: 'recommended';
}

const SERVER_VIEWS: readonly MatchView[] = ['all', 'active', 'high', 'shortlisted'];
const SORTS = ['recent', 'score', 'active', 'age', 'ageDesc'];

/**
 * What a URL into Matches asks the page to show.
 *
 * Every link that lands on Matches (sidebar, home collections, "view all")
 * describes the whole state it wants, so the page derives that state from the
 * URL each time it changes. A plain /matches therefore always means the normal
 * browse list: a tile pressed on an earlier visit (Shortlisted, say) does not
 * survive navigating back to Matches.
 *
 * The home collections use their own view names:
 * - values: the "Recommended for you" section, ranked by compatibility
 * - near:   people in the viewer's own city
 * - recent: profiles that joined this month, newest first
 */
export function matchesNavState(params: URLSearchParams, ownCity?: string | null): MatchesNavState {
  const requested = params.get('view') ?? '';
  const filters: MatchesLinkFilters = {};

  const sort = params.get('sort');
  if (sort && SORTS.includes(sort)) filters.sort = sort;
  const minScore = params.get('minScore');
  if (minScore && /^\d{1,3}$/.test(minScore)) filters.minScore = minScore;
  const city = params.get('city');
  if (city) filters.city = city;

  if ((SERVER_VIEWS as readonly string[]).includes(requested)) {
    return { view: requested as MatchView, filters };
  }
  if (requested === 'values') {
    return { view: 'all', filters, focus: 'recommended' };
  }
  if (requested === 'near') {
    const near = ownCity?.trim();
    return { view: 'all', filters: near ? { ...filters, city: near } : filters };
  }
  if (requested === 'recent') {
    return { view: 'all', filters: { ...filters, sort: 'recent', addedWithinDays: '30' } };
  }
  return { view: 'all', filters };
}
