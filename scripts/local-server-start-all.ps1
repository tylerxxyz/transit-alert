$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$hostStart = Join-Path $PSScriptRoot "local-host-start.ps1"
$cloudflaredPath = Join-Path $repoRoot ".local-host\bin\cloudflared.exe"
$publicDir = Join-Path $repoRoot ".local-public"
$tokenPath = Join-Path $publicDir "tunnel-token.txt"
$configPath = Join-Path $publicDir "config.yml"
$pidPath = Join-Path $publicDir "cloudflared.pid"
$outLog = Join-Path $publicDir "cloudflared.out.log"
$errLog = Join-Path $publicDir "cloudflared.err.log"
$healthLog = Join-Path $publicDir "supervisor.log"

function Write-HealthLog([string]$Message) {
  Add-Content -LiteralPath $healthLog -Value "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $Message"
}

# The database bridge is a separate local service from the public app host.
# Keep it under the existing logon watchdog so a reboot or process exit does
# not silently leave the app's database-backed features disconnected.
$databaseBridgeDir = 'C:\Users\tyler\Documents\Codex\2026-10-07\us\work\transit-alert-migration\local-db-bridge'
$databaseBridgeScript = Join-Path $databaseBridgeDir 'server.mjs'
$databaseBridgeOutLog = Join-Path $databaseBridgeDir 'bridge-out.log'
$databaseBridgeErrorLog = Join-Path $databaseBridgeDir 'bridge-error.log'
$nodePath = 'C:\Users\tyler\AppData\Local\Programs\NodeJS\node-v24.21.0-win-x64\node.exe'
$databaseBridgeHealthy = $false
try {
  $databaseBridgeProbe = Invoke-WebRequest -Uri 'http://127.0.0.1:18787/health' -UseBasicParsing -TimeoutSec 3 -SkipHttpErrorCheck
  $databaseBridgeHealthy = ($databaseBridgeProbe.StatusCode -eq 401 -and $databaseBridgeProbe.Content -match '"error"\s*:\s*"unauthorized"')
} catch {
  $databaseBridgeHealthy = $false
}

