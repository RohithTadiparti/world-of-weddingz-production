import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../../.github/workflows/source-sync-review.yml', import.meta.url);

test('scheduled source review uses private-repository access and publishes review-only evidence', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:\s*['"]17 3 \* \* \*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /repository:\s*RohithTadiparti\/WOW-MD/);
  assert.match(workflow, /token:\s*\$\{\{\s*secrets\.WOW_SYNC_TOKEN\s*\}\}/);
  assert.match(workflow, /node scripts\/source-sync\/report\.mjs/);
  assert.match(workflow, /retention-days:\s*30/);
  assert.match(workflow, /wow-source-sync-report/);
});

test('scheduled source review cannot merge or push either repository', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.doesNotMatch(workflow, /\bgit\s+(?:merge|push)\b/i);
  assert.doesNotMatch(workflow, /pulls\.(?:create|merge)|mergePullRequest/i);
  assert.doesNotMatch(workflow, /contents:\s*write/i);
  assert.match(workflow, /issues:\s*write/);
});

test('pull-request mirror gate checks out enough history to compare base and head', () => {
  const governance = readFileSync(
    new URL('../../.github/workflows/governance.yml', import.meta.url),
    'utf8',
  );

  assert.match(
    governance,
    /registers:[\s\S]*?steps:\s*\n\s*- uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*fetch-depth:\s*0\s*\n\s*- uses:\s*actions\/setup-node@v4/,
  );
});
