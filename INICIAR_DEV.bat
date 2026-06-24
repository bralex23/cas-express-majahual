@echo off
echo ============================================
echo   CAS Express Majahual - Modo Desarrollo
echo ============================================
echo.

cd /d "%~dp0"

echo Cerrando procesos previos de Node/Expo...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im electron.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Limpiando cache...
if exist ".expo" rmdir /s /q ".expo" >nul 2>&1
if exist "node_modules\.cache" rmdir /s /q "node_modules\.cache" >nul 2>&1

echo.
echo Iniciando Expo Web en puerto 8082...
start "Expo Web" cmd /k "npx expo start --web --port 8082"

echo Esperando que Expo termine de compilar (30 segundos)...
timeout /t 30 /nobreak >nul

echo Iniciando Electron...
start "Electron" cmd /k "npm run electron:dev"

echo.
echo Listo!
