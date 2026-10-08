import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock, apiGetMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  apiGetMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/api', () => ({
  api: { get: apiGetMock, post: vi.fn() },
  apiMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('../store/auth', () => ({
  useAuth: (select: (state: { user: { role: string } }) => unknown) => select({ user: { role: 'groom' } }),
}));

import Support from './Support';

function renderAt(path: string, cases: unknown[] = []) {
  useQueryMock.mockReturnValue({ isLoading: false, data: { data: cases } });
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Support />
    </MemoryRouter>,
  );
}

const caseRow = {
  id: 'case-1',
  title: 'Payout missing',
  description: 'The payout for booking #42 never arrived.',
  status: 'resolution_submitted',
  subjectType: 'payment',
  createdAt: '2026-10-01T10:00:00Z',
};

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

  it('reads the reader\u2019s own raised cases, not a staff queue', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    useQueryMock.mockReturnValue({ isLoading: false, data: { data: [] } });
    renderToStaticMarkup(
      <MemoryRouter initialEntries={['/support']}>
        <Support />
      </MemoryRouter>,
    );
    // An officer would otherwise see the cases allocated to them here, because
    // the one endpoint answers both questions. scope=raised picks the other.
    const config = useQueryMock.mock.calls[0][0] as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
    };
    expect(config.queryKey).toEqual(['support-cases', 'raised']);
    await config.queryFn();
    expect(apiGetMock).toHaveBeenCalledWith('/verification/cases', {
      params: { scope: 'raised' },
    });
  });

  it('opens the case a notification links to', () => {
    const markup = renderAt('/support?case=case-1', [caseRow]);

    expect(markup).toContain('The payout for booking #42 never arrived.');
  });

  it('keeps cases closed on a plain visit', () => {
    const markup = renderAt('/support', [caseRow]);

    expect(markup).toContain('Payout missing');
    expect(markup).not.toContain('The payout for booking #42 never arrived.');
  });
});
