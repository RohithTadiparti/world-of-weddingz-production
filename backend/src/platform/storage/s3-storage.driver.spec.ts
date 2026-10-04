import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3StorageDriver } from './s3-storage.driver';
import { StorageSettings } from './storage-config';

const settings = (overrides: Partial<StorageSettings> = {}): StorageSettings => ({
  storageProvider: 's3',
  s3Bucket: 'wow-media',
  s3Region: 'ap-south-1',
  s3AccessKeyId: 'AKIAEXAMPLEEXAMPLE',
  s3SecretAccessKey: 'secret/example/secret/example',
  s3Endpoint: '',
  s3PublicEndpoint: '',
  s3ForcePathStyle: false,
  presignExpirySeconds: 900,
  getExpirySeconds: 3600,
  maxFileSizeBytes: 10 * 1024 * 1024,
  cdnBaseUrl: '',
  mockBaseUrl: '',
  mockStorageDir: '/tmp',
  ...overrides,
});

const KEY = 'users/5b1d6c2e-1f7a-4c1e-9a53-0d2f3c4b5a61/profile/1767000000000-abcdef0123456789-photo.jpg';

describe('S3StorageDriver', () => {
  describe('with the SDK client mocked', () => {
    const send = jest.fn();
    const client = { send } as unknown as S3Client;
    const presign = jest.fn().mockResolvedValue('https://signed.example/url');
    const driver = () => new S3StorageDriver(settings(), { client }, presign);

    beforeEach(() => {
      send.mockReset();
      presign.mockClear();
    });

    it('signs the size and type into an upload slot when they are known', async () => {
      const out = await driver().presignPut(KEY, { contentType: 'image/jpeg', size: 1234 });

      const [, command, options] = presign.mock.calls[0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'wow-media',
        Key: KEY,
        ContentType: 'image/jpeg',
        ContentLength: 1234,
      });
      expect(options.expiresIn).toBe(900);
      expect([...options.signableHeaders].sort()).toEqual(['content-length', 'content-type']);
      expect(out).toEqual({ url: 'https://signed.example/url', headers: { 'Content-Type': 'image/jpeg' } });
    });

    it('serves an object as the type its name says, whatever was uploaded', async () => {
      await driver().urlFor(KEY, { downloadName: 'sangeet 1.jpg' });
      const [, command, options] = presign.mock.calls[0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'wow-media',
        Key: KEY,
        ResponseContentType: 'image/jpeg',
        ResponseContentDisposition: 'attachment; filename="sangeet_1.jpg"',
      });
      expect(options.expiresIn).toBe(3600);
    });

    it('signs a short-lived link at the moment it is asked for', async () => {
      const at = Date.UTC(2026, 8, 19, 10, 17, 5);
      await driver().urlFor(KEY, { expiresInSeconds: 300 }, at);
      const [, , options] = presign.mock.calls[0];
      expect(options.expiresIn).toBe(300);
      expect(options.signingDate).toEqual(new Date(at));
    });

    it('never lets a requested life outlast the usual one', async () => {
      await driver().urlFor(KEY, { expiresInSeconds: 999999 });
      const [, , options] = presign.mock.calls[0];
      expect(options.expiresIn).toBe(3600);
    });

    it('reads an object back', async () => {
      send.mockResolvedValue({ ContentLength: 42, ContentType: 'image/png' });
      await expect(driver().head(KEY)).resolves.toEqual({ size: 42, contentType: 'image/png' });
      expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('answers null for an object that is not there', async () => {
      send.mockRejectedValue(Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
      await expect(driver().head(KEY)).resolves.toBeNull();
    });

    it('does not mistake an outage for a missing object', async () => {
      send.mockRejectedValue(Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 503 } }));
      await expect(driver().head(KEY)).rejects.toThrow('boom');
    });

    it('deletes', async () => {
      send.mockResolvedValue({});
      await driver().delete(KEY);
      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
      expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'wow-media', Key: KEY });
    });
  });

  /*
   * The real signer, offline. Presigning is arithmetic over the credentials and
   * touches no network, so what a browser will actually be handed can be
   * checked without a bucket.
   */
  describe('the URLs it hands out', () => {
    it('makes an upload URL a browser can use', async () => {
      const url = new URL(await new S3StorageDriver(settings()).presignPut(KEY, { size: 10, contentType: 'image/jpeg' }).then((p) => p.url));

      expect(url.host).toBe('wow-media.s3.ap-south-1.amazonaws.com');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
      // A checksum parameter would demand a header no browser can compute.
      expect([...url.searchParams.keys()].some((k) => /checksum/i.test(k))).toBe(false);
    });

    it('hands out the same viewing link throughout a window, so browsers can cache it', async () => {
      const driver = new S3StorageDriver(settings());
      const at = Date.UTC(2026, 8, 19, 10, 0, 5);
      const a = await driver.urlFor(KEY, {}, at);
      const b = await driver.urlFor(KEY, {}, at + 20 * 60 * 1000);
      const c = await driver.urlFor(KEY, {}, at + 31 * 60 * 1000);
      expect(a).toBe(b);
      expect(c).not.toBe(a);
      expect(new URL(a).searchParams.get('response-content-type')).toBe('image/jpeg');
    });

    it('recognises its own links and turns them back into keys', async () => {
      const driver = new S3StorageDriver(settings());
      expect(driver.keyFromUrl(await driver.urlFor(KEY))).toBe(KEY);
      expect(driver.keyFromUrl(`https://s3.ap-south-1.amazonaws.com/wow-media/${KEY}`)).toBe(KEY);
      expect(driver.keyFromUrl(`https://other-bucket.s3.ap-south-1.amazonaws.com/${KEY}`)).toBeNull();
      expect(driver.keyFromUrl('https://cdn.example.com/a.jpg')).toBeNull();
      expect(driver.keyFromUrl('not a url')).toBeNull();
    });

    it('signs for the address a browser reaches, and still recognises both', async () => {
      const driver = new S3StorageDriver(
        settings({
          s3Endpoint: 'http://minio:9000',
          s3PublicEndpoint: 'http://localhost:9100',
          s3ForcePathStyle: true,
        }),
      );
      const url = await driver.urlFor(KEY);
      expect(url.startsWith(`http://localhost:9100/wow-media/${KEY}?`)).toBe(true);
      expect(driver.keyFromUrl(url)).toBe(KEY);
      expect(driver.keyFromUrl(`http://minio:9000/wow-media/${KEY}`)).toBe(KEY);
    });
  });
});
