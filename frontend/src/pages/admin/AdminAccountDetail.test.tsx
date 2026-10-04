import { describe, expect, it } from 'vitest';
import { buildSummaryCards } from './AdminAccountDetail';

describe('buildSummaryCards', () => {
  const account = {
    user: { id: 'u1', email: 'a@example.com', role: 'vendor', isActive: true, isVerified: true, managedByAgentId: null, phone: null, createdAt: '2024-01-01T00:00:00.000Z' },
    profiles: [],
    businesses: [],
    bookings: [],
    providerBookings: [],
    plannerBusinesses: [],
    casesRaised: [],
    casesAssigned: [],
    verifications: [],
    matchmaking: null,
    payments: { total: '0', inEscrow: '0', released: '0', refunded: '0', history: [] },
    agency: null,
    officer: null,
    metrics: {
      provider: { bookings: 7, inEscrow: '3200', released: '1500' },
      agent: null,
      officer: null,
    },
  };

  it('builds the expected vendor summary cards', () => {
    const cards = buildSummaryCards('vendor', account as any, 'v1');
    expect(cards.map((card) => card.label)).toEqual([
      'Total bookings',
      'Amount in escrow',
      'Amount released',
      'Recent payments',
    ]);
  });

  it('builds the expected officer summary cards', () => {
    const cards = buildSummaryCards('officer', {
      ...account,
      user: { ...account.user, role: 'in_person' },
      officer: {
        assigned: 2,
        open: 1,
        overdue: 1,
        queue: [{ status: 'in_progress' }, { status: 'assigned' }],
        serviceAreas: [],
        decisions: [{ id: 'd1' }],
      },
      casesAssigned: [{ status: 'resolved' }, { status: 'open' }, { status: 'closed' }],
      metrics: { provider: { bookings: 0, inEscrow: '0', released: '0' }, agent: null, officer: { new: 1, assigned: 2, approved: 1 } },
    } as any, 'o1');

    expect(cards.map((card) => [card.label, card.value])).toEqual([
      ['Assigned verifications', 2],
      ['Completed verifications', 1],
      ['In progress', 1],
      ['Missed / overdue', 1],
      ['Cases assigned', 3],
      ['Cases solved', 2],
    ]);
  });
});
