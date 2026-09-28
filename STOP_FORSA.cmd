@echo off
setlocal EnableExtensions
title Stop FORSA
cd /d "%~dp0"

echo Stopping FORSA applications...
taskkill /FI "WINDOWTITLE eq FORSA API*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq FORSA WEB*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq FORSA WORKER*" /T /F >nul 2>&1

if exist "docker-compose.yml" (
  echo Stopping FORSA Docker services without deleting data...
  docker compose stop
)

echo.
echo FORSA has been stopped. Project data was not deleted.
echo.
timeout /t 4 /nobreak >nul
exit /b 0
