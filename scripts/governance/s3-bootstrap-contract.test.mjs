import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('bootstrap contains only durable private S3 and IAM resources', async () => {
  const files = await Promise.all([
    read('terraform/bootstrap/storage.tf'),
    read('terraform/bootstrap/iam.tf'),
  ]);
  const source = files.join('\n');

  for (const required of [
    'aws_s3_bucket_public_access_block',
    'aws_s3_bucket_server_side_encryption_configuration',
    'aws_s3_bucket_versioning',
    'aws_s3_bucket_lifecycle_configuration',
    'aws_s3_bucket_policy',
    'aws_iam_user',
    'aws_iam_user_policy',
  ]) {
    assert.match(source, new RegExp(`resource\\s+"${required}"`));
  }
  for (const forbidden of ['aws_eks_', 'aws_rds_', 'aws_elasticache_', 'aws_nat_gateway', 'aws_lb']) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
  assert.match(source, /sse_algorithm\s*=\s*"AES256"/);
  assert.match(source, /status\s*=\s*"Enabled"/);
  assert.match(source, /aws:SecureTransport/);
  assert.doesNotMatch(source, /aws_iam_access_key/);
});

test('application policy is object-only and cannot change bucket privacy', async () => {
  const source = await read('terraform/bootstrap/iam.tf');
  for (const action of ['s3:GetObject', 's3:PutObject', 's3:DeleteObject']) {
    assert.match(source, new RegExp(action));
  }
  for (const forbidden of ['s3:PutBucketPolicy', 's3:PutBucketAcl', 's3:DeleteBucket', 's3:*']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be granted to the application`);
  }
});

test('lifecycle preserves current objects and expires only stale versions and incomplete uploads', async () => {
  const source = await read('terraform/bootstrap/storage.tf');
  assert.match(source, /noncurrent_version_expiration/);
  assert.match(source, /noncurrent_days\s*=\s*var\.noncurrent_version_retention_days/);
  assert.match(source, /abort_incomplete_multipart_upload/);
  assert.doesNotMatch(source, /\n\s*expiration\s*\{/);
});
