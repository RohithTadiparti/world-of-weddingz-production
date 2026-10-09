# Railway staging live evidence

Recorded: 2026-10-10 (Asia/Calcutta)

## Candidate

| Field | Value |
| --- | --- |
| Project | `confident-vibrancy` |
| Project ID | `59d2074b-2242-4d6e-b545-65f1938cbea2` |
| Environment | `staging` |
| Environment ID | `839f97b5-071a-4bf4-85c4-f62cbfe75b08` |
| Region | US East (Virginia, USA) |
| Railway allowance shown | 30 days or USD 5 remaining |
| Deployed repository revision | `f30bc1f6fa2eda452f8bebe67cb103a6dcb013c8` |
| Production domain attached | No |

## Services

| Service | Service ID | Public endpoint | Result |
| --- | --- | --- | --- |
| PostgreSQL | `99e36f95-3c99-4227-8916-6d6fe1441a41` | Private only | Online; migrations report no pending migrations |
| Redis | `6b87e3a2-9de0-4b09-aff1-1cb5784daae0` | Private only | Online; backend health reports Redis up |
| Backend | `621cd269-c2e7-4274-86f1-b8f82211eece` | `https://backend-staging-9af4.up.railway.app` | Online; `/api/health/live` and `/api/health` return HTTP 200 |
| Frontend | `73074542-125f-43c6-bb3f-79a72e1dd988` | `https://world-of-weddingz-production-staging.up.railway.app` | Online; `/` and proxied `/api/health/live` return HTTP 200 |

Backend and frontend use `/docker/Dockerfile` and
`/docker/Dockerfile.frontend`. New Railway services cannot opt in to the
deprecated Config as Code files. The frontend references the backend with
`API_UPSTREAM=${{backend.RAILWAY_PRIVATE_DOMAIN}}:3000`.

## Live smoke

Command contract: `frontend/e2e/railway-smoke.e2e.ts` with
`RAILWAY_SMOKE=true`, the two temporary HTTPS endpoints and an ephemeral strong
password held only in the test process.

Result: 1 of 1 passed in 21.9 seconds. The run verified:

- frontend shell and same-origin API proxy;
- direct backend health, exact CORS origin and credential headers;
- fresh bride registration and access-token issuance;
- secure HttpOnly SameSite=None refresh cookie and refresh rotation;
- browser registration, authenticated profile reload and dashboard navigation;
- authenticated WebSocket connection and clean disconnect.

The run created two uniquely timestamped staging-only smoke accounts. No real
person data or production domain was used.

## Protected automation decision

The protected `railway-staging` GitHub environment was created with its six
non-secret project, environment, service and URL variables. The first protected
run, `37987169744`, passed input validation but Railway rejected the backend CLI
request as unauthorized. A fail-closed scope preflight then proved in run
`37987323813` that the supplied project token belonged to a different Railway
project. Both runs stopped before changing either live service.

The correct `confident-vibrancy` project reports that account verification is
required to create its project token and routes verification to a paid plan.
Under the approved no-revenue cost policy, paid automation is deferred until a
Hobby or public-beta decision. The invalid cross-project secret is removed from
this repository environment; the underlying token in its owning Railway
project is not changed.

## Remaining closure gate

RLY-001 remains In Progress. At Hobby or public-beta approval, create a project
token scoped to `confident-vibrancy` / `staging`, store it as `RAILWAY_TOKEN`,
run `.github/workflows/railway-deploy.yml`, and record the successful workflow,
final deployment IDs, idle CPU, memory and projected monthly cost before marking
the item Done.
