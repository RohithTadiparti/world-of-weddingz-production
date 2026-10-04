#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function argsOf(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: report.mjs --source <repository> --baseline <sha> --output <directory>');
    }
    values[key.slice(2)] = value;
  }
  for (const required of ['source', 'baseline', 'output']) {
    if (!values[required]) throw new Error(`Missing required --${required} argument`);
  }
  return values;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hasCommit(cwd, sha) {
  try {
    git(cwd, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(cwd, ancestor, head) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, head], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function classify(path) {
  const normalized = path.replaceAll('\\', '/');
  const base = normalized.split('/').at(-1) ?? normalized;
  const unsafe = /(^|\/)(\.env(?:\.|$)|\.claude|\.superdesign|\.superpowers|outputs|qa-report|node_modules|logs?)(\/|$)/i
    .test(normalized) || /^\.env(?:\.|$)/i.test(normalized) || /\.log$/i.test(base) || normalized.startsWith('docker/downloads/');
  if (unsafe) return 'unsafe-local';

  const dependency = /^(package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements(?:-[^/]*)?\.txt|pyproject\.toml|poetry\.lock|Pipfile(?:\.lock)?|Gemfile(?:\.lock)?|go\.(?:mod|sum)|Cargo\.(?:toml|lock))$/i.test(base);
  if (dependency) return 'dependency';
  if (/(^|\/)(?:test|tests|e2e)(\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(normalized)) return 'test';
  if (normalized.startsWith('docs/') || /\.(?:md|mdx)$/i.test(base)) return 'documentation';
  if (/^(frontend|mobile)\//.test(normalized) || /\.(?:css|scss|sass|less)$/i.test(base)) return 'ui-ux';
  return 'functional';
}

function markdown(report) {
  const lines = [
    '<!-- wow-source-sync-report -->',
    '# WOW-MD source synchronization report',
    '',
    `- Reviewed baseline: \`${report.reviewedBaseline}\``,
    `- Source head: \`${report.sourceHead}\``,
    `- New commits: **${report.commitCount}**`,
    `- Changed paths: **${report.paths.length}**`,
    `- Dependency paths: **${report.dependencyPaths.length}**`,
    `- Unsafe/local-only paths: **${report.unsafePaths.length}**`,
    '',
  ];

  if (report.commitCount === 0) {
    lines.push('No committed source changes were found after the reviewed baseline.', '');
  } else {
    lines.push('## Commits', '');
    for (const commit of report.commits) lines.push(`- \`${commit.sha}\` ${commit.subject}`);
    lines.push('', '## Changed paths', '', '| Classification | Path |', '|---|---|');
    for (const entry of report.paths) lines.push(`| ${entry.classification} | \`${entry.path}\` |`);
    lines.push('');
  }

  lines.push(
    '## Gate',
    '',
    'This report is review-only. Classify each source commit in `change-intake.csv`; accepted changes require a production pull request. Nothing is merged automatically.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = argsOf(process.argv.slice(2));
  const source = resolve(args.source);
  const output = resolve(args.output);
  const baseline = args.baseline;

  if (!hasCommit(source, baseline)) {
    throw new Error(`Reviewed baseline ${baseline} is not present in source history`);
  }
  const head = git(source, 'rev-parse', 'HEAD');
  if (!isAncestor(source, baseline, head)) {
    throw new Error(`Reviewed baseline ${baseline} is not an ancestor of source HEAD ${head}`);
  }

  const commitText = git(source, 'log', '--reverse', '--format=%H%x09%s', `${baseline}..${head}`);
  const commits = commitText
    ? commitText.split(/\r?\n/).map((line) => {
        const separator = line.indexOf('\t');
        return { sha: line.slice(0, separator), subject: line.slice(separator + 1) };
      })
    : [];
  const pathText = execFileSync('git', ['diff', '--name-only', '-z', `${baseline}..${head}`], {
    cwd: source,
    encoding: 'utf8',
  });
  const paths = pathText
    .split('\0')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, classification: classify(path) }));

  const report = {
    reviewedBaseline: baseline,
    sourceHead: head,
    commitCount: commits.length,
    commits,
    paths,
    dependencyPaths: paths.filter(({ classification }) => classification === 'dependency').map(({ path }) => path),
    unsafePaths: paths.filter(({ classification }) => classification === 'unsafe-local').map(({ path }) => path),
  };

  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'source-sync-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(output, 'source-sync-report.md'), markdown(report));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
