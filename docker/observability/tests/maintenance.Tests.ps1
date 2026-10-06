$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$prune = Join-Path $repo 'docker\observability\maintenance\prune-logs.sh'
$disk = Join-Path $repo 'docker\observability\maintenance\check-disk.sh'
if (-not (Test-Path $prune) -or -not (Test-Path $disk)) { throw 'Maintenance scripts are missing' }

$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('wow-log-maint-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $sandbox 'services\backend') -Force | Out-Null
$fresh = Join-Path $sandbox 'services\backend\fresh.jsonl'
$old = Join-Path $sandbox 'services\backend\old.jsonl'
$sentinel = Join-Path $sandbox 'outside-sentinel.jsonl'
Set-Content -LiteralPath $fresh -Value '{}'
Set-Content -LiteralPath $old -Value '{}'
Set-Content -LiteralPath $sentinel -Value '{}'
(Get-Item $fresh).LastWriteTimeUtc = [datetime]::UtcNow.AddDays(-29)
(Get-Item $old).LastWriteTimeUtc = [datetime]::UtcNow.AddDays(-31)

try {
  # Run scripts through a read-only mount so the test exercises the committed implementation.
  docker run --rm -v "${sandbox}:/logs" -v "${prune}:/opt/prune.sh:ro" -e LOG_ROOT=/logs/services -e RETENTION_DAYS=30 -e DRY_RUN=true alpine:3.20.6 sh /opt/prune.sh | Out-Null
  if (-not (Test-Path $old)) { throw 'Dry run removed an old log' }
  docker run --rm -v "${sandbox}:/logs" -v "${prune}:/opt/prune.sh:ro" -e LOG_ROOT=/logs/services -e RETENTION_DAYS=30 -e RUN_ONCE=true alpine:3.20.6 sh /opt/prune.sh | Out-Null
  if (Test-Path $old) { throw 'Old log was not removed' }
  if (-not (Test-Path $fresh)) { throw 'Fresh log was removed' }
  if (-not (Test-Path $sentinel)) { throw 'Out-of-root sentinel was removed' }

  foreach ($unsafe in @('', '/', '.')) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker run --rm -v "${prune}:/opt/prune.sh:ro" -e LOG_ROOT=$unsafe -e RUN_ONCE=true alpine:3.20.6 sh /opt/prune.sh 2>$null | Out-Null
    $unsafeExit = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($unsafeExit -eq 0) { throw "Unsafe root was accepted: '$unsafe'" }
  }

  $warning = docker run --rm -v "${disk}:/opt/check.sh:ro" -e FIXTURE_USED_PERCENT=82 -e FIXTURE_FREE_BYTES=1000 alpine:3.20.6 sh /opt/check.sh | ConvertFrom-Json
  if ($warning.event -ne 'log_disk_health' -or $warning.level -ne 'warn') { throw 'Warning disk event is invalid' }
  $errorEvent = docker run --rm -v "${disk}:/opt/check.sh:ro" -e FIXTURE_USED_PERCENT=91 -e FIXTURE_FREE_BYTES=500 alpine:3.20.6 sh /opt/check.sh | ConvertFrom-Json
  if ($errorEvent.level -ne 'error') { throw 'Error disk event is invalid' }
} finally {
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'OBS-003 maintenance safety tests passed.'
