@echo off
echo ============================================
echo   CAS Express - Instalando dependencias
echo ============================================
echo.

cd /d "%~dp0"

echo [1/2] Instalando paquetes de Electron...
npm install electron electron-builder electron-serve electron-updater --save-dev

echo.
echo [2/2] Listo!
echo.
echo ============================================
echo   Comandos disponibles:
echo.
echo   DESARROLLO (requiere "npm run web" corriendo):
echo   npm run electron:dev
echo.
echo   GENERAR .EXE:
echo   npm run electron:build
echo   (El .exe queda en la carpeta /release)
echo ============================================
echo.
pause
