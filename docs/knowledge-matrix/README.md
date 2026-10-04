# Knowledge matrix

This directory is the entry point for the complete software-delivery lifecycle. Every requirement, work item, test family, risk, decision, release gate, document and source change must have a stable identifier and evidence link.

## Matrix

| Area | Canonical document/register | Required evidence |
|---|---|---|
| Product and deployment decisions | `docs/superpowers/specs/2026-10-04-railway-first-aws-migration-design.md` | Approved design and later decision records |
| Implementation sequence | `docs/superpowers/plans/2026-10-04-railway-first-aws-migration.md` | Task commits and PRs |
| Requirements traceability | `docs/tracking/registers/requirements.csv` | Test IDs, issue and PR links |
| Open work | `docs/tracking/registers/open-items.csv` | GitHub issue and implementing PR |
| Test coverage | `docs/knowledge-matrix/test-strategy.md`, `docs/tracking/registers/test-inventory.csv` | CI run, report or QA workbook |
| Existing detailed QA cases | `docs/evidence/qa/WOW_End_to_End_QA_Report_2026-10-04.xlsx` | 865 executed cases and 426 API operations |
| Risks | `docs/tracking/registers/risks.csv` | Mitigation owner and closure evidence |
| Access | `docs/knowledge-matrix/access-matrix.md`, `docs/tracking/registers/access.csv` | Named owner and verified date, never a secret |
| Release gates | `docs/tracking/registers/release-gates.csv` | Evidence URL/path and approver |
| Source-repository intake | `docs/governance/source-integration.md`, `docs/tracking/registers/change-intake.csv` | Source commit and production PR |
| Agent/LLM handoff | `docs/governance/LLM_TASK_PROTOCOL.md`, `.github/pull_request_template.md` | Issue claim, branch, PR and test evidence |
| Documents | `docs/tracking/registers/document-register.csv` | Owner, status and review date |
| PR handoffs | `docs/tracking/registers/pr-handoffs.csv` | PR, work item, commit range and remaining risks |

## Traceability rule

No production change is complete unless this chain is present:

`Requirement → open item/GitHub issue → branch → PR → tests → release gate/evidence`

If a change originates in `WOW-MD`, add the source commit to the change-intake register before implementation. Never merge the source repository wholesale.
