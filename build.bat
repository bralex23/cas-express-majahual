@echo off
title CAS Tamanique — Build EXE
cd /d "%~dp0"
echo.
echo  Construyendo CAS Tamanique...
echo  Esto puede tardar 3-5 minutos. No cierres esta ventana.
echo.
npm run electron:build
echo.
if %ERRORLEVEL% EQU 0 (
    echo  [OK] Build exitoso. El instalador esta en la carpeta dist/
) else (
    echo  [ERROR] El build fallo. Revisa los mensajes de arriba.
)
echo.
pause
