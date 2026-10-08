# Railway staging topology

RLY-001 defines four independent Railway services in one staging project:

| Service | Source | Config path | Public networking |
| --- | --- | --- | --- |
| `frontend` | this repository | `/railway/frontend.toml` | Railway temporary domain; production domain remains detached |
| `backend` | this repository | `/railway/backend.toml` | temporary domain only for CORS and smoke verification |
| `Postgres` | Railway PostgreSQL | managed | none; private network only |
| `Redis` | Railway Redis | managed | none; private network only |

The frontend proxies `/api/` and `/socket.io/` to `API_UPSTREAM`. Local Compose
keeps the default `backend:3000`; Railway sets it to the backend private DNS
name and port. No database, Redis, media or secret value belongs in Git.

## One-time project setup

1. Create a disposable Railway project and a `staging` environment. Do not add
   the production domain.
2. Add PostgreSQL and Redis from Railway templates, then add `backend` and
   `frontend` from `RohithTadiparti/world-of-weddingz-production`.
3. Set each repository service's config-file path to the value in the table.
4. Generate temporary Railway domains for the frontend and backend only.
5. Set `API_UPSTREAM` on `frontend` to the backend private address, including
   port 3000, for example `${{backend.RAILWAY_PRIVATE_DOMAIN}}:3000`.
6. Create a Railway project token for CI and add the variables below to the
   protected GitHub environment named `railway-staging`.

## Backend variables

Use Railway reference variables for infrastructure values:

```text
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_USER=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
DB_NAME=${{Postgres.PGDATABASE}}
REDIS_HOST=${{Redis.REDISHOST}}
REDIS_PORT=${{Redis.REDISPORT}}
REDIS_PASSWORD=${{Redis.REDISPASSWORD}}
```

Set the remaining non-secret deployment values explicitly:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DEPLOYMENT_TIER=local
SERVICE_NAME=backend
RELEASE=${{RAILWAY_GIT_COMMIT_SHA}}
APP_BASE_URL=https://<temporary-frontend-domain>
CORS_ORIGINS=https://<temporary-frontend-domain>
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
SWAGGER_ENABLED=false
MAIL_PROVIDER=log
SMS_PROVIDER=log
WHATSAPP_PROVIDER=log
PUSH_PROVIDER=log
PAYMENT_PROVIDER=mock
AADHAAR_PROVIDER=mock
MEDIA_STORAGE_PROVIDER=mock
AI_PROVIDER=mock
```

`DEPLOYMENT_TIER=local` is deliberate for the disposable topology test. The
public-beta tier fails closed until S3-001 supplies private durable media. Never
use mock media for real accounts.

Create strong `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PAYMENT_WEBHOOK_SECRET` and
any test-delivery key directly in Railway. Do not paste them into issues, CI
logs, this file or a workbook.

## GitHub environment secrets and variables

Secrets:

- `RAILWAY_TOKEN`: project-scoped deployment token.
- `RAILWAY_SMOKE_PASSWORD`: fresh strong password used only for the smoke account.

Variables:

- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_BACKEND_SERVICE_ID`
- `RAILWAY_FRONTEND_SERVICE_ID`
- `RAILWAY_BACKEND_URL`
- `RAILWAY_FRONTEND_URL`

The deployment workflow requires the protected `railway-staging` environment
and the typed confirmation `deploy`. It deploys the backend first so the
pre-deploy migration finishes before application traffic, then deploys the
frontend and runs the focused Railway browser/socket smoke suite. A failed
post-deployment smoke removes the new successful deployments and redeploys the
previous revisions. First-time bootstrap deployments have no previous revision
and must therefore be performed from the Railway dashboard before enabling the
workflow.

## Verification record

After the disposable deployment, record the Railway plan, region, service IDs,
deployment IDs, idle CPU/RAM, cold-start time, baseline monthly projection and
smoke-run URL in the RLY-001 PR. The custom production domain remains blocked
until the release gates approve it.

