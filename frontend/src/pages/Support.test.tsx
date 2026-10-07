import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  apiMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('../store/auth', () => ({
  useAuth: (select: (state: { user: { role: string } }) => unknown) => select({ user: { role: 'groom' } }),
}));

import Support from './Support';

function renderAt(path: string) {
  useQueryMock.mockReturnValue({ isLoading: false, data: { data: [] } });
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Support />
    </MemoryRouter>,
  );
}

describe('Support', () => {
  it('opens on the ticket list by default', () => {
    const markup = renderAt('/support');

    expect(markup).not.toContain('What is it about?');
    expect(markup).toContain('Raise an issue');
  });

  it('opens the new ticket form straight away from a "Raise an issue" link', () => {
    const markup = renderAt('/support?new=1');

    expect(markup).toContain('What is it about?');
    expect(markup).toContain('Cancel');
  });
});
