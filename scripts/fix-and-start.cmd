@echo off
setlocal
cd /d "%~dp0"

echo === Cleaning up legacy TransitAlert startup entries ===
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup-legacy-startup.ps1"

echo.
echo === Making sure the correct startup entry is installed ===
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-host-install-startup.ps1"

echo.
echo === Starting TransitAlert now (host + tunnel supervisor) ===
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0local-server-supervisor.ps1')"

echo.
echo Done. TransitAlert is starting now, and will start itself automatically every time you log in from now on.
echo Give it a minute or two, then check https://transit-alert.com/
echo.
pause
