@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required for the local broker.
  echo The three NavSentinel HTML files work without Node.
  pause
  exit /b 1
)
node daemon\server.cjs
pause
