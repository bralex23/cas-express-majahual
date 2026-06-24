@echo off
echo ============================================
echo   CAS Majahual - Publicar Cambios
echo ============================================
echo.

cd /d "%~dp0"

REM Leer version actual del package.json
for /f "tokens=2 delims=:, " %%v in ('findstr /r "\"version\"" package.json') do (
  set CURRENT_VER=%%~v
)
echo Version actual: %CURRENT_VER%
echo.

set /p NEW_VER=Nueva version (Enter para incrementar automatico):

if "%NEW_VER%"=="" (
  REM Incrementar el ultimo numero automaticamente
  for /f "tokens=1,2,3 delims=." %%a in ("%CURRENT_VER%") do (
    set /a PATCH=%%c+1
    set NEW_VER=%%a.%%b.!PATCH!
  )
)

REM Habilitar delayed expansion para usar !NEW_VER!
setlocal enabledelayedexpansion

if "%NEW_VER%"=="" set NEW_VER=%CURRENT_VER%

echo Nueva version: !NEW_VER!

REM Actualizar version en package.json
powershell -Command "(Get-Content package.json) -replace '\"version\": \"%CURRENT_VER%\"', '\"version\": \"!NEW_VER!\"' | Set-Content package.json"

git add -A

echo.
echo Cambios pendientes:
git status --short
echo.

set /p MSG=Descripcion del cambio (ej: Corregi calculo de mora):

if "!MSG!"=="" set MSG=Actualizacion v!NEW_VER!

git commit -m "v!NEW_VER! - !MSG!"

echo.
echo Enviando a GitHub...
git push

echo.
echo ============================================
echo   Listo! Version !NEW_VER! publicada.
echo   GitHub compilara en aprox. 5-10 min.
echo.
echo   La PC AMD recibira la actualizacion
echo   automaticamente al abrir la app.
echo ============================================
echo.
pause
