import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const required = [
  ['open-items.csv', 'ID'],
  ['requirements.csv', 'ID'],
  ['test-inventory.csv', 'ID'],
  ['risks.csv', 'ID'],
  ['access.csv', 'ID'],
  ['release-gates.csv', 'ID'],
  ['change-intake.csv', 'ID'],
  ['pr-handoffs.csv', 'WorkItem'],
  ['document-register.csv', 'ID'],
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('unterminated quoted CSV field');
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

export function validateRegisters(root) {
  const directory = join(root, 'docs', 'tracking', 'registers');
  const errors = [];
  const byFile = new Map();

  for (const [name, idColumn] of required) {
    const path = join(directory, name);
    if (!existsSync(path)) {
      errors.push(`missing register ${name}`);
      continue;
    }
    const rows = parseCsv(readFileSync(path, 'utf8'));
    const headers = rows[0] ?? [];
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) {
      errors.push(`${name}: missing ${idColumn} column`);
      continue;
    }
    const seen = new Set();
    for (const [offset, record] of rows.slice(1).entries()) {
      if (record.length !== headers.length) {
        errors.push(`${name}:${offset + 2}: expected ${headers.length} columns, found ${record.length}`);
      }
      const id = (record[idIndex] ?? '').trim();
      if (!id) errors.push(`${name}:${offset + 2}: blank ${idColumn}`);
      else if (seen.has(id)) errors.push(`${name}: duplicate ID ${id}`);
      else seen.add(id);
    }
    byFile.set(name, { headers, rows: rows.slice(1), ids: seen });
  }

  const openIds = byFile.get('open-items.csv')?.ids ?? new Set();
  const open = byFile.get('open-items.csv');
  if (open) {
    const dependencyIndex = open.headers.indexOf('DependsOn');
    for (const [offset, row] of open.rows.entries()) {
      for (const dependency of (row[dependencyIndex] ?? '').split(/[ ,]+/).filter(Boolean)) {
        if (!openIds.has(dependency)) errors.push(`open-items.csv:${offset + 2}: unknown dependency ${dependency}`);
      }
    }
  }

  return errors;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '..', '..'));
const errors = validateRegisters(root);
if (errors.length) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Register validation passed (${required.length} registers).\n`);
}
