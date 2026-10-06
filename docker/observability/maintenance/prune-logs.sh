#!/bin/sh
set -eu

root="${LOG_ROOT-/logs/services}"
days="${RETENTION_DAYS:-30}"
dry_run="${DRY_RUN:-false}"

case "$root" in
  /logs/services|/logs/services/*) ;;
  *) echo '{"event":"log_retention_refused","level":"error","message":"unsafe log root"}' >&2; exit 64 ;;
esac

case "$days" in
  ''|*[!0-9]*) echo '{"event":"log_retention_refused","level":"error","message":"invalid retention"}' >&2; exit 64 ;;
esac
[ "$days" -ge 1 ] || exit 64
[ -d "$root" ] || mkdir -p "$root"

resolved="$(readlink -f "$root")"
case "$resolved" in
  /logs/services|/logs/services/*) ;;
  *) echo '{"event":"log_retention_refused","level":"error","message":"resolved path escaped log root"}' >&2; exit 64 ;;
esac

if [ "$dry_run" = "true" ]; then
  count="$(find "$resolved" -xdev -type f -name '*.jsonl' -mtime "+$days" -print | wc -l | tr -d ' ')"
  printf '{"event":"log_retention","level":"info","dryRun":true,"retentionDays":%s,"matched":%s}\n' "$days" "$count"
  exit 0
fi

count="$(find "$resolved" -xdev -type f -name '*.jsonl' -mtime "+$days" -print | wc -l | tr -d ' ')"
find "$resolved" -xdev -type f -name '*.jsonl' -mtime "+$days" -delete
printf '{"event":"log_retention","level":"info","dryRun":false,"retentionDays":%s,"deleted":%s}\n' "$days" "$count"
