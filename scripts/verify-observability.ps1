param(
  [string]$ComposeProject = 'obs003',
  [string]$LogRoot = '',
  [int]$TimeoutSeconds = 60,
  [switch]$SkipRecovery
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$compose = Join-Path $repo 'docker\docker-compose.yml'
if (-not $LogRoot) { $LogRoot = Join-Path $repo 'logs' }
if (-not $env:GRAFANA_ADMIN_PASSWORD) { throw 'GRAFANA_ADMIN_PASSWORD is required for verification' }
$env:WOW_LOG_DIR = $LogRoot.Replace('\', '/')

function Wait-Until([scriptblock]$Check, [string]$Failure) {
  $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Check) { return }
    Start-Sleep -Seconds 2
  } while ([datetime]::UtcNow -lt $deadline)
  throw $Failure
}

function Get-Loki([string]$Query) {
  $encoded = [uri]::EscapeDataString($Query)
  $url = "http://loki:3100/loki/api/v1/query_range?query=$encoded&limit=100"
  $raw = & docker run --rm --network "${ComposeProject}_default" curlimages/curl:8.12.1 -fsS $url
  if ($LASTEXITCODE -ne 0) { throw "Loki query failed: $Query" }
  return ($raw | ConvertFrom-Json)
}

function File-Contains([string]$Needle) {
  return [bool](Get-ChildItem -LiteralPath (Join-Path $LogRoot 'services') -Recurse -File -ErrorAction SilentlyContinue | Select-String -SimpleMatch $Needle -Quiet)
}

$required = @('wow-loki','wow-vector','wow-grafana','wow-log-retention','wow-log-disk-monitor')
foreach ($container in $required) {
  $state = docker inspect $container --format '{{.State.Status}}' 2>$null
  if ($LASTEXITCODE -ne 0 -or $state -ne 'running') { throw "$container is not running" }
}

$marker = 'obs003-' + [guid]::NewGuid().ToString('N')
Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/health' -Headers @{ 'X-Request-ID' = $marker } | Out-Null
try { Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8080/observability-$marker" | Out-Null } catch { if (-not $_.Exception.Response) { throw } }
Wait-Until { File-Contains $marker } "Marker $marker did not reach the JSONL sink"
Wait-Until { (Get-Loki "{service=~`"wow-(backend|frontend)`"} |= `"$marker`"").data.result.Count -gt 0 } "Marker $marker did not reach Loki"
$markerLoki = Get-Loki "{service=~`"wow-(backend|frontend)`"} |= `"$marker`""

$authCanary = 'auth-' + [guid]::NewGuid().ToString('N')
$otpCanary = 'otp-' + [guid]::NewGuid().ToString('N')
$bankCanary = 'bank-' + [guid]::NewGuid().ToString('N')
$canaryUri = "http://localhost:3000/api/health?authorization=$authCanary&otp=$otpCanary&bank_account=$bankCanary"
Invoke-WebRequest -UseBasicParsing -Uri $canaryUri | Out-Null
Start-Sleep -Seconds 5
$allFiles = (Get-ChildItem -LiteralPath (Join-Path $LogRoot 'services') -Recurse -File | Get-Content -Raw) -join "`n"
foreach ($secret in @($authCanary,$otpCanary,$bankCanary)) {
  if ($allFiles.Contains($secret)) { throw "Secret canary persisted in JSONL: $secret" }
  $leak = Get-Loki "{service=`"wow-backend`"} |= `"$secret`""
  if ($leak.data.result.Count -ne 0) { throw "Secret canary persisted in Loki: $secret" }
}

$labels = @($markerLoki.data.result | ForEach-Object { $_.stream.PSObject.Properties.Name } | Sort-Object -Unique)
$unexpected = @($labels | Where-Object { $_ -notin @('service','environment','level','stream') })
if ($unexpected.Count -gt 0) { throw "Unexpected Loki labels: $($unexpected -join ', ')" }

$grafanaUser = if ($env:GRAFANA_ADMIN_USER) { $env:GRAFANA_ADMIN_USER } else { 'admin' }
$credential = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${grafanaUser}:$($env:GRAFANA_ADMIN_PASSWORD)"))
$headers = @{ Authorization = "Basic $credential" }
$dashboard = Invoke-RestMethod -Uri 'http://127.0.0.1:3300/api/search?query=WOW%20Operational%20Logs' -Headers $headers
if (-not ($dashboard | Where-Object uid -eq 'wow-operational-logs')) { throw 'Provisioned Grafana dashboard not found' }
$alerts = Invoke-RestMethod -Uri 'http://127.0.0.1:3300/api/v1/provisioning/alert-rules' -Headers $headers
if (@($alerts).Count -lt 7) { throw 'Expected seven provisioned log alert rules' }

if (-not $SkipRecovery) {
  $bufferMarker = 'obs003-buffer-' + [guid]::NewGuid().ToString('N')
  docker stop wow-loki | Out-Null
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/health' -Headers @{ 'X-Request-ID' = $bufferMarker } | Out-Null
    Wait-Until { File-Contains $bufferMarker } 'File sink stopped while Loki was unavailable'
  } finally {
    docker start wow-loki | Out-Null
  }
  Wait-Until { (Get-Loki "{service=`"wow-backend`"} |= `"$bufferMarker`"").data.result.Count -gt 0 } 'Buffered Loki event did not drain after recovery'

  $preserved = 'obs003-preserved-' + [guid]::NewGuid().ToString('N')
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8080/$preserved" | Out-Null } catch { if (-not $_.Exception.Response) { throw } }
  Wait-Until { File-Contains $preserved } 'Frontend marker did not reach JSONL before recreation'
  docker restart wow-frontend | Out-Null
  Wait-Until { (docker inspect wow-frontend --format '{{.State.Status}}') -eq 'running' } 'Frontend did not restart'
  if (-not (File-Contains $preserved)) { throw 'Pre-recreation log disappeared from JSONL' }
}

$report = [ordered]@{
  verifiedAtUtc = [datetime]::UtcNow.ToString('o')
  marker = $marker
  jsonl = 'pass'
  loki = 'pass'
  redaction = 'pass'
  labels = $labels
  grafanaDashboard = 'pass'
  grafanaAlerts = @($alerts).Count
  recovery = $(if ($SkipRecovery) { 'skipped' } else { 'pass' })
}
$outDir = Join-Path $repo ('outputs\observability-' + [datetime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outDir 'verification.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 5
