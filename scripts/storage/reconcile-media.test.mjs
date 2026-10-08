import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaKeysIn, reconcileMedia } from './reconcile-media.mjs';

test('extracts media references from text and JSON without treating signed URLs as authoritative', () => {
  assert.deepEqual(
    mediaKeysIn(JSON.stringify({ photos: ['media://users/u1/profile/a.jpg', 'https://bucket/key?signature=x'] })),
    ['users/u1/profile/a.jpg'],
  );
});

test('reports missing and orphan objects without deleting either', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('information_schema.columns')) {
        return { rows: [{ table_schema: 'public', table_name: 'profiles', column_name: 'photos' }] };
      }
      return {
        rows: [{ value: '["media://users/u1/profile/a.jpg","media://users/u1/profile/missing.jpg"]' }],
      };
    },
  };
  const pages = [
    { keys: ['users/u1/profile/a.jpg'], nextContinuationToken: 'next' },
    { keys: ['vendors/v1/portfolio/orphan.jpg'] },
  ];
  const s3 = { list: async () => pages.shift() };

  const report = await reconcileMedia({
    pool,
    s3,
    bucket: 'wow-private',
    now: () => new Date('2026-10-08T00:00:00.000Z'),
  });

  assert.equal(report.exact, false);
  assert.equal(report.matchedCount, 1);
  assert.deepEqual(report.missingObjects, ['users/u1/profile/missing.jpg']);
  assert.deepEqual(report.orphanObjects, ['vendors/v1/portfolio/orphan.jpg']);
  assert.equal(queries.some((sql) => /DELETE|UPDATE/i.test(sql)), false);
});

