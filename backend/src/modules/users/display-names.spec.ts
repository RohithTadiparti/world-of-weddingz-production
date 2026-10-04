import { displayNamesByUserIds, pickDisplayName } from './display-names';

describe('the name shown for an account', () => {
  it('prefers the person’s own profile name', () => {
    expect(
      pickDisplayName({ profileName: 'Asha', businessName: 'Asha Studios', email: 'a@x.in' }),
    ).toBe('Asha');
  });

  it('falls back to the business, then the email, skipping blanks', () => {
    expect(pickDisplayName({ profileName: '  ', businessName: 'Asha Studios', email: 'a@x.in' })).toBe(
      'Asha Studios',
    );
    expect(pickDisplayName({ profileName: null, businessName: '', email: 'a@x.in' })).toBe('a@x.in');
    expect(pickDisplayName({})).toBeNull();
  });

  it('names a vendor, a planner and an agency with no profile by their business', async () => {
    const repo = <T>(rows: T[]) => ({ find: jest.fn(async () => rows) }) as unknown as never;
    const names = await displayNamesByUserIds(
      {
        users: repo([
          { id: 'u1', email: 'bride@x.in' },
          { id: 'v', email: 'vendor@x.in' },
          { id: 'p', email: 'planner@x.in' },
          { id: 'a', email: 'agency@x.in' },
          { id: 'o', email: 'officer@x.in' },
        ]),
        profiles: repo([{ userId: 'u1', displayName: 'Meera' }]),
        vendors: repo([
          { ownerUserId: 'v', name: 'Lotus Caterers' },
          { ownerUserId: 'v', name: 'Second Business' },
        ]),
        planners: repo([{ ownerUserId: 'p', agencyName: 'Sharma Weddings' }]),
        agencies: repo([{ ownerUserId: 'a', agencyName: 'Bandhan Agency' }]),
      },
      ['u1', 'v', 'p', 'a', 'o', null, 'u1'],
    );
    expect(Object.fromEntries(names)).toEqual({
      u1: 'Meera',
      v: 'Lotus Caterers',
      p: 'Sharma Weddings',
      a: 'Bandhan Agency',
      o: 'officer@x.in',
    });
  });

  it('asks nothing when there is nobody to name', async () => {
    const find = jest.fn();
    const repo = { find } as unknown as never;
    expect((await displayNamesByUserIds({ users: repo, profiles: repo }, [null])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
