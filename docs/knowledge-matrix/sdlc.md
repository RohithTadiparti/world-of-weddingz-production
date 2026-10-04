# SDLC operating model

## 1. Intake

- Assign a stable work-item ID from `open-items.csv`.
- Record user-visible intent, dependencies, acceptance criteria and source commits.
- Create or link the GitHub issue before code changes.

## 2. Design

- Update the applicable specification and requirement rows.
- Record security, data, migration and rollback effects.
- Keep mock/live provider behavior explicit.

## 3. Implementation

- Create `codex/<work-item-id>-<short-name>` from current `main`.
- Follow test-first development for behavior changes.
- Do not add credentials, user data, generated build output or environment files.

## 4. Verification

- Run focused tests, then all affected project suites.
- Required gates include lint, typecheck, unit tests, database migrations, backend E2E, frontend tests/build, mobile typecheck/export, Playwright, dependency audit and security scanning.
- Attach exact commands and results to the PR.

## 5. Review

- Every change reaches `main` through a PR.
- The PR identifies the work item, requirement IDs, risk changes, source commits and rollback procedure.
- Critical/high security findings and failed required checks block merge.

## 6. Release

- Promote immutable commit/image identifiers.
- Run migrations separately and verify health before traffic change.
- Update the release-gate register with evidence.
- Domain attachment and public Railway launch are final-gate actions, not development setup.

## 7. Operate

- Monitor availability, latency, errors, capacity, costs, backups and security events.
- Create an operational issue for every unresolved alert that crosses its escalation period.
- Keep logs for 30 days and preserve correlation IDs.

## 8. Improve

- Review incidents, escaped defects, flaky tests, capacity forecasts and source-repository drift.
- Convert findings into identified open items; do not leave actions only in meeting/chat notes.
