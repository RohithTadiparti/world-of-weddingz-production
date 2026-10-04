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

## Periodic review

`.github/workflows/source-sync-review.yml` runs every day at 03:17 UTC and on demand. It checks out the source repository, compares its `main` branch with `.production/source-baseline.json`, uploads a 30-day JSON/Markdown report, and updates one bot-owned comment on issue `#32`.

The workflow is deliberately review-only: it cannot push or merge either repository. A person reviews every reported commit, records the classification in `change-intake.csv`, and advances the reviewed baseline only after every commit in the range has a recorded decision.

Only committed and pushed source changes are visible to GitHub Actions. Local WOW-MD commits or uncommitted UI/UX work remain outside the report until their owner publishes them.

## Repository access and `WOW_SYNC_TOKEN`

`WOW_SYNC_TOKEN` exists solely so the production repository's scheduled workflow can read `WOW-MD` after that repository returns to private visibility. It is not an application credential, login secret, deployment token or database key. While `WOW-MD` is temporarily public, GitHub can perform a read-only checkout without a personal token; the token can therefore remain deferred. Configure it before returning `WOW-MD` to private visibility, or update the workflow in a reviewed PR to use anonymous checkout while public.

Generate it in GitHub under **Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token**, then add it to `world-of-weddingz-production` under **Settings -> Secrets and variables -> Actions -> New repository secret** with the exact name `WOW_SYNC_TOKEN`:

- resource owner: `RohithTadiparti`;
- repository access: only `WOW-MD`;
- repository permission: **Contents: read-only**;
- no organization, administration, workflow, issue, pull-request, secret or package permissions;
- expiry: 90 days or shorter, with a named rotation owner.

Copy the value once directly into the Actions secret form. The secret must never appear in a register, workbook, issue, workflow output or source file. Once private access is required, an absent, expired or unauthorized token makes the scheduled job fail closed and leaves the previous baseline unchanged.

## Changes that must flow back to WOW-MD

Production changes under shared backend, frontend, mobile, Docker/Kubernetes application, or dependency-manifest paths require a separate WOW-MD pull request. The production PR links that mirror PR and cannot pass the mirror gate without it. Reviewers must resolve conflicts in WOW-MD; automation must not replace complete files over ongoing UI/UX work.

Production-only governance, evidence and infrastructure files do not require a source mirror. Dependency manifests and lockfiles are always treated as shared because a later source synchronization could otherwise restore vulnerable or incompatible versions.

The required production PR fields are:

- `Shared source impact: None` when no configured shared path changed, otherwise `Mirror required`;
- `WOW-MD mirror PR: None` or the exact `https://github.com/RohithTadiparti/WOW-MD/pull/<number>` URL;
- `Dependency changes: None` or a concise list of affected manifests/lockfiles.

The required `registers` check calculates changed paths from the PR base/head SHAs. Any change under `backend/`, `frontend/`, `mobile/`, `docker/` or `k8s/` fails until the PR body identifies the WOW-MD mirror PR. This is a review linkage, not permission to overwrite source: the mirror PR resolves any conflict against current WOW-MD work before either side is considered synchronized.
