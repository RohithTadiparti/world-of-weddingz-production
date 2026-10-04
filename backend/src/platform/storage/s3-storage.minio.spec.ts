import { AppConfigService } from '../../config/app-config.service';
import { StorageService } from './storage.service';
import { StorageSettings } from './storage-config';
import { buildKey } from './storage-keys';

/**
 * The S3 driver against a real S3-compatible store.
 *
 * Skipped unless S3_E2E_ENDPOINT names one, so the ordinary suite needs no
 * network. To run it against the compose MinIO:
 *
 *   docker compose -f docker/docker-compose.yml --profile s3 up -d minio minio-init
 *   S3_E2E_ENDPOINT=http://localhost:9100 S3_E2E_ACCESS_KEY=wowminio \
 *     S3_E2E_SECRET_KEY=wowminio-local-only npx jest s3-storage.minio
 */
const endpoint = process.env.S3_E2E_ENDPOINT;
const suite = endpoint ? describe : describe.skip;

suite('S3 storage against a real bucket', () => {
  const media: StorageSettings = {
    storageProvider: 's3',
    s3Bucket: process.env.S3_E2E_BUCKET || 'wow-media',
    s3Region: 'us-east-1',
    s3AccessKeyId: process.env.S3_E2E_ACCESS_KEY || '',
    s3SecretAccessKey: process.env.S3_E2E_SECRET_KEY || '',
    s3Endpoint: endpoint || '',
    s3PublicEndpoint: '',
    s3ForcePathStyle: true,
    presignExpirySeconds: 300,
    getExpirySeconds: 600,
    maxFileSizeBytes: 1024 * 1024,
    cdnBaseUrl: '',
    mockBaseUrl: '',
    mockStorageDir: '',
  };
  const storage = new StorageService({ media } as unknown as AppConfigService);
  const photo = Buffer.from('\xff\xd8\xff\xe0 not really a jpeg, but its bytes are its own', 'latin1');
  const key = buildKey({ owner: 'bookings', id: '9c0e1d2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f', area: 'deliveries' }, 'Sangeet 01.jpg');

  afterAll(() => storage.driver.delete(key));

  it('uploads through a presigned PUT, the way a browser does', async () => {
    const slot = await storage.presignUpload(key, { size: photo.length, contentType: 'image/jpeg' });
    const put = await fetch(slot.uploadUrl, { method: 'PUT', body: photo, headers: slot.headers });
    expect(put.status).toBe(200);
    expect(slot.ref).toBe(`media://${key}`);
  });

  // One byte over. A much larger body is refused the same way (403), but the
  // store answers before reading it and Node's fetch then waits on the socket.
  it('refuses a body of any other length than the one signed', async () => {
    const other = buildKey({ owner: 'users', id: 'u-1', area: 'profile' }, 'big.jpg');
    const slot = await storage.presignUpload(other, { size: 10, contentType: 'image/jpeg' });
    const put = await fetch(slot.uploadUrl, { method: 'PUT', body: Buffer.alloc(11), headers: slot.headers });
    expect(put.ok).toBe(false);
    expect(await storage.driver.head(other)).toBeNull();
  });

  it('refuses a different content type than the one signed', async () => {
    const other = buildKey({ owner: 'users', id: 'u-1', area: 'profile' }, 'page.jpg');
    const slot = await storage.presignUpload(other, { size: 4, contentType: 'image/jpeg' });
    const put = await fetch(slot.uploadUrl, {
      method: 'PUT',
      body: Buffer.from('<h1>'),
      headers: { 'Content-Type': 'text/html' },
    });
    expect(put.ok).toBe(false);
  });

  it('verifies what landed', async () => {
    await expect(storage.verifyUpload(key)).resolves.toMatchObject({
      key,
      ref: `media://${key}`,
      size: photo.length,
      contentType: 'image/jpeg',
    });
  });

  it('keeps the object private', async () => {
    const bare = `${endpoint}/${media.s3Bucket}/${key}`;
    expect((await fetch(bare)).status).toBe(403);
  });

  it('serves it through a signed link, as the type its name says', async () => {
    const url = await storage.signedUrl(key);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer()).equals(photo)).toBe(true);
  });

  it('turns the signed link a client sends back into the stored reference', async () => {
    const url = await storage.signedUrl(key);
    expect(storage.storedForm(url)).toBe(`media://${key}`);
  });

  it('signs references wherever they sit in a response', async () => {
    const out = await storage.signDeep({ deliveryEvidence: [`media://${key}`] });
    const res = await fetch(out.deliveryEvidence[0]);
    expect(res.status).toBe(200);
  });

  it('hands out a download link on request', async () => {
    const url = await storage.signedUrl(key, { downloadName: 'Sangeet 01.jpg' });
    const res = await fetch(url);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Sangeet_01.jpg"');
  });
});
