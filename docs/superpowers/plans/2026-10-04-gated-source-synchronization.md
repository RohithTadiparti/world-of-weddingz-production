# Gated Source Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuously detect committed WOW-MD changes and prevent shared production changes from being accepted without a reviewed WOW-MD mirror path.

**Architecture:** A scheduled GitHub workflow checks out the private WOW-MD repository with a narrowly scoped secret, generates a deterministic commit/path/dependency report, and updates issue `SYNC-002` without merging code. A separate pull-request gate detects shared-path changes in production and requires a linked WOW-MD mirror PR, so changes flow through review in both repositories instead of copying either tree wholesale.

**Tech Stack:** GitHub Actions, Node.js 20 scripts/tests, Git, CSV governance registers

**Spec:** `docs/governance/source-integration.md`

## Global Constraints

- Never merge `WOW-MD/main` into production wholesale.
- Never modify the active dirty WOW checkout.
- Only committed and pushed WOW-MD changes can enter the scheduled review.
- Cross-repository access uses the `WOW_SYNC_TOKEN` GitHub secret; no credential is committed.
- Shared code and dependency changes require a separate WOW-MD pull request and code review.
- Synchronization reports may classify and propose changes but may not merge them.

## Review Focus

- Missing or invalid source baseline must stop classification instead of treating the whole source history as new.
- A source force-push that removes the reviewed baseline must be reported as an error.
- Dependency manifests and lockfiles must be classified explicitly rather than hidden among general code paths.
- Production-only documentation and tracking changes must not require a WOW-MD mirror PR.
- A shared-code production PR without a valid WOW-MD PR URL must fail its governance gate.

---

### Task 1: Deterministic source-change report

**Files:**
- Create: `scripts/source-sync/report.mjs`
- Create: `scripts/source-sync/report.test.mjs`

**Interfaces:**
- Consumes: source repository directory, reviewed source SHA, and output directory from CLI arguments.
- Produces: `source-sync-report.json` and `source-sync-report.md` with commit, path, classification, and dependency-change evidence.

- [ ] **Step 1: Write failing tests for no-change, functional/UI, dependency, unsafe/local-only, and missing-baseline histories**
- [ ] **Step 2: Run `node --test scripts/source-sync/report.test.mjs` and confirm failures because the report command does not exist**
- [ ] **Step 3: Implement the minimal report generator and CLI validation**
- [ ] **Step 4: Run the focused test and confirm all fixtures pass**
- [ ] **Step 5: Commit with `feat: add deterministic source synchronization report`**

### Task 2: Scheduled review without automatic merge

**Files:**
- Create: `.github/workflows/source-sync-review.yml`
- Modify: `docs/governance/source-integration.md`
- Modify: `docs/knowledge-matrix/access-matrix.md`
- Modify: `docs/tracking/registers/access.csv`
- Modify: `docs/tracking/registers/document-register.csv`

**Interfaces:**
- Consumes: Task 1 report command and repository secret `WOW_SYNC_TOKEN`.
- Produces: daily/manual synchronization artifact, job summary, and an idempotently updated bot comment on issue `#32`.

- [ ] **Step 1: Add workflow validation tests that execute the report and reject write/merge steps**
- [ ] **Step 2: Run governance tests and confirm the new checks fail before the workflow exists**
- [ ] **Step 3: Add the scheduled/manual workflow and document the least-privilege token requirements**
- [ ] **Step 4: Run governance tests and a local source report against the current private source checkout**
- [ ] **Step 5: Commit with `ci: schedule gated source change reviews`**

### Task 3: Shared-code and dependency mirror gate

**Files:**
- Create: `.production/shared-source-paths.json`
- Create: `scripts/source-sync/mirror-gate.mjs`
- Create: `scripts/source-sync/mirror-gate.test.mjs`
- Modify: `.github/workflows/governance.yml`
- Modify: `.github/pull_request_template.md`
- Modify: `docs/governance/source-integration.md`

**Interfaces:**
- Consumes: pull-request base/head SHAs, changed paths, and PR body.
- Produces: success for production-only changes; otherwise requires a `WOW-MD mirror PR` URL and records whether dependency files changed.

- [ ] **Step 1: Write failing tests for production-only, shared-code, dependency, missing-link, and valid-link cases**
- [ ] **Step 2: Run `node --test scripts/source-sync/mirror-gate.test.mjs` and confirm failure because the gate is absent**
- [ ] **Step 3: Implement the gate, configuration, PR fields, and required governance job**
- [ ] **Step 4: Run focused tests and the full governance suite**
- [ ] **Step 5: Commit with `ci: require reviewed WOW mirrors for shared changes`**

### Task 4: Traceability and management tracker

**Files:**
- Modify: `docs/tracking/registers/open-items.csv`
- Modify: `docs/tracking/registers/change-intake.csv`
- Modify: `docs/tracking/registers/pr-handoffs.csv`
- Modify: `docs/tracking/production-readiness-tracker.xlsx`

**Interfaces:**
- Consumes: verified implementation evidence from Tasks 1-3.
- Produces: PR-ready `SYNC-002` handoff and regenerated Excel management view.

- [ ] **Step 1: Record status, access prerequisite, tests, rollback, and residual risk in canonical registers**
- [ ] **Step 2: Regenerate the workbook from the canonical CSV registers**
- [ ] **Step 3: Verify workbook formulas, render the dashboard, and compare the Desktop copy byte-for-byte**
- [ ] **Step 4: Run the full governance suite and commit with `docs: record gated synchronization evidence`**
