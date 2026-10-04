# Railway-First Launch and AWS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch safely on Railway Hobby with S3 media, operational capacity alerts and a protected one-action workflow that can migrate the platform to AWS Option B with a maximum 15-minute read-only cutover and automatic rollback before AWS writes open.

**Architecture:** A canonical YAML file supplies non-secret defaults to the existing typed NestJS configuration layer. A new operations module measures capacity, persists deduplicated alerts and migration runs, and exposes an MFA-step-up-protected admin API. The admin action dispatches an external GitHub Actions state machine; its mock executor ships first, while the real executor provisions the existing Terraform target, copies and verifies PostgreSQL, changes DNS only after dark-launch checks, and reports signed progress events.

**Tech Stack:** NestJS 10, TypeORM/PostgreSQL 16, Redis 7, React 18, TanStack Query, Vitest, Jest, Playwright, Railway, private Amazon S3, Terraform >=1.6/AWS provider 5.x, GitHub Actions with AWS OIDC, EKS/Aurora/ElastiCache, Loki/Grafana.

**Spec:** `docs/superpowers/specs/2026-10-04-railway-first-aws-migration-design.md`

## Global Constraints

- Railway Free is closed-beta only; public launch uses Railway Hobby.
- All real uploads use private S3 from the first real account; Railway disks contain no authoritative media.
- `config/platform.yaml` contains every non-secret default and mock/provider selection; secrets remain environment/secret-manager values.
- Initial live-environment providers are mock/log except `media.storageProvider: s3`; mock delivery must be labelled simulated.
- Migration is human-triggered, never threshold-triggered.
- Migration initiation requires `admin:infrastructure:migrate`, recent password verification and MFA.
- Real migration runs outside Railway and authenticates to AWS with GitHub OIDC.
- The selected cutover is Option A: at most 15 minutes in business-write read-only mode.
- Automatic rollback is guaranteed only before AWS writes are enabled.
- Railway remains available read-only for 72 hours; decommissioning is a separate approval.
- Production Kubernetes must use a version in EKS standard support; do not retain the Terraform default `1.29`.
- Complete the three existing observability plans before enabling the real migration executor.
- Preserve unrelated working-tree changes in `.gitignore`, `mobile/src/app/planner-clients.tsx`, `.claude/`, `.superdesign/`, QA artifacts and existing plan files.

## File Structure

### Canonical configuration

- Create `config/platform.yaml`: non-secret defaults, thresholds, provider modes and migration policy.
- Create `backend/src/config/platform-config.types.ts`: typed YAML contract.
- Create `backend/src/config/platform-config.loader.ts`: YAML parse, environment overrides and unknown-key rejection.
- Modify `backend/src/config/configuration.ts`, `config.schema.ts`, `app-config.service.ts`: expose the canonical contract and production invariants.
- Create `scripts/verify-config-boundary.mjs`: fail CI on new direct `process.env` reads outside approved bootstrap files.

### Railway and storage

- Create `railway/backend.toml`, `railway/frontend.toml`, `railway/README.md`: reproducible service configuration and operator setup.
- Create `.github/workflows/railway-deploy.yml`: gated image build/deploy and post-deploy smoke checks.
- Modify `docker/Dockerfile.frontend` and `frontend/nginx.conf`: Railway API/WebSocket upstream injection without changing local Compose behavior.
- Create `terraform/bootstrap/`: an independently applied, low-cost state containing private media storage, migration-control storage, Terraform state/locking and GitHub OIDC foundations; applying it must not create Option B compute/database resources.

### Operations backend

- Create `backend/src/modules/operations/`: capacity collection, alert evaluation, migration state machine, executor adapters and controllers.
- Create `backend/src/database/migrations/1710000112000-OperationalAlerts.ts`: capacity snapshots, operational alerts and deduplication constraints. Before implementation, rescan migration filenames and choose the next unused monotonically increasing value if `1710000112000` has been taken.
- Create `backend/src/database/migrations/1710000113000-MigrationControlPlane.ts`: migration runs/events and active-run/idempotency constraints, using the same next-free-timestamp rule.
- Modify notifications, mail and audit modules only through their public services; do not duplicate delivery implementations.

### Admin web

- Create `frontend/src/pages/admin/AdminInfrastructure.tsx` and focused components under `frontend/src/components/admin/infrastructure/`.
- Modify `frontend/src/pages/admin/AdminDashboard.tsx`, `AdminLayout.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/permissions.ts` and notification copy/target maps.

### External migration

- Create `.github/workflows/migrate-to-aws.yml`: protected workflow dispatch and staged cutover.
- Create `scripts/migration/`: preflight, export/import, reconciliation, maintenance, DNS and smoke-test commands with machine-readable results.
- Modify `terraform/`: finish Option B, remote state, secrets, supported EKS version, observability and outputs required by the workflow.
- Create `docs/runbooks/railway-launch.md`, `aws-migration.md`, `aws-migration-rollback.md` and `aws-decommission-railway.md`.

## Review Focus

