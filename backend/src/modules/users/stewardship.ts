import { ProfileLifecycle } from '../../common/enums';
import type { Profile } from './entities/profile.entity';

/**
 * Whether the person stewarding a profile (an agent, or a family member) may
 * still write its biodata.
 *
 * Claiming used to end this: once the subject had an account, only they could
 * edit. That left an agency whose client was still on their book, actively
 * being matched, unable to correct a caste or add a sibling, which is most of
 * what the family pays them for. The subject getting an account does not end
 * the engagement, so it no longer ends the edit either. Both sides now write
 * the same profile, and each save lands on the one record the other reads.
 *
 * What ends it is the engagement itself: the agency releasing the profile
 * from their book (which clears `managedByUserId`, so this is never reached)
 * or the profile being closed out (ARCHIVED). A paused profile is still a
 * client, so pausing does not.
 */
export function stewardMayEditBiodata(
  profile: Pick<Profile, 'managedByUserId' | 'lifecycle'>,
  userId: string,
): boolean {
  return (
    profile.managedByUserId !== null &&
    profile.managedByUserId === userId &&
    profile.lifecycle !== ProfileLifecycle.ARCHIVED
  );
}

export const CLOSED_ENGAGEMENT_MESSAGE =
  'This client’s engagement is closed, so their biodata is read-only for you.';
