import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const program = readFileSync('PRODUCTION_PROGRAM.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const seedAdmin = readFileSync('backend/src/database/seed-admin.ts', 'utf8');
const seedAdminConfig = readFileSync('backend/src/database/seed-admin-config.ts', 'utf8');
const ignore = readFileSync('.gitignore', 'utf8');

test('public repository documentation does not claim private visibility', () => {
  assert.doesNotMatch(program, /This private repository/);
  assert.doesNotMatch(readme, /This private repository/);
});

test('administrator seed has no published fallback credential', () => {
  assert.doesNotMatch(seedAdmin, /DEFAULT_ADMIN/);
  assert.doesNotMatch(seedAdmin, /admin123/);
  assert.match(seedAdminConfig, /ADMIN_EMAIL and ADMIN_PASSWORD are required/);
});

test('Excel temporary owner files cannot be committed', () => {
  assert.match(ignore, /~\$\*\.xlsx/);
});
