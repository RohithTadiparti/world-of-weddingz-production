# Railway-First Launch and Controlled AWS Migration Design

**Date:** 2026-10-04  
**Status:** Draft for approval  
**Decision owner:** Product owner  
**Related:** `2026-10-04-durable-observability-design.md`

## Purpose

Launch the platform at minimum pre-revenue cost on Railway, keep user media durable in Amazon S3 from the first real account, give administrators early capacity and cost warnings in the portal and by email, and provide one protected admin action that can move the platform to the approved AWS Option B architecture.

The migration is automated and reversible through the last safe cutover gate. It is not automatically triggered by a threshold, and it is not an unguarded DNS button.

## Agreed deployment stages

| Stage | Hosting | Guardrail |
|---|---|---|
| Closed beta | Railway Trial/Free and private S3 | At most 100 accounts, 20 DAU and 2,000 API requests/day |
| Public pre-revenue | Railway Hobby and private S3 | At most 2,000 accounts, 200 DAU and 25,000 API requests/day |
| Growth | Railway Pro and private S3 | Up to the migration thresholds below, subject to measured load-test results |
| Scale | AWS Option B in `ap-south-1` | Three-AZ EKS, Aurora PostgreSQL writer/reader, Multi-AZ Redis, WAF/ALB, CloudFront/S3, Loki/Grafana |

Railway Free is not a public-production target. The current application needs frontend, API, PostgreSQL and Redis services; public launch therefore starts on Hobby. Railway spending limits are protection, not migration triggers, because reaching a hard limit can stop workloads.

## Storage decision

All real user uploads use a private S3 bucket from day one. Railway disks hold no authoritative media. Objects remain private and are reached through short-lived signed URLs; bucket public access is blocked, encryption and versioning are enabled, and lifecycle rules clean incomplete multipart uploads and superseded versions.

Development may continue to use the mock storage provider. Closed beta and later environments set `media.storageProvider: s3`. Object keys remain provider-neutral so the same database rows work after the compute and database migration.

## Canonical configuration

Create one committed, non-secret configuration document at `config/platform.yaml`. It contains environment-independent defaults, provider selections, threshold values, retention periods, feature flags and migration policy. Environment variables may override scalar values but may not introduce undeclared keys. Application code reads typed values only through `AppConfigService`; direct `process.env` reads outside configuration bootstrap are rejected by CI.

Secrets are deliberately excluded. Railway variables hold secrets before migration; GitHub environment secrets and AWS Secrets Manager hold deployment and runtime secrets during and after migration. The configuration refers to secret names, never secret values.

Initial provider values are:

- `mail`, `sms`, `whatsapp`, `push`, `payment`, and identity verification: `mock`/`log`
- media storage: `s3` outside local development
- migration executor: `mock`
- migration enabled: `false`
- migration dry run: `true`

Production validation fails closed when a provider is marked live but its required credentials are absent, when mock money/identity providers are enabled for a revenue environment, or when secure cookies, CORS, Swagger exposure, storage privacy, or administrator MFA requirements are unsafe.

## Capacity metrics and thresholds

The platform calculates hourly snapshots from the database and runtime metrics. Daily-active-user counts use distinct authenticated users in the preceding 24 hours. API request and latency/error figures come from Prometheus-compatible request metrics. Railway cost is supplied by a provider adapter; the mock adapter is used until Railway billing credentials are configured.

| Metric | Warning | Critical/migration-ready |
|---|---:|---:|
| Registered accounts | 5,000 | 10,000 |
| Daily active users | 500 | 1,000 |
| API requests/day | 50,000 | 100,000 |
| Concurrent active users | 30 | 75 |
| PostgreSQL data size | 5 GB | 10 GB |
| P95 API latency | 400 ms | 750 ms |
| API error rate | 0.5% | 1% |
| CPU or memory utilization | 70% | 80% |
| Projected Railway monthly cost | INR 15,000 | INR 30,000 |

Revenue readiness is reported separately. The commercial target is INR 1,200,000 monthly net platform revenue, with INR 1,500,000 preferred before accepting the full Option B operating cost. Reliability or security conditions may require migration before the revenue target.

Thresholds do not fire from one noisy sample. Count/storage/cost thresholds require two consecutive hourly samples; performance/resource thresholds require 15 sustained minutes; the same unresolved alert is deduplicated and reminded every 24 hours.

## Operational alerts

Operational alerts are distinct from user-domain notifications. Each alert has a stable fingerprint, metric, observed value, threshold, severity, first/last observed timestamps, status, acknowledgement and resolution metadata. Open alerts appear on the admin dashboard and Infrastructure page.

Every new critical alert and every configured reminder:

