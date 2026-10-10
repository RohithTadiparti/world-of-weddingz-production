import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), put: vi.fn(), post: vi.fn() },
  apiMessage: () => '',
  isConflict: () => false,
}));
vi.mock('../store/auth', () => ({ usePermissions: () => [] }));

import SharedWithMe from './SharedWithMe';

function render(rows: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['shared-with-me'], rows);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SharedWithMe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const profile = { id: 'p1', displayName: 'Meera Rao', photos: [], ageRange: '26-30', age: 27, dateOfBirth: null };

/** WOW-07: a shared card names the agency and the date, and nothing to contact it by. */
describe('Shared With Me cards', () => {
  it('shows the sharing agency and the date, never its mobile or email', () => {
    const html = render([
      {
        shareId: 's1',
        sharedAt: '2026-10-01T00:00:00Z',
        message: null,
        // An older server still sending these must not get them onto the card.
        sharedBy: {
          agencyName: 'Bandhan Agency',
          city: 'Hyderabad',
          contactPhone: '+91 98765 43210',
          email: 'desk@bandhan.in',
        },
        profile,
      },
    ]);

    expect(html).toContain('Bandhan Agency');
    expect(html).toContain(new Date('2026-10-01T00:00:00Z').toLocaleDateString());
    expect(html).not.toContain('98765');
    expect(html).not.toContain('desk@bandhan.in');
    expect(html).not.toContain('Hyderabad');
  });

  it('says another agency rather than falling back to an email', () => {
    const html = render([
      { shareId: 's2', sharedAt: '2026-10-02T00:00:00Z', message: null, sharedBy: { agencyName: null }, profile },
    ]);
    expect(html).toContain('another agency');
  });
});
