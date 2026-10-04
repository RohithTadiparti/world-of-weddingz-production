import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { AppConfigService } from '../../config/app-config.service';
import { StorageService } from './storage.service';
import { StorageSettings } from './storage-config';
import { PutOptions, StorageDriver } from './storage.driver';

const settings = (overrides: Partial<StorageSettings> = {}): StorageSettings => ({
  storageProvider: 'mock',
  s3Bucket: '',
  s3Region: '',
  s3AccessKeyId: '',
  s3SecretAccessKey: '',
  s3Endpoint: '',
  s3PublicEndpoint: '',
  s3ForcePathStyle: false,
  presignExpirySeconds: 900,
  getExpirySeconds: 3600,
  maxFileSizeBytes: 1000,
  cdnBaseUrl: '',
  mockBaseUrl: 'http://localhost:8085/api/mock-storage',
  mockStorageDir: mkdtempSync(join(tmpdir(), 'wow-media-')),
  ...overrides,
});
const cfg = (media: StorageSettings) => ({ media }) as unknown as AppConfigService;

const KEY = 'users/u-1/profile/1767000000000-abcdef0123456789-photo.jpg';
const BOOKING_KEY = 'bookings/b-1/deliveries/1767000000000-abcdef0123456789-sangeet.jpg';

