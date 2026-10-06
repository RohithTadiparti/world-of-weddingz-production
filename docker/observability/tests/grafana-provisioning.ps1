$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$datasource = Join-Path $root 'grafana\provisioning\datasources\loki.yaml'
$provider = Join-Path $root 'grafana\provisioning\dashboards\provider.yaml'
$dashboard = Join-Path $root 'grafana\provisioning\dashboards\wow-logs.json'
$alerts = Join-Path $root 'grafana\provisioning\alerting\wow-alerts.yaml'

foreach ($path in @($datasource, $provider, $dashboard, $alerts)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing provisioning file: $path" }
}

if ((Get-Content $datasource -Raw) -notmatch 'url:\s*http://loki:3100') { throw 'Loki datasource URL is incorrect' }
$dashboardJson = Get-Content $dashboard -Raw | ConvertFrom-Json
$titles = @($dashboardJson.panels.title)
foreach ($title in @('Log volume by service and level','Backend 5xx','Client errors','Audit write failures','Job failures','Provider failures','Disk health','Collector and Loki health')) {
  if ($titles -notcontains $title) { throw "Missing dashboard panel: $title" }
}
$alertText = Get-Content $alerts -Raw
foreach ($event in @('backend_5xx','audit_write_failure','job_failure','vector_sink_failure','loki_ingestion_failure','log_disk_health')) {
  if ($alertText -notmatch [regex]::Escape($event)) { throw "Missing alert coverage: $event" }
}
if ($alertText -match 'by\s*\([^)]*(requestId|actorId|resourceId)') { throw 'Alert rules use high-cardinality grouping' }

Write-Host 'OBS-003 Grafana provisioning validation passed.'
