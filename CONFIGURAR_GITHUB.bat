@echo off
chcp 65001 >nul
echo ============================================
echo   CAS Majahual - Configurar GitHub
echo ============================================
echo.
echo Este script solo se corre UNA VEZ en la PC Intel.
echo Sirve para publicar actualizaciones automaticas.
echo.

cd /d "%~dp0"

:: Pedir usuario de GitHub
echo Paso 1: Usuario de GitHub
echo   (el mismo que usas en github.com)
echo.
set /p GITHUB_USER=Escribe tu usuario de GitHub:

if "%GITHUB_USER%"=="" (
  echo Error: usuario vacio.
  pause
  exit /b 1
)

:: Actualizar package.json con el usuario real
node -e "const fs=require('fs');const p=require('./package.json');p.build.publish.owner='%GITHUB_USER%';fs.writeFileSync('./package.json',JSON.stringify(p,null,2));"
echo [OK] package.json actualizado con usuario: %GITHUB_USER%

:: Guardar config local
echo GITHUB_USER=%GITHUB_USER%> .github-config
echo [OK] Config guardada en .github-config

echo.
echo Paso 2: Token de GitHub
echo   1. Ve a: https://github.com/settings/tokens/new
echo   2. En "Note" escribe: CAS Majahual
echo   3. En "Expiration" elige: No expiration
echo   4. Marca el checkbox: repo (acceso completo)
echo   5. Click en "Generate token"
echo   6. COPIA el token (empieza con ghp_...)
echo.
set /p GH_TOKEN_INPUT=Pega aqui el token de GitHub:

if "%GH_TOKEN_INPUT%"=="" (
  echo Error: token vacio.
  pause
  exit /b 1
)

:: Guardar token como variable de entorno permanente del sistema
setx GH_TOKEN "%GH_TOKEN_INPUT%"
echo [OK] Token guardado como variable de entorno GH_TOKEN

echo.
echo Paso 3: Crear repositorio en GitHub
echo   1. Ve a: https://github.com/new
echo   2. Nombre del repo: cas-express-majahual
echo   3. Selecciona: Private
echo   4. NO inicialices con README
echo   5. Click "Create repository"
echo.
echo Cuando lo hayas creado, presiona cualquier tecla...
pause >nul

:: Inicializar Git y hacer primer push
echo.
echo Inicializando repositorio Git...

if not exist ".git" (
  git init
  git add -A
  git commit -m "Initial commit - CAS Majahual Tamanique v1.0.0"
  git branch -M main
  git remote add origin https://github.com/%GITHUB_USER%/cas-express-majahual.git
  git push -u origin main
) else (
  git add -A
  git commit -m "Setup GitHub publish"
  git push
)

if errorlevel 1 (
  echo.
  echo [AVISO] El push fallo. Verifica que el repo exista en GitHub.
  echo Comando manual: git remote add origin https://github.com/%GITHUB_USER%/cas-express-majahual.git
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Configuracion completa!
echo.
echo   Ahora puedes correr COMPILAR_EXE.bat
echo   para generar el instalador y publicar
echo   actualizaciones automaticas.
echo ============================================
echo.
pause
