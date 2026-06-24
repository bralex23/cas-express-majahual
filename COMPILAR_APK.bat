@echo off
title CAS Express - Compilar APK Android
color 1F
cd /d "%~dp0"

echo.
echo  ============================================
echo    CAS EXPRESS - COMPILAR APK ANDROID
echo  ============================================
echo.

:: ── Detectar JDK de Android Studio automaticamente ──────────────────────────
if not defined JAVA_HOME (
    echo  Buscando JDK de Android Studio...

    :: Android Studio Quail / Ladybug / Hedgehog usan "jbr"
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
        echo  OK - JDK encontrado en Android Studio jbr
        goto :jdk_found
    )
    :: Versiones anteriores usan "jre"
    if exist "C:\Program Files\Android\Android Studio\jre\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jre"
        echo  OK - JDK encontrado en Android Studio jre
        goto :jdk_found
    )
    :: Ruta alternativa si Android Studio esta en otro lugar
    if exist "C:\Program Files (x86)\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files (x86)\Android\Android Studio\jbr"
        echo  OK - JDK encontrado
        goto :jdk_found
    )

    echo  ERROR: No se encontro el JDK. Abre Android Studio al menos una vez
    echo  para que instale el JDK incluido.
    pause
    exit /b 1
)
:jdk_found
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo  JAVA_HOME = %JAVA_HOME%
echo.

:: ── Detectar Android SDK ─────────────────────────────────────────────────────
if not defined ANDROID_HOME (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
        echo  OK - Android SDK encontrado
    )
)
echo.

echo  [1/3] Compilando web actualizada...
call npx expo export --platform web --output-dir dist
if errorlevel 1 (
    echo  ERROR: Fallo el export de Expo.
    pause
    exit /b 1
)
echo  OK - Web compilada.
echo.

echo  [2/3] Sincronizando con proyecto Android...
call npx cap sync android
if errorlevel 1 (
    echo  ERROR: Fallo el sync. Ejecuta SETUP_CAPACITOR.bat primero.
    pause
    exit /b 1
)
echo  OK - Sincronizado.
echo.

echo  [3/3] Compilando APK (debug)...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo  ERROR: Fallo el build de Gradle.
    pause
    exit /b 1
)
cd ..

echo.
echo  ============================================
echo    APK generada exitosamente!
echo.
echo    Ubicacion:
echo    android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo    Copia ese archivo a tu celular/tablet
echo    e instalalo (permite "Fuentes desconocidas" en ajustes)
echo  ============================================
echo.

explorer android\app\build\outputs\apk\debug\
pause
