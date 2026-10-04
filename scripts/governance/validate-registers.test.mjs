import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./validate-registers.mjs', import.meta.url));

test('accepts the repository production registers', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /register validation passed/i);
});

test('rejects duplicate open-item identifiers', () => {
  const root = mkdtempSync(join(tmpdir(), 'wow-registers-'));
  const registers = join(root, 'docs', 'tracking', 'registers');
  mkdirSync(registers, { recursive: true });
  writeFileSync(
    join(registers, 'open-items.csv'),
    'ID,Title,Status\nDUP-001,First,Open\nDUP-001,Second,Open\n',
  );
  for (const name of [
    'requirements.csv',
    'test-inventory.csv',
    'risks.csv',
    'access.csv',
    'release-gates.csv',
    'change-intake.csv',
    'pr-handoffs.csv',
    'document-register.csv',
  ]) {
    writeFileSync(join(registers, name), 'ID,Status\n');
  }

  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate ID DUP-001/i);
});
