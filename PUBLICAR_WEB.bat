@echo off
title CAS Express - Publicar version web (Firebase Hosting)
color 1F
cd /d "%~dp0"

echo.
echo  ============================================
echo    CAS EXPRESS - PUBLICAR VERSION WEB
echo  ============================================
echo.

echo  [1/3] Compilando version web actualizada...
call npx expo export --platform web --output-dir dist
if errorlevel 1 (
    echo  ERROR: Fallo el export de Expo.
    pause
    exit /b 1
)
echo  OK - Web compilada.
echo.

echo  [2/3] Verificando Firebase CLI...
where firebase >nul 2>nul
if errorlevel 1 (
    echo  No se encontro Firebase CLI, instalando...
    call npm install -g firebase-tools
)
echo.

echo  [3/3] Publicando a Firebase Hosting...
call firebase deploy --only hosting
if errorlevel 1 (
    echo.
    echo  ERROR: Fallo la publicacion.
    echo  Si es la primera vez, ejecuta primero: firebase login
    pause
    exit /b 1
)

echo.
echo  ============================================
echo    Publicado correctamente!
echo.
echo    Tu novia puede abrir esta direccion
echo    desde Safari en su iPhone:
echo.
echo    https://cas-express-ba9ea.web.app
echo.
echo    Luego: compartir -^> "Agregar a pantalla de inicio"
echo  ============================================
echo.
pause
