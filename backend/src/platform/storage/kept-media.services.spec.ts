import { BadRequestException } from '@nestjs/common';
import { AgencyService } from '../../modules/agents/agency.service';
import { ManagedProfilesService } from '../../modules/agents/managed-profiles.service';
import { UsersService } from '../../modules/users/users.service';
import { VendorsService } from '../../modules/vendors/vendors.service';
import { WeddingPlannersService } from '../../modules/wedding-planners/wedding-planners.service';
import { EventsService } from '../../modules/events/events.service';
import { ProfileDetailsService } from '../../modules/profile-details/profile-details.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ProfileClaimStatus, UserRole } from '../../common/enums';
import { UploadedMediaRecogniser, configureUploadedMedia } from './uploaded-media';

const KEY = 'users/5b1d0000-0000-4000-8000-000000000001/profile/1767000000000-3f2a9c1d2e3f4a5b-photo.jpg';
const UPLOADED = `https://wow.test/api/mock-storage/${KEY}`;
const LEGACY = 'https://photos.example.com/old.jpg';
const LEGACY_COVER = 'https://photos.example.com/cover.jpg';
const FOREIGN = 'https://evil.example.com/new.jpg';

const none = {} as never;
const saveEcho = () => jest.fn(async (row: object) => row);

/**
 * Every form that resends a whole media list (or its one picture) can save
 * with an older outside link still in it, and cannot add a new one.
 */
