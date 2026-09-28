@echo off
setlocal EnableExtensions EnableDelayedExpansion
title FORSA Launcher
cd /d "%~dp0"

if not exist "package.json" (
  echo.
  echo [ERROR] Put START_FORSA.cmd inside the inspect_forsa_full project folder.
  echo.
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Docker Desktop is not installed or docker is not available.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>&1
if not errorlevel 1 goto DOCKER_READY

echo Starting Docker Desktop...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" (
  start "" "%LOCALAPPDATA%\Docker\Docker Desktop.exe"
) else (
  echo.
  echo [ERROR] Open Docker Desktop, then run this file again.
  echo.
  pause
  exit /b 1
)

set /a DOCKER_TRIES=0
:WAIT_DOCKER
timeout /t 2 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto DOCKER_READY
set /a DOCKER_TRIES+=1
if !DOCKER_TRIES! GEQ 60 (
  echo.
  echo [ERROR] Docker Desktop did not become ready within two minutes.
  echo.
  pause
  exit /b 1
)
goto WAIT_DOCKER

:DOCKER_READY
echo Starting FORSA infrastructure...
docker compose up -d
if errorlevel 1 (
  echo.
  echo [ERROR] Docker services could not be started.
  echo.
  pause
  exit /b 1
)

curl.exe -s --max-time 1 http://localhost:3000/health >nul 2>&1
if errorlevel 1 (
  start "FORSA API" cmd.exe /k "title FORSA API ^&^& cd /d ""%~dp0"" ^&^& pnpm.cmd run dev:api"
)

curl.exe -s --max-time 1 http://localhost:3001/ar-SA >nul 2>&1
if errorlevel 1 (
  start "FORSA WEB" cmd.exe /k "title FORSA WEB ^&^& cd /d ""%~dp0"" ^&^& pnpm.cmd run dev:web"
)

tasklist /V /FI "WINDOWTITLE eq FORSA WORKER*" 2>nul | findstr /I /C:"FORSA WORKER" >nul
if errorlevel 1 (
  start "FORSA WORKER" cmd.exe /k "title FORSA WORKER ^&^& cd /d ""%~dp0"" ^&^& pnpm.cmd run dev:worker"
)

echo Waiting for the platform...
set /a WEB_TRIES=0
:WAIT_WEB
timeout /t 2 /nobreak >nul
curl.exe -s --max-time 2 http://localhost:3001/ar-SA >nul 2>&1
if not errorlevel 1 goto OPEN_FORSA
set /a WEB_TRIES+=1
if !WEB_TRIES! GEQ 60 (
  echo.
  echo [ERROR] The web interface did not become ready within two minutes.
  echo Check the FORSA API and FORSA WEB windows for an error.
  echo.
  pause
  exit /b 1
)
goto WAIT_WEB

:OPEN_FORSA
start "" "http://localhost:3001/ar-SA"
echo.
echo FORSA is ready. Keep the API, WEB, and WORKER windows open.
echo You can close this launcher window.
echo.
timeout /t 5 /nobreak >nul
exit /b 0
