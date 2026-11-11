# One-time cleanup: TransitAlert has accumulated more than one way to start
# itself at boot as the project evolved from separate local-host/local-public
# scripts to the unified local-server-start-all.ps1 + supervisor. Leftover
# legacy entries can race the current one or kill a healthy tunnel out from
# under it. This reports what's currently registered and removes the ones
# that are now stale. Safe to run more than once.

$ErrorActionPreference = "Stop"

Write-Output "=== TransitAlert startup entries ==="

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

$hostRun = Get-ItemProperty -Path $runKey -Name "TransitAlertHost" -ErrorAction SilentlyContinue
if ($hostRun) {
  Write-Output "Run key 'TransitAlertHost': $($hostRun.TransitAlertHost)"
  if ($hostRun.TransitAlertHost -notlike "*local-server-supervisor.ps1*") {
    Write-Output "  -> WARNING: doesn't point at local-server-supervisor.ps1. Re-run local-host-install-startup.ps1 to fix it."
  }
} else {
  Write-Output "Run key 'TransitAlertHost': not present"
  Write-Output "  -> Nothing will start TransitAlert at logon. Run local-host-install-startup.ps1."
}

$publicRun = Get-ItemProperty -Path $runKey -Name "TransitAlertPublic" -ErrorAction SilentlyContinue
if ($publicRun) {
  Write-Output "Run key 'TransitAlertPublic': $($publicRun.TransitAlertPublic)"
  Write-Output "  -> Legacy tunnel starter. It targets port 3000 (the app now runs on 3200, and local-host-start.ps1 actively kills anything left on 3000), and it force-kills any running cloudflared.exe before it does its own health check -- so on a logon where this fires it can take down a perfectly healthy tunnel and then fail to bring its own up. Removing it."
  Remove-ItemProperty -Path $runKey -Name "TransitAlertPublic" -ErrorAction SilentlyContinue
} else {
  Write-Output "Run key 'TransitAlertPublic': not present (good)"
}

$task = Get-ScheduledTask -TaskName "TransitAlertHost" -ErrorAction SilentlyContinue
if ($task) {
  Write-Output "Scheduled task 'TransitAlertHost' (ONLOGON): present"
  Write-Output "  -> Duplicates the Run key by launching local-host-start.ps1 directly at logon, racing the supervisor's own call to the same script. Removing it."
  Unregister-ScheduledTask -TaskName "TransitAlertHost" -Confirm:$false -ErrorAction SilentlyContinue
} else {
  Write-Output "Scheduled task 'TransitAlertHost': not present (good)"
}

Write-Output ""
Write-Output "Done. After this, only the 'TransitAlertHost' Run key -> local-server-supervisor.ps1 should remain as a startup entry."
Write-Output "Check anytime with: Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'"
