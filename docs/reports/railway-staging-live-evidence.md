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

## Remaining closure gate

RLY-001 remains In Progress until a project-scoped Railway token and a dedicated
smoke password are stored in the protected GitHub `railway-staging` environment
and `.github/workflows/railway-deploy.yml` completes successfully. Record the
resulting workflow URL and final backend/frontend deployment IDs, then capture
idle CPU, memory and projected monthly cost from Railway before marking the item
Done.
