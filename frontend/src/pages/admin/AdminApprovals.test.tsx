import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() }, apiMessage: () => '' }));
vi.mock('../../store/auth', () => ({ usePermissions: () => [] }));

import { AdminApprovals } from './AdminPages';

function render(cache: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [key, value] of Object.entries(cache)) client.setQueryData([key], value);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminApprovals />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminApprovals agencies (ISS-10)', () => {
  it('lists rejected agencies apart from the ones awaiting approval', () => {
    const html = render({
      'pending-agents': [{ id: 'a1', agencyName: 'Waiting Agency', registrationNumber: null, contactPhone: '******3210', about: null }],
      'rejected-agents': [{ id: 'r1', agencyName: 'Refused Agency', rejectionReason: 'Address not found' }],
    });

    const pendingCard = html.slice(html.indexOf('Agencies awaiting approval'), html.indexOf('Rejected agencies'));
    expect(pendingCard).toContain('Waiting Agency');
    expect(pendingCard).not.toContain('Refused Agency');
    expect(html).toContain('Rejected agencies (1)');
    expect(html).toContain('Reason given: Address not found');
    expect(html).toContain('Approve instead');
  });

  it('shows no rejected section when there are none', () => {
    const html = render({ 'pending-agents': [], 'rejected-agents': [] });
    expect(html).toContain('Nothing pending.');
    expect(html).not.toContain('Rejected agencies');
  });
});