describe('resending stored media', () => {
  beforeAll(() => {
    configureUploadedMedia(
      new UploadedMediaRecogniser({ cdnBaseUrl: '', mockBaseUrl: 'https://wow.test/api/mock-storage' }),
    );
  });

  describe('AgencyService.upsertOwn (office photographs)', () => {
    const setup = () => {
      const agencies = {
        findOne: jest.fn(async () => ({ id: 'a1', ownerUserId: 'u1', isApproved: true, pictures: [LEGACY] })),
        save: saveEcho(),
      };
      const service = new AgencyService(agencies as never, none, none, none, none, none);
      return { agencies, service };
    };

    it('keeps an older outside photograph and accepts a new upload', async () => {
      const { agencies, service } = setup();
      await service.upsertOwn('u1', { agencyName: 'Agency', pictures: [LEGACY, UPLOADED] });
      expect(agencies.save).toHaveBeenCalledWith(expect.objectContaining({ pictures: [LEGACY, UPLOADED] }));
    });

    it('refuses a new outside photograph and saves nothing', async () => {
      const { agencies, service } = setup();
      await expect(
        service.upsertOwn('u1', { agencyName: 'Agency', pictures: [LEGACY, FOREIGN] }),
      ).rejects.toThrow(new BadRequestException(['each value in pictures must be a file uploaded here']));
      expect(agencies.save).not.toHaveBeenCalled();
    });

    it('treats a first registration as having nothing stored', async () => {
      const { agencies, service } = setup();
      agencies.findOne.mockResolvedValueOnce(null as never);
      await expect(service.upsertOwn('u1', { agencyName: 'Agency', pictures: [LEGACY] })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('UsersService.upsert (profile photos)', () => {
    const setup = () => {
      const profiles = {
        findOne: jest.fn(async () => ({ id: 'p1', userId: 'u1', photos: [LEGACY] })),
        save: saveEcho(),
      };
      const moderation = { assertGenuinePhotos: jest.fn(async () => undefined) };
      const service = new UsersService(
        profiles as never,
        none, none, none, none, none, none, none, none, none,
        moderation as never,
      );
      return { profiles, moderation, service };
    };

    it('keeps an older outside photo in a resent list', async () => {
      const { profiles, service } = setup();
      await service.upsert('u1', { photos: [UPLOADED, LEGACY] });
      expect(profiles.save).toHaveBeenCalledWith(expect.objectContaining({ photos: [UPLOADED, LEGACY] }));
    });

    it('refuses a new outside photo before it is moderated or saved', async () => {
      const { profiles, moderation, service } = setup();
      await expect(service.upsert('u1', { photos: [LEGACY, FOREIGN] })).rejects.toThrow(
        new BadRequestException(['each value in photos must be a file uploaded here']),
      );
      expect(moderation.assertGenuinePhotos).not.toHaveBeenCalled();
      expect(profiles.save).not.toHaveBeenCalled();
    });
  });

  describe('ManagedProfilesService.update (managed profile photos)', () => {
    const admin: AuthUser = { userId: 'admin-1', email: 'a@x.in', role: UserRole.ADMIN, managedByAgentId: null };
    const setup = () => {
      const profiles = {
        findOne: jest.fn(async () => ({
          id: 'p1',
          managedByUserId: 'agent-1',
          claimStatus: ProfileClaimStatus.UNCLAIMED,
          photos: [LEGACY],
        })),
        save: saveEcho(),
      };
      const moderation = { assertGenuinePhotos: jest.fn(async () => undefined) };
      const service = new ManagedProfilesService(
        profiles as never,
        none, none, none, none, none, none, none,
        moderation as never,
      );
      return { profiles, service };
    };

    it('keeps an older outside photo', async () => {
      const { profiles, service } = setup();
      await service.update(admin, 'p1', { photos: [LEGACY, UPLOADED] });
      expect(profiles.save).toHaveBeenCalledWith(expect.objectContaining({ photos: [LEGACY, UPLOADED] }));
    });

    it('refuses a new outside photo', async () => {
      const { profiles, service } = setup();
      await expect(service.update(admin, 'p1', { photos: [FOREIGN] })).rejects.toThrow(BadRequestException);
      expect(profiles.save).not.toHaveBeenCalled();
    });
  });

  describe('VendorsService (portfolio and certificates)', () => {
    const setup = () => {
      const vendors = {
        findOne: jest.fn(async () => ({
          id: 'v1',
          ownerUserId: 'u1',
          portfolio: [LEGACY],
          complianceDocuments: [LEGACY_COVER],
        })),
        create: jest.fn((row: object) => row),
        save: saveEcho(),
      };
      const catalogCategories = { find: jest.fn(async () => [{ slug: 'decor' }]) };
      const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() };
      const lifecycle = { assertIdentityEditable: jest.fn() };
      const service = new VendorsService(
        vendors as never,
        catalogCategories as never,
        none, none, none, none, none, none, none,
        redis as never,
        none,
        lifecycle as never,
      );
      return { vendors, service };
    };

    it('saves an edit that resends older outside files with a new upload', async () => {
      const { vendors, service } = setup();
      await service.update('u1', 'v1', {
        portfolio: [LEGACY, UPLOADED],
        complianceDocuments: [LEGACY_COVER],
      });
      expect(vendors.save).toHaveBeenCalledWith(
        expect.objectContaining({ portfolio: [LEGACY, UPLOADED], complianceDocuments: [LEGACY_COVER] }),
      );
    });

    it('refuses a new outside file in either list', async () => {
      const { vendors, service } = setup();
      await expect(service.update('u1', 'v1', { portfolio: [LEGACY, FOREIGN] })).rejects.toThrow(
        new BadRequestException(['each value in portfolio must be a file uploaded here']),
      );
      await expect(service.update('u1', 'v1', { complianceDocuments: [LEGACY] })).rejects.toThrow(
        new BadRequestException(['each value in complianceDocuments must be a file uploaded here']),
      );
      expect(vendors.save).not.toHaveBeenCalled();
    });

    it('accepts no outside file on a new listing', async () => {
      const { vendors, service } = setup();
      await expect(
        service.create('u1', { name: 'Lotus', categories: ['decor'], portfolio: [LEGACY] } as never),
      ).rejects.toThrow(BadRequestException);
      expect(vendors.save).not.toHaveBeenCalled();
    });
  });

  describe('WeddingPlannersService.upsertOwn (portfolio and weddings)', () => {
    const setup = () => {
      const planners = {
        findOne: jest.fn(async () => ({
          id: 'pl1',
          ownerUserId: 'u1',
          isApproved: true,
          portfolio: [LEGACY],
          weddings: [
            { id: 'w1', title: 'Rahul & Priya', coverUrl: LEGACY_COVER, photos: [LEGACY], videos: [], events: [] },
          ],
        })),
        save: saveEcho(),
      };
      const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() };
      const service = new WeddingPlannersService(planners as never, none, redis as never, none);
      return { planners, service };
    };

    it('saves the whole listing back with its older outside pictures', async () => {
      const { planners, service } = setup();
      await service.upsertOwn('u1', {
        agencyName: 'Everafter',
        portfolio: [LEGACY, UPLOADED],
        weddings: [
          { id: 'w1', title: 'Rahul & Priya', coverUrl: LEGACY_COVER, photos: [LEGACY, UPLOADED] },
          // A wedding without an id may carry a picture another wedding holds.
          { title: 'Second', coverUrl: LEGACY, photos: [LEGACY_COVER] },
        ],
      });
      const saved = planners.save.mock.calls[0][0] as unknown as {
        portfolio: string[];
        weddings: { coverUrl: string; photos: string[] }[];
      };
      expect(saved.portfolio).toEqual([LEGACY, UPLOADED]);
      expect(saved.weddings.map((w) => [w.coverUrl, w.photos])).toEqual([
        [LEGACY_COVER, [LEGACY, UPLOADED]],
        [LEGACY, [LEGACY_COVER]],
      ]);
    });

    it('names the wedding whose new photo is not an upload', async () => {
      const { planners, service } = setup();
      await expect(
        service.upsertOwn('u1', {
          agencyName: 'Everafter',
          weddings: [
            { id: 'w1', title: 'Rahul & Priya', photos: [LEGACY] },
            { title: 'Second', photos: [FOREIGN] },
          ],
        }),
      ).rejects.toThrow(new BadRequestException(['weddings.1.each value in photos must be a file uploaded here']));
      expect(planners.save).not.toHaveBeenCalled();
    });

    it('refuses a new outside cover and a new outside portfolio picture', async () => {
      const { service } = setup();
      await expect(
        service.upsertOwn('u1', { agencyName: 'Everafter', weddings: [{ title: 'X', coverUrl: FOREIGN }] }),
      ).rejects.toThrow(new BadRequestException(['weddings.0.coverUrl must be a file uploaded here']));
      await expect(
        service.upsertOwn('u1', { agencyName: 'Everafter', portfolio: [FOREIGN] }),
      ).rejects.toThrow(new BadRequestException(['each value in portfolio must be a file uploaded here']));
    });
  });

  describe('EventsService.updateEvent (event picture)', () => {
    const setup = () => {
      const events = {
        findOne: jest.fn(async () => ({ id: 'e1', userId: 'u1', imageUrl: LEGACY })),
        save: saveEcho(),
      };
      const service = new EventsService(
        none,
        events as never,
        none, none, none, none, none, none, none, none, none, none, none, none, none, none, none, none,
      );
      return { events, service };
    };
    const host: AuthUser = { userId: 'u1', email: 'u1@x.in', role: UserRole.BRIDE, managedByAgentId: null };

    it('saves an edit that sends the older picture back unchanged', async () => {
      const { events, service } = setup();
      await service.updateEvent(host, 'e1', { imageUrl: LEGACY });
      expect(events.save).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: LEGACY }));
    });

    it('refuses a different outside picture', async () => {
      const { events, service } = setup();
      await expect(service.updateEvent(host, 'e1', { imageUrl: FOREIGN })).rejects.toThrow(
        new BadRequestException(['imageUrl must be a file uploaded here']),
      );
      expect(events.save).not.toHaveBeenCalled();
    });
  });

  describe('ProfileDetailsService horoscope document', () => {
    const owner: AuthUser = { userId: 'u1', email: 'u1@x.in', role: UserRole.BRIDE, managedByAgentId: null };
    const setup = () => {
      const details = {
        findOne: jest.fn(async () => ({
          profileId: 'p1',
          horoscopeDocumentUrl: LEGACY,
          primaryPhotoUrl: UPLOADED,
        })),
        create: jest.fn((row: object) => row),
        save: saveEcho(),
      };
      const profiles = { findOne: jest.fn(async () => ({ id: 'p1', userId: 'u1', managedByUserId: null })) };
      const redis = { raw: { scan: jest.fn(async () => ['0', []]) }, del: jest.fn() };
      const service = new ProfileDetailsService(
        details as never,
        none, none,
        profiles as never,
        none,
        redis as never,
        none, none, none, none,
      );
      return { details, service };
    };

    it('saves the horoscope section with the older chart still attached', async () => {
      const { details, service } = setup();
      await service.saveHoroscope(owner, 'p1', { horoscopeAvailable: true, horoscopeDocumentUrl: LEGACY });
      expect(details.save).toHaveBeenCalledWith(expect.objectContaining({ horoscopeDocumentUrl: LEGACY }));
    });

    it('refuses a new outside chart from either screen', async () => {
      const { details, service } = setup();
      await expect(
        service.saveHoroscope(owner, 'p1', { horoscopeAvailable: true, horoscopeDocumentUrl: FOREIGN }),
      ).rejects.toThrow(new BadRequestException(['horoscopeDocumentUrl must be a file uploaded here']));
      await expect(
        service.savePreferences(owner, 'p1', {
          preferredAgeMin: 25,
          preferredAgeMax: 30,
          preferredHeightMinCm: 150,
          preferredHeightMaxCm: 180,
          horoscopeDocumentUrl: FOREIGN,
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(details.save).not.toHaveBeenCalled();
    });
  });
});
