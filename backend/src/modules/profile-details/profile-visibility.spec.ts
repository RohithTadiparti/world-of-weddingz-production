import { ForbiddenException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { ProfileDetailsService } from './profile-details.service';
import { ProfileDetailsController } from './profile-details.controller';
import { Profile } from '../users/entities/profile.entity';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { InterestStatus, MatchFixedState, ProfileLifecycle, ProfileVisibility, UserRole } from '../../common/enums';
import { ageOf, toBiodata, toCardFacts, toPublicProfile } from '../users/dto/public-profile.dto';

const states = ['none', 'sent', 'accepted', 'proposed', 'fixed', 'rejected', 'withdrawn'] as const;
const basic = {
  religion: 'Hindu', motherTongue: 'Telugu', caste: 'Community',
  highestQualification: 'B.Tech', occupationStatus: 'employed',
  employment: { role: 'Engineer', salary: 'secret-income' }, business: {},
};

// Evaluate actual repository predicates, including both directions and In().
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) =>
    value instanceof FindOperator ? value.value.includes(row[key]) : row[key] === value);
}

describe.each(Object.values(ProfileVisibility))('profile visibility %s', visibility => {
  describe.each(states)('relationship %s', state => {
    it.each([false, true])('enforces the direct API and card response (reverse=%s)', async reverse => {
      const a = { id: 'a', userId: 'user-a', managedByUserId: null };
      const b = { id: 'b', userId: 'user-b', managedByUserId: null };
      const viewer = reverse ? b : a;
      const target = {
        ...(reverse ? a : b), visibility, lifecycle: ProfileLifecycle.ACTIVE,
        displayName: 'Chakri', dateOfBirth: '1996-04-02', photos: ['lead-photo', 'protected-photo'],
        bio: 'protected-bio',
      } as Profile;
      const accepted = ['accepted', 'proposed', 'fixed'].includes(state);
      const fixed = state === 'fixed';
      const full = visibility === ProfileVisibility.PUBLIC || fixed ||
        (visibility === ProfileVisibility.MATCHES_ONLY && accepted);
      // PRIVATE is shut to non-controllers until a match with it is fixed.
      const forbidden = visibility === ProfileVisibility.PRIVATE && !fixed;
      const interest = {
        fromProfileId: 'a', toProfileId: 'b',
        status: accepted ? InterestStatus.ACCEPTED : state === 'rejected' ? InterestStatus.REJECTED :
          state === 'withdrawn' ? InterestStatus.WITHDRAWN : InterestStatus.PENDING,
        matchFixedState: fixed ? MatchFixedState.CONFIRMED : state === 'proposed' ? 'proposed' : 'none',
      };
      const details = {
        profileId: target.id,
        ...basic, father: { name: 'protected-family' },
        horoscope: { rashi: 'headline-rashi' },
        horoscopeAvailable: true, horoscopeDocumentUrl: 'chart-document',
        communicationAddress: 'secret-address', alternateMobile: 'secret-phone',
        biodataDocumentUrl: 'secret-document', incomeVisible: false,
      };
      const service = new ProfileDetailsService(
        { findOne: async () => details, find: async () => [details] } as never,
        { find: async () => [] } as never,
        { find: async () => [] } as never,
        { findOne: async () => target, find: async () => [viewer] } as never,
        {} as never, {} as never, {} as never,
        { findOne: async ({ where }: { where: Record<string, unknown>[] }) =>
          state !== 'none' && where.some(w => matches(interest, w)) ? interest : null } as never,
        {} as never, {} as never,
      );
      const actor = { userId: viewer.userId, role: UserRole.BRIDE } as AuthUser;
      const view = new ProfileDetailsController(service).view(actor, target.id);
      if (forbidden) {
        await expect(view).rejects.toBeInstanceOf(ForbiddenException);
      } else {
        const response = await view;
        expect(response.accessLevel).toBe(full ? 'full' : 'basic');
        expect(response.limited).toBe(!full);
        expect(response.profile.displayName).toBe('Chakri');
        expect(response.profile.ageRange).toBeTruthy();
        // The exact age on every view, limited or full; the date of birth only on full.
        expect(response.profile.age).toBe(ageOf('1996-04-02'));
        expect(response.profile.age).toBeGreaterThanOrEqual(18);
        expect(response.details).toMatchObject({ religion: 'Hindu', motherTongue: 'Telugu',
          highestQualification: 'B.Tech', occupationStatus: 'employed' });
        const json = JSON.stringify(response);
        for (const secret of ['secret-address', 'secret-phone', 'secret-document', 'secret-income']) {
          expect(json).not.toContain(secret);
        }
        expect(json.includes('protected-family')).toBe(full);
        expect(json.includes('protected-photo')).toBe(full);
        expect(json.includes('protected-bio')).toBe(full);
        // The lead photo, horoscope headline and chart travel with the basic view
        // too (EZ1-I48, EZ1-I231).
        expect(response.profile.photos[0]).toBe('lead-photo');
        expect(json).toContain('headline-rashi');
        expect(json).toContain('chart-document');
        if (!full) {
          expect(response.profile.photos).toEqual(['lead-photo']);
          expect(response.details).toMatchObject({ profession: 'Engineer', rashi: 'headline-rashi',
            horoscopeDocumentUrl: 'chart-document' });
        }
      }

      const card = toPublicProfile(target, { accepted, fixed, card: toCardFacts(details as never) });
      expect(card.accessLevel).toBe(full ? 'full' : 'basic');
      expect(card.ageRange).toBeTruthy();
      expect(card.age).toBe(ageOf('1996-04-02'));
      expect(card.card?.motherTongue).toBe('Telugu');
      expect(card.card?.profession).toBe('Engineer');
      // Before a match the card carries the lead photo, except for PRIVATE.
      expect(card.photos).toEqual(full && accepted ? ['lead-photo', 'protected-photo'] :
        visibility === ProfileVisibility.PRIVATE ? [] : ['lead-photo']);
      expect(card.bio).toBe(full ? 'protected-bio' : undefined);

      // The editor endpoint remains owner/steward/admin only, even for PUBLIC.
      await expect(service.findFull(actor, target.id)).rejects.toThrow();
    });
  });

  it('keeps shared links basic for private profiles without a viewer relationship', () => {
    const view = toBiodata({ id: 'a', displayName: 'Chakri', visibility,
      dateOfBirth: '1996-04-02', photos: ['photo'] } as Profile, basic);
    expect(view.ageRange).toBeTruthy();
    expect(view.age).toBe(ageOf('1996-04-02'));
    expect(view.dateOfBirth).toBe(visibility === ProfileVisibility.PUBLIC ? '1996-04-02' : null);
    expect(view.basic?.motherTongue).toBe('Telugu');
    expect(view.photos).toEqual(visibility === ProfileVisibility.PUBLIC ? ['photo'] : []);
  });

  it('gives a named share recipient the full biodata sheet', () => {
    const view = toBiodata({ id: 'a', displayName: 'Chakri', visibility,
      dateOfBirth: '1996-04-02', photos: ['photo'] } as Profile, basic, { recipient: true });
    expect(view.dateOfBirth).toBe('1996-04-02');
    expect(view.photos).toEqual(['photo']);
    expect(view.basic?.motherTongue).toBe('Telugu');
  });

  it('applies visibility to a steward viewing a managed client from Interests', async () => {
    const agent = { userId: 'agent-1', role: UserRole.AGENT } as AuthUser;
    const clientA = { id: 'client-a', userId: 'user-a', managedByUserId: agent.userId };
    const clientB = {
      id: 'client-b',
      userId: 'user-b',
      managedByUserId: agent.userId,
      visibility,
      lifecycle: ProfileLifecycle.ACTIVE,
      displayName: 'Chakri chandhu',
      dateOfBirth: '2004-02-10',
      photos: ['photo-1', 'photo-2'],
    } as Profile;
    const service = new ProfileDetailsService(
      { findOne: async () => basic, find: async () => [{ ...basic, profileId: clientB.id }] } as never,
      { find: async () => [] } as never,
      { find: async () => [] } as never,
      {
        findOne: async () => clientB,
        find: async () => [clientA, clientB],
      } as never,
      { findOne: async () => ({ id: agent.userId, role: agent.role }) } as never,
      {} as never,
      {} as never,
      {
        findOne: async () => null,
      } as never,
      {} as never,
      {} as never,
    );
    const response = await new ProfileDetailsController(service).view(agent, clientB.id);
    if (visibility === ProfileVisibility.PUBLIC) {
      expect(response.accessLevel).toBe('full');
      expect(response.limited).toBe(false);
    } else {
      expect(response.accessLevel).toBe('basic');
      expect(response.limited).toBe(true);
      // A steward controls the client, so even a PRIVATE one opens, as the
      // basic view with its lead photo.
      expect(response.profile.photos).toEqual(['photo-1']);
    }
  });
});
