@echo off
echo ============================================
echo   CAS Majahual - Compilar EXE
echo ============================================
echo.

cd /d "%~dp0"

if "%GH_TOKEN%"=="" (
  echo AVISO: No hay GH_TOKEN - se generara el .exe sin publicar en GitHub
  echo.
  set PUBLICAR=no
) else (
  set PUBLICAR=si
)

echo Exportando app con Expo...
call npx expo export --platform web --output-dir dist
if errorlevel 1 (
  echo ERROR: Fallo la exportacion de Expo.
  pause
  exit /b 1
)

echo.
echo Compilando instalador .exe...
if "%PUBLICAR%"=="si" (
  call npx electron-builder --win --publish always
) else (
  call npx electron-builder --win
)

if errorlevel 1 (
  echo ERROR: Fallo la compilacion.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   LISTO - Instalador en carpeta: release\
if "%PUBLICAR%"=="si" (
  echo   Publicado en GitHub - AMD se actualiza automatico
)
echo ============================================
echo.
pause
