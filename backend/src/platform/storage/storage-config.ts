/** The slice of `media` configuration storage reads. */
export interface StorageSettings {
  storageProvider: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Endpoint: string;
  s3PublicEndpoint: string;
  s3ForcePathStyle: boolean;
  presignExpirySeconds: number;
  getExpirySeconds: number;
  maxFileSizeBytes: number;
  cdnBaseUrl: string;
  mockBaseUrl: string;
  mockStorageDir: string;
}

/**
 * Everything wrong with a storage configuration, in words.
 *
 * Checked when the API boots, so choosing S3 without naming a bucket stops the
 * process with a sentence instead of starting it and failing the first
 * photograph somebody uploads — which is when the old hand-signed URLs found
 * out, as a host of `.s3.us-east-1.amazonaws.com` with no bucket in front.
 */
export function storageConfigProblems(s: StorageSettings): string[] {
  const problems: string[] = [];
  if (s.storageProvider !== 'mock' && s.storageProvider !== 's3') {
    problems.push(`MEDIA_STORAGE_PROVIDER must be mock or s3, got "${s.storageProvider}"`);
  }
  if (!(s.maxFileSizeBytes > 0)) problems.push('MAX_FILE_SIZE must be a positive number of bytes');
  if (s.storageProvider !== 's3') return problems;

  if (!s.s3Bucket) problems.push('MEDIA_STORAGE_PROVIDER=s3 needs S3_BUCKET');
  if (!s.s3Region) problems.push('MEDIA_STORAGE_PROVIDER=s3 needs S3_REGION');
  // One without the other is a typo, not a choice: the SDK would silently fall
  // back to whatever role the machine has and the configured key is ignored.
  if (Boolean(s.s3AccessKeyId) !== Boolean(s.s3SecretAccessKey)) {
    problems.push('Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither');
  }
  for (const [name, value] of [
    ['S3_ENDPOINT', s.s3Endpoint],
    ['S3_PUBLIC_ENDPOINT', s.s3PublicEndpoint],
  ] as const) {
    if (value && !/^https?:\/\/[^/\s]+\/?$/i.test(value)) {
      problems.push(`${name} must be an http(s) origin such as http://minio:9000, got "${value}"`);
    }
  }
  if (!(s.presignExpirySeconds >= 60)) problems.push('S3_PRESIGN_EXPIRY must be at least 60 seconds');
  if (!(s.getExpirySeconds >= 120)) problems.push('S3_GET_EXPIRY must be at least 120 seconds');
  return problems;
}

export function assertStorageConfig(s: StorageSettings): void {
  const problems = storageConfigProblems(s);
  if (problems.length > 0) {
    throw new Error(`Media storage is misconfigured: ${problems.join('; ')}`);
  }
}
