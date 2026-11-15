@echo off
setlocal
set "ROOT=%~dp0"
set "LUDEX_PORTABLE_DIR=%ROOT%"
set "LUDEX_PORTABLE=1"
if not exist "%ROOT%LudexData" mkdir "%ROOT%LudexData"
if not exist "%ROOT%Games" mkdir "%ROOT%Games"
if not exist "%ROOT%Ludex.exe" (
  echo Ludex.exe not found next to this script.
  pause
  exit /b 1
)
start "Ludex" "%ROOT%Ludex.exe" %*
