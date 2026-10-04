import { ProfileVisibility } from '../../../common/enums';
import { Profile } from '../entities/profile.entity';
import { profilePhotoOf, toPublicProfile } from './public-profile.dto';

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
