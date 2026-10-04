# Source repository integration

The product-development source is `https://github.com/RohithTadiparti/WOW-MD.git`, configured locally as remote `source`. This production repository has clean, independent history.

## Intake process

1. Fetch without merging: `git fetch source main`.
2. Compare `source/main` with the last reviewed source SHA in `.production/source-baseline.json`.
3. Classify each source commit as functional, test/documentation, generated/local-only or unsafe/out of scope.
4. Add accepted candidates to `docs/tracking/registers/change-intake.csv`.
5. Implement or cherry-pick each logical change on a production branch after reviewing security, configuration, migration and deployment impact.
6. Run all affected mandatory tests.
7. Merge through a production PR that lists the exact source SHA values.
8. Advance the reviewed source baseline only after all commits in the range are classified.

Never merge `source/main` directly into production. Never copy `.env`, local volumes, downloads, QA credentials, tunnels, agent settings or unreviewed generated files.

Current uncommitted source-tree changes are not source commits. `mobile/src/app/planner-clients.tsx` and `.gitignore` must be reviewed separately before intake; their presence is recorded in the open-items/change-intake registers.
