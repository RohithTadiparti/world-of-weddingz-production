# Production repository instructions

Read these files before changing anything:

1. `PRODUCTION_PROGRAM.md`
2. `docs/knowledge-matrix/README.md`
3. `docs/governance/LLM_TASK_PROTOCOL.md`
4. The selected row in `docs/tracking/registers/open-items.csv`
5. The linked specification, plan, issue and existing PR

Rules:

- Work on one identified open item from a `codex/` branch. Do not work directly on `main`.
- Every implementation requires a GitHub issue and PR. Record the PR in `open-items.csv` and `pr-handoffs.csv`.
- Use test-first development for behavior changes. Run all affected mandatory suites before handoff.
- Do not commit credentials, personal data, `.env` files, Terraform state, logs, downloads or generated local artifacts.
- Keep provider modes and all non-secret operational defaults in the canonical configuration once CFG-001 lands. Keep secrets in platform secret stores.
- Treat `RohithTadiparti/WOW-MD` as a source remote only. Never merge it wholesale. Record each accepted source commit in `change-intake.csv` and the production PR.
- Update requirement, test, risk, document and release-gate registers when a change affects them.
- Do not attach the production domain to Railway until GATE-002 through GATE-007 are approved.
- Do not enable the real AWS migration executor until GATE-009 through GATE-011 are approved.
- Preserve exact database/UI reconciliation. An unexplained value mismatch fails the case.

Handoff must include issue, branch, PR, commit range, source commits, decisions, exact test results, deployment, rollback and remaining risks.
