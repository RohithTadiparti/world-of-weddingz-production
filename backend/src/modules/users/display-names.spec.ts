import {
  adminAccountNames,
  displayNamesByUserIds,
  joinName,
  pickDisplayName,
} from './display-names';

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

  it('masks only the email fallback when an administrator list asks it to (ISS-11)', async () => {
    const repo = <T>(rows: T[]) => ({ find: jest.fn(async () => rows) }) as unknown as never;
    const names = await displayNamesByUserIds(
      {
        users: repo([
          { id: 'u1', email: 'bride@x.in' },
          { id: 'o', email: 'officer@x.in' },
        ]),
        profiles: repo([{ userId: 'u1', displayName: 'Meera' }]),
      },
      ['u1', 'o'],
      { maskEmail: true },
    );
    expect(Object.fromEntries(names)).toEqual({ u1: 'Meera', o: 'o***@x.in' });
  });

  it('asks nothing when there is nobody to name', async () => {
    const find = jest.fn();
    const repo = { find } as unknown as never;
    expect((await displayNamesByUserIds({ users: repo, profiles: repo }, [null])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});

describe('the names an administrator list shows (WOW-01..04)', () => {
  const repo = <T>(rows: T[]) => ({ find: jest.fn(async () => rows) }) as unknown as never;

  it('joins first and last names, dropping blanks', () => {
    expect(joinName('Meera', 'Rao')).toBe('Meera Rao');
    expect(joinName(' Meera ', '', null)).toBe('Meera');
    expect(joinName(null, undefined, '  ')).toBeNull();
  });

  it('leads with the biodata name, then the profile name, then the business, then masked contact', async () => {
    const names = await adminAccountNames(
      {
        users: repo([]),
        profiles: repo([
          { id: 'p1', userId: 'u1', displayName: 'Profile Name' },
          { id: 'p2', userId: 'u2', displayName: 'Ravi Kumar' },
          // An older-first order: the account's own profile is the first one.
          { id: 'p2b', userId: 'u2', displayName: 'Later Profile' },
        ]),
        details: repo([
          { profileId: 'p1', firstName: 'Meera', lastName: null, surname: 'Rao' },
        ]),
        vendors: repo([{ ownerUserId: 'v', name: 'Lotus Caterers' }]),
        agencies: repo([{ ownerUserId: 'u2', agencyName: 'Bandhan Agency' }]),
      },
      [
        { id: 'u1', email: 'meera@x.in' },
        { id: 'u2', email: 'ravi@x.in' },
        { id: 'v', email: 'vendor@x.in' },
        { id: 'e', email: 'nobody@x.in' },
        { id: 'm', email: null, phone: '+91 90000 11111' },
      ],
    );

    expect(Object.fromEntries(names)).toEqual({
      u1: { name: 'Meera Rao', personName: 'Meera Rao', businessName: null },
      u2: { name: 'Ravi Kumar', personName: 'Ravi Kumar', businessName: 'Bandhan Agency' },
      v: { name: 'Lotus Caterers', personName: null, businessName: 'Lotus Caterers' },
      e: { name: 'n***@x.in', personName: null, businessName: null },
      m: { name: '********1111', personName: null, businessName: null },
    });
  });

  it('asks nothing when the page is empty', async () => {
    const find = jest.fn();
    const r = { find } as unknown as never;
    expect((await adminAccountNames({ users: r, profiles: r }, [])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
