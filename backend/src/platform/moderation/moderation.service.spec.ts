import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationService } from './moderation.service';
import { HeuristicImageModerationProvider } from './image-moderation.provider';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../../modules/users/users.service';
import { Profile } from '../../modules/users/entities/profile.entity';
import { Interest } from '../../modules/matchmaking/entities/interest.entity';
import { Booking } from '../../modules/bookings/entities/booking.entity';
import { SupportCase } from '../../modules/verification/entities/support-case.entity';
import { Vendor } from '../../modules/vendors/entities/vendor.entity';
import { PlannerProfile } from '../../modules/wedding-planners/entities/planner-profile.entity';
import { Notification } from '../../modules/notifications/entities/notification.entity';
import { User } from '../../modules/auth/entities/user.entity';
import { ProfileDetails } from '../../modules/profile-details/entities/profile-details.entity';
import { AgentProfile } from '../../modules/agents/entities/agent-profile.entity';
import { ProfileDetailsService } from '../../modules/profile-details/profile-details.service';
import { ProfileSibling } from '../../modules/profile-details/entities/profile-sibling.entity';
import { ProfileAsset } from '../../modules/profile-details/entities/profile-asset.entity';
import { MediaService } from '../../modules/media/media.service';
import { MediaAccessService } from '../../modules/media/media-access.service';
import { Album } from '../../modules/media/entities/album.entity';
import { MediaItem } from '../../modules/media/entities/media-item.entity';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import { AiService } from '../../modules/ai/ai.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';

/** A PNG straight out of Automatic1111: its settings line in a `parameters` chunk. */
function generatedPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    chunk('tEXt', Buffer.from('parameters\0a woman\nSteps: 20, Sampler: Euler a, CFG scale: 7', 'latin1')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CLEAN_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);

const bride: AuthUser = { userId: 'u1', email: 'u1@example.com', role: UserRole.BRIDE, managedByAgentId: null };

function moderation(files: Record<string, Buffer | Error> = {}) {
  const audit = { record: jest.fn(async () => undefined) };
  const storage = {
    readStart: jest.fn(async (url: string) => {
      const file = files[url];
      if (file instanceof Error) throw file;
      return file ?? null;
    }),
    keyOf: jest.fn(() => null),
    signedUrl: jest.fn(),
    storedForm: (u: string) => u,
  };
  const service = new ModerationService(
    new HeuristicImageModerationProvider(),
    audit as unknown as AuditService,
    storage as unknown as StorageService,
  );
  return { service, audit, storage };
}

describe('ModerationService', () => {
  it('reads the stored file and refuses a generated one, saying what to do instead', async () => {
    const { service, audit, storage } = moderation({ 'media://users/u1/profile/1-a-me.png': generatedPng() });
    const attempt = service.assertGenuinePhoto('media://users/u1/profile/1-a-me.png', { userId: 'u1', kind: 'profile' });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'This looks like an AI-generated image. Please upload a genuine photo of yourself.',
    );
    expect(storage.readStart).toHaveBeenCalledWith('media://users/u1/profile/1-a-me.png', expect.any(Number));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'image',
        metadata: expect.objectContaining({ kind: 'profile', marker: expect.stringContaining('parameters') }),
      }),
    );
  });

  it('allows a clean photograph', async () => {
    const { service } = moderation({ 'media://users/u1/profile/1-a-me.jpg': CLEAN_JPEG });
    await expect(service.assertGenuinePhoto('media://users/u1/profile/1-a-me.jpg', { kind: 'biodata' })).resolves.toBeUndefined();
  });

  it('does not refuse a photograph because the store could not be read', async () => {
    const { service } = moderation({ 'media://users/u1/profile/1-a-me.jpg': new Error('store down') });
    await expect(service.assertGenuinePhoto('media://users/u1/profile/1-a-me.jpg', { kind: 'profile' })).resolves.toBeUndefined();
  });

  it('checks only the photographs a save adds', async () => {
    const { service, storage } = moderation({ 'media://new.png': generatedPng() });
    await expect(service.assertGenuinePhotos(['media://old.jpg'], ['media://old.jpg'], { kind: 'profile' })).resolves.toBeUndefined();
    expect(storage.readStart).not.toHaveBeenCalled();
    await expect(
      service.assertGenuinePhotos(['media://old.jpg', 'media://new.png'], ['media://old.jpg'], { kind: 'profile' }),
    ).rejects.toThrow('AI-generated');
  });
});

/*
 * Every place a photograph of a person is attached checks it before anything
 * is saved. One test per attach point, against the real service with its
 * stores stubbed, so a refactor that drops the call fails here.
 */
