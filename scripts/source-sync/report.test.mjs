import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const script = new URL('./report.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wow-source-sync-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Source Sync Test');
  git(root, 'config', 'user.email', 'source-sync@example.invalid');
  writeFileSync(join(root, 'README.md'), 'baseline\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'baseline');
  return { root, baseline: git(root, 'rev-parse', 'HEAD') };
}

function commitFile(root, path, content, message) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  git(root, 'add', path);
  git(root, 'commit', '-m', message);
}

function run(root, baseline) {
  const output = join(root, '.report');
  const result = spawnSync(process.execPath, [script, '--source', root, '--baseline', baseline, '--output', output], {
    encoding: 'utf8',
  });
  return { result, output };
}

test('reports an unchanged source baseline with zero commits and paths', () => {
  const { root, baseline } = fixture();
  const { result, output } = run(root, baseline);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(output, 'source-sync-report.json'), 'utf8'));
  assert.equal(report.commitCount, 0);
  assert.deepEqual(report.paths, []);
  assert.match(readFileSync(join(output, 'source-sync-report.md'), 'utf8'), /No committed source changes/);
});

test('classifies UI, dependency, test, documentation, and unsafe source paths explicitly', () => {
  const { root, baseline } = fixture();
  commitFile(root, 'frontend/src/pages/Home.tsx', 'export const Home = 1;\n', 'ui change');
  commitFile(root, 'backend/package-lock.json', '{"lockfileVersion":3}\n', 'dependency change');
  commitFile(root, 'backend/src/auth.spec.ts', 'export {};\n', 'test change');
  commitFile(root, 'docs/decision.md', '# Decision\n', 'documentation change');
  commitFile(root, '.env', 'SECRET=do-not-copy\n', 'unsafe local file');

  const { result, output } = run(root, baseline);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(output, 'source-sync-report.json'), 'utf8'));
  const byPath = Object.fromEntries(report.paths.map((entry) => [entry.path, entry.classification]));

  assert.equal(report.commitCount, 5);
  assert.equal(byPath['frontend/src/pages/Home.tsx'], 'ui-ux');
  assert.equal(byPath['backend/package-lock.json'], 'dependency');
  assert.equal(byPath['backend/src/auth.spec.ts'], 'test');
  assert.equal(byPath['docs/decision.md'], 'documentation');
  assert.equal(byPath['.env'], 'unsafe-local');
  assert.deepEqual(report.dependencyPaths, ['backend/package-lock.json']);
  assert.deepEqual(report.unsafePaths, ['.env']);
});

test('records source commit identifiers and subjects in oldest-first order', () => {
  const { root, baseline } = fixture();
  commitFile(root, 'backend/src/one.ts', 'export const one = 1;\n', 'first functional change');
  const first = git(root, 'rev-parse', 'HEAD');
  commitFile(root, 'mobile/src/two.tsx', 'export const two = 2;\n', 'second functional change');
  const second = git(root, 'rev-parse', 'HEAD');

  const { result, output } = run(root, baseline);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(output, 'source-sync-report.json'), 'utf8'));
  assert.deepEqual(report.commits.map(({ sha }) => sha), [first, second]);
  assert.deepEqual(report.commits.map(({ subject }) => subject), ['first functional change', 'second functional change']);
});

test('fails closed when the reviewed baseline is absent from source history', () => {
  const { root } = fixture();
  const { result, output } = run(root, '0000000000000000000000000000000000000000');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed baseline.*not present/i);
  assert.throws(() => readFileSync(join(output, 'source-sync-report.json')));
});
