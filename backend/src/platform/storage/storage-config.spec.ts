import { StorageSettings, assertStorageConfig, storageConfigProblems } from './storage-config';

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
  maxFileSizeBytes: 10 * 1024 * 1024,
  cdnBaseUrl: '',
  mockBaseUrl: 'http://localhost:8080/api/mock-storage',
  mockStorageDir: '/tmp/media-store',
  ...overrides,
});

const s3 = (overrides: Partial<StorageSettings> = {}) =>
  settings({ storageProvider: 's3', s3Bucket: 'wow-media', s3Region: 'ap-south-1', ...overrides });

describe('storage configuration', () => {
  it('needs nothing at all for the local store', () => {
    expect(storageConfigProblems(settings())).toEqual([]);
  });

  it('accepts S3 with a bucket and a region, credentials left to the SDK', () => {
    expect(storageConfigProblems(s3())).toEqual([]);
  });

  it('refuses to boot on S3 with no bucket or region', () => {
    expect(() => assertStorageConfig(s3({ s3Bucket: '', s3Region: '' }))).toThrow(
      /S3_BUCKET.*S3_REGION/,
    );
  });

  it('refuses half a key pair', () => {
    expect(storageConfigProblems(s3({ s3AccessKeyId: 'AKIA' }))).toEqual([
      'Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither',
    ]);
  });

  it('refuses an endpoint that is not an origin', () => {
    expect(storageConfigProblems(s3({ s3Endpoint: 'minio:9000' }))[0]).toMatch(/S3_ENDPOINT/);
    expect(storageConfigProblems(s3({ s3Endpoint: 'http://minio:9000' }))).toEqual([]);
  });

  it('refuses a provider it does not know', () => {
    expect(storageConfigProblems(settings({ storageProvider: 'gcs' }))[0]).toMatch(/mock or s3/);
  });

  it('refuses expiries too short to use', () => {
    expect(storageConfigProblems(s3({ presignExpirySeconds: 5, getExpirySeconds: 10 }))).toHaveLength(2);
  });
});
