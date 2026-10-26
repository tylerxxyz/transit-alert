# Current Floot app, migrated to this PC on 20 October 2026.
$selfHostStart='C:\Users\tyler\Documents\Codex\2026-10-20\i-w\work\transit-alert-selfhost\start.ps1'
if(Test-Path -LiteralPath $selfHostStart){ & $selfHostStart; return }
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$hostDir = Join-Path $repoRoot ".local-host"
$configPath = Join-Path $hostDir "host-config.ps1"
$pidPath = Join-Path $hostDir "server.pid"
$launcherPath = Join-Path $hostDir "run-server.cmd"
$bundledNodePath = Join-Path $hostDir "node.exe"

# Older launchers used port 3000 and can survive beside the managed port-3200
# process. They have no PTV credentials and can also lock the embedded database.
# Remove only a listener owned by this project's private Node runtime.
$staleListeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $staleListeners) {
  $candidate = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($candidate -and $candidate.Path -eq $bundledNodePath) {
    Stop-Process -Id $candidate.Id -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Path $hostDir -Force | Out-Null

if (!(Test-Path $configPath)) {
  $secret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  # A fresh random admin password per install, never a shared default.
  $adminPassword = [guid]::NewGuid().ToString("N").Substring(0, 20)
  Write-Output "Created $configPath with a new admin password. Read it from that file; it is not printed here."
  $config = @"
`$HostConfig = @{
  Port = 3200
  AdminUsername = "tyler"
  AdminPassword = "$adminPassword"
  AuthSessionSecret = "$secret"
  AllowedOrigins = @(
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.32:3000",
    "http://localhost:3200",
    "http://127.0.0.1:3200",
    "http://192.168.1.32:3200",
    "https://tylerbnobleday-cmyk.github.io",
    "https://tylerbnobleday-cmyk.github.io/transit-alert/"
  )
  DatabaseUrl = ""
  RegistrationPhase = "public"
  ApprovedDebugTesters = "Jack Miller,jackmiller"
  PtvSubscriptionKey = ""
  PtvDeveloperId = ""
  PtvApiKey = ""
  NswTransportApiKey = ""
  VapidPublicKey = ""
  VapidPrivateKey = ""
  VapidSubject = "mailto:admin@transit-alert.com"
}
"@
  Set-Content -Path $configPath -Value $config -Encoding UTF8
}

. $configPath

# Older configs (created before RegistrationPhase existed) won't define it —
# default to public rather than silently falling back to the app's own
# debug-testers-only default, which would undo an explicit prior choice.
if (-not $HostConfig.ContainsKey("RegistrationPhase") -or [string]::IsNullOrWhiteSpace([string]$HostConfig.RegistrationPhase)) {
  $HostConfig.RegistrationPhase = "public"
}

$allowedOrigins = $HostConfig.AllowedOrigins -join ","
# Quoted "set" lines plus doubled % keep values containing & | % or spaces
# from breaking (or injecting into) the generated launcher.
function ConvertTo-CmdValue($value) {
  return ([string]$value).Replace('%', '%%').Replace('"', '')
}
$launcher = @"
@echo off
cd /d "$repoRoot"
set "PORT=$(ConvertTo-CmdValue $HostConfig.Port)"
set "ADMIN_USERNAME=$(ConvertTo-CmdValue $HostConfig.AdminUsername)"
set "ADMIN_PASSWORD=$(ConvertTo-CmdValue $HostConfig.AdminPassword)"
set "AUTH_SESSION_SECRET=$(ConvertTo-CmdValue $HostConfig.AuthSessionSecret)"
set "ALLOWED_ORIGINS=$(ConvertTo-CmdValue $allowedOrigins)"
set "DATABASE_URL=$(ConvertTo-CmdValue $HostConfig.DatabaseUrl)"
set "REGISTRATION_PHASE=$(ConvertTo-CmdValue $HostConfig.RegistrationPhase)"
set "APPROVED_DEBUG_TESTERS=$(ConvertTo-CmdValue $HostConfig.ApprovedDebugTesters)"
set "PTV_SUBSCRIPTION_KEY=$(ConvertTo-CmdValue $HostConfig.PtvSubscriptionKey)"
set "PTV_DEVELOPER_ID=$(ConvertTo-CmdValue $HostConfig.PtvDeveloperId)"
set "PTV_TIMETABLE_API_KEY=$(ConvertTo-CmdValue $HostConfig.PtvApiKey)"
set "NSW_TRANSPORT_API_KEY=$(ConvertTo-CmdValue $HostConfig.NswTransportApiKey)"
set "VAPID_PUBLIC_KEY=$(ConvertTo-CmdValue $HostConfig.VapidPublicKey)"
set "VAPID_PRIVATE_KEY=$(ConvertTo-CmdValue $HostConfig.VapidPrivateKey)"
set "VAPID_SUBJECT=$(ConvertTo-CmdValue $HostConfig.VapidSubject)"
"$bundledNodePath" .\server\render-server.js 1>> ".\.local-host\server.out.log" 2>> ".\.local-host\server.err.log"
"@
Set-Content -Path $launcherPath -Value $launcher -Encoding ASCII

if (!(Test-Path (Join-Path $repoRoot "dist\\index.html"))) {
  throw "Missing dist\\index.html. Run scripts\\local-host-build.ps1 first."
}

if (Test-Path $pidPath) {
  $existingPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Write-Output "TransitAlert host is already running on PID $existingPid."
      exit 0
    }
  }
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
}

$env:PORT = [string]$HostConfig.Port
$env:ADMIN_USERNAME = [string]$HostConfig.AdminUsername
$env:ADMIN_PASSWORD = [string]$HostConfig.AdminPassword
$env:AUTH_SESSION_SECRET = [string]$HostConfig.AuthSessionSecret
$env:ALLOWED_ORIGINS = $allowedOrigins
$env:DATABASE_URL = [string]$HostConfig.DatabaseUrl
$env:REGISTRATION_PHASE = [string]$HostConfig.RegistrationPhase
$env:APPROVED_DEBUG_TESTERS = [string]$HostConfig.ApprovedDebugTesters
$env:PTV_SUBSCRIPTION_KEY = [string]$HostConfig.PtvSubscriptionKey
$env:PTV_DEVELOPER_ID = [string]$HostConfig.PtvDeveloperId
$env:PTV_TIMETABLE_API_KEY = [string]$HostConfig.PtvApiKey
$env:NSW_TRANSPORT_API_KEY = [string]$HostConfig.NswTransportApiKey
$env:VAPID_PUBLIC_KEY = [string]$HostConfig.VapidPublicKey
$env:VAPID_PRIVATE_KEY = [string]$HostConfig.VapidPrivateKey
$env:VAPID_SUBJECT = [string]$HostConfig.VapidSubject

$process = Start-Process `
  -FilePath $bundledNodePath `
  -ArgumentList @(".\server\render-server.js") `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $hostDir "server.out.log") `
  -RedirectStandardError (Join-Path $hostDir "server.err.log") `
  -PassThru

Set-Content -Path $pidPath -Value $process.Id -Encoding ASCII

Write-Output "TransitAlert host started on http://localhost:$($HostConfig.Port)/ with PID $($process.Id)."

