@echo off
title CAS Majahual
cd /d "%~dp0"

REM ── Buscar Node.js ──────────────────────────────
set NODE_EXE=
if exist "C:\Program Files\nodejs\node.exe"           set NODE_EXE=C:\Program Files\nodejs\node.exe
if exist "C:\Program Files (x86)\nodejs\node.exe"     set NODE_EXE=C:\Program Files (x86)\nodejs\node.exe
if exist "%LOCALAPPDATA%\Programs\node\node.exe"       set NODE_EXE=%LOCALAPPDATA%\Programs\node\node.exe
if "%NODE_EXE%"=="" (
    for /f "delims=" %%i in ('where node 2^>nul') do set NODE_EXE=%%i
)

for %%i in ("%NODE_EXE%") do set "NODE_DIR=%%~dpi"
set PATH=%NODE_DIR%;%PATH%

REM ── Iniciar Expo (--reset-cache limpia bundle desactualizado) ─────
set BROWSER=none
start "Expo-CAS" /min cmd /c ""%NODE_DIR%npx.cmd" expo start --web --port 8082 --reset-cache 2>&1"

REM ── Esperar a que Expo esté listo ────────────────────────────────
timeout /t 8 /nobreak > nul

REM ── Lanzar Electron (no bloqueante → CMD se cierra solo) ─────────
start /B "" "%NODE_DIR%node.exe" ".\node_modules\electron\cli.js" electron/main.js
timeout /t 2 /nobreak > nul
exit