- Duplicate or out-of-order workflow callbacks must be idempotent and must never move a migration backwards; Task 9 tests this.
- A capacity metric oscillating around a threshold must not create duplicate alerts or repeated email floods; Task 6 tests hysteresis, deduplication and reminders.
- Failed final database reconciliation must restore Railway writes and leave DNS unchanged or restored; Task 12 rehearses this.
- A stale/replayed callback or admin without recent MFA step-up must be rejected without changing migration state; Tasks 8 and 9 test both paths.
- Cross-origin cookies and WebSockets on separate Railway frontend/API domains must survive login, refresh and reconnect; Task 4 includes browser tests.

---

## Workstream 0 — Release safety prerequisites

### Task 1A: Enforce administrator MFA and production-safe providers

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.service.spec.ts`
- Modify: `backend/src/config/config.schema.ts`
- Modify: `docker/docker-compose.yml`, `k8s/configmap.yaml`
- Test: `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Produces: admin login that cannot complete without configured MFA and production bootstrap that rejects unsafe provider/cookie combinations.
- Consumes: existing auth and provider configuration.

- [ ] **Step 1: Write failing tests for an admin with MFA required but not enrolled and for unsafe production provider combinations**
- [ ] **Step 2: Run focused auth/config tests and confirm each intended failure**
- [ ] **Step 3: Require admin MFA enrollment before privileged use and make production provider validation fail closed**
- [ ] **Step 4: Run auth unit/E2E, config validation, lint and typecheck**
- [ ] **Step 5: Commit with `fix: enforce production authentication policy`**

### Task 1B: Authorize and constrain WebSocket traffic

**Files:**
- Modify: `backend/src/modules/chat/chat.gateway.ts`
- Modify/Create: focused gateway specs beside `chat.gateway.ts`
- Modify: WebSocket E2E coverage under `backend/test/`

**Interfaces:**
- Produces: origin allowlisting, token-version/must-reset checks, relationship authorization for call relay and audience-scoped presence.
- Consumes: current authentication and relationship services.

- [ ] **Step 1: Write failing tests for hostile origins, revoked tokens, forced-reset accounts, arbitrary call targets and global presence leakage**
- [ ] **Step 2: Run the focused gateway tests and confirm failure**
- [ ] **Step 3: Implement handshake and per-event authorization plus scoped presence rooms**
- [ ] **Step 4: Run gateway unit/E2E, lint and typecheck**
- [ ] **Step 5: Commit with `fix: authorize websocket traffic`**

### Task 1C: Make background work safe with multiple replicas

**Files:**
- Modify: `backend/src/platform/outbox/outbox.processor.ts`
- Modify: scheduled jobs under `backend/src/platform/jobs/`
- Create/Modify: focused concurrency specs beside each owner

**Interfaces:**
- Produces: database-backed claiming/locking that permits one effective execution across replicas.
- Consumes: PostgreSQL transactions and existing audit/event services.

- [ ] **Step 1: Write failing two-worker tests for outbox and each money/notification-affecting scheduled job**
- [ ] **Step 2: Run the concurrency tests and demonstrate duplicate work**
- [ ] **Step 3: Add row/advisory locking, bounded leases and retry-safe idempotency keys**
- [ ] **Step 4: Run concurrency tests repeatedly plus the complete backend suite**
- [ ] **Step 5: Commit with `fix: serialize replicated background jobs`**

### Task 1D: Harden HTTP startup and migration integrity

**Files:**
- Modify: `backend/src/main.ts`
- Create: `scripts/verify-migration-order.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: duplicate migration filenames/classes only through a reviewed reconciliation procedure
- Test: application bootstrap and header tests under `backend/test/`

**Interfaces:**
- Produces: secure headers, production-disabled Swagger and a CI gate for unique strictly ordered migrations.
- Consumes: existing Helmet/Swagger setup and TypeORM migration history.

- [ ] **Step 1: Write failing tests for headers, production Swagger exposure and duplicate timestamps**
- [ ] **Step 2: Inventory applied migration names in every retained environment before renaming anything**
- [ ] **Step 3: Reconcile duplicate names without invalidating applied history, then enable the CI order check**
- [ ] **Step 4: Apply migrations to an empty database and an upgraded database snapshot; both must converge**
- [ ] **Step 5: Run the full CI-equivalent suite and commit with `fix: harden startup and migration ordering`**

### Task 1E: Remediate production dependency vulnerabilities

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json`
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Modify: `mobile/package.json`, `mobile/package-lock.json`
- Create: `.github/workflows/dependency-policy.yml`
- Modify: dependency-specific code only when required by a reviewed major-version upgrade

**Interfaces:**
- Produces: reproducible dependency locks with no unaccepted critical/high production advisory and a CI policy that prevents regression.
- Consumes: existing CodeQL/Dependabot configuration.

- [ ] **Step 1: Export current production-only audit reports for all three applications**
- [ ] **Step 2: Classify each critical/high advisory as upgrade, unreachable with evidence, temporary exception with expiry, or release blocker**
- [ ] **Step 3: Upgrade one dependency family at a time and run its focused tests before proceeding**
- [ ] **Step 4: Add CI enforcement for critical/high production advisories and time-bounded exceptions**
- [ ] **Step 5: Run backend, frontend and mobile CI-equivalent suites and commit with `chore: enforce dependency security policy`**

