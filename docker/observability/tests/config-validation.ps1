$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$compose = Join-Path $repo 'docker\docker-compose.yml'
$vector = Join-Path $repo 'docker\observability\vector.yaml'
$loki = Join-Path $repo 'docker\observability\loki.yaml'

function Assert-Contains([string]$Path, [string]$Pattern, [string]$Message) {
  $content = Get-Content -LiteralPath $Path -Raw
  if ($content -notmatch $Pattern) { throw $Message }
}

docker compose -f $compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration is invalid' }

Assert-Contains $loki 'retention_period:\s*720h' 'Loki retention must be exactly 720h'
Assert-Contains $loki 'retention_enabled:\s*true' 'Loki compactor retention must be enabled'
Assert-Contains $loki 'discover_service_name:\s*\[\]' 'Loki must not inject an extra service_name label'
Assert-Contains $vector 'type:\s*docker_logs' 'Vector must consume Docker logs'
Assert-Contains $vector 'type:\s*disk' 'The Loki sink must use a disk buffer'
Assert-Contains $vector '(?s)service.*environment.*level.*stream' 'Only approved low-cardinality labels may be configured'
Assert-Contains $vector '(?is)authorization.*cookie.*otp.*reset.*bank' 'Vector must include defense-in-depth secret patterns'
Assert-Contains $compose 'source:\s*/var/run/docker.sock' 'Docker socket must be mounted explicitly'
Assert-Contains $compose 'read_only:\s*true' 'The Docker socket mount must be read-only'
Assert-Contains $compose '\$\{WOW_LOG_DIR:-\.\./logs\}' 'WOW_LOG_DIR must default to ../logs'

$rendered = docker compose -f $compose config
if ($rendered -match '(?ms)\n\s+(loki|vector):.*?\n\s+ports:') {
  throw 'Loki and Vector must not publish ports'
}

Write-Host 'OBS-003 collector/Loki configuration validation passed.'
