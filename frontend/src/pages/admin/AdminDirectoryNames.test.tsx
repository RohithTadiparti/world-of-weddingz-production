import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), put: vi.fn() },
  apiMessage: () => '',
}));
vi.mock('../../store/auth', () => ({ usePermissions: () => [] }));

import { AdminAgents, AdminPlanners, AdminUsers, AdminVendors } from './AdminPages';
import { accountLabel } from '../../lib/admin-names';

/**
 * WOW-01..04: the admin lists lead with the person's name (and, for agents and
 * planners, the business beside it) instead of a column of masked emails.
 */
function render(ui: ReactElement, cache: [unknown[], unknown][], path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [key, value] of cache) client.setQueryData(key, value);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const page = (data: unknown[]) => ({ data, meta: { total: data.length, totalPages: 1 } });

describe('accountLabel', () => {
  it('prefers the name, then the masked email, then the masked mobile', () => {
    expect(accountLabel({ name: 'Meera Rao', email: 'm***@x.in' })).toBe('Meera Rao');
    expect(accountLabel({ name: '  ', email: 'm***@x.in' })).toBe('m***@x.in');
    expect(accountLabel({ name: null, email: null, phone: '******3210' })).toBe('******3210');
    expect(accountLabel({})).toBe('No name on file');
  });
});

describe('Agents list (WOW-02)', () => {
  it("shows the agent's name with an Agency Name column beside it", () => {
    const html = render(<AdminAgents />, [
      [
        ['admin-role-directory', 'agent', 'all', '', 1],
        page([
          {
            id: 'a1aaaaaa-0000',
            name: 'Ravi Kumar',
            businessName: 'Bandhan Agency',
            email: 'r***@bandhan.in',
            phone: '********3210',
            isActive: true,
            isVerified: true,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]),
      ],
    ]);

    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toMatch(/>Name<\/th><th[^>]*>Agency Name<\/th>/);
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('Bandhan Agency');
    expect(html).not.toContain('r***@bandhan.in');
    expect(html).toContain('Search by name, email or mobile');
  });
});

describe('Wedding planners list (WOW-04)', () => {
  it("shows the planner's name with a Business Name column beside it", () => {
    const html = render(<AdminPlanners />, [
      [
        ['admin-role-directory', 'planner', 'all', '', 1],
        page([
          {
            id: 'p1pppppp-0000',
            name: 'Anil Sharma',
            businessName: 'Sharma Weddings',
            email: 'a***@sharma.in',
            isActive: true,
            isVerified: false,
            createdAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2pppppp-0000',
            name: null,
            businessName: null,
            email: 'n***@x.in',
            isActive: true,
            isVerified: false,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]),
      ],
    ]);

    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toMatch(/>Name<\/th><th[^>]*>Business Name<\/th>/);
    expect(html).toContain('Anil Sharma');
    expect(html).toContain('Sharma Weddings');
    // No name anywhere: the masked email is the last resort, never a blank.
    expect(html).toContain('n***@x.in');
  });
});

describe('Vendors list (WOW-03)', () => {
  it("leads with the owner's name and keeps the business name column", () => {
    const html = render(<AdminVendors />, [
      [
        ['admin-vendor-businesses', '', 'all', 1],
        page([
          {
            id: 'v1',
            ownerUserId: 'u1',
            name: 'Sri Caterers',
            category: 'catering',
            status: 'approved',
            createdAt: '2026-01-01T00:00:00Z',
            owner: { name: 'Suresh Reddy', email: 'o***@caterers.in', isActive: true, createdAt: '2026-01-01T00:00:00Z' },
          },
        ]),
      ],
    ]);

    expect(html).toContain('Owner Name');
    expect(html).toContain('Suresh Reddy');
    expect(html).toContain('Sri Caterers');
    expect(html).not.toContain('o***@caterers.in');
  });
});

describe('Users list (WOW-01)', () => {
  it("leads each row with the person's name, the masked email only as a sub-line", () => {
    const html = render(
      <AdminUsers />,
      [
        [
          ['admin-directory', 'bride', '', '', undefined],
          page([
            {
              id: 'u1',
              name: 'Meera Rao',
              email: 'm***@example.org',
              role: 'bride',
              isActive: true,
              isVerified: true,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ]),
        ],
      ],
      '/admin/users?role=bride',
    );

    const nameAt = html.indexOf('Meera Rao');
    expect(nameAt).toBeGreaterThan(-1);
    expect(html.indexOf('m***@example.org')).toBeGreaterThan(nameAt);
    expect(html).toContain('Search by name, email or mobile');
  });
});
