import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('capacity harness defines ramp spike soak and recovery profiles', async () => {
  const source = await read('backend/test/k6/railway-capacity.js');
  for (const profile of ['ramp', 'spike', 'soak', 'recovery']) {
    assert.match(source, new RegExp(`${profile}:`));
  }
  for (const operation of ['registration_login', 'discovery', 'chat', 'planner', 'bookings', 'uploads']) {
    assert.match(source, new RegExp(operation));
  }
  assert.match(source, /QA_ACCOUNT_FILE/);
  assert.match(source, /bride.*groom.*vendor.*wedding_planner.*admin/s);
});

test('thresholds enforce the public plan and 30 percent resource headroom', async () => {
  const config = JSON.parse(await read('backend/test/k6/railway-capacity-thresholds.json'));
  assert.equal(config.minimumHeadroomPercent, 30);
  assert.equal(config.plannedOperatingConcurrentUsers, 30);
  assert.equal(config.breakpointConcurrentUsers, 75);
  assert.ok(config.thresholds.http_req_failed.includes('rate<0.01'));
  assert.ok(config.thresholds.operation_duration.includes('p(95)<400'));
});

test('baseline report cannot be mistaken for executed evidence', async () => {
  const report = await read('docs/reports/railway-capacity-baseline.md');
  assert.match(report, /Status:\s*Not Run/);
  assert.match(report, /must not be used as release evidence/i);
  assert.match(report, /30% headroom/i);
});