if (-not $databaseBridgeHealthy) {
  $databaseBridgeListener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18787 -State Listen -ErrorAction SilentlyContinue
  if ($databaseBridgeListener) {
    Write-HealthLog 'Database bridge port is occupied but its health probe failed; leaving the existing process untouched.'
  } elseif ((Test-Path -LiteralPath $nodePath) -and (Test-Path -LiteralPath $databaseBridgeScript)) {
    Write-HealthLog 'Database bridge is offline; starting a replacement.'
    Start-Process -FilePath $nodePath `
      -ArgumentList @($databaseBridgeScript) `
      -WorkingDirectory $databaseBridgeDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput $databaseBridgeOutLog `
      -RedirectStandardError $databaseBridgeErrorLog
  } else {
    Write-HealthLog 'Database bridge could not start because its Node runtime or server script is missing.'
  }
}

# Run the host check in this process. Spawning a nested PowerShell here could
# leave the watchdog waiting indefinitely after Windows logon, so the tunnel
# startup below was never reached.
try {
  & $hostStart
} catch {
  # A failure here used to kill this entire script (ErrorActionPreference =
  # Stop), which meant the Cloudflare tunnel logic below was never reached
  # either -- a transient local-host problem (missing build, port still
  # settling after boot, etc.) took the public tunnel down with it. Log it
  # and keep going; the supervisor calls this script again in 15s so the
  # host gets retried, and the tunnel stays managed in the meantime.
  Write-HealthLog "Local host start failed: $($_.Exception.Message)"
}

if (!(Test-Path -LiteralPath $cloudflaredPath)) {
  throw "Cloudflare connector is missing: $cloudflaredPath"
}
if (!(Test-Path -LiteralPath $tokenPath)) {
  throw "Cloudflare tunnel token is missing: $tokenPath"
}
if (!(Test-Path -LiteralPath $configPath)) {
  throw "Cloudflare tunnel config is missing: $configPath"
}

New-Item -ItemType Directory -Path $publicDir -Force | Out-Null

$running = $null
if (Test-Path -LiteralPath $pidPath) {
  $savedPid = (Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($savedPid) {
    $candidate = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ProcessName -eq "cloudflared") {
      $running = $candidate
    }
  }
}
if (-not $running) {
  $running = Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1
}

if ($running) {
  Set-Content -LiteralPath $pidPath -Value $running.Id -Encoding ASCII

  # A cloudflared process can stay alive while stuck retrying failed
  # connections to Cloudflare's edge — observed repeatedly on this machine
  # as WSL2's virtual network adapter re-negotiates (Windows 10 doesn't
  # support WSL2 "mirrored" networking, so this churn is expected to keep
  # happening as long as WSL/Home Assistant runs here) — the site is down
  # but this process-liveness check alone reads it as healthy and never
  # restarts it. Periodically confirm the public hostname actually answers;
  # a short interval and low failure threshold matter here specifically
  # because this flapping has been observed recurring every 1-5 minutes,
  # not as a rare one-off — waiting minutes to react leaves the site down
  # for the whole gap.
  $healthStatePath = Join-Path $publicDir "tunnel-health.json"
  $healthCheckIntervalSeconds = 20
  $state = @{ lastCheckedAt = $null; consecutiveFailures = 0 }
  if (Test-Path -LiteralPath $healthStatePath) {
    try {
      $loaded = Get-Content -LiteralPath $healthStatePath -Raw | ConvertFrom-Json
      $state.lastCheckedAt = $loaded.lastCheckedAt
      $state.consecutiveFailures = [int]$loaded.consecutiveFailures
    } catch {
      # Corrupt or missing state file — fall back to the defaults above.
    }
  }

  $dueForCheck = $true
  if ($state.lastCheckedAt) {
    $elapsed = (Get-Date) - [datetime]$state.lastCheckedAt
    $dueForCheck = $elapsed.TotalSeconds -ge $healthCheckIntervalSeconds
  }

  if (-not $dueForCheck) {
    exit 0
  }

  $reachable = $false
  try {
    $response = Invoke-WebRequest -Uri "https://transit-alert.com/" -UseBasicParsing -TimeoutSec 10
    $reachable = $response.StatusCode -eq 200
  } catch {
    $reachable = $false
  }

  $state.lastCheckedAt = (Get-Date).ToString("o")
  if ($reachable) {
    $state.consecutiveFailures = 0
    $state | ConvertTo-Json | Set-Content -LiteralPath $healthStatePath -Encoding UTF8
    exit 0
  }

  $state.consecutiveFailures += 1
  $state | ConvertTo-Json | Set-Content -LiteralPath $healthStatePath -Encoding UTF8

  if ($state.consecutiveFailures -lt 1) {
    exit 0
  }

  Write-HealthLog "Cloudflare connector process is alive but transit-alert.com is not reachable after $($state.consecutiveFailures) checks; forcing a restart."
  Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  $state.consecutiveFailures = 0
  $state | ConvertTo-Json | Set-Content -LiteralPath $healthStatePath -Encoding UTF8
}

Write-HealthLog "Cloudflare connector was offline; starting a replacement using HTTP/2."
$process = Start-Process `
  -FilePath $cloudflaredPath `
  -ArgumentList @("--config", $configPath, "tunnel", "--protocol", "http2", "--no-autoupdate", "run", "--token-file", $tokenPath) `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ASCII
Start-Sleep -Seconds 3
if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
  Write-HealthLog "Cloudflare connector exited during startup. See cloudflared.err.log."
  throw "Cloudflare connector exited during startup."
}
Write-HealthLog "Cloudflare connector started successfully on PID $($process.Id)."