1. creates or updates a persistent operational alert;
2. creates an in-app notification for every active administrator with infrastructure permission;
3. sends email to the configured operational recipients through `MailService`;
4. writes an append-only audit event; and
5. carries a correlation ID into logs.

Mock mail writes a redacted structured log record and records delivery as simulated. It must never claim that an email reached an inbox.

## Migration control plane

The admin Infrastructure page shows readiness, threshold history, blockers, estimated AWS cost, most recent backup, Terraform plan age, last rehearsal and migration history.

Only an administrator holding a new `admin:infrastructure:migrate` permission may start a migration. Starting requires a five-minute step-up token issued after password plus TOTP/recovery-code verification. The confirmation presents the target, cost range, read-only window, last backup and rollback boundary.

One primary action creates a migration run and dispatches an external workflow. The application process does not own the long-running migration because it is one of the systems being replaced.

The initial mock executor emits the same state transitions and failure modes as the real executor without changing infrastructure:

`requested -> preflight -> provisioning -> initial_sync -> awaiting_cutover -> read_only -> final_sync -> validating -> dns_cutover -> observing -> completed`

Terminal alternatives are `failed`, `rolled_back`, and `cancelled`. Cancellation is allowed only before `read_only`.

## Real executor

The real executor is a protected GitHub Actions environment. The admin API dispatches a workflow with a migration-run ID and receives signed, timestamped callbacks. GitHub authenticates to AWS with OIDC rather than static access keys. Railway, DNS and callback credentials remain environment secrets.

The workflow:

1. verifies configuration, backup freshness, repository revision, AWS quotas, DNS access and budget approval;
2. applies Terraform for Option B with a current standard-support Kubernetes version;
3. builds and deploys immutable frontend/backend images;
4. runs database migrations against an empty target and validates schema state;
5. copies an initial Railway PostgreSQL snapshot to Aurora;
6. deploys the target in dark mode and runs health, API, browser and database reconciliation checks;
7. waits for the operator-approved cutover gate captured by the original action;
8. puts business writes into read-only mode while keeping health, authentication required for operators, and migration callbacks available;
9. copies the final delta, resets sequences and compares table counts plus critical-field checksums;
10. switches DNS, verifies TLS and synthetic journeys, observes traffic, then enables writes on AWS; and
11. retains Railway read-only for 72 hours before decommission approval.

The target read-only window is at most 15 minutes. If the final copy or verification cannot finish in that window, traffic stays on Railway and writes resume there.

## Rollback boundary

Automatic rollback is guaranteed until AWS writes are enabled. Before that point, rollback restores Railway write mode, returns DNS to Railway when necessary, marks the run rolled back, and retains AWS resources for diagnosis.

After AWS begins accepting writes, DNS-only rollback is unsafe because it would fork data. The workflow therefore treats write enablement as the irreversible production boundary. Subsequent incidents use forward recovery on AWS unless a separately rehearsed reverse-replication procedure proves safe.

## Safety and audit requirements

- A database advisory lock and unique partial index permit at most one non-terminal migration run.
- Every workflow callback is HMAC signed, timestamp checked and replay protected.
- The requested Git commit SHA is deployed and returned by target health metadata.
- Migration jobs are idempotent and resumable from their last completed stage.
- Logs and artifacts redact secrets and personal information.
- Database exports are encrypted, access logged and lifecycle-deleted after the retention period.
- No Terraform destroy occurs automatically after a failure.
- Railway is not decommissioned by the migration button.
- A separate administrator action after 72 hours approves decommissioning.

## Readiness blockers before public beta

The current production-readiness audit remains binding. Public beta cannot use real personal data or money until administrator MFA enforcement, WebSocket authorization/CORS, multi-replica job locking, production provider validation, secure cookies/security headers, private Swagger, dependency remediation, migration ordering and durable logging are closed and independently verified.

## Acceptance criteria

- Railway Hobby deploys frontend, API, PostgreSQL and Redis with private networking, health checks and spending alerts.
- Real uploads survive redeploys and are served only through authorized signed URLs from S3.
- Admin warning and critical thresholds are calculated from exact persisted/runtime measurements.
- Portal and email notifications are deduplicated, auditable and testable through mock delivery.
- The mock migration completes and fails deterministically without external side effects.
- A rehearsed real migration restores a sanitized production-sized dataset to Aurora, passes exact row/checksum verification, switches a rehearsal hostname and demonstrates automatic rollback before write enablement.
- The production button remains disabled until all readiness checks are green and `migration.enabled` plus the real executor are explicitly configured.

## Explicitly deferred

- Automatic migration without a human action
- Zero-downtime/dual-write migration
- Multi-region AWS disaster recovery
- Automatic Railway destruction
- Live payment, identity, SMS, WhatsApp and push providers
- Native iOS/Android store release infrastructure
