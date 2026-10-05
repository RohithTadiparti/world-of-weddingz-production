# Platform configuration

`config/platform.yaml` is the canonical, versioned source for non-secret platform defaults: provider modes, operating thresholds, feature defaults, revenue gates, and migration policy. The backend parses it once during bootstrap, rejects unknown fields, applies only declared scalar environment overrides, validates cross-field safety rules, and freezes the result.

Secrets never belong in this file. Supply database passwords, JWT keys, SMTP credentials, S3 credentials, payment keys, and identity-provider credentials through Railway variables, Kubernetes Secrets, or the local ignored `docker/.env` file.

## Declared overrides

- `DEPLOYMENT_TIER`
- `MAIL_PROVIDER`, `SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `PUSH_PROVIDER`
- `PAYMENT_PROVIDER`, `AADHAAR_PROVIDER`, `MEDIA_STORAGE_PROVIDER`, `AI_PROVIDER`
- `LOG_RETENTION_DAYS`
- `MIGRATION_ENABLED`, `MIGRATION_EXECUTOR`, `MIGRATION_DRY_RUN`
- `MIGRATION_READ_ONLY_MINUTES`, `RAILWAY_RETENTION_HOURS`

The platform refuses unsafe combinations. Public tiers require S3, secure cookies, disabled Swagger, and an S3 bucket. Revenue tier additionally refuses mock payments and mock identity. An enabled migration requires the AWS executor and `dryRun=false`.

Run `node scripts/verify-config-boundary.mjs` from the repository root to prevent new application code from bypassing the typed configuration service. Run `npm test -- --runInBand src/config/platform-config.loader.spec.ts` from `backend` for the parser and safety contract.
