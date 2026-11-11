$ErrorActionPreference = "Continue"

$mutex = New-Object System.Threading.Mutex($false, "Local\TransitAlertServerSupervisor")
$ownsMutex = $false

try {
  $ownsMutex = $mutex.WaitOne(0)
  if (!$ownsMutex) {
    exit 0
  }

  $startAll = Join-Path $PSScriptRoot "local-server-start-all.ps1"
  $supervisorLog = Join-Path (Split-Path -Parent $PSScriptRoot) ".local-public\supervisor.log"
  Add-Content -LiteralPath $supervisorLog -Value "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') Server watchdog started."

  while ($true) {
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startAll
      if ($LASTEXITCODE -ne 0) {
        # A thrown error inside a nested "powershell.exe -File" process does
        # NOT surface as a .NET exception here, so the catch below never saw
        # it -- local-server-start-all.ps1 could fail silently, over and
        # over, with nothing in this log to explain why nothing came online.
        $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
        Add-Content -LiteralPath $supervisorLog -Value "$timestamp local-server-start-all.ps1 exited with code $LASTEXITCODE."
      }
    } catch {
      $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
      Add-Content -LiteralPath $supervisorLog -Value "$timestamp $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 15
  }
} finally {
  if ($ownsMutex) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
