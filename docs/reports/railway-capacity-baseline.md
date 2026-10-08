# Railway capacity baseline

**Status: Not Run**

This document is a controlled evidence template. It must not be used as release evidence
until every ramp, spike, soak and recovery row contains an attached k6
summary plus matching Railway/PostgreSQL/Redis measurements from the same UTC
window. No capacity number below is measured or approved yet.

## Candidate and dataset

| Field | Required evidence |
|---|---|
| Deployment revision | Exact backend/frontend commit and image digest |
| Railway project/services | Project and frontend/API/PostgreSQL/Redis service IDs |
| Resource sizes | CPU, memory, replicas and volume configuration per service |
| Dataset | Sanitized 10,000-account shape; counts by every account role |
| Media | Private S3 synthetic references and bounded upload objects |
| Test source | Runner IP/region, k6 version and harness commit |
| Observation window | UTC start/end for each profile |

## Required runs

| Profile | Planned load | k6 result | CPU peak | RAM peak | PostgreSQL connections/latency | Redis latency/memory | Recovery | Evidence |
|---|---:|---|---:|---:|---|---|---|---|
| Ramp | 1 to 30 concurrent users | Not run | n.a. | n.a. | n.a. | n.a. | n.a. | Missing |
| Spike | 30 to 75 concurrent users | Not run | n.a. | n.a. | n.a. | n.a. | n.a. | Missing |
| Soak | 30 concurrent users for 2 hours | Not run | n.a. | n.a. | n.a. | n.a. | n.a. | Missing |
| Recovery | 75 to 0 to 30 concurrent users | Not run | n.a. | n.a. | n.a. | n.a. | n.a. | Missing |

The traffic mix covers login, role landing data, vendor/planner discovery, chat
history, booking lists and opt-in synthetic S3 uploads. Socket.IO reconnects need
a separate browser/native runner because stock k6 does not implement the
Socket.IO protocol; attach that result to the same observation window.

## Pass rule

- HTTP failures below 1%, P95 below 400 ms and P99 below 750 ms.
- CPU, memory, PostgreSQL connections and Redis memory at or below 70% at the
  published operating limit, preserving at least **30% headroom**.
- No crash loop, lost job ownership, exhausted pool, stuck connection, data
  mismatch or unrecovered latency after spike/recovery.
- Planning thresholds may be lowered from measured evidence. They are not raised
  without a separately reviewed repeatable result.

## Execution

Use at least 75 protected, synthetic accounts covering bride, groom, vendor,
wedding planner and administrator. Do not commit the real fixture file.

```powershell
k6 run -e BASE_URL=https://candidate.example `
  -e FRONTEND_ORIGIN=https://candidate.example `
  -e QA_ACCOUNT_FILE=./railway-capacity-accounts.json `
  -e PROFILE=ramp backend/test/k6/railway-capacity.js
```

Repeat with `spike`, `soak` and `recovery`. Set `ENABLE_UPLOADS=true` only after
S3-001 live privacy checks pass, and clean synthetic objects through the
application-owned workflow. Store raw summaries and provider metric exports as
30-day restricted CI artifacts; record immutable links here.

## Result and approved operating limits

Not available. QA-001 and GATE-006 remain open until the evidence above proves
the published limits retain 30% headroom.
