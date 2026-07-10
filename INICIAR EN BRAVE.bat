@echo off
title CAS Express - Brave
cd /d "%~dp0"

REM ── Buscar Node.js ────────────────────────────────────────────────
set NODE_EXE=
if exist "C:\Program Files\nodejs\node.exe"           set NODE_EXE=C:\Program Files\nodejs\node.exe
if exist "C:\Program Files (x86)\nodejs\node.exe"     set NODE_EXE=C:\Program Files (x86)\nodejs\node.exe
if exist "%LOCALAPPDATA%\Programs\node\node.exe"       set NODE_EXE=%LOCALAPPDATA%\Programs\node\node.exe
if "%NODE_EXE%"=="" (
    for /f "delims=" %%i in ('where node 2^>nul') do set NODE_EXE=%%i
)

for %%i in ("%NODE_EXE%") do set "NODE_DIR=%%~dpi"
set PATH=%NODE_DIR%;%PATH%

REM ── Iniciar Expo ──────────────────────────────────────────────────
set BROWSER=none
start "CAS Express - Servidor" /min cmd /c ""%NODE_DIR%npx.cmd" expo start --web --port 8083 2>&1"

timeout /t 5 /nobreak > nul

REM ── Abrir en Brave ────────────────────────────────────────────────
start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" "http://localhost:8083"

exit