### Task 2: Complete durable observability prerequisites

**Files:**
- Execute: `docs/superpowers/plans/2026-10-04-backend-observability-foundation.md`
- Execute: `docs/superpowers/plans/2026-10-04-client-error-observability.md`
- Execute: `docs/superpowers/plans/2026-10-04-local-log-platform.md`
- Verify against: `docs/superpowers/specs/2026-10-04-durable-observability-design.md`

**Interfaces:**
- Consumes: the existing observability design and plans.
- Produces: request correlation IDs, redacted structured logs, client-error intake, Loki/Grafana and 30-day retention used by alerts and migration diagnostics.

- [ ] **Step 1: Execute the three plans in their documented order**

- [ ] **Step 2: Verify correlation across browser, API, worker and database-error logs**

- [ ] **Step 3: Verify 30-day retention and secret/PII redaction**

- [ ] **Step 4: Commit each existing plan at its own review boundary**

## Workstream 1 — Configuration and economical Railway launch

### Task 3: Introduce the canonical non-secret configuration

**Files:**
- Create: `config/platform.yaml`
- Modify: `backend/package.json`, `backend/package-lock.json` (add one maintained YAML parser)
- Create: `backend/src/config/platform-config.types.ts`
- Create: `backend/src/config/platform-config.loader.ts`
- Create: `backend/src/config/platform-config.loader.spec.ts`
- Modify: `backend/src/config/configuration.ts`
- Modify: `backend/src/config/config.schema.ts`
- Modify: `backend/src/config/app-config.service.ts`
- Create: `scripts/verify-config-boundary.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `docker/.env.example`, `terraform/terraform.tfvars.example`, `k8s/configmap.yaml`

**Interfaces:**
- Produces: `loadPlatformConfig(path: string, env: NodeJS.ProcessEnv): PlatformConfig` and typed `AppConfigService.operations`, `.deployment`, `.providers` and `.migration` getters.
- Consumes: existing environment variable names for backward compatibility.

- [ ] **Step 1: Write loader tests**

  Assert the spec’s exact thresholds, initial mock modes, S3 live-environment mode, 15-minute cutover and 72-hour retention; assert an undeclared YAML key, malformed scalar and unsafe production combination fail with a named path.

- [ ] **Step 2: Run the loader tests and confirm they fail because the loader does not exist**

  Run: `npm test -- platform-config.loader.spec.ts --runInBand` from `backend`. Expected: FAIL.

- [ ] **Step 3: Add the YAML contract and loader**

  Parse one committed file, apply only declared environment overrides, validate with Joi, freeze the result and redact secret-shaped values from validation errors.

- [ ] **Step 4: Route existing configuration through the loader**

  Retain current getter names; remove duplicated provider/mock defaults from Compose and ConfigMap once the typed loader owns them.

- [ ] **Step 5: Add and run the configuration-boundary check**

  `node scripts/verify-config-boundary.mjs` must reject direct `process.env` reads outside `backend/src/config/`, TypeORM bootstrap, build-time frontend configuration and approved scripts.

- [ ] **Step 6: Run backend lint, typecheck and the full configuration/service test suite**

- [ ] **Step 7: Commit**

  Commit message: `feat: centralize platform configuration`.

### Task 4: Deploy the four-service Railway Hobby topology

**Files:**
- Create: `railway/backend.toml`
- Create: `railway/frontend.toml`
- Create: `railway/README.md`
- Create: `.github/workflows/railway-deploy.yml`
- Modify: `docker/Dockerfile.frontend`
- Modify: `frontend/nginx.conf`
- Modify: `backend/src/main.ts`
- Test: `frontend/e2e/railway-smoke.e2e.ts`

**Interfaces:**
- Produces: frontend and API Railway services connected to managed PostgreSQL and Redis over private networking; `/api/health/live`, `/api/health` and WebSocket reachability.
- Consumes: `APP_BASE_URL`, `CORS_ORIGINS`, cookie-domain settings and Railway-injected database/Redis URLs.

- [ ] **Step 1: Write the Railway smoke test**

  Cover health, registration, login, refresh-cookie rotation, authenticated navigation, file-upload presign and Socket.IO reconnect across the configured public origin.

- [ ] **Step 2: Add Railway service definitions and health/restart policies**

  Keep frontend, backend, PostgreSQL and Redis separate on Hobby; use private service addresses for backend dependencies and one public custom domain for the frontend.

- [ ] **Step 3: Make the frontend proxy upstream configurable at container start**

  Preserve local Compose’s `backend:3000`; Railway injects its private API upstream. Do not bake secrets or environment-specific hostnames into the image.

- [ ] **Step 4: Add a gated deploy workflow**

  Build immutable images, run CI, deploy migrations before the API, check health, run the smoke suite and roll back the deployment when smoke checks fail.

- [ ] **Step 5: Verify in a disposable Railway project**

  Record actual idle RAM/CPU, cold start, baseline monthly projection and whether the project is on Trial, Hobby or Pro.

- [ ] **Step 6: Commit**

  Commit message: `feat: add railway hobby deployment`.

### Task 5: Move all beta media to private S3 from day one

**Files:**
- Create: `terraform/bootstrap/main.tf`
- Create: `terraform/bootstrap/variables.tf`
- Create: `terraform/bootstrap/storage.tf`
- Create: `terraform/bootstrap/iam.tf`
- Create: `terraform/bootstrap/outputs.tf`
- Create: `terraform/bootstrap/terraform.tfvars.example`
- Modify: `backend/src/platform/storage/storage-config.ts`
- Modify: `backend/src/platform/storage/storage-config.spec.ts`
- Modify: upload validation/moderation tests under `backend/src/platform/storage/` and `backend/src/platform/moderation/`
- Create: `scripts/storage/reconcile-media.mjs`
- Create: `docs/runbooks/s3-media.md`

**Interfaces:**
- Produces: private versioned bucket, SSE encryption, lifecycle policy, least-privilege Railway IAM credentials and `reconcileMedia(): MediaReconciliationReport`.
- Consumes: existing `StorageService` S3 object-key contract.

- [ ] **Step 1: Write failing privacy and persistence tests**

  Assert public bucket access is impossible, keys are user-scoped, signed URLs expire, cross-user reads fail, oversized/unsupported content fails and an upload survives application redeployment.

- [ ] **Step 2: Add independently applied bootstrap S3 infrastructure and least-privilege policy**

  Permit the application only required object actions on the media prefix; reserve a separate migration-control prefix with different permissions. Confirm `terraform plan` contains no EKS, Aurora, ElastiCache, NAT gateway or load-balancer resources.

- [ ] **Step 3: Add image-size policy and reconciliation reporting**

  Keep the 10 MB hard ceiling, add client/server compression targets where supported, and report database keys missing from S3 plus orphan objects without deleting either automatically.

- [ ] **Step 4: Run storage unit tests and an integration upload/download/delete cycle**

- [ ] **Step 5: Commit**

  Commit message: `feat: store beta media in private s3`.

## Workstream 2 — Capacity telemetry and administrator alerts

### Task 6: Persist capacity snapshots and deduplicated operational alerts

**Files:**
- Create: `backend/src/database/migrations/1710000112000-OperationalAlerts.ts` using the next free timestamp rule
- Create: `backend/src/modules/operations/entities/capacity-snapshot.entity.ts`
- Create: `backend/src/modules/operations/entities/operational-alert.entity.ts`
- Create: `backend/src/modules/operations/capacity/capacity.types.ts`
- Create: `backend/src/modules/operations/capacity/capacity.collector.ts`
- Create: `backend/src/modules/operations/capacity/capacity.collector.spec.ts`
- Create: `backend/src/modules/operations/alerts/alert-evaluator.ts`
- Create: `backend/src/modules/operations/alerts/alert-evaluator.spec.ts`
- Create: `backend/src/modules/operations/operations.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `CapacityCollector.collect(at: Date): Promise<CapacitySnapshot>` and `AlertEvaluator.evaluate(snapshot: CapacitySnapshot): Promise<AlertEvaluationResult>`.
- Consumes: Task 3 thresholds and observability metrics from Task 2.

