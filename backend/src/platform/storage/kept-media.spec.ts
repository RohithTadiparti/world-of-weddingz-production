import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpsertAgencyDto } from '../../modules/agents/dto/agency.dto';
import { UpdateVendorDto } from '../../modules/vendors/dto/vendor.dto';
import { UpdateEventDto } from '../../modules/events/dto/event.dto';
import { AddMediaItemDto } from '../../modules/media/dto/media.dto';
import { assertMediaValueUploaded, assertNewMediaUploaded, unacceptedMedia } from './kept-media';
import { UploadedMediaRecogniser, configureUploadedMedia } from './uploaded-media';

const KEY = 'users/5b1d0000-0000-4000-8000-000000000001/profile/1767000000000-3f2a9c1d2e3f4a5b-photo.jpg';
const UPLOADED = `https://wow.test/api/mock-storage/${KEY}`;
const REF = `media://${KEY}`;
const LEGACY = 'https://photos.example.com/old.jpg';
const FOREIGN = 'https://evil.example.com/new.jpg';

/**
 * A list resent whole keeps the outside links it already held; only what is
 * new has to be an upload (ISS-06 follow-up).
 */
describe('kept media', () => {
  beforeAll(() => {
    configureUploadedMedia(
      new UploadedMediaRecogniser({ cdnBaseUrl: '', mockBaseUrl: 'https://wow.test/api/mock-storage' }),
    );
  });

  describe('unacceptedMedia', () => {
    it('lets through uploads and entries already stored, and nothing else', () => {
      expect(unacceptedMedia([UPLOADED, REF, LEGACY, FOREIGN], [LEGACY])).toEqual([FOREIGN]);
    });

    it('compares stored entries byte for byte', () => {
      expect(unacceptedMedia([`${LEGACY}?x=1`, LEGACY.toUpperCase()], [LEGACY])).toHaveLength(2);
    });

    it('accepts a single stored value, a list, or nothing as the stored side', () => {
      expect(unacceptedMedia([LEGACY], LEGACY)).toEqual([]);
      expect(unacceptedMedia([LEGACY], [null, undefined, LEGACY])).toEqual([]);
      expect(unacceptedMedia([LEGACY], null)).toEqual([LEGACY]);
      expect(unacceptedMedia([LEGACY], undefined)).toEqual([LEGACY]);
    });

    it('never treats a non-string as stored', () => {
      expect(unacceptedMedia([42, null], ['42'])).toEqual([42, null]);
    });
  });

  describe('assertNewMediaUploaded', () => {
    it('passes a resent list that still holds an older outside link', () => {
      expect(() => assertNewMediaUploaded('photos', [LEGACY, UPLOADED], [LEGACY])).not.toThrow();
    });

    it('passes an empty or absent list', () => {
      expect(() => assertNewMediaUploaded('photos', [], [])).not.toThrow();
      expect(() => assertNewMediaUploaded('photos', undefined, [])).not.toThrow();
      expect(() => assertNewMediaUploaded('photos', null, [])).not.toThrow();
    });

    it('refuses a new outside link with the validation pipe wording', () => {
      try {
        assertNewMediaUploaded('photos', [LEGACY, FOREIGN], [LEGACY]);
        throw new Error('expected a refusal');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          message: ['each value in photos must be a file uploaded here'],
        });
      }
    });

    it('prefixes a nested path', () => {
      expect(() => assertNewMediaUploaded('photos', [FOREIGN], [], 'weddings.2.')).toThrow(
        new BadRequestException(['weddings.2.each value in photos must be a file uploaded here']),
      );
    });

    it('refuses a link that was stored on a different record', () => {
      expect(() => assertNewMediaUploaded('photos', [LEGACY], [])).toThrow(BadRequestException);
    });
  });

  describe('assertMediaValueUploaded', () => {
    it('keeps an unchanged value and accepts a new upload', () => {
      expect(() => assertMediaValueUploaded('imageUrl', LEGACY, LEGACY)).not.toThrow();
      expect(() => assertMediaValueUploaded('imageUrl', UPLOADED, LEGACY)).not.toThrow();
      expect(() => assertMediaValueUploaded('imageUrl', REF, null)).not.toThrow();
    });

    it('lets a clear or an omitted value through for the caller to handle', () => {
      expect(() => assertMediaValueUploaded('imageUrl', null, LEGACY)).not.toThrow();
      expect(() => assertMediaValueUploaded('imageUrl', undefined, LEGACY)).not.toThrow();
    });

    it('refuses a changed value that is not an upload', () => {
      expect(() => assertMediaValueUploaded('imageUrl', FOREIGN, LEGACY)).toThrow(
        new BadRequestException(['imageUrl must be a file uploaded here']),
      );
    });
  });

  describe('the DTO side', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    it('lets a resend field carry an outside link through to the service', async () => {
      await expect(
        pipe.transform({ agencyName: 'Agency', pictures: [LEGACY] }, { type: 'body', metatype: UpsertAgencyDto }),
      ).resolves.toBeDefined();
      await expect(
        pipe.transform({ portfolio: [LEGACY], complianceDocuments: [LEGACY] }, { type: 'body', metatype: UpdateVendorDto }),
      ).resolves.toBeDefined();
      await expect(
        pipe.transform({ imageUrl: LEGACY }, { type: 'body', metatype: UpdateEventDto }),
      ).resolves.toBeDefined();
    });

    it('still refuses something that is not a URL at all', async () => {
      for (const bad of ['javascript:alert(1)', '/relative.jpg', 'ftp://x.example.com/a.jpg']) {
        await expect(
          pipe.transform({ portfolio: [bad] }, { type: 'body', metatype: UpdateVendorDto }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('keeps add-one fields strict at the DTO', async () => {
      await expect(
        pipe.transform({ url: LEGACY }, { type: 'body', metatype: AddMediaItemDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
