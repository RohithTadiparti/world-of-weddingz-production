import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), put: vi.fn() },
  apiMessage: () => '',
}));
// An administrator who holds the reveal permission.
vi.mock('../../store/auth', () => ({ usePermissions: () => ['admin:contact:reveal'] }));
vi.mock('../../components/CategoryPicker', () => ({ CategoryNames: () => null }));

import AdminProfileDetail from './AdminProfileDetail';
import AdminBusinessDetail, { businessContact } from './AdminBusinessDetail';
import { accountHeading, plannerContact } from './AdminAccountDetail';

/**
 * WOW-05: every admin detail page shows email and mobile masked, with the
 * audited "Reveal contact details" control for the whole values.
 */
function render(path: string, route: string, ui: ReactElement, cache: [unknown[], unknown][]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [key, value] of cache) client.setQueryData(key, value);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PROFILE = {
  profile: {
    id: 'p1',
    profileCode: 'WOW-1',
    displayName: 'Meera Rao',
    gender: 'female',
    dateOfBirth: null,
    city: 'Hyderabad',
    address: null,
    bio: null,
    photos: [],
    preferences: {},
    contactEmail: 'm***@example.org',
    contactPhone: '********6789',
    contactMasked: true,
    stewardRelation: null,
    managingFor: null,
    claimStatus: 'self',
    networkVisibility: 'private',
    visibility: 'public',
    lifecycle: 'active',
    lifecycleReason: null,
    profileCompleted: true,
    lastActiveAt: null,
    pooledAt: null,
    governmentIdType: null,
    governmentIdLast4: null,
    idSubmittedAt: null,
    idVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  owner: { id: 'u1', name: 'Meera Rao', email: 'm***@example.org', phone: '********2222' },
  steward: { id: 'a1', name: 'Ravi Kumar', email: 'd***@bandhan.in', role: 'agent' },
  verifiedBy: null,
  details: null,
  matchmaking: { sent: 0, received: 0, accepted: 0, fixed: 0 },
};

describe('View full profile (WOW-05)', () => {
  it('shows the contact lines masked, with the audited reveal beside them', () => {
    const html = render('/admin/profiles/p1', '/admin/profiles/:id', <AdminProfileDetail />, [
      [['admin-profile-detail', 'p1'], PROFILE],
    ]);
    expect(html).toContain('********6789');
    expect(html).toContain('m***@example.org');
    expect(html).toContain('Reveal contact details');
    // The steward is named, not identified by their email.
    expect(html).toContain('Open steward (Ravi Kumar)');
  });
});

const BUSINESS = {
  business: {
    id: 'v1',
    name: 'Sri Caterers',
    category: 'catering',
    categories: [],
    otherCategory: null,
    description: null,
    city: 'Hyderabad',
    pricing: {},
    portfolio: [],
    ratingAvg: 0,
    ratingCount: 0,
    gstNumber: null,
    panNumber: null,
    registrationNumber: null,
    tradingSince: null,
    registeredAddress: null,
    contactPhone: '********1111',
    complianceDocuments: [],
    status: 'approved',
    isApproved: true,
    submittedAt: null,
    verifiedAt: null,
    decisionReason: null,
    revisionCount: 0,
    archivedAt: null,
    payoutAccountId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  owner: {
    id: 'u1',
    name: 'Suresh Reddy',
    email: 'o***@caterers.in',
    role: 'vendor',
    isActive: true,
    phone: '********2222',
    createdAt: '2026-01-01T00:00:00Z',
  },
  services: [],
  verifications: [],
  bookings: [],
  reviews: [],
};

describe('Business detail (WOW-05)', () => {
  it("shows the business and owner contact masked, with the owner's reveal", () => {
    const html = render('/admin/businesses/v1', '/admin/businesses/:id', <AdminBusinessDetail />, [
      [['admin-business-detail', 'v1'], BUSINESS],
    ]);
    expect(html).toContain('********1111');
    expect(html).toContain('o***@caterers.in');
    expect(html).toContain('********2222');
    expect(html).toContain('Suresh Reddy');
    expect(html).toContain('Reveal contact details');
  });

  it('swaps in the whole values only once the audited reveal returns them', () => {
    expect(businessContact(BUSINESS, null)).toEqual({
      businessPhone: '********1111',
      ownerEmail: 'o***@caterers.in',
      ownerPhone: '********2222',
    });
    expect(
      businessContact(BUSINESS, {
        id: 'u1',
        email: 'owner@caterers.in',
        phone: '+919876522222',
        businesses: [{ id: 'v1', contactPhone: '+91 98765 11111' }],
      }),
    ).toEqual({
      businessPhone: '+91 98765 11111',
      ownerEmail: 'owner@caterers.in',
      ownerPhone: '+919876522222',
    });
  });
});

describe('Account detail (WOW-01..05)', () => {
  const base = {
    user: { id: 'u1', name: 'Ravi Kumar', businessName: 'Bandhan Agency', email: 'r***@x.in', phone: null },
    businesses: [],
    plannerBusinesses: [],
  };

  it("heads the page with the server's name and opens the account's own profile", () => {
    const heading = accountHeading({
      ...base,
      profiles: [
        { id: 'client', displayName: 'A Client', lifecycle: 'active', city: null, own: false },
        { id: 'mine', displayName: 'Ravi', lifecycle: 'active', city: null, own: true },
      ],
    } as never);
    expect(heading).toEqual({ name: 'Ravi Kumar', businessName: 'Bandhan Agency', profileId: 'mine' });
  });

  it("never offers a stewarded client's profile as the account's own", () => {
    const heading = accountHeading({
      ...base,
      user: { ...base.user, name: null },
      profiles: [{ id: 'client', displayName: 'A Client', lifecycle: 'active', city: null, own: false }],
    } as never);
    expect(heading.profileId).toBeNull();
    expect(heading.name).toBe('r***@x.in');
  });

  it("shows a planner business's lines masked until the account reveal returns them", () => {
    const business = { id: 'pl1', contactPhone: '********6655', contactEmail: 'h***@sharma.in' };
    expect(plannerContact(business, null)).toEqual({ phone: '********6655', email: 'h***@sharma.in' });
    expect(
      plannerContact(business, {
        id: 'u1',
        email: null,
        phone: null,
        plannerBusinesses: [{ id: 'pl1', contactPhone: '9988776655', contactEmail: 'hello@sharma.in' }],
      }),
    ).toEqual({ phone: '9988776655', email: 'hello@sharma.in' });
  });
});
