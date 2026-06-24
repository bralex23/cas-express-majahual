@echo off
title Crear Accesos Directos - CAS Express
cd /d "%~dp0"
echo Creando accesos directos en el Escritorio...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0crear-accesos.ps1"
echo.
echo Listo!
echo.
pause
