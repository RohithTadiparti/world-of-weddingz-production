import { spawnSync } from 'node:child_process';

// These advisories currently have no patched release in the Expo 57 / React
// Native 0.86 line. They are reached by Metro/Expo build tooling, not by code
// that parses customer input in the shipped Android bundle. Keep the IDs
// explicit so a new high/critical advisory fails CI instead of being hidden by
// a blanket audit exception.
const acceptedBuildToolAdvisories = new Set([
  1240107, // brace-expansion nested-group stack exhaustion
  1240111, // brace-expansion comma-parser stack exhaustion
  1240912, // node-forge signature parser in Expo code-signing tooling
  1240992, // braces nested-pattern stack exhaustion
]);

const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm audit --omit=dev --json']
  : ['audit', '--omit=dev', '--json'];
const result = spawnSync(command, args, {
  cwd: new URL('../../mobile/', import.meta.url),
  encoding: 'utf8',
  shell: false,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error(result.stderr || result.stdout || 'npm audit did not return JSON');
  process.exit(1);
}

const unexpected = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const advisory of vulnerability.via ?? []) {
    if (typeof advisory === 'string') continue;
    if (!['high', 'critical'].includes(advisory.severity)) continue;
    if (!acceptedBuildToolAdvisories.has(Number(advisory.source))) {
      unexpected.set(Number(advisory.source), advisory.title);
    }
  }
}

if (unexpected.size) {
  console.error('Unexpected high/critical mobile production advisories:');
  for (const [id, title] of unexpected) console.error(`- ${id}: ${title}`);
  process.exit(1);
}

console.log(`Mobile audit passed with ${acceptedBuildToolAdvisories.size} explicit build-tool exceptions.`);
