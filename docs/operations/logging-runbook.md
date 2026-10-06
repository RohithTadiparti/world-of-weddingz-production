# Local logging and Grafana runbook

Related work item: `OBS-003`. Operational logs are retained for 30 days in host JSONL files and local Loki. Business audit records remain in PostgreSQL and follow their separate policy.

## Start and health

Set `WOW_LOG_DIR` to the operator-owned host directory and set a unique `GRAFANA_ADMIN_PASSWORD` in `docker/.env`. Then start the normal application plus the observability profile:

```powershell
docker compose -f docker/docker-compose.yml --profile observability up -d
docker compose -f docker/docker-compose.yml --profile observability ps
```

Grafana is available only from the server at `http://127.0.0.1:3300`. Loki and Vector publish no host port. Application containers contain no SSH daemon.

## Find an operation

- Immediate fallback: `docker logs wow-backend --since 15m`
- Host files: `$env:WOW_LOG_DIR\services\wow-backend\YYYY-MM-DD.jsonl`
- Grafana Explore: `{service="wow-backend"} | json | requestId="<request-id>"`
- Errors: `{service="wow-backend",level=~"error|fatal"}`

Labels are limited to `service`, `environment`, `level`, and `stream`. Request IDs, users, resources, routes, and messages stay inside the JSON event.

## Verification

```powershell
$env:GRAFANA_ADMIN_PASSWORD = '<the local secret>'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-observability.ps1
```

The verification checks both sinks, secret canaries, labels, dashboard and alert provisioning, Loki buffering, and log survival after an application-container restart. Its JSON evidence is written beneath ignored `outputs/`.

## Retention and disk safety

Loki Compactor retention is `720h`. `wow-log-retention` deletes only `*.jsonl` files older than 30 days beneath `/logs/services` and refuses empty, root, relative, or symlink-escaped roots. Test deletion without changing data:

```powershell
docker compose -f docker/docker-compose.yml --profile observability run --rm -e DRY_RUN=true log-retention /opt/wow/prune-logs.sh
```

`wow-log-disk-monitor` emits `log_disk_health` every five minutes. Warning begins at 80 percent and error at 90 percent. Inspect host use with `Get-PSDrive` and the directory size with `Get-ChildItem $env:WOW_LOG_DIR -Recurse`.

## Failure and recovery

- Loki down: JSONL continues and Vector buffers the Loki sink on disk. Restart `wow-loki`; the buffer drains automatically.
- Vector down: the bounded Docker `local` driver keeps `docker logs` available. Restart Vector; collection resumes from new events. Do not claim automatic backfill.
- File sink down: Loki continues; repair ownership/free space and restart Vector.
- Disk pressure: export evidence if required, run the retention dry-run, then the normal retention job. Never delete outside the configured root.

Controlled shutdown:

```powershell
docker compose -f docker/docker-compose.yml --profile observability stop grafana vector loki log-retention log-disk-monitor
```

## Move to a remote Loki-compatible server

Set `LOKI_ENDPOINT` in the platform secret/environment store and restart Vector. Add tenant/auth/TLS fields to the Vector Loki sink only when the remote operator supplies them; keep credentials outside Git. During a migration, retain the JSONL sink and validate remote queries before removing local Loki.
