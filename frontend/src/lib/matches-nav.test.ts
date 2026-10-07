import { describe, expect, it } from 'vitest';
import { matchesNavState } from './matches-nav';

const at = (search: string, city?: string) => matchesNavState(new URLSearchParams(search), city);

describe('matchesNavState', () => {
  it('treats a plain /matches as the normal browse list', () => {
    expect(at('')).toEqual({ view: 'all', filters: {} });
  });

  it('opens the shortlist from the sidebar link', () => {
    expect(at('view=shortlisted')).toEqual({ view: 'shortlisted', filters: {} });
  });

  it('does not carry the shortlist into a later plain Matches visit', () => {
    expect(at('view=shortlisted').view).toBe('shortlisted');
    expect(at('').view).toBe('all');
  });

  it('sends "Same values" to the recommended section', () => {
    expect(at('view=values')).toEqual({ view: 'all', filters: {}, focus: 'recommended' });
  });

  it('narrows "Near you" to the viewer city', () => {
    expect(at('view=near', 'Hyderabad')).toEqual({ view: 'all', filters: { city: 'Hyderabad' } });
    expect(at('view=near')).toEqual({ view: 'all', filters: {} });
  });

  it('shows "Recently joined" as this month, newest first', () => {
    expect(at('view=recent')).toEqual({ view: 'all', filters: { sort: 'recent', addedWithinDays: '30' } });
  });

  it('gives each home collection a different destination', () => {
    const states = ['values', 'near', 'recent'].map((v) => JSON.stringify(at(`view=${v}`, 'Pune')));
    expect(new Set(states).size).toBe(3);
  });

  it('honours the sort and score of a "view all" link and ignores junk', () => {
    expect(at('minScore=51&sort=score')).toEqual({ view: 'all', filters: { minScore: '51', sort: 'score' } });
    expect(at('minScore=abc&sort=evil&view=bogus')).toEqual({ view: 'all', filters: {} });
  });
});
