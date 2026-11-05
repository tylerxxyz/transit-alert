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

# beta.transit-alert.com (port 3201) had no watchdog: after a reboot or a
# crash it stayed down (Cloudflare 502) until someone restarted it by hand.
# start-beta.ps1 returns immediately when the beta is already healthy.
$betaStart = 'C:\Users\tyler\Documents\Codex\2026-10-20\i-w\work\transit-alert-selfhost\start-beta.ps1'
if (Test-Path -LiteralPath $betaStart) {
  try {
    & $betaStart | Out-Null
  } catch {
    Write-HealthLog "Beta host start failed: $($_.Exception.Message)"
  }
}

# The tunnel serving transit-alert.com is the connector for transit-alert-db.yml,
# which the host start above brings back whenever it's missing. The old logic
# here adopted the first cloudflared it found (which could be an unrelated
# tunnel) and crashed on a blank pid file, so it hadn't run since September.
# Only that one connector is ever restarted, and only when the local app is
# healthy but the public site isn't reachable, so an internet or app outage
# can't turn into repeated restarts.
$connectorConfig = 'transit-alert-db.yml'
$healthStatePath = Join-Path $publicDir "tunnel-health.json"
$state = @{ lastCheckedAt = $null; lastRestartAt = $null; consecutiveFailures = 0 }
if (Test-Path -LiteralPath $healthStatePath) {
  try {
    $loaded = Get-Content -LiteralPath $healthStatePath -Raw | ConvertFrom-Json
    $state.lastCheckedAt = $loaded.lastCheckedAt
    $state.lastRestartAt = $loaded.lastRestartAt
    $state.consecutiveFailures = [int]$loaded.consecutiveFailures
  } catch {
    # Corrupt state: start again from the defaults above.
  }
}

if ($state.lastCheckedAt -and ((Get-Date) - [datetime]$state.lastCheckedAt).TotalSeconds -lt 20) {
  exit 0
}

function Test-Healthy([string]$Url) {
  try {
    return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200
  } catch {
    return $false
  }
}

$state.lastCheckedAt = (Get-Date).ToString("o")
if (Test-Healthy "https://transit-alert.com/_health") {
  $state.consecutiveFailures = 0
} elseif (Test-Healthy "http://127.0.0.1:3200/_health") {
  $state.consecutiveFailures += 1
  $recentlyRestarted = $state.lastRestartAt -and ((Get-Date) - [datetime]$state.lastRestartAt).TotalMinutes -lt 5
  if ($state.consecutiveFailures -ge 3 -and -not $recentlyRestarted) {
    $connector = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like "*$connectorConfig*" } |
      Select-Object -First 1
    if ($connector) {
      Write-HealthLog "Local app is healthy but transit-alert.com is unreachable after $($state.consecutiveFailures) checks; restarting its tunnel connector."
      Stop-Process -Id $connector.ProcessId -Force -ErrorAction SilentlyContinue
      $state.lastRestartAt = (Get-Date).ToString("o")
      $state.consecutiveFailures = 0
    }
  }
} else {
  # The app itself is down: the host start above is already handling that.
  $state.consecutiveFailures = 0
}
$state | ConvertTo-Json | Set-Content -LiteralPath $healthStatePath -Encoding UTF8
exit 0
