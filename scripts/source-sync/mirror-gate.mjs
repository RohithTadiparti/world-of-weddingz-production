#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function argsOf(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: mirror-gate.mjs --repository <path> --base <sha> --head <sha> --body-file <path> --config <path>');
    }
    values[key.slice(2)] = value;
  }
  for (const required of ['repository', 'base', 'head', 'body-file', 'config']) {
    if (!values[required]) throw new Error(`Missing required --${required} argument`);
  }
  return values;
}

function main() {
  const args = argsOf(process.argv.slice(2));
  const repository = resolve(args.repository);
  const config = JSON.parse(readFileSync(resolve(args.config), 'utf8'));
  const body = readFileSync(resolve(args['body-file']), 'utf8');
  const diff = execFileSync('git', ['diff', '--name-only', '-z', `${args.base}...${args.head}`], {
    cwd: repository,
    encoding: 'utf8',
  });
  const changedPaths = diff.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b));
  const sharedPaths = changedPaths.filter((path) =>
    config.sharedPrefixes.some((prefix) => path.replaceAll('\\', '/').startsWith(prefix)),
  );
  const dependencyPaths = sharedPaths.filter((path) => {
    const name = basename(path);
    return config.dependencyFileNames.includes(name) || /^requirements-[^/]+\.txt$/i.test(name);
  });
  const mirrorRequired = sharedPaths.length > 0;
  const impact = body.match(/^\s*-\s*Shared source impact:\s*(.+?)\s*$/im)?.[1]?.trim() ?? '';
  const mirrorValue = body.match(/^\s*-\s*WOW-MD mirror PR:\s*(.+?)\s*$/im)?.[1]?.trim() ?? '';
  const mirrorMatch = mirrorValue.match(/^https:\/\/github\.com\/RohithTadiparti\/WOW-MD\/pull\/(\d+)$/i);

  if (mirrorRequired && !/^mirror required$/i.test(impact)) {
    throw new Error('Shared paths changed: set "Shared source impact" to "Mirror required".');
  }
  if (mirrorRequired && !mirrorMatch) {
    throw new Error('Shared paths changed: provide a WOW-MD mirror PR URL under https://github.com/RohithTadiparti/WOW-MD/pull/<number>.');
  }

  const result = {
    mirrorRequired,
    mirrorPullRequest: mirrorMatch ? mirrorValue : null,
    dependencyChanged: dependencyPaths.length > 0,
    sharedPaths,
    dependencyPaths,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