describe('profile photograph attach points', () => {
  const refuse = () => ({
    assertGenuinePhoto: jest.fn(async () => {
      throw new BadRequestException('This looks like an AI-generated image. Please upload a genuine photo of yourself.');
    }),
    assertGenuinePhotos: jest.fn(async () => {
      throw new BadRequestException('This looks like an AI-generated image. Please upload a genuine photo of yourself.');
    }),
  });

  it("the account holder's own profile form (PUT /users/me/profile)", async () => {
    const profiles = { findOne: jest.fn(async () => ({ userId: 'u1', photos: ['media://old.jpg'] })), save: jest.fn(), create: jest.fn() };
    const mod = refuse();
    const repos = [Profile, Interest, Booking, SupportCase, Vendor, PlannerProfile, Notification, User, ProfileDetails, AgentProfile];
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        ...repos.map((entity) => ({ provide: getRepositoryToken(entity), useValue: entity === Profile ? profiles : {} })),
        { provide: ModerationService, useValue: mod },
      ],
    }).compile();
    const users = module.get(UsersService);

    await expect(users.upsert('u1', { photos: ['media://old.jpg', 'media://new.png'] }, UserRole.BRIDE)).rejects.toThrow('AI-generated');
    expect(mod.assertGenuinePhotos).toHaveBeenCalledWith(['media://old.jpg', 'media://new.png'], ['media://old.jpg'], {
      userId: 'u1',
      kind: 'profile',
    });
    expect(profiles.save).not.toHaveBeenCalled();

    // A save that does not touch the photographs does not run the check.
    mod.assertGenuinePhotos.mockClear();
    profiles.save.mockImplementation(async (p) => p);
    await users.upsert('u1', { bio: 'Hello' }, UserRole.BRIDE);
    expect(mod.assertGenuinePhotos).not.toHaveBeenCalled();
  });

  it('the biodata gallery (POST /profiles/:id/details/photos)', async () => {
    const profiles = { findOne: jest.fn(async () => ({ id: 'p1', userId: 'u1', photos: [] })), save: jest.fn() };
    const details = { findOne: jest.fn(async () => null), create: jest.fn((v) => v), save: jest.fn() };
    const mod = refuse();
    const service = new ProfileDetailsService(
      details as unknown as Repository<ProfileDetails>,
      {} as Repository<ProfileSibling>,
      {} as Repository<ProfileAsset>,
      profiles as unknown as Repository<Profile>,
      {} as Repository<User>,
      {} as RedisService,
      mod as unknown as ModerationService,
      {} as Repository<Interest>,
      {} as AiService,
      {} as StorageService,
    );
    await expect(service.addPhoto(bride, 'p1', 'media://users/u1/profile/x.png')).rejects.toThrow('AI-generated');
    expect(mod.assertGenuinePhoto).toHaveBeenCalledWith('media://users/u1/profile/x.png', { userId: 'u1', kind: 'biodata' });
    expect(profiles.save).not.toHaveBeenCalled();
  });

  describe('the upload itself, when declared a profile photograph (POST /media/complete)', () => {
    const key = 'users/u1/profile/1767000000000-0123456789abcdef-me.png';
    const setup = () => {
      const storage = {
        verifyUpload: jest.fn(async (k: string) => ({
          key: k,
          ref: `media://${k}`,
          url: `https://store/${k}`,
          size: 10,
          contentType: k.endsWith('.pdf') ? 'application/pdf' : 'image/png',
        })),
        driver: { delete: jest.fn(async () => undefined) },
      };
      const access = { canUpload: jest.fn(async () => true) };
      const mod = refuse();
      const media = new MediaService(
        {} as Repository<Album>,
        {} as Repository<MediaItem>,
        storage as unknown as StorageService,
        access as unknown as MediaAccessService,
        {} as AppConfigService,
        mod as unknown as ModerationService,
      );
      return { media, storage, mod };
    };

    it('refuses a generated photograph and deletes it', async () => {
      const { media, storage, mod } = setup();
      await expect(media.completeUpload(bride, key, undefined, 'profile_photo')).rejects.toThrow('AI-generated');
      expect(mod.assertGenuinePhoto).toHaveBeenCalledWith(`media://${key}`, { userId: 'u1', kind: 'profile' });
      expect(storage.driver.delete).toHaveBeenCalledWith(key);
    });

    it('leaves other uploads alone: no purpose, or not an image', async () => {
      const { media, mod } = setup();
      await expect(media.completeUpload(bride, key)).resolves.toMatchObject({ key });
      await expect(
        media.completeUpload(bride, 'users/u1/attachments/1767000000000-0123456789abcdef-a.pdf', undefined, 'profile_photo'),
      ).resolves.toMatchObject({ contentType: 'application/pdf' });
      expect(mod.assertGenuinePhoto).not.toHaveBeenCalled();
    });
  });
});
