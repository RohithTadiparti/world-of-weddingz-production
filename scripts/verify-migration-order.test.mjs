import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyMigrationOrder } from './verify-migration-order.mjs';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'wow-migrations-'));
  await Promise.all(
    Object.entries(files).map(([name, body]) => writeFile(join(root, name), body, 'utf8')),
  );
  return root;
}

test('accepts unique ordered timestamps that match class and migration names', async () => {
  const root = await fixture({
    '1710000001000-First.ts': "export class First1710000001000 implements MigrationInterface { name = 'First1710000001000'; }",
    '1710000002000-Second.ts': "export class Second1710000002000 implements MigrationInterface { name = 'Second1710000002000'; }",
  });
  assert.deepEqual(await verifyMigrationOrder(root), []);
});

test('rejects duplicate timestamps and mismatched class metadata', async () => {
  const root = await fixture({
    '1710000001000-First.ts': "export class First1710000001000 implements MigrationInterface { name = 'First1710000001000'; }",
    '1710000001000-Second.ts': "export class Second1710000002000 implements MigrationInterface { name = 'Second1710000002000'; }",
  });
  const errors = await verifyMigrationOrder(root);
  assert.ok(errors.some((error) => error.includes('duplicate timestamp 1710000001000')));
  assert.ok(errors.some((error) => error.includes('does not match filename timestamp')));
});
