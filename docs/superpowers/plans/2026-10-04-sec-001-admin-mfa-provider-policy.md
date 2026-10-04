# Administrator MFA and Production Provider Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent administrator access without enrolled MFA and make public/revenue deployments fail closed when security-critical providers or transport settings are unsafe.

**Architecture:** Authentication rejects unenrolled administrators at login and at JWT validation, covering both new and existing sessions. A typed deployment tier drives boot-time Joi policy checks. Zoho Mail uses the existing SMTP adapter with documented regional host/app-password configuration; it delivers account email but does not replace authenticator-based MFA.

**Tech Stack:** NestJS, TypeScript, Jest, Joi, Nodemailer SMTP, TOTP/otplib, Docker/Kubernetes configuration

**Spec:** `docs/superpowers/specs/2026-10-04-railway-first-aws-migration-design.md`

## Global Constraints

- Administrators cannot receive privileged access without enrolled TOTP MFA when `MFA_REQUIRED_FOR_ADMIN=true`.
- Existing administrator access tokens are denied after the policy is enabled if MFA is not enrolled.
- Local Docker remains usable through `DEPLOYMENT_TIER=local`; public deployments explicitly select `public-beta` or `revenue`.
- `public-beta` requires HTTPS/cookies, private Swagger, SMTP mail, private S3 and administrator MFA.
- `revenue` additionally rejects mock payment and identity providers or missing credentials.
- Zoho credentials remain outside Git; the sender must match the authenticated address or alias.
- Every shared production change is mirrored in a separate WOW-MD PR before the production PR can pass governance.

## Review Focus

- An administrator with a previously issued access token but no MFA enrollment must be rejected.
- An administrator with MFA enabled must still receive the normal TOTP challenge rather than an enrollment error.
- Local/test environments must not be broken by public deployment policy.
- Zoho SMTP port 465 must use secure mode while port 587 uses TLS upgrade mode.
- Revenue mode must not start with mock payment/identity providers or incomplete live-provider credentials.

---

### Task 1: Boot-time deployment/provider policy

**Files:**
- Modify: `backend/src/config/config.schema.ts`
- Modify: `backend/src/config/configuration.ts`
- Create: `backend/src/config/config.schema.spec.ts`
- Modify: `backend/.env.example`
- Modify: `docker/.env.example`
- Modify: `docker/docker-compose.yml`
- Modify: `k8s/configmap.yaml`
- Modify: `k8s/secret.example.yaml`

**Interfaces:**
- Produces: `runtime.deploymentTier` with `local | staging | public-beta | revenue` and fail-closed boot validation.
- Consumes: existing provider, cookie, CORS, storage, mail, payment and identity environment variables.

- [ ] **Step 1: Write failing schema tests for safe local, unsafe public-beta, Zoho-compatible SMTP, and unsafe revenue configurations**
- [ ] **Step 2: Run the focused schema test and confirm policy cases fail before implementation**
- [ ] **Step 3: Add deployment-tier parsing, policy validation and environment examples**
- [ ] **Step 4: Run schema tests, typecheck and lint**
- [ ] **Step 5: Commit with `fix: fail closed on unsafe production providers`**

### Task 2: Enforce administrator MFA across login and existing sessions

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.service.spec.ts`
- Modify: `backend/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/modules/auth/strategies/jwt.strategy.spec.ts`

**Interfaces:**
- Produces: `MFA_ENROLLMENT_REQUIRED` refusal for unenrolled admins and JWT rejection for existing unenrolled admin sessions.
- Consumes: `auth.mfaRequiredForAdmin`, user role and persisted `mfaEnabled`.

- [ ] **Step 1: Write failing login and JWT tests for an unenrolled administrator plus controls for enabled and non-admin accounts**
- [ ] **Step 2: Run focused auth tests and confirm the unenrolled-admin cases fail**
- [ ] **Step 3: Implement minimal login/JWT enforcement without weakening existing TOTP challenges**
- [ ] **Step 4: Run auth/JWT tests, backend typecheck and lint**
- [ ] **Step 5: Commit with `fix: require enrolled MFA for administrator access`**

### Task 3: Zoho Mail operating guide and source mirror

**Files:**
- Create: `docs/operations/zoho-mail.md`
- Modify: `docs/knowledge-matrix/access-matrix.md`
- Modify: `docs/tracking/registers/access.csv`
- Modify: `docs/tracking/registers/document-register.csv`
- Mirror shared Task 1-2 files in a WOW-MD branch/PR based on `origin/main`.

**Interfaces:**
- Produces: exact Zoho SMTP setup/rotation/test/rollback steps and a linked WOW-MD mirror PR.
- Consumes: the existing generic Nodemailer SMTP adapter; no Zoho-specific SDK.

- [ ] **Step 1: Document verified Zoho SMTP hosts, ports, app-password requirement, sender rule and secret locations**
- [ ] **Step 2: Apply shared changes to an isolated WOW-MD worktree and run focused backend verification**
- [ ] **Step 3: Open the WOW-MD mirror PR and record its URL in the production PR**
- [ ] **Step 4: Commit production documentation with `docs: add Zoho Mail production runbook`**

### Task 4: Production handoff and tracker

**Files:**
- Modify: `docs/tracking/registers/open-items.csv`
- Modify: `docs/tracking/registers/pr-handoffs.csv`
- Modify: `docs/tracking/registers/test-inventory.csv`
- Modify: `docs/tracking/registers/risks.csv`
- Modify: `docs/tracking/production-readiness-tracker.xlsx`

**Interfaces:**
- Consumes: verified Tasks 1-3 and both PR URLs.
- Produces: review-ready SEC-001 traceability, test evidence, rollback and residual-risk record.

- [ ] **Step 1: Record the production and source PRs, exact tests, deployment sequence and residual enrollment risk**
- [ ] **Step 2: Regenerate the workbook and Desktop copy from canonical CSV registers**
- [ ] **Step 3: Verify formulas, visual dashboard, byte equality and complete affected suites**
- [ ] **Step 4: Commit with `docs: record SEC-001 security evidence`**
