import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }));
vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  apiMessage: (_error: unknown, fallback: string) => fallback,
}));

import { PlannerCard, plannerHref } from './WeddingPlanners';

const planner = {
  id: 'planner-1',
  agencyName: 'Lotus Weddings',
  city: 'Hyderabad',
  yearsExperience: 6,
  ratingAvg: 4.5,
  ratingCount: 3,
};

function renderCard(weddingDate = '') {
  useQueryMock.mockReturnValue({ data: undefined, isFetching: false });
  return renderToStaticMarkup(
    <MemoryRouter>
      <PlannerCard planner={planner} weddingDate={weddingDate} shortlisted={false} onToggleShortlist={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('PlannerCard', () => {
  it('links the whole card to the planner profile', () => {
    const markup = renderCard();

    expect(markup).toContain('href="/wedding-planners/planner-1"');
    expect(markup).toContain('aria-label="Lotus Weddings: view profile and availability"');
    // The link's ::after stretches over the positioned card.
    expect(markup).toContain('after:absolute after:inset-0');
    expect(markup).toMatch(/<article[^>]*class="group relative/);
  });

  it('carries the chosen date into the profile link', () => {
    expect(renderCard('2026-12-12')).toContain('href="/wedding-planners/planner-1?date=2026-12-12"');
    expect(plannerHref('p', '')).toBe('/wedding-planners/p');
  });

  it('keeps the shortlist heart clickable above the card link', () => {
    const markup = renderCard();

    expect(markup).toMatch(/<button[^>]*class="absolute right-2 top-2 z-10[^"]*"[^>]*aria-label="Add to shortlist"/);
  });
});
