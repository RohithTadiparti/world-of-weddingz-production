#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FILE_PATTERN = /^(\d{13})-([A-Za-z0-9]+)\.ts$/;

export async function verifyMigrationOrder(directory) {
  const errors = [];
  const files = (await readdir(directory)).filter((name) => name.endsWith('.ts')).sort();
  const timestamps = new Map();
  const migrationNames = new Set();

  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      errors.push(`${file}: filename must be <13-digit timestamp>-<Name>.ts`);
      continue;
    }
    const [, timestamp] = match;
    const duplicate = timestamps.get(timestamp);
    if (duplicate) errors.push(`${file}: duplicate timestamp ${timestamp} also used by ${duplicate}`);
    else timestamps.set(timestamp, file);

    const source = await readFile(path.join(directory, file), 'utf8');
    const classMatch = /export\s+class\s+([A-Za-z0-9_]+?)(\d{13})\s+implements\s+MigrationInterface/.exec(source);
    if (!classMatch) {
      errors.push(`${file}: exported migration class with a 13-digit suffix was not found`);
      continue;
    }
    const [, classBase, classTimestamp] = classMatch;
    if (classTimestamp !== timestamp) {
      errors.push(`${file}: class timestamp ${classTimestamp} does not match filename timestamp ${timestamp}`);
    }
    const expectedName = `${classBase}${classTimestamp}`;
    const nameMatch = /\bname\s*=\s*['"]([^'"]+)['"]/.exec(source);
    if (!nameMatch || nameMatch[1] !== expectedName) {
      errors.push(`${file}: migration name must be ${expectedName}`);
    } else if (migrationNames.has(nameMatch[1])) {
      errors.push(`${file}: duplicate migration name ${nameMatch[1]}`);
    } else {
      migrationNames.add(nameMatch[1]);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = path.resolve(process.argv[2] ?? 'backend/src/database/migrations');
  const errors = await verifyMigrationOrder(directory);
  if (errors.length) {
    errors.forEach((error) => process.stderr.write(`${error}\n`));
    process.exitCode = 1;
  } else {
    process.stdout.write(`Migration order verified (${(await readdir(directory)).filter((name) => name.endsWith('.ts')).length} files).\n`);
  }
}
