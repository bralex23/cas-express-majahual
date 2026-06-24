@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║        CAS Express — Guía de Actualizaciones Automáticas    ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo ¿CÓMO FUNCIONA?
echo ───────────────
echo  Tu app tiene un sistema de actualización automática.
echo  Cuando publicas una nueva versión en GitHub, la app en la
echo  computadora de tu papá se actualiza sola al abrirse.
echo.
echo  NO necesitas llevar ningún USB ni instalar nada de nuevo.
echo.
echo ═══════════════════════════════════════════════════════════════
echo  PASO 1 — Crear cuenta GitHub (solo una vez)
echo ═══════════════════════════════════════════════════════════════
echo.
echo  1. Ve a: https://github.com
echo  2. Crea una cuenta gratuita (usa: alexpagos23 como usuario)
echo  3. Crea un repositorio NUEVO llamado: cas-express-releases
echo     - Ponlo como PÚBLICO
echo     - NO inicialices con README
echo.
echo ═══════════════════════════════════════════════════════════════
echo  PASO 2 — Crear Token de Acceso (solo una vez)
echo ═══════════════════════════════════════════════════════════════
echo.
echo  1. Ve a: https://github.com/settings/tokens
echo  2. Click en "Generate new token (classic)"
echo  3. Ponle nombre: cas-express-build
echo  4. Expiration: No expiration (o 1 año)
echo  5. Selecciona el scope: [✓] repo (todo el bloque)
echo  6. Click "Generate token"
echo  7. COPIA el token (empieza con ghp_...)
echo.
echo  8. Abre una terminal y pega:
echo     setx GH_TOKEN "ghp_TU_TOKEN_AQUI"
echo  9. CIERRA y vuelve a abrir la terminal
echo.
echo ═══════════════════════════════════════════════════════════════
echo  PASO 3 — Compilar y publicar primera versión
echo ═══════════════════════════════════════════════════════════════
echo.
echo  Corre: COMPILAR_EXE.bat
echo.
echo  Esto genera:
echo    release\CAS Express Setup 1.0.0.exe  ← instalar en PC del papá
echo    release\latest.yml                    ← archivo de versiones
echo  Y los sube automáticamente a GitHub Releases.
echo.
echo ═══════════════════════════════════════════════════════════════
echo  PASO 4 — Instalar en la PC de tu papá (solo una vez)
echo ═══════════════════════════════════════════════════════════════
echo.
echo  1. Copia el archivo: release\CAS Express Setup 1.0.0.exe
echo     a un USB o compártelo por WhatsApp/Drive
echo  2. En la PC del papá: doble click → instalar
echo  3. Listo. Ya nunca más necesitas llevar nada.
echo.
echo ═══════════════════════════════════════════════════════════════
echo  PASO 5 — Cuando hagas cambios al sistema
echo ═══════════════════════════════════════════════════════════════
echo.
echo  1. Abre package.json y sube la versión:
echo     "version": "1.0.0"  →  "version": "1.0.1"
echo  2. Corre COMPILAR_EXE.bat
echo  3. ¡Listo! La próxima vez que tu papá abra CAS Express,
echo     verá un mensaje: "Hay una nueva versión disponible"
echo     y se actualizará sola.
echo.
echo ═══════════════════════════════════════════════════════════════
echo  RESUMEN DE VERSIONES (guíate por esto):
echo ═══════════════════════════════════════════════════════════════
echo.
echo  1.0.0 → Primera versión
echo  1.0.1 → Corrección pequeña (bug fix)
echo  1.1.0 → Nueva función
echo  2.0.0 → Cambio grande
echo.
pause
