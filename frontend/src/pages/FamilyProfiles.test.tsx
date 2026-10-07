import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission } from '../lib/permissions';

const { useQueryMock, auth } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  auth: { role: 'family', permissions: [] as string[] },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiMessage: (_error: unknown, fallback?: string) => fallback ?? '',
}));
vi.mock('../store/auth', () => ({
  useAuth: (select: (state: { user: { role: string } }) => unknown) =>
    select({ user: { role: auth.role } }),
  usePermissions: () => auth.permissions,
}));

import Biodata from './Biodata';
import ManagedProfiles from './ManagedProfiles';

const FAMILY = [
  Permission.MATCH_BROWSE,
  Permission.MANAGED_PROFILE_MANAGE,
  Permission.MANAGED_PROFILE_INVITE,
  Permission.ACT_ON_BEHALF,
  Permission.PROFILE_CIRCULATE,
];
const AGENT = [...FAMILY, Permission.AGENCY_MANAGE];

const relative = {
  id: 'p-daughter',
  displayName: 'Bhavana Rao',
  claimStatus: 'unclaimed',
  contactPhone: null,
  contactEmail: null,
  city: 'Hyderabad',
  photos: [],
  visibility: 'private',
  lifecycle: 'active',
  stewardRelation: 'Mother',
  actions: { canEdit: true, canManagePhotos: true, canCirculate: true, canInvite: false },
  circulation: null,
};

/** Answers each query by its key, the way the pages ask them. */
function answer(byKey: Record<string, unknown>) {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => ({
    data: byKey[String(queryKey[0])],
    isLoading: false,
  }));
}

const render = (node: React.ReactNode, path = '/') =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

describe('a family member managing a relative', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    auth.role = 'family';
    auth.permissions = FAMILY;
  });

  it('is asked whose biodata to fill in rather than given one of their own', () => {
    answer({ 'actable-profiles': [relative] });

    const markup = render(<Biodata />, '/biodata');

    expect(markup).toContain('not for you');
    expect(markup).toContain('Whose biodata');
    // Nothing is loaded for the family account's own profile.
    const query = (key: string) => useQueryMock.mock.calls.find(([o]) => o.queryKey[0] === key)?.[0];
    expect(query('biodata')).toMatchObject({ queryKey: ['biodata', ''], enabled: false });
    expect(query('me')?.enabled).toBe(false);
  });

  it('opens the chosen relative’s biodata, not the family member’s', () => {
    answer({
      biodata: {
        details: { firstName: 'Bhavana', lastName: 'Rao' },
        profile: { displayName: 'Bhavana Rao', city: 'Vizag', dateOfBirth: '1998-02-14', photos: [] },
        completion: { complete: false, percent: 20, missing: [], sections: [] },
      },
    });

    const markup = render(<Biodata />, '/biodata?profileId=p-daughter');

    expect(markup).toContain('Vizag');
    expect(useQueryMock.mock.calls.some(([o]) => o.queryKey[0] === 'biodata' && o.queryKey[1] === 'p-daughter')).toBe(true);
  });

  it('can make a private relative matchable before the biodata is complete', () => {
    answer({
      'managed-profiles': { data: [relative] },
      'profile-completion': { complete: false, percent: 40, missing: ['horoscope'] },
    });

    const markup = render(<ManagedProfiles />);

    expect(markup).toContain('Private: not shown in matches');
    expect(markup).toContain('Make matchable');
  });

  it('says a visible relative is in matches', () => {
    answer({
      'managed-profiles': { data: [{ ...relative, visibility: 'matches_only' }] },
      'profile-completion': { complete: false, percent: 40, missing: ['horoscope'] },
    });

    const markup = render(<ManagedProfiles />);

    expect(markup).toContain('Visible in matches');
    expect(markup).not.toContain('Make matchable');
  });

  it('keeps an agency client private until its biodata is complete', () => {
    auth.role = 'agent';
    auth.permissions = AGENT;
    answer({
      'agency-status': { approved: true, registered: true },
      'managed-profiles': { data: [relative] },
      'profile-completion': { complete: false, percent: 40, missing: ['horoscope'] },
    });

    const markup = render(<ManagedProfiles />);

    expect(markup).toContain('Private until complete');
    expect(markup).not.toContain('Make matchable');
  });
});
