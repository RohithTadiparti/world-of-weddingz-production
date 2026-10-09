import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Railway services use immutable Docker builds, health gates and bounded restarts', () => {
  const backend = read('railway/backend.toml');
  const frontend = read('railway/frontend.toml');

  assert.match(backend, /dockerfilePath\s*=\s*"docker\/Dockerfile"/);
  assert.match(backend, /preDeployCommand\s*=\s*\["npm run migration:run:prod"\]/);
  assert.match(backend, /startCommand\s*=\s*"node dist\/main"/);
  assert.match(backend, /healthcheckPath\s*=\s*"\/api\/health\/live"/);
  assert.match(backend, /restartPolicyType\s*=\s*"ON_FAILURE"/);

  assert.match(frontend, /dockerfilePath\s*=\s*"docker\/Dockerfile\.frontend"/);
  assert.match(frontend, /healthcheckPath\s*=\s*"\/"/);
  assert.match(frontend, /restartPolicyType\s*=\s*"ON_FAILURE"/);
});

test('the frontend keeps local Compose while accepting a Railway private upstream', () => {
  const dockerfile = read('docker/Dockerfile.frontend');
  const nginx = read('frontend/nginx.conf');
  const compose = read('docker/docker-compose.yml');

  assert.match(dockerfile, /NGINX_ENVSUBST_FILTER=API_UPSTREAM/);
  assert.match(dockerfile, /API_UPSTREAM=backend:3000/);
  assert.match(dockerfile, /templates\/default\.conf\.template/);
  assert.match(nginx, /proxy_pass http:\/\/\$\{API_UPSTREAM\};/g);
  assert.doesNotMatch(nginx, /proxy_pass http:\/\/backend:3000/);
  assert.match(compose, /API_UPSTREAM:\s*\$\{API_UPSTREAM:-backend:3000\}/);
});

test('Railway deployment is manual, secret-backed, ordered and smoke-gated', () => {
  const workflow = read('.github/workflows/railway-deploy.yml');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*railway-staging/);
  assert.match(workflow, /RAILWAY_TOKEN:\s*\$\{\{ secrets\.RAILWAY_TOKEN \}\}/);
  assert.match(workflow, /RAILWAY_BACKEND_SERVICE_ID/);
  assert.match(workflow, /RAILWAY_FRONTEND_SERVICE_ID/);
  assert.ok(workflow.indexOf('Deploy backend') < workflow.indexOf('Deploy frontend'));
  assert.ok(workflow.indexOf('Deploy frontend') < workflow.indexOf('Run Railway smoke suite'));
  assert.match(workflow, /RAILWAY_SMOKE:\s*'true'/);
  assert.match(workflow, /Rollback failed smoke deployment/);
});

test('new Railway services avoid deprecated config-as-code bootstrap instructions', () => {
  const guide = read('railway/README.md');

  assert.match(guide, /RAILWAY_DOCKERFILE_PATH=\/docker\/Dockerfile\b/);
  assert.match(guide, /RAILWAY_DOCKERFILE_PATH=\/docker\/Dockerfile\.frontend\b/);
  assert.match(guide, /Config as Code is deprecated/i);
  assert.doesNotMatch(guide, /Set each repository service's config-file path/i);
});

test('Railway deployment verifies project-token scope before invoking the CLI', () => {
  const workflow = read('.github/workflows/railway-deploy.yml');

  assert.match(workflow, /Project-Access-Token: \$RAILWAY_TOKEN/);
  assert.match(workflow, /projectToken \{ projectId environmentId \}/);
  assert.match(workflow, /RAILWAY_PROJECT_ID/);
  assert.match(workflow, /RAILWAY_ENVIRONMENT_ID/);
});

