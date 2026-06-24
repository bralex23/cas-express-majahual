@echo off
title CAS Express - Setup Capacitor (Solo se corre UNA VEZ)
color 1F
cd /d "%~dp0"

echo.
echo  ============================================
echo    CAS EXPRESS - SETUP CAPACITOR ANDROID
echo    (Ejecutar solo la primera vez)
echo  ============================================
echo.

echo  [1/4] Instalando paquetes de Capacitor + PDF...
call npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem @capacitor/share jspdf
if errorlevel 1 (
    echo  ERROR: Fallo al instalar paquetes. Verifica tu conexion a internet.
    pause
    exit /b 1
)
echo  OK - Capacitor + jsPDF instalados.
echo.

echo  [2/4] Compilando web (Expo export)...
call npx expo export --platform web --output-dir dist
if errorlevel 1 (
    echo  ERROR: Fallo el export de Expo.
    pause
    exit /b 1
)
echo  OK - Web compilada en dist/
echo.

echo  [3/4] Inicializando plataforma Android...
call npx cap add android
if errorlevel 1 (
    echo  ERROR: Fallo al agregar Android. Puede que ya este inicializado, continuando...
)
echo  OK - Plataforma Android agregada.
echo.

echo  [4/4] Sincronizando assets con Android...
call npx cap sync android
if errorlevel 1 (
    echo  ERROR: Fallo el sync de Capacitor.
    pause
    exit /b 1
)
echo  OK - Assets sincronizados.
echo.

echo  ============================================
echo    Setup completado!
echo.
echo    SIGUIENTE PASO: Ejecuta COMPILAR_APK.bat
echo    (necesitas Android Studio o JDK instalado)
echo  ============================================
echo.
pause
