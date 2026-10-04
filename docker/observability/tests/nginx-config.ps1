$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw (Join-Path $PSScriptRoot '..\..\..\frontend\nginx.conf')

$required = @(
  'log_format wow_json escape=json',
  '"service":"frontend"',
  '"requestId":"$wow_request_id"',
  '"route":"$uri"',
  'proxy_set_header X-Request-ID $wow_request_id;',
  'add_header X-Request-ID $wow_request_id always;',
  '~^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
)
foreach ($text in $required) {
  if (-not $config.Contains($text)) { throw "Missing nginx observability contract: $text" }
}

$prohibited = @('$request_uri', '$args', '$http_authorization', '$http_cookie', '$request_body')
foreach ($text in $prohibited) {
  if ($config.Contains($text)) { throw "Sensitive/query-bearing nginx log input is prohibited: $text" }
}

$proxyCount = ([regex]::Matches($config, [regex]::Escape('proxy_set_header X-Request-ID $wow_request_id;'))).Count
if ($proxyCount -ne 2) { throw "Expected request ID forwarding in API and Socket.IO locations; found $proxyCount" }

Write-Output 'nginx observability configuration passed'
