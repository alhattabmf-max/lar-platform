@echo off
setlocal EnableExtensions
title Stop LAR Preview
cd /d "%~dp0"

echo Closing the temporary preview...
taskkill /FI "WINDOWTITLE eq LAR PREVIEW SERVER*" /T /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

if exist "PREVIEW_URL.txt" del /q "PREVIEW_URL.txt"

echo.
echo The public preview link is closed. Project data was not deleted.
echo.
timeout /t 4 /nobreak >nul
exit /b 0
