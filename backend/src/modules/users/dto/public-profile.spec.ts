import { ProfileVisibility } from '../../../common/enums';
import { Profile } from '../entities/profile.entity';
import { profilePhotoOf, stewardshipHint, toPublicProfile } from './public-profile.dto';

const photos = ['https://cdn.example.com/lead.jpg', 'https://cdn.example.com/second.jpg'];

const profile = (visibility: ProfileVisibility): Profile =>
  ({
    id: 'p1',
    displayName: 'Profile',
    gender: 'female',
    city: 'Hyderabad',
    dateOfBirth: '1998-04-02',
    photos,
    visibility,
    bio: 'Written by them.',
  }) as Profile;

describe('toPublicProfile photos', () => {
  // The default visibility. Match cards used to come up blank for it while the
  // profile view showed the same photo.
  it('shows the profile photo on a MATCHES_ONLY profile before a match', () => {
    const view = toPublicProfile(profile(ProfileVisibility.MATCHES_ONLY));
    expect(view.photos).toEqual(['https://cdn.example.com/lead.jpg']);
    expect(view.photoCount).toBe(2);
  });

  it('shows the profile photo on a PUBLIC profile before a match', () => {
    expect(toPublicProfile(profile(ProfileVisibility.PUBLIC)).photos).toEqual([
      'https://cdn.example.com/lead.jpg',
    ]);
  });

  it('shows nothing of a PRIVATE profile', () => {
    expect(toPublicProfile(profile(ProfileVisibility.PRIVATE)).photos).toEqual([]);
  });

  it('opens the full set once matched', () => {
    expect(toPublicProfile(profile(ProfileVisibility.MATCHES_ONLY), { matched: true }).photos).toEqual(
      photos,
    );
  });
});

describe('profilePhotoOf', () => {
  it('is the first photo when nobody chose one', () => {
    expect(profilePhotoOf(profile(ProfileVisibility.MATCHES_ONLY))).toBe(
      'https://cdn.example.com/lead.jpg',
    );
  });

  it('is nothing for a PRIVATE profile', () => {
    expect(profilePhotoOf(profile(ProfileVisibility.PRIVATE))).toBeNull();
  });

  it('is nothing for a profile with no photos', () => {
    expect(profilePhotoOf({ photos: [], visibility: ProfileVisibility.PUBLIC })).toBeNull();
  });
});

describe('stewardshipHint', () => {
  const base = { userId: null, managedByUserId: 'steward', stewardRelation: null } as Pick<
    Profile,
    'userId' | 'managedByUserId' | 'stewardRelation'
  >;

  it('is nothing for a self-run profile', () => {
    expect(stewardshipHint({ ...base, managedByUserId: null })).toBeNull();
    expect(stewardshipHint({ ...base, userId: 'steward' })).toBeNull();
  });

  it('names the agency in a single line, "Managed by" included once', () => {
    expect(stewardshipHint(base, { stewardRole: 'agent', agencyName: 'ABC Marriages' })).toEqual({
      kind: 'agency',
      label: 'Managed by ABC Marriages',
      relation: null,
    });
    expect(stewardshipHint(base, { stewardRole: 'agent' })?.label).toBe('Managed by an agency');
  });

  it('says a family member, with the relation when one was recorded', () => {
    expect(stewardshipHint({ ...base, stewardRelation: 'Parent' }, { stewardRole: 'family' })).toEqual({
      kind: 'family',
      label: 'Managed by a family member',
      relation: 'Parent',
    });
  });

  it('infers the kind when the steward role is unknown', () => {
    expect(stewardshipHint(base, { agencyName: 'ABC Marriages' })?.kind).toBe('agency');
    expect(stewardshipHint({ ...base, stewardRelation: 'Sibling' })?.kind).toBe('family');
    expect(stewardshipHint(base)).toEqual({
      kind: 'steward',
      label: 'Managed on their behalf',
      relation: null,
    });
  });

  it('travels on the suggestion card', () => {
    const card = toPublicProfile(
      { ...profile(ProfileVisibility.MATCHES_ONLY), managedByUserId: 'agent-1', userId: null } as Profile,
      { sourceAgency: 'ABC Marriages', stewardRole: 'agent' },
    );
    expect(card.stewardship?.label).toBe('Managed by ABC Marriages');
    expect(toPublicProfile(profile(ProfileVisibility.PUBLIC)).stewardship).toBeNull();
  });
});
