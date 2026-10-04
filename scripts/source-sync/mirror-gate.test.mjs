import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const script = new URL('./mirror-gate.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const config = new URL('../../.production/shared-source-paths.json', import.meta.url).pathname.replace(/^\/(.:)/, '$1');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture(path) {
  const root = mkdtempSync(join(tmpdir(), 'wow-mirror-gate-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Mirror Gate Test');
  git(root, 'config', 'user.email', 'mirror-gate@example.invalid');
  writeFileSync(join(root, 'README.md'), 'baseline\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  const base = git(root, 'rev-parse', 'HEAD');
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'changed\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'change');
  return { root, base, head: git(root, 'rev-parse', 'HEAD') };
}

function run(change, body) {
  const bodyFile = join(change.root, 'pr-body.md');
  writeFileSync(bodyFile, body);
  return spawnSync(process.execPath, [
    script,
    '--repository', change.root,
    '--base', change.base,
    '--head', change.head,
    '--body-file', bodyFile,
    '--config', config,
  ], { encoding: 'utf8' });
}

test('allows production-only governance changes without a WOW-MD mirror', () => {
  const result = run(fixture('docs/governance/policy.md'), '- Shared source impact: None\n- WOW-MD mirror PR: None\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mirrorRequired, false);
});

test('rejects shared application code when the WOW-MD mirror PR is missing', () => {
  const result = run(fixture('backend/src/security.ts'), '- Shared source impact: Mirror required\n- WOW-MD mirror PR: None\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WOW-MD mirror PR/i);
});

test('accepts shared application code with a correctly scoped WOW-MD pull request', () => {
  const result = run(
    fixture('frontend/src/App.tsx'),
    '- Shared source impact: Mirror required\n- WOW-MD mirror PR: https://github.com/RohithTadiparti/WOW-MD/pull/123\n',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mirrorPullRequest, 'https://github.com/RohithTadiparti/WOW-MD/pull/123');
});

test('classifies dependency manifests as shared dependency changes', () => {
  const result = run(
    fixture('backend/package-lock.json'),
    '- Shared source impact: Mirror required\n- WOW-MD mirror PR: https://github.com/RohithTadiparti/WOW-MD/pull/456\n',
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.dependencyChanged, true);
  assert.deepEqual(report.dependencyPaths, ['backend/package-lock.json']);
});

test('rejects links to a different repository', () => {
  const result = run(
    fixture('mobile/src/app.tsx'),
    '- Shared source impact: Mirror required\n- WOW-MD mirror PR: https://github.com/RohithTadiparti/not-wow/pull/9\n',
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RohithTadiparti\/WOW-MD/i);
});
