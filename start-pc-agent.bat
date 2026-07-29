@echo off
chcp 65001 >nul
title ClipForge PC Agent (niewidoczny worker)
cd /d "%~dp0"

if "%CLIPFORGE_CLOUD_URL%"=="" set CLIPFORGE_CLOUD_URL=https://clipforge-45ti.onrender.com

echo.
echo  ClipForge PC Agent
echo  Chmura (strona w przegladarce): %CLIPFORGE_CLOUD_URL%
echo  Ten proces liczy filmy NA TYM PC — bez przekierowania strony.
echo.
echo  Ustaw w .env albo tutaj:
echo    CLIPFORGE_EMAIL=twoj@email.com
echo    CLIPFORGE_PASSWORD=haslo
echo  (albo CLIPFORGE_AGENT_TOKEN=...)
echo.

if "%CLIPFORGE_EMAIL%"=="" (
  if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
      if /I "%%A"=="SMTP_USER" if "%CLIPFORGE_EMAIL%"=="" set CLIPFORGE_EMAIL=%%B
    )
  )
)

node scripts\pc-agent.js
if errorlevel 1 pause
