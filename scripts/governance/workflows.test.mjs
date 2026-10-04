import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const governance = readFileSync('.github/workflows/governance.yml', 'utf8');
const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');

test('secret scan can enumerate pull-request commits', () => {
  assert.match(governance, /pull-requests:\s*read/);
});

test('public-tier CodeQL uploads native findings and keeps a 30-day SARIF artifact', () => {
  assert.match(codeql, /security-events:\s*write/);
  assert.match(codeql, /upload:\s*always/);
  assert.match(codeql, /output:\s*results/);
  assert.match(codeql, /path:\s*results/);
  assert.doesNotMatch(codeql, /\.\.\/results/);
  assert.match(codeql, /actions\/upload-artifact@/);
  assert.match(codeql, /retention-days:\s*30/);
});
