@echo off
title CAS Express - DIAGNOSTICO
cd /d "%~dp0"
echo ==========================================
echo   CAS Express - DIAGNOSTICO
echo ==========================================
echo.

echo [1] Verificando Node.js...
node --version
if errorlevel 1 (
    echo ERROR: Node.js no encontrado en PATH
    pause
    exit /b 1
)

echo.
echo [2] Verificando Electron...
if exist ".\node_modules\.bin\electron.cmd" (
    echo OK - electron.cmd encontrado
) else (
    echo ERROR: electron no encontrado en node_modules
)

echo.
echo [3] Verificando .env...
if exist ".env" (
    echo OK - .env existe
) else (
    echo ERROR: .env no encontrado
)

echo.
echo [4] Intentando iniciar Expo...
start "Expo Server" cmd /k "npx expo start --web --port 8082"

echo.
echo [5] Esperando 8 segundos...
timeout /t 8 /nobreak

echo.
echo [6] Intentando abrir Electron...
call .\node_modules\.bin\electron.cmd electron/main.js

echo.
echo === FIN ===
pause
