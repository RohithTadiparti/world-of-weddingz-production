# Task and PR handoff protocol

These rules apply to every automated or human contributor.

## Before work

1. Read `PRODUCTION_PROGRAM.md`, the knowledge matrix, the applicable spec/plan and the repository `AGENTS.md` if present.
2. Select one open item with satisfied dependencies.
3. Put the GitHub issue URL in the work item and mark it `In Progress` with claimant and timestamp.
4. Create branch `codex/<item-id-lowercase>-<short-name>`.
5. If the change came from `WOW-MD`, add every source commit to `change-intake.csv`.

## During work

- Follow test-first development for behavior changes.
- Keep commits scoped to the selected item.
- Record decisions that change the specification, security boundary, data model, deployment or rollback.
- Update tests and documentation in the same PR.

## Mandatory PR content

Every implementing PR must state:

- work-item and requirement IDs;
- linked GitHub issue;
- source-repository commit IDs, or `None`;
- user-visible behavior and non-goals;
- database/configuration/infrastructure effects;
- security and privacy effects;
- exact tests run with results;
- screenshots/reports where applicable;
- deployment steps;
- rollback steps and irreversible boundary;
- residual risks and follow-up IDs.

The contributor must place the PR URL in `open-items.csv` and add a row to `pr-handoffs.csv` before requesting review. A task without a PR is not ready for another contributor to treat as complete.

## Handoff states

- `Open`: unclaimed.
- `In Progress`: branch exists and claimant is named.
- `PR Open`: PR URL and verification are recorded.
- `Blocked`: exact blocker and required actor are recorded.
- `Done`: PR merged, evidence recorded, requirement/test/risk registers updated.

## Resume checklist

A new contributor reads the issue, PR conversation, commit range, tests, rulings, remaining risks and last evidence. If any is missing, the contributor repairs the handoff record before modifying code.
