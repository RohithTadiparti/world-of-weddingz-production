#!/bin/sh
set -eu

root="${LOG_ROOT:-/logs}"
warning="${DISK_WARNING_PERCENT:-80}"
error="${DISK_ERROR_PERCENT:-90}"

if [ -n "${FIXTURE_USED_PERCENT:-}" ]; then
  used="$FIXTURE_USED_PERCENT"
  free="${FIXTURE_FREE_BYTES:-0}"
else
  line="$(df -Pk "$root" | awk 'NR==2 {print $4 " " $5}')"
  free_kb="${line%% *}"
  used="${line##* }"
  used="${used%%%}"
  free="$((free_kb * 1024))"
fi

level=info
[ "$used" -lt "$warning" ] || level=warn
[ "$used" -lt "$error" ] || level=error
printf '{"event":"log_disk_health","level":"%s","usedPercent":%s,"freeBytes":%s,"warningPercent":%s,"errorPercent":%s}\n' "$level" "$used" "$free" "$warning" "$error"
