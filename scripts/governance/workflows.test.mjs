import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const governance = readFileSync('.github/workflows/governance.yml', 'utf8');
const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');

test('secret scan can enumerate pull-request commits', () => {
  assert.match(governance, /pull-requests:\s*read/);
});

test('private-tier CodeQL keeps a 30-day SARIF artifact without native upload', () => {
  assert.match(codeql, /upload:\s*false/);
  assert.match(codeql, /actions\/upload-artifact@/);
  assert.match(codeql, /retention-days:\s*30/);
});
