param(
  [int]$Port = 3100,
  [string]$HostName = "127.0.0.1",
  [int]$TimeoutSeconds = 30,
  [switch]$Dev
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$healthUrl = "http://$HostName`:$Port/healthz"
$outLog = Join-Path $repoRoot ".shipyard-ensure-$Port.out.log"
$errLog = Join-Path $repoRoot ".shipyard-ensure-$Port.err.log"

function Test-ShipyardHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

if (Test-ShipyardHealth) {
  Write-Output "shipyard-cp already running: $healthUrl"
  exit 0
}

if ($Dev) {
  $filePath = "npx.cmd"
  $argumentList = @("tsx", "watch", "src/server.ts")
} else {
  $distServer = Join-Path $repoRoot "dist/server.js"
  if (-not (Test-Path $distServer)) {
    Write-Output "dist/server.js not found; building before start..."
    Push-Location $repoRoot
    try {
      npm run build
    } finally {
      Pop-Location
    }
  }
  $filePath = "node.exe"
  $argumentList = @("dist/server.js")
}

$env:PORT = "$Port"
$env:HOST = "127.0.0.1"

Start-Process `
  -FilePath $filePath `
  -ArgumentList $argumentList `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if (Test-ShipyardHealth) {
    Write-Output "shipyard-cp started: $healthUrl"
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Write-Error "shipyard-cp did not become healthy within $TimeoutSeconds seconds. Logs: $outLog / $errLog"
exit 1
