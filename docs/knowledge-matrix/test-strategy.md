# Test strategy and evidence model

## Mandatory layers

| Layer | Scope | Merge gate |
|---|---|---|
| Static | formatting, lint, TypeScript, migration ordering and configuration boundaries | Required |
| Unit | services, guards, state machines, adapters and UI components | Required |
| Database E2E | migrations, constraints, locking, row-level outcomes and rollback | Required |
| API contract | every Swagger operation inventoried; critical operations executed across allowed/denied states | Required for affected APIs |
| Browser E2E | registration, recovery, every role, planner/self-managed wedding and admin operations | Required |
| Mobile | typecheck, bundle/export and critical auth/profile flows | Required for shared/mobile changes |
| Security | CodeQL, dependency policy, secret scan, container/IaC scan and focused abuse cases | Required |
| Performance | ramp, spike, soak and recovery with representative data | Required before public launch and threshold changes |
| Resilience | backup restore, node/service loss, failed migration and DNS rollback | Required before real migration enablement |
| Data reconciliation | exact counts, sequences and critical-field checksums between source and target/UI | Required for deployment migration |

## Case identification

Use IDs shaped as `AREA-FLOW-NNN`, for example `AUTH-RESET-001` or `MIG-ROLLBACK-004`. Each case records role, preconditions, test data class, steps, expected result, automation location, environment and latest evidence.

The historical detailed workbook at `docs/evidence/qa/WOW_End_to_End_QA_Report_2026-10-04.xlsx` is the baseline evidence set. It includes 865 executed cases, 105 role screens, 46 UI/database comparisons and all 426 Swagger operations. Its explicit backlog remains open until replaced by newer evidence.

## Exact-data rule

A database-to-UI comparison passes only when every required value matches after documented presentation normalization. Unrelated mismatches are failures, not warnings. Tests must retain the source query, UI locator/API field and compared value without storing real personal data in the repository.

## Evidence retention

- CI results: retain according to repository policy, minimum 90 days for release runs.
- Playwright traces/screenshots: retain on failure and for release certification.
- Release test report: commit only sanitized summaries; store large/raw artifacts in the release or protected artifact store.
- Logs: 30 days.
- Migration reconciliation and restore evidence: retain for the life of the release plus 90 days.
