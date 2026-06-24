@echo off
title CAS Express - Instalar soporte PDF para Android
color 1F
cd /d "%~dp0"

echo.
echo  ============================================
echo    INSTALAR SOPORTE DE PDF PARA ANDROID
echo  ============================================
echo.

echo  [1/2] Instalando jsPDF + plugins Capacitor...
call npm install @capacitor/filesystem @capacitor/share jspdf
if errorlevel 1 (
    echo  ERROR al instalar paquetes.
    pause
    exit /b 1
)
echo  OK
echo.

echo  [2/2] Sincronizando con proyecto Android...
call npx cap sync android
if errorlevel 1 (
    echo  ERROR al sincronizar.
    pause
    exit /b 1
)
echo  OK
echo.

echo  ============================================
echo    Listo! Ahora corre COMPILAR_APK.bat
echo    para generar el APK con soporte de PDF.
echo  ============================================
echo.
pause