/** A private store whose links say which key they are for. */
function privateStore(overrides: Partial<StorageSettings> = {}) {
  const driver: jest.Mocked<StorageDriver> = {
    name: 's3',
    private: true,
    presignPut: jest.fn(async (key: string, options: PutOptions) => {
      const headers: Record<string, string> = {};
      if (options.contentType) headers['Content-Type'] = options.contentType;
      return { url: `https://bucket/${key}?put`, headers };
    }),
    urlFor: jest.fn(async (key: string) => `https://bucket/${key}?X-Amz-Signature=sig`),
    keyFromUrl: jest.fn((url: string) =>
      url.startsWith('https://bucket/') ? url.slice('https://bucket/'.length).split('?')[0] : null,
    ),
    head: jest.fn(),
    delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
  const s = settings({ storageProvider: 's3', s3Bucket: 'b', s3Region: 'r', ...overrides });
  return { driver, storage: new StorageService(cfg(s), driver) };
}

describe('StorageService', () => {
  it('will not start on a configuration it cannot use', () => {
    expect(() => new StorageService(cfg(settings({ storageProvider: 's3' })))).toThrow(/S3_BUCKET/);
  });

  describe('on the local store', () => {
    const storage = (overrides: Partial<StorageSettings> = {}) => new StorageService(cfg(settings(overrides)));

    it('hands out the same permanent URL to upload to and to store', async () => {
      const r = await storage().presignUpload(KEY);
      expect(r.uploadUrl).toBe(`http://localhost:8085/api/mock-storage/${KEY}`);
      expect(r.publicUrl).toBe(r.uploadUrl);
      expect(r.ref).toBe(r.uploadUrl);
    });

    /*
     * A phone on the same Wi-Fi. The configured base on a local stack is
     * loopback, and a phone handed an upload URL on its own loopback failed
     * every photograph at the PUT.
     */
    it('points a phone at the address it reached, keeping the storage path', async () => {
      const r = await storage().presignUpload(KEY, { requestOrigin: 'http://192.168.31.178:8085' });
      expect(r.uploadUrl).toBe(`http://192.168.31.178:8085/api/mock-storage/${KEY}`);
    });

    /*
     * A private address is a real deployment (a staging box, an internal load
     * balancer) and the request origin comes from Host / X-Forwarded-Host,
     * which the client controls. Trusting it there would let one user store a
     * photo URL pointing at a host of their choosing for everyone else to load.
     */
    it('keeps a configured private storage address rather than the request origin', async () => {
      const r = await storage({
        mockBaseUrl: 'http://192.168.0.55:3000/api/mock-storage',
      }).presignUpload(KEY, { requestOrigin: 'http://attacker.example:8085' });
      expect(r.uploadUrl).toBe(`http://192.168.0.55:3000/api/mock-storage/${KEY}`);
      expect(r.publicUrl).toBe(r.uploadUrl);
    });

    it.each(['http://127.0.0.1:8085/api/mock-storage', 'http://[::1]:8085/api/mock-storage'])(
      'treats %s as loopback too',
      async (mockBaseUrl) => {
        const r = await storage({ mockBaseUrl }).presignUpload(KEY, { requestOrigin: 'http://192.168.31.178:8085' });
        expect(r.uploadUrl.startsWith('http://192.168.31.178:8085/api/mock-storage/')).toBe(true);
      },
    );

    it('never overrides a real configured address or a CDN', async () => {
      const real = await storage({ mockBaseUrl: 'https://wow.example.org/api/mock-storage' }).presignUpload(KEY, {
        requestOrigin: 'http://192.168.31.178:8085',
      });
      expect(real.uploadUrl.startsWith('https://wow.example.org/api/mock-storage/')).toBe(true);
      const cdn = await storage({ cdnBaseUrl: 'https://cdn.example.com' }).presignUpload(KEY, {
        requestOrigin: 'http://192.168.31.178:8085',
      });
      expect(cdn.publicUrl).toBe(`https://cdn.example.com/${KEY}`);
    });

    it('ignores an origin that is not a URL', async () => {
      const r = await storage().presignUpload(KEY, { requestOrigin: 'not a url' });
      expect(r.uploadUrl.startsWith('http://localhost:8085/api/mock-storage/')).toBe(true);
    });

    it('does not ask an old client for the size', async () => {
      await expect(storage().presignUpload(KEY)).resolves.toBeDefined();
    });

    it('stores and returns values exactly as they are', async () => {
      const s = storage();
      const body = { photos: ['https://bucket/x.jpg?X-Amz-Signature=1', 'media://users/u/profile/a.jpg'] };
      expect(s.normaliseDeep(body)).toBe(body);
      await expect(s.signDeep(body)).resolves.toBe(body);
    });

    it('verifies an upload from the file on disk, and removes one that is too large', async () => {
      const s = settings();
      const small = join(s.mockStorageDir, KEY);
      mkdirSync(dirname(small), { recursive: true });
      writeFileSync(small, Buffer.alloc(10));
      await expect(new StorageService(cfg(s)).verifyUpload(KEY)).resolves.toMatchObject({
        size: 10,
        contentType: 'image/jpeg',
      });

      const bigKey = KEY.replace('photo', 'big');
      writeFileSync(join(s.mockStorageDir, bigKey), Buffer.alloc(2000));
      await expect(new StorageService(cfg(s)).verifyUpload(bigKey)).rejects.toThrow(/too large/);
      expect(existsSync(join(s.mockStorageDir, bigKey))).toBe(false);
    });

    it('says so when nothing was uploaded', async () => {
      await expect(storage().verifyUpload(KEY)).rejects.toThrow(/Nothing has been uploaded/);
    });
  });

  describe('upload limits', () => {
    it('refuses a file over the limit before minting anything', async () => {
      const { storage, driver } = privateStore();
      await expect(storage.presignUpload(KEY, { size: 1001 })).rejects.toThrow(/too large/);
      expect(driver.presignPut).not.toHaveBeenCalled();
    });

    it('requires the size on a private store, where the slot would otherwise take 5 GB', async () => {
      await expect(privateStore().storage.presignUpload(KEY)).rejects.toThrow(/file size/);
    });

    it('refuses a type that does not fit the name', async () => {
      const { storage } = privateStore();
      await expect(storage.presignUpload(KEY, { size: 10, contentType: 'text/html' })).rejects.toThrow();
      await expect(storage.presignUpload(KEY, { size: 10, contentType: 'video/mp4' })).rejects.toThrow();
      await expect(storage.presignUpload(KEY, { size: 10, contentType: 'image/heic' })).resolves.toBeDefined();
    });

    it('refuses a bad key outright', async () => {
      await expect(privateStore().storage.presignUpload('../x.jpg', { size: 1 })).rejects.toThrow(/Bad object key/);
    });
  });

  describe('on a private store', () => {
    it('stores the reference and shows a signed link', async () => {
      const r = await privateStore().storage.presignUpload(KEY, { size: 10, contentType: 'image/jpeg' });
      expect(r.ref).toBe(`media://${KEY}`);
      expect(r.publicUrl).toBe(`https://bucket/${KEY}?X-Amz-Signature=sig`);
      expect(r.uploadUrl).toBe(`https://bucket/${KEY}?put`);
    });

    it('turns a signed link sent back into the reference it came from', () => {
      const { storage } = privateStore();
      const body = {
        name: 'Chaitra',
        photos: [`https://bucket/${KEY}?X-Amz-Signature=sig`, 'https://elsewhere.example/a.jpg'],
        nested: { evidence: [`media://${BOOKING_KEY}`] },
      };
      expect(storage.normaliseDeep(body)).toEqual({
        name: 'Chaitra',
        photos: [`media://${KEY}`, 'https://elsewhere.example/a.jpg'],
        nested: { evidence: [`media://${BOOKING_KEY}`] },
      });
      expect(body.photos[0]).toContain('X-Amz-Signature'); // not mutated
      expect([...storage.keysIn(body)].sort()).toEqual([BOOKING_KEY, KEY]);
    });

    it('signs every reference in a response, and nulls the ones the viewer may not see', async () => {
      const { storage } = privateStore();
      const when = new Date('2026-09-19T00:00:00Z');
      const response = {
        items: [
          { url: `media://${KEY}`, createdAt: when },
          { url: `media://${KEY}` },
        ],
        deliveryEvidence: [`media://${BOOKING_KEY}`],
        legacy: 'http://localhost:8085/api/mock-storage/uploads/u/old.jpg',
      };
      const out = await storage.signDeep(response, (key) => !key.startsWith('bookings/'));
      expect(out).toEqual({
        items: [
          { url: `https://bucket/${KEY}?X-Amz-Signature=sig`, createdAt: when },
          { url: `https://bucket/${KEY}?X-Amz-Signature=sig` },
        ],
        deliveryEvidence: [null],
        legacy: 'http://localhost:8085/api/mock-storage/uploads/u/old.jpg',
      });
      expect(out.items[0].createdAt).toBe(when);
      expect(response.items[0].url).toBe(`media://${KEY}`); // the original is untouched
    });

    it('checks an upload against what the store recorded, deleting a misnamed file', async () => {
      const { storage, driver } = privateStore();
      driver.head.mockResolvedValue({ size: 10, contentType: 'text/html' });
      await expect(storage.verifyUpload(KEY)).rejects.toThrow(/cannot be kept/);
      expect(driver.delete).toHaveBeenCalledWith(KEY);

      driver.head.mockResolvedValue({ size: 10, contentType: 'application/octet-stream' });
      await expect(storage.verifyUpload(KEY)).resolves.toMatchObject({ ref: `media://${KEY}`, size: 10 });
    });
  });
});
