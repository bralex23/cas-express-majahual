@echo off
title CAS Tamanique — Build APK Android
cd /d "%~dp0"
echo.
echo  Construyendo APK de CAS Tamanique para Android...
echo  Esto puede tardar 5-10 minutos. No cierres esta ventana.
echo.

:: Verificar / configurar SDK de Android automaticamente
set "SDK_PATH=%LOCALAPPDATA%\Android\Sdk"
if not exist "%SDK_PATH%" (
    echo  [WARN] No se encontro el SDK en %SDK_PATH%
    echo  Busca la carpeta del SDK de Android Studio e ingresala:
    set /p SDK_PATH="> SDK Path: "
)
echo  SDK: %SDK_PATH%
echo sdk.dir=%SDK_PATH:\=\\% > android\local.properties
echo  [OK] local.properties actualizado.
echo.

echo  [1/3] Exportando bundle web...
call npx expo export --platform web --output-dir dist
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Fallo al exportar el bundle web.
    pause & exit /b 1
)

echo.
echo  [2/3] Sincronizando con Capacitor Android...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Fallo al sincronizar Capacitor.
    pause & exit /b 1
)

echo.
echo  [3/3] Compilando APK Debug (firmado automaticamente)...
cd android
call gradlew assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Fallo al compilar el APK. Verifica que Android Studio y el JDK esten instalados.
    cd ..
    pause & exit /b 1
)
cd ..

echo.
echo  [OK] APK generado exitosamente!
echo  Ubicacion: android\app\build\outputs\apk\debug\app-debug.apk
echo.
pause
