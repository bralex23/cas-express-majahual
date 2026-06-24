@echo off
echo ============================================
echo   CAS Majahual - Publicar Cambios
echo ============================================
echo.

cd /d "%~dp0"

git add -A

echo Cambios pendientes:
git status --short
echo.

set /p MSG=Descripcion del cambio (ej: "Corregi calculo de mora"):

if "%MSG%"=="" set MSG=Actualizacion

git commit -m "%MSG%"

echo.
echo Enviando a GitHub...
git push

echo.
echo ============================================
echo   Listo! GitHub compilara el instalador
echo   en aprox. 5-10 minutos.
echo.
echo   La PC AMD recibira la actualizacion
echo   automaticamente al abrir la app.
echo ============================================
echo.
pause
