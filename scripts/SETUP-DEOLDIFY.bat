@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ClipForge DeOldify setup11
echo.
echo  ClipForge DeOldify setup11
echo  Log: %TEMP%\clipforge-deoldify-setup.log
echo.
set "DEOLDIFY_PS1=%~dp0scripts\setup-deoldify.ps1"
if not exist "%DEOLDIFY_PS1%" set "DEOLDIFY_PS1=%~dp0setup-deoldify.ps1"
if not exist "%DEOLDIFY_PS1%" (
  echo [BLAD] Brak setup-deoldify.ps1. Pobierz swiezy pc-setup.cmd ze Studio.
  pause
  exit /b 1
)
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS_EXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%DEOLDIFY_PS1%"
set ERR=%ERRORLEVEL%
echo.
echo  Exit: %ERR%
if not "%ERR%"=="0" echo  Setup nieudany. Log: %TEMP%\clipforge-deoldify-setup.log
echo.
pause
exit /b %ERR%