- [ ] **Step 1: Write schema and collector tests**

  Assert exact registered-account, 24-hour DAU, database-byte and projected-cost values; mock runtime metrics for request count, concurrency, P95, errors and utilization.

- [ ] **Step 2: Write evaluator tests**

  Assert two consecutive hourly count/storage/cost breaches, sustained performance breaches, stable fingerprints, severity promotion, one 24-hour reminder, acknowledgement and automatic resolution.

- [ ] **Step 3: Run the focused tests and confirm failure**

- [ ] **Step 4: Add the migration, entities, collector and evaluator**

  Add a unique open-alert fingerprint constraint and indexes for metric/time and status/severity. Store raw values with units so the UI never guesses conversions.

- [ ] **Step 5: Schedule collection with the same single-owner locking created in Task 1**

- [ ] **Step 6: Run migrations twice and the unit/E2E suite**

  The second migration run must be a no-op; two scheduler instances must produce one snapshot for the same period.

- [ ] **Step 7: Commit**

  Commit message: `feat: collect capacity and operational alerts`.

### Task 7: Deliver operational alerts in-app and by email

**Files:**
- Modify: `backend/src/common/enums/index.ts`
- Modify: `backend/src/modules/notifications/notification-targets.ts`
- Modify: `backend/src/modules/notifications/notification-delivery.ts`
- Modify: `backend/src/modules/notifications/notifications.service.ts`
- Create: `backend/src/modules/operations/alerts/alert-delivery.service.ts`
- Create: `backend/src/modules/operations/alerts/alert-delivery.service.spec.ts`
- Modify: `backend/src/platform/audit/audit.service.ts`
- Modify: `frontend/src/lib/notification-copy.ts`

