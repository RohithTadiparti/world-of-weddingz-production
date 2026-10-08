import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const MEDIA_REF = /media:\/\/([A-Za-z0-9._/-]+)/g;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function mediaKeysIn(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  if (!source) return [];
  return [...source.matchAll(MEDIA_REF)].map((match) => match[1]);
}

export async function discoverDatabaseMediaKeys(pool) {
  const columns = await pool.query(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('character varying', 'text', 'json', 'jsonb', 'ARRAY')
    ORDER BY table_name, ordinal_position
  `);
  const keys = new Set();
  for (const column of columns.rows) {
    const schema = quoteIdentifier(column.table_schema);
    const table = quoteIdentifier(column.table_name);
    const name = quoteIdentifier(column.column_name);
    const values = await pool.query(
      `SELECT ${name}::text AS value FROM ${schema}.${table} WHERE ${name}::text LIKE '%media://%'`,
    );
    for (const row of values.rows) {
      for (const key of mediaKeysIn(row.value)) keys.add(key);
    }
  }
  return keys;
}

export async function discoverS3MediaKeys(s3, bucket) {
  const keys = new Set();
  let continuationToken;
  do {
    const page = await s3.list({ bucket, continuationToken });
    for (const key of page.keys) keys.add(key);
    continuationToken = page.nextContinuationToken;
  } while (continuationToken);
  return keys;
}

/**
 * @typedef {object} MediaReconciliationReport
 * @property {string} generatedAt
 * @property {string} bucket
 * @property {number} databaseReferenceCount
 * @property {number} objectCount
 * @property {number} matchedCount
 * @property {string[]} missingObjects
 * @property {string[]} orphanObjects
 * @property {boolean} exact
 */

/** @returns {Promise<MediaReconciliationReport>} */
export async function reconcileMedia({ pool, s3, bucket, now = () => new Date() }) {
  const [databaseKeys, objectKeys] = await Promise.all([
    discoverDatabaseMediaKeys(pool),
    discoverS3MediaKeys(s3, bucket),
  ]);
  const missingObjects = [...databaseKeys].filter((key) => !objectKeys.has(key)).sort();
  const orphanObjects = [...objectKeys].filter((key) => !databaseKeys.has(key)).sort();
  return {
    generatedAt: now().toISOString(),
    bucket,
    databaseReferenceCount: databaseKeys.size,
    objectCount: objectKeys.size,
    matchedCount: [...databaseKeys].filter((key) => objectKeys.has(key)).length,
    missingObjects,
    orphanObjects,
    exact: missingObjects.length === 0 && orphanObjects.length === 0,
  };
}

async function main() {
  const bucket = process.env.S3_BUCKET?.trim();
  const region = process.env.S3_REGION?.trim();
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!bucket || !region || !connectionString) {
    throw new Error('DATABASE_URL, S3_BUCKET and S3_REGION are required');
  }

  const requireFromBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
  const { Pool } = requireFromBackend('pg');
  const { ListObjectsV2Command, S3Client } = requireFromBackend('@aws-sdk/client-s3');
  const credentials =
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined;
  const client = new S3Client({ region, credentials });
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  const s3 = {
    async list({ bucket: bucketName, continuationToken }) {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucketName, ContinuationToken: continuationToken }),
      );
      return {
        keys: (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
        nextContinuationToken: page.NextContinuationToken,
      };
    },
  };

  try {
    const report = await reconcileMedia({ pool, s3, bucket });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.exact && !process.argv.includes('--allow-drift')) process.exitCode = 2;
  } finally {
    await pool.end();
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

