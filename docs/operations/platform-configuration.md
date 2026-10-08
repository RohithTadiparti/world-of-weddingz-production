# Platform configuration

`config/platform.yaml` is the canonical, versioned source for non-secret platform defaults: provider modes, operating thresholds, feature defaults, revenue gates, and migration policy. The backend parses it once during bootstrap, rejects unknown fields, applies only declared scalar environment overrides, validates cross-field safety rules, and freezes the result.

Secrets never belong in this file. Supply database passwords, JWT keys, SMTP credentials, S3 credentials, payment keys, and identity-provider credentials through Railway variables, Kubernetes Secrets, or the local ignored `docker/.env` file.

## Declared overrides

- `DEPLOYMENT_TIER`
- `MAIL_PROVIDER`, `SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `PUSH_PROVIDER`
- `PAYMENT_PROVIDER`, `AADHAAR_PROVIDER`, `MEDIA_STORAGE_PROVIDER`, `AI_PROVIDER`
- `LOG_RETENTION_DAYS`
- `OPERATIONS_ALERT_RECIPIENTS` (comma-separated list override of `operations.alertRecipients`; blank keeps the YAML default)
- `MIGRATION_ENABLED`, `MIGRATION_EXECUTOR`, `MIGRATION_DRY_RUN`
- `MIGRATION_READ_ONLY_MINUTES`, `RAILWAY_RETENTION_HOURS`

The platform refuses unsafe combinations. Public tiers require S3, secure cookies, disabled Swagger, and an S3 bucket. Revenue tier additionally refuses mock payments and mock identity. An enabled migration requires the AWS executor and `dryRun=false`.

Run `node scripts/verify-config-boundary.mjs` from the repository root to prevent new application code from bypassing the typed configuration service. Run `npm test -- --runInBand src/config/platform-config.loader.spec.ts` from `backend` for the parser and safety contract.

## Operational alert delivery

`operations.alertRecipients` is the list of operational email recipients for capacity and performance alerts. The canonical YAML keeps it empty (`[]`); set the addresses per environment with `OPERATIONS_ALERT_RECIPIENTS=ops@example.com,oncall@example.com`. Each entry must be a valid address of at most 254 characters, entries must be unique ignoring case, and at most 20 are accepted. Validation errors name the path, never the address.

The hourly capacity job delivers alerts inside its replica lock, after evaluation:

- In-app: one notification (`operational_alert`, opening `/admin/infrastructure?alert=<alertId>`) to every active account whose role holds `admin:infrastructure:read`. No eligible administrator is recorded as `skipped` with `no_eligible_administrators`, not as success.
- Email: one message per configured recipient through `MailService`. The `log` mail provider is recorded as `simulated`; no recipients is `not_configured`.
- Audit: `operations.alert_opened`, `operations.alert_promoted`, `operations.alert_reminded`, `operations.alert_acknowledged`, `operations.alert_resolved` and `operations.alert_delivery_failed`.
- Logs: `operational_alert.delivered`, `operational_alert.suppressed` (debug), `operational_alert.acknowledged`, `operational_alert.resolved` and `operational_alert.delivery_failed`, each with a `correlationId` (the request id inside a request, a generated UUID per scheduler run).

An alert is announced once when opened and once more if promoted from warning to critical. A reminder is sent only while the alert is `open` (never acknowledged or resolved) and at least `operations.alertReminderHours` after the later of the last notification and the last reminder. Resolution writes audit and log evidence and sends nothing. An announcement that reached nobody because a channel failed is retried on the next hourly run, at most three attempts in total; an attempt that reached anybody is never retried. Every attempt is recorded, newest first and capped at 20, in `operational_alerts.deliveryMetadata`, which holds only statuses, counts, timestamps, the provider mode and stable error codes.

Alert payloads, emails, audit rows and logs carry only the severity, metric, observed value, unit, threshold, source, first-observed time, recommended action, alert ID, event and correlation ID.
