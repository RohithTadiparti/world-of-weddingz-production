import { ValidationPipe } from '@nestjs/common';
import { ProfilePhotoDto, StoredPhotoDto } from '../../modules/profile-details/dto/profile-details.dto';
import {
  UploadedMediaRecogniser,
  configureUploadedMedia,
  isUploadedMedia,
} from './uploaded-media';

const KEY = 'users/5b1d0000-0000-4000-8000-000000000001/profile/1767000000000-3f2a9c1d2e3f4a5b-photo.jpg';

/**
 * Only what the platform's own storage handed out passes as an upload. A
 * well-formed URL to anywhere else used to be stored as a profile photo.
 */
describe('UploadedMediaRecogniser', () => {
  const live = new UploadedMediaRecogniser({
    cdnBaseUrl: '',
    mockBaseUrl: 'https://test.worldofweddingz.com/api/mock-storage',
  });

  it('accepts a media reference', () => {
    expect(live.matches(`media://${KEY}`)).toBe(true);
    expect(live.matches('media://../etc/passwd')).toBe(false);
  });

  it("accepts the local store's own public URL", () => {
    expect(live.matches(`https://test.worldofweddingz.com/api/mock-storage/${KEY}`)).toBe(true);
  });

  it.each([
    'https://evil.example.com/x.jpg',
    `https://evil.example.com/api/mock-storage/${KEY}`,
    `http://test.worldofweddingz.com/api/mock-storage/${KEY}`, // wrong scheme, so a different origin
    `https://test.worldofweddingz.com/other/${KEY}`,
    `https://test.worldofweddingz.com/api/mock-storage/`,
    `https://test.worldofweddingz.com/api/mock-storage/users/../../secret`,
    `https://user:pw@test.worldofweddingz.com/api/mock-storage/${KEY}`,
    'javascript:alert(1)',
    'ftp://test.worldofweddingz.com/api/mock-storage/x.jpg',
    '/api/mock-storage/x.jpg',
    '',
    42,
    null,
  ])('refuses %p', (value) => {
    expect(live.matches(value)).toBe(false);
  });

  it('accepts URLs under a configured CDN base', () => {
    const cdn = new UploadedMediaRecogniser({
      cdnBaseUrl: 'https://cdn.worldofweddingz.com',
      mockBaseUrl: 'https://app.worldofweddingz.com/api/mock-storage',
    });
    expect(cdn.matches(`https://cdn.worldofweddingz.com/${KEY}`)).toBe(true);
    expect(cdn.matches(`https://app.worldofweddingz.com/api/mock-storage/${KEY}`)).toBe(true);
    expect(cdn.matches(`https://cdn.example.com/${KEY}`)).toBe(false);
  });

  it('on a loopback-configured stack accepts the local and LAN origins the API rewrites to', () => {
    const dev = new UploadedMediaRecogniser({
      cdnBaseUrl: '',
      mockBaseUrl: 'http://localhost:8080/api/mock-storage',
    });
    for (const origin of [
      'http://localhost:8080',
      'http://127.0.0.1:41234',
      'http://192.168.31.178:8085',
      'http://10.0.2.2:3000',
    ]) {
      expect(dev.matches(`${origin}/api/mock-storage/${KEY}`)).toBe(true);
    }
    // Straight off the API port, without the web proxy's prefix.
    expect(dev.matches(`http://localhost:3000/mock-storage/${KEY}`)).toBe(true);
    expect(dev.matches(`https://evil.example.com/api/mock-storage/${KEY}`)).toBe(false);
    expect(dev.matches(`https://evil.example.com/mock-storage/${KEY}`)).toBe(false);
    expect(dev.matches('http://192.168.31.178:8085/x.jpg')).toBe(false);
  });

  it("on a private store accepts the bucket's own addresses, as the driver reads them", () => {
    const keyFromUrl = jest.fn((url: string) => (url.startsWith('https://wow-media.s3') ? KEY : null));
    const s3 = new UploadedMediaRecogniser(
      { cdnBaseUrl: '', mockBaseUrl: 'https://app.worldofweddingz.com/api/mock-storage' },
      { private: true, keyFromUrl },
    );
    expect(s3.matches(`https://wow-media.s3.us-east-1.amazonaws.com/${KEY}`)).toBe(true);
    // Objects stored before the deployment switched to S3 are still ours.
    expect(s3.matches(`https://app.worldofweddingz.com/api/mock-storage/${KEY}`)).toBe(true);
    expect(s3.matches('https://evil.example.com/x.jpg')).toBe(false);
  });

  it('never trusts the local driver to recognise its own path on another host', () => {
    const local = new UploadedMediaRecogniser(
      { cdnBaseUrl: '', mockBaseUrl: 'https://app.worldofweddingz.com/api/mock-storage' },
      { private: false, keyFromUrl: () => KEY },
    );
    expect(local.matches(`https://evil.example.com/api/mock-storage/${KEY}`)).toBe(false);
  });
});

describe('IsUploadedUrl on profile photographs', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
  const own = `https://test.worldofweddingz.com/api/mock-storage/${KEY}`;

  beforeAll(() =>
    configureUploadedMedia(
      new UploadedMediaRecogniser({
        cdnBaseUrl: '',
        mockBaseUrl: 'https://test.worldofweddingz.com/api/mock-storage',
      }),
    ),
  );
  afterAll(() =>
    configureUploadedMedia(
      new UploadedMediaRecogniser({ cdnBaseUrl: '', mockBaseUrl: 'http://localhost:8080/api/mock-storage' }),
    ),
  );

  const add = (url: string) => pipe.transform({ url }, { type: 'body', metatype: ProfilePhotoDto });

  it('accepts an uploaded photo and a media reference', async () => {
    await expect(add(own)).resolves.toEqual({ url: own });
    await expect(add(`media://${KEY}`)).resolves.toEqual({ url: `media://${KEY}` });
    expect(isUploadedMedia(own)).toBe(true);
  });

  it('refuses an outside URL with the photo message', async () => {
    await expect(add('https://evil.example.com/x.jpg')).rejects.toMatchObject({
      response: { message: expect.arrayContaining(['That is not an uploaded photo']) },
    });
  });

  it('still lets the owner name an outside photo stored earlier, to remove or reorder it', async () => {
    await expect(
      pipe.transform({ url: 'https://evil.example.com/x.jpg' }, { type: 'body', metatype: StoredPhotoDto }),
    ).resolves.toEqual({ url: 'https://evil.example.com/x.jpg' });
    await expect(
      pipe.transform({ url: 'javascript:alert(1)' }, { type: 'body', metatype: StoredPhotoDto }),
    ).rejects.toBeDefined();
  });
});
