@echo off
setlocal EnableExtensions
title LAR PREVIEW
cd /d "%~dp0"

if not exist "package.json" (
  echo.
  echo [ERROR] Put START_PREVIEW.cmd inside the project folder.
  echo.
  pause
  exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Docker Desktop is not available.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Open Docker Desktop first, then run this file again.
  echo.
  pause
  exit /b 1
)

docker compose up -d
if errorlevel 1 (
  echo.
  echo [ERROR] The database services could not be started.
  echo.
  pause
  exit /b 1
)

taskkill /FI "WINDOWTITLE eq FORSA API*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq FORSA WEB*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq FORSA WORKER*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq LAR PREVIEW SERVER*" /T /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

where ssh.exe >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Windows OpenSSH is not available on this computer.
  echo.
  pause
  exit /b 1
)

if exist "PREVIEW_URL.txt" del /q "PREVIEW_URL.txt"
start "LAR PREVIEW SERVER" /D "%~dp0" cmd.exe /k node scripts\preview\start-public-preview.mjs

echo.
echo A new window is preparing the preview link.
echo When it says LAR PREVIEW IS READY, send the displayed URL to Codex.
echo Use test data only while this temporary link is open.
echo.
pause
