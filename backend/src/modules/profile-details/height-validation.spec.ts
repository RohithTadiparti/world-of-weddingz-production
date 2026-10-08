import { ValidationPipe } from '@nestjs/common';
import { PersonalDetailsDto, PartnerPreferencesDto, ProfilePhotoDto } from './dto/profile-details.dto';
import { SuggestionsQueryDto } from '../matchmaking/dto/matchmaking.dto';
import { parseHeightCmQuery } from '../../common/util/height';

describe('Biodata height and photo API validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
  const personal = { firstName: 'Ada', lastName: 'Rao', complexion: 'wheatish', communicationAddress: 'Test address' };
  const preferences = { preferredAgeMin: 20, preferredAgeMax: 30, preferredHeightMinCm: 91, preferredHeightMaxCm: 244 };

  it.each([168, 170, 178, 180])('accepts %s cm across write and filter DTOs', async (heightCm) => {
    await expect(pipe.transform({ ...personal, heightCm }, { type: 'body', metatype: PersonalDetailsDto })).resolves.toMatchObject({ heightCm });
    await expect(pipe.transform({ ...preferences, preferredHeightMinCm: heightCm }, { type: 'body', metatype: PartnerPreferencesDto })).resolves.toBeDefined();
    await expect(pipe.transform({ heightMinCm: String(heightCm) }, { type: 'query', metatype: SuggestionsQueryDto })).resolves.toMatchObject({ heightMinCm: heightCm });
  });

  it.each(['abc', '', null, undefined, 90, 245, 168.5, '168.5', NaN, Infinity])('rejects invalid required height %s', async (heightCm) => {
    await expect(pipe.transform({ ...personal, heightCm }, { type: 'body', metatype: PersonalDetailsDto })).rejects.toThrow();
    await expect(pipe.transform({ ...preferences, preferredHeightMinCm: heightCm }, { type: 'body', metatype: PartnerPreferencesDto })).rejects.toThrow();
  });

  it.each(['', 'abc', '-168', '168.5', '1.68e2', '0xA8', ' 168 ', '245'])('rejects malformed height filter %s', async (heightMinCm) => {
    await expect(pipe.transform({ heightMinCm }, { type: 'query', metatype: SuggestionsQueryDto })).rejects.toThrow();
  });

  it('allows an omitted optional filter and parses whole-centimetre query strings', async () => {
    await expect(pipe.transform({}, { type: 'query', metatype: SuggestionsQueryDto })).resolves.toBeDefined();
    expect(parseHeightCmQuery('168')).toBe(168);
    expect(parseHeightCmQuery('168.5')).toBe('168.5');
  });

  it('accepts both local upload URLs and durable private-storage references', async () => {
    for (const url of ['http://localhost:3000/mock-storage/photo.jpg', 'media://users/u1/profile/photo.jpg']) {
      await expect(pipe.transform({ url }, { type: 'body', metatype: ProfilePhotoDto })).resolves.toMatchObject({ url });
    }
    await expect(pipe.transform({ url: 'javascript:alert(1)' }, { type: 'body', metatype: ProfilePhotoDto })).rejects.toThrow();
    await expect(pipe.transform({ url: 'ftp://example.com/photo.jpg' }, { type: 'body', metatype: ProfilePhotoDto })).rejects.toThrow();
    // Well-formed is not enough: it has to be one of the platform's own uploads.
    await expect(pipe.transform({ url: 'https://evil.example.com/x.jpg' }, { type: 'body', metatype: ProfilePhotoDto })).rejects.toThrow();
  });
});