**Interfaces:**
- Produces: `AlertDeliveryService.deliver(alert: OperationalAlert): Promise<AlertDeliveryResult>` and audit actions for opened, acknowledged, resolved and reminded alerts.
- Consumes: `NotificationsService.createForRole`, `MailService` and Task 6 alert fingerprints.

- [ ] **Step 1: Write delivery tests**

  Assert all active infrastructure administrators receive one in-app alert, only configured recipients receive email, mock email is marked simulated, secrets are absent, a duplicate evaluation sends nothing and a due reminder sends once.

- [ ] **Step 2: Add the operational notification type and total-map entries**

  Target `/admin/infrastructure?alert=:alertId`; keep domain-user notification behavior unchanged.

- [ ] **Step 3: Implement email and audit fan-out**

  Include severity, metric, observed value, threshold, first observed time, recommended action and correlation ID.

- [ ] **Step 4: Run notification, mail, alert and enum-totality tests**

- [ ] **Step 5: Commit**

  Commit message: `feat: notify admins of operational thresholds`.

### Task 8: Add the administrator Infrastructure dashboard

**Files:**
- Create: `backend/src/modules/operations/operations.controller.ts`
- Create: `backend/src/modules/operations/dto/operations.dto.ts`
- Create: `backend/src/modules/operations/operations.controller.spec.ts`
- Create: `frontend/src/pages/admin/AdminInfrastructure.tsx`
- Create: `frontend/src/components/admin/infrastructure/CapacityStatus.tsx`
- Create: `frontend/src/components/admin/infrastructure/OperationalAlerts.tsx`
- Create: `frontend/src/components/admin/infrastructure/MigrationReadiness.tsx`
- Create: `frontend/src/pages/admin/AdminInfrastructure.test.tsx`
- Modify: `frontend/src/pages/admin/AdminDashboard.tsx`
- Modify: `frontend/src/pages/admin/AdminLayout.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: backend/frontend permission enums and tests

**Interfaces:**
- Produces: `GET /admin/operations/status`, `GET /admin/operations/alerts`, `POST /admin/operations/alerts/:id/acknowledge` and `/admin/infrastructure`.
- Consumes: Tasks 6–7 snapshots, alerts and delivery metadata.

- [ ] **Step 1: Add `admin:infrastructure:read` and `admin:infrastructure:migrate` permission tests**

  Only administrator roles receive either permission; read-only admin UI checks the read permission and migration endpoints separately require migrate permission.

- [ ] **Step 2: Write controller and component tests**

  Assert exact units/thresholds, stale-data treatment, warning/critical ordering, acknowledgement actor/time, email delivery state and an unavailable migration button when readiness is red.

- [ ] **Step 3: Implement read and acknowledgement endpoints**

- [ ] **Step 4: Implement the admin page and dashboard summary**

  Show measured value, warning/critical thresholds, collection time and source. Never infer green from missing data; render `unknown` and block migration.

- [ ] **Step 5: Run backend/frontend unit tests, typechecks and an admin Playwright walk**

- [ ] **Step 6: Commit**

  Commit message: `feat: add admin infrastructure dashboard`.

## Workstream 3 — Safe migration control plane

### Task 9: Add MFA step-up authorization for destructive infrastructure actions

**Files:**
- Create: `backend/src/modules/auth/step-up.service.ts`
- Create: `backend/src/modules/auth/step-up.guard.ts`
- Create: `backend/src/modules/auth/step-up.service.spec.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/auth/dto/auth.dto.ts`
- Modify: `backend/src/modules/auth/auth.module.ts`
- Create: `frontend/src/components/admin/infrastructure/StepUpDialog.tsx`
- Test: component tests and backend E2E under `backend/test/`

**Interfaces:**
- Produces: `POST /auth/step-up` returning a five-minute JWT with `scope: admin:infrastructure:migrate`, `sub`, `jti` and `auth_time`; `RequireStepUpGuard` consumes it from `X-Step-Up-Token`.
- Consumes: the existing password hash, TOTP and recovery-code verification paths without duplicating their algorithms.

- [ ] **Step 1: Write tests for password+TOTP, recovery code, expiry, wrong scope, replay and administrator-without-MFA**

- [ ] **Step 2: Implement the scoped step-up service and guard**

  Store consumed `jti` values in Redis for the remaining token TTL so a token can start only one migration.

- [ ] **Step 3: Add the step-up dialog**

  Keep secrets in component state only, clear on close/error and never place them in query caches or logs.

- [ ] **Step 4: Run auth unit/E2E and frontend component tests**

- [ ] **Step 5: Commit**

  Commit message: `feat: require admin step up for migration`.

### Task 10: Implement the migration state machine and mock executor

**Files:**
- Create: `backend/src/database/migrations/1710000113000-MigrationControlPlane.ts` using the next free timestamp rule
- Create: `backend/src/modules/operations/entities/migration-run.entity.ts`
- Create: `backend/src/modules/operations/entities/migration-event.entity.ts`
- Create: `backend/src/modules/operations/migration/migration.types.ts`
- Create: `backend/src/modules/operations/migration/migration-state-machine.ts`
- Create: `backend/src/modules/operations/migration/migration-state-machine.spec.ts`
- Create: `backend/src/modules/operations/migration/migration-executor.ts`
- Create: `backend/src/modules/operations/migration/mock-migration.executor.ts`
- Create: `backend/src/modules/operations/migration/mock-migration.executor.spec.ts`
- Modify: operations controller/DTO/module

**Interfaces:**
- Produces: `MigrationExecutor.start(run: MigrationRun): Promise<ExecutorStartResult>`, `MigrationStateMachine.apply(run, event): MigrationRun`, `POST /admin/operations/migrations`, `GET /admin/operations/migrations/:id`, and pre-read-only cancellation.
- Consumes: Task 3 policy, Task 8 readiness, Task 9 step-up token and `AuditService`.

- [ ] **Step 1: Write state-transition and concurrency tests**

  Assert all allowed transitions from the spec, reject skips/backward moves, make duplicate events no-ops, prohibit cancellation at/after read-only and permit only one active run.

- [ ] **Step 2: Write mock-executor tests**

  Cover successful progression, failure injection at each stage, rollback before write enablement, no external calls and deterministic timestamps under a fake clock.

- [ ] **Step 3: Implement entities, constraints and state machine**

  Give each event a unique `(runId, externalEventId)` key and each run the requested commit SHA, executor kind, config digest and rollback boundary.

- [ ] **Step 4: Add protected endpoints and audit actions**

  Starting requires green readiness, `migration.enabled`, a fresh backup, migration permission and the consumed step-up token. Mock runs are allowed only when `executor: mock`.

- [ ] **Step 5: Run two concurrent-start E2E requests**

  Expected: one `202 Accepted`, one `409 Conflict`, one active database row and one external dispatch.

- [ ] **Step 6: Commit**

  Commit message: `feat: add mock aws migration workflow`.

### Task 11: Complete the migration experience in the admin portal

**Files:**
- Create: `frontend/src/components/admin/infrastructure/MigrationTimeline.tsx`
- Create: `frontend/src/components/admin/infrastructure/MigrationConfirmation.tsx`
- Modify: `frontend/src/pages/admin/AdminInfrastructure.tsx`
- Create: `frontend/src/pages/admin/AdminInfrastructure.migration.test.tsx`
- Create: `frontend/e2e/admin-migration.e2e.ts`

**Interfaces:**
- Produces: one primary `Start AWS migration` action, step-up/confirmation flow, live timeline, safe cancellation before read-only and downloadable result metadata.
- Consumes: Tasks 8–10 APIs and WebSocket/poll fallback.

- [ ] **Step 1: Write UI tests for readiness blockers and confirmation content**

  Assert cost range, source/target, commit SHA, backup age, 15-minute window, 72-hour retention and rollback boundary are visible before start.

- [ ] **Step 2: Write the mock migration browser test**

  Start with step-up, observe every state, refresh mid-run without losing state, reject a second start, inject one failure and verify the rolled-back terminal state plus alert/email marker.

- [ ] **Step 3: Implement the confirmation, action and live timeline**

  Use accessible progress semantics and textual states; never show success until the backend reports `completed`.

- [ ] **Step 4: Run frontend unit, typecheck, build and Playwright**

- [ ] **Step 5: Commit**

  Commit message: `feat: add admin migration control center`.

## Workstream 4 — AWS Option B and real migration automation

### Task 12: Finish and validate AWS Option B infrastructure

**Files:**
- Modify: `terraform/main.tf`, `variables.tf`, `vpc.tf`, `eks.tf`, `rds.tf`, `elasticache.tf`, `outputs.tf`
- Create: `terraform/alb.tf`, `waf.tf`, `cloudfront.tf`, `iam.tf`, `monitoring.tf`, `secrets.tf`, `backend.hcl.example`
- Modify: `terraform/terraform.tfvars.example`, `terraform/README.md`
- Modify/Create: Kubernetes manifests under `k8s/` for application, workers, autoscaling, network policies and observability
- Create: `.github/workflows/terraform-plan.yml`

**Interfaces:**
- Produces: Terraform outputs `app_url`, `api_url`, `aurora_writer_endpoint`, `redis_primary_endpoint`, `eks_cluster_name`, `ecr_repository_urls`, `migration_bucket`, and `deployment_role_arn`.
- Consumes: immutable container image digests and Task 3 production configuration.

- [ ] **Step 1: Add static infrastructure tests**

  Run `terraform fmt -check`, `terraform validate`, TFLint, Checkov/tfsec and policy assertions for three AZs, private nodes/databases, encryption, backups, deletion protection, WAF, least privilege and standard-support Kubernetes.

- [ ] **Step 2: Replace Kubernetes 1.29 and parameterize right-sized launch capacity**

  Keep three-AZ scheduling; separate stateless and observability capacity where necessary. Do not enable EKS extended-support billing.

- [ ] **Step 3: Add remote state and GitHub OIDC deployment roles**

  Bootstrap state/lock resources separately so the migration workflow cannot accidentally destroy its own state store.

- [ ] **Step 4: Complete networking, data, edge, secrets and monitoring resources**

- [ ] **Step 5: Apply to a disposable rehearsal environment and run failure-zone checks**

  Terminate one node and verify workloads recover; force a database failover; verify private resources have no public route.

- [ ] **Step 6: Export a versioned Terraform plan summary to the admin readiness feed**

- [ ] **Step 7: Commit**

  Commit message: `feat: complete aws option b infrastructure`.

### Task 13: Build signed workflow dispatch and callback handling

**Files:**
- Create: `.github/workflows/migrate-to-aws.yml`
- Create: `backend/src/modules/operations/migration/github-migration.executor.ts`
- Create: `backend/src/modules/operations/migration/github-migration.executor.spec.ts`
- Create: `backend/src/modules/operations/migration/migration-callback.controller.ts`
- Create: `backend/src/modules/operations/migration/migration-callback.guard.ts`
- Create: corresponding controller/guard specs
- Modify: Task 3 configuration and schema for GitHub App/environment identifiers and callback secret references

**Interfaces:**
- Produces: real `MigrationExecutor`, `POST /internal/migrations/:runId/events`, HMAC canonicalization and callback replay cache.
- Consumes: Task 10 state-machine events and Task 12 Terraform outputs.

- [ ] **Step 1: Write dispatch tests**

  Assert only run ID, commit SHA and non-secret config digest leave the backend; GitHub App credentials never appear in logs or database rows.

- [ ] **Step 2: Write callback security tests**

  Assert valid signature/time succeeds; wrong signature, expired timestamp, reused nonce, unknown run and invalid transition fail without mutation.

- [ ] **Step 3: Implement the GitHub executor and callback guard**

- [ ] **Step 4: Add a protected GitHub environment and AWS OIDC**

  Restrict secrets, branches and OIDC claims without adding a second human approval: the signed, single-use admin authorization is the one human action. Production apply, DNS change and write enablement still require machine-verified readiness gates inside the workflow.

- [ ] **Step 5: Run a mock-dispatch integration against a temporary repository environment**

- [ ] **Step 6: Commit**

  Commit message: `feat: dispatch signed aws migration workflow`.

### Task 14: Implement PostgreSQL synchronization, reconciliation and maintenance mode

**Files:**
- Create: `backend/src/platform/maintenance/maintenance.guard.ts`
- Create: `backend/src/platform/maintenance/maintenance.service.ts`
- Create: `backend/src/platform/maintenance/maintenance.spec.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/main.ts`
- Create: `scripts/migration/export-postgres.ps1` and Linux-equivalent workflow script if required
- Create: `scripts/migration/import-aurora.sh`
- Create: `scripts/migration/reconcile-postgres.ts`
- Create: `scripts/migration/reconcile-postgres.spec.ts`
- Create: `scripts/migration/set-dns.ts`
- Create: `scripts/migration/smoke-target.ts`
- Modify: `.github/workflows/migrate-to-aws.yml`

**Interfaces:**
- Produces: signed maintenance-state controls, encrypted export/import, `ReconciliationReport` with schema version/table counts/sequences/critical checksums, DNS change receipt and smoke-test report.
- Consumes: Railway/Aurora connection secrets, Task 2 correlation/logging and Task 13 callbacks.

- [ ] **Step 1: Write maintenance-guard tests**

  Assert ordinary mutations return `503` with retry metadata while reads, health and signed migration callbacks continue; verify operator authentication remains available without permitting business writes.

- [ ] **Step 2: Write reconciliation tests with deliberately corrupted fixtures**

  Detect a missing row, altered wedding budget/date/status value, incorrect sequence, schema mismatch and unexpected table; redact PII from the report.

- [ ] **Step 3: Implement encrypted export/import and reconciliation**

  Use PostgreSQL-native consistent snapshots. Never copy Redis sessions as authoritative state; require users to refresh/re-authenticate if cache recreation invalidates a session.

- [ ] **Step 4: Implement DNS and target smoke scripts as idempotent operations**

  Require the expected current DNS value before update and record old/new values for rollback.

- [ ] **Step 5: Compose the workflow stages with timeouts and compensating actions**

  If final sync/reconciliation exceeds 15 minutes or fails, restore Railway writes and DNS, emit `rolled_back` and do not enable AWS writes.

- [ ] **Step 6: Commit**

  Commit message: `feat: automate verified railway aws cutover`.

## Workstream 5 — Rehearsal, launch and controlled activation

### Task 15: Prove capacity and establish measured Railway limits

**Files:**
- Extend: `backend/test/k6/`
- Create: `backend/test/k6/railway-capacity.js`
- Create: `backend/test/k6/railway-capacity-thresholds.json`
- Create: `docs/reports/railway-capacity-baseline.md`
- Modify: Task 3 threshold overrides only if evidence requires it

**Interfaces:**
- Produces: measured maximums and recommended operating limits for registration/login, discovery, chat, planner operations, bookings and uploads.
- Consumes: Railway staging topology and sanitized representative data.

- [ ] **Step 1: Define representative traffic mix and seed volume**

  Include all roles, 10,000-account data shape, realistic photo references, chat reconnects and read/write ratios without real PII.

- [ ] **Step 2: Run ramp, spike, soak and recovery tests**

  Record CPU, RAM, PostgreSQL connections/latency, Redis latency, P50/P95/P99, errors and cost projection.

- [ ] **Step 3: Validate or lower—not raise without evidence—the planning thresholds**

  The system must retain at least 30% resource headroom at the published operating limit.

- [ ] **Step 4: Commit the test and evidence report**

  Commit message: `test: establish railway capacity baseline`.

### Task 16: Rehearse success and rollback end to end

**Files:**
- Create: `docs/runbooks/railway-launch.md`
- Create: `docs/runbooks/aws-migration.md`
- Create: `docs/runbooks/aws-migration-rollback.md`
- Create: `docs/runbooks/aws-decommission-railway.md`
- Create: `docs/reports/aws-migration-rehearsal.md`
- Extend: `frontend/e2e/admin-migration.e2e.ts`

**Interfaces:**
- Produces: signed rehearsal evidence and the readiness flag consumed by the real migration button.
- Consumes: all prior workstreams.

- [ ] **Step 1: Rehearse a successful migration of a sanitized production-sized dataset**

  Verify exact table counts, sampled field checksums, stored S3 keys, login/refresh, every role’s critical journey, WebSockets, background work, logs, alerts, TLS and DNS.

- [ ] **Step 2: Rehearse failure before DNS**

  Corrupt one target value; expect reconciliation failure, Railway writes restored and no DNS change.

- [ ] **Step 3: Rehearse failure after DNS but before AWS writes**

  Fail a synthetic journey; expect DNS restored, Railway writes restored and no split-brain data.

- [ ] **Step 4: Test restoration from encrypted backup in an isolated environment**

  Record recovery time and recovery point; a backup does not count as ready until restore succeeds.

- [ ] **Step 5: Obtain security, operations and product sign-off**

  Enable `migration.executor: github` and `migration.enabled: true` only after every acceptance item is attached to the rehearsal record.

- [ ] **Step 6: Commit runbooks and evidence**

  Commit message: `docs: add verified migration runbooks`.

### Task 17: Launch Railway beta and operate the migration gate

**Files:**
- Modify only environment configuration/secrets and deployment records; no unreviewed source edits during launch.
- Record: `docs/reports/railway-beta-launch.md`

**Interfaces:**
- Produces: live Railway Hobby beta with S3, alerts, backups, dashboards and a disabled or mock migration executor until rehearsal sign-off.
- Consumes: Tasks 1–16.

- [ ] **Step 1: Deploy Railway Hobby with mock business providers and S3 media**

- [ ] **Step 2: Run the complete live Playwright role suite and UI-to-database reconciliation**

- [ ] **Step 3: Verify daily backup, restore evidence, 30-day log retention and every alert channel**

- [ ] **Step 4: Configure Railway soft/hard spend limits above normal operation but below unacceptable exposure**

  Never set the hard limit at the migration threshold; alert early enough to preserve operating time.

- [ ] **Step 5: Run the mock migration from the admin portal in production configuration**

  Confirm it has no external side effects and all administrators receive the intended simulated notices.

- [ ] **Step 6: Publish the beta launch report and begin weekly capacity review**

## Final verification gate

- [ ] Backend lint and typecheck pass.
- [ ] Backend unit, migration and E2E suites pass with no skipped migration-control tests.
- [ ] Frontend typecheck, unit tests and production build pass.
- [ ] Mobile typecheck and Android export still pass against unchanged API contracts.
- [ ] Docker production images build and pass vulnerability policy.
- [ ] Terraform format, validate, lint, security and disposable apply tests pass.
- [ ] Railway live smoke and all-role Playwright suites pass.
- [ ] Exact PostgreSQL reconciliation passes on the rehearsal dataset.
- [ ] Successful and failed migration rehearsals are documented.
- [ ] The real migration button is disabled unless config, permissions, MFA, backup, Terraform plan, rehearsal and budget gates are all green.
- [ ] Unrelated working-tree changes remain untouched.

## Recommended execution order and estimated effort

| Workstream | Engineering estimate | Exit condition |
|---|---:|---|
| Release safety prerequisites | 1.5–3 weeks | Public-beta security and observability gates green |
| Config + Railway + S3 | 1–2 weeks | Stable Hobby deployment and durable uploads |
| Metrics + alerts + admin dashboard | 1.5–2.5 weeks | Exact warnings visible and emailed without duplicates |
| Mock migration control plane | 1.5–2 weeks | Full safe workflow exercised without side effects |
| AWS infrastructure + real executor | 3–5 weeks | Disposable Option B and signed workflow pass |
| Rehearsal + beta launch | 1–2 weeks | Success/rollback evidence and launch sign-off |

With one experienced platform/backend engineer plus frontend support, plan on roughly **9–16 weeks**. Parallel work can shorten calendar time only after Task 3 fixes the configuration interfaces and Task 6 fixes the operations data contracts.
