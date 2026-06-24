# 📱 CAS EXPRESS — Tutorial Completo de Instalación

**Majahual Tamanique CAS Express** · Firebase + Expo · Android + iOS + Web

---

## ¿Qué vas a instalar?
- **Firebase** (gratis) → base de datos, usuarios, fotos en la nube
- **Expo** → framework para crear la app
- **Node.js** → necesario para correr el proyecto

Tiempo estimado: **1-2 horas** la primera vez.

---

## PASO 1 — Instalar Node.js

1. Ve a https://nodejs.org
2. Descarga la versión **LTS** (la recomendada)
3. Instala normalmente (siguiente, siguiente, finalizar)
4. Verifica: abre **CMD** y escribe: `node --version`
   - Debe mostrar algo como `v20.x.x`

---

## PASO 2 — Instalar Expo CLI

Abre **CMD** (o PowerShell) y escribe:

```bash
npm install -g expo-cli eas-cli
```

Verifica: `expo --version`

---

## PASO 3 — Crear cuenta en Firebase (GRATIS)

1. Ve a https://console.firebase.google.com
2. Inicia sesión con tu cuenta de Google
3. Click en **"Agregar proyecto"**
4. Nombre: `cas-express` → Continuar
5. **Desactiva** Google Analytics (no es necesario) → Crear proyecto

### 3.1 Activar Authentication
1. En el menú izquierdo: **Authentication** → **Comenzar**
2. En la pestaña **Sign-in method**: habilita **Correo/contraseña** → Guardar

### 3.2 Activar Firestore Database
1. En el menú: **Firestore Database** → **Crear base de datos**
2. Selecciona **Modo de producción** → Siguiente
3. Ubicación: `us-central` → Habilitar

### 3.3 Activar Storage (para fotos)
1. En el menú: **Storage** → **Comenzar**
2. Siguiente → Listo

### 3.4 Registrar la app web
1. En la página principal del proyecto, haz click en el ícono **`</>`** (Web)
2. Alias: `cas-express-web` → **Registrar app**
3. Copia el objeto `firebaseConfig` que aparece. Se ve así:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "tu-proyecto.firebaseapp.com",
     projectId: "tu-proyecto",
     storageBucket: "tu-proyecto.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123:web:abc"
   };
   ```

---

## PASO 4 — Configurar las variables de entorno

1. En la carpeta del proyecto (`CAS EXPRESS SISTEMA MAJAHUAL TAMANIQUE`), encuentra el archivo `.env.example`
2. Copia ese archivo y renómbralo a `.env`
3. Abre `.env` con el Bloc de notas y reemplaza los valores con los de tu `firebaseConfig`:

```
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSy...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=tu-proyecto
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
EXPO_PUBLIC_FIREBASE_APP_ID=1:123:web:abc
```

---

## PASO 5 — Configurar reglas de Firestore

1. En Firebase Console → **Firestore Database** → pestaña **Reglas**
2. Borra todo lo que hay
3. Copia el contenido completo del archivo `firestore.rules`
4. Pégalo y haz click en **Publicar**

---

## PASO 6 — Crear tu primer usuario (Admin)

1. En Firebase Console → **Authentication** → **Usuarios** → **Agregar usuario**
2. Ingresa el correo de tu novia (o el tuyo): `tuemail@gmail.com`
3. Contraseña temporal: `CasExpress2025!`
4. Click en **Agregar usuario**
5. Copia el **UID** que aparece (es una cadena como `abc123xyz`)
6. Ve a **Firestore Database** → **Datos** → Colección `perfiles`
7. Encuentra el documento con ese UID
8. Edita el campo `rol` y cambia `asesor` por `admin`
9. Guarda

> ⚠️ **Importante:** El primer usuario que se registre queda como "asesor". Debes cambiarlo manualmente a "admin" desde Firestore. Después, el admin puede crear el resto de usuarios desde la app.

---

## PASO 7 — Instalar dependencias y correr la app

Abre **CMD**, navega a la carpeta del proyecto:

```bash
cd "C:\Users\BRALX\Desktop\CAS EXPRESS SISTEMA MAJAHUAL TAMANIQUE"
npm install
npx expo start
```

Esto abre un **QR code** en tu navegador.

### Para ver en tu celular:
1. Instala **Expo Go** en el celular (Android o iPhone)
2. Escanea el QR con Expo Go (Android) o con la cámara (iPhone)
3. La app se abre directamente

### Para ver en tu PC (navegador):
- Presiona `W` en la terminal donde corre expo
- Se abre en Chrome como si fuera una app web

---

## PASO 8 — Compilar APK para Android (instalación directa)

> Para distribuir la app a los asesores sin publicarla en Play Store.

### 8.1 Crear cuenta en Expo
```bash
npx eas login
```
Crea una cuenta en https://expo.dev (gratis)

### 8.2 Configurar EAS
```bash
npx eas build:configure
```

### 8.3 Compilar APK
```bash
npx eas build --platform android --profile preview
```

Esto sube el código a los servidores de Expo, compila el APK y te da un enlace para descargarlo. **Tarda unos 15-20 minutos.**

Descarga el APK → envíalo por WhatsApp a tus asesores → ellos lo instalan.

> En Android, antes de instalar necesitan activar: **Configuración → Seguridad → Instalar apps de fuentes desconocidas**

---

## PASO 9 — Compilar para iPhone (iOS)

Necesitas una **cuenta de desarrollador Apple** ($99/año) O usar **TestFlight**.

Sin la cuenta de desarrollador, lo más fácil para iPhone es:
- Usar la **versión web** (paso siguiente)
- O crear la cuenta en https://developer.apple.com

```bash
npx eas build --platform ios
```

---

## PASO 10 — Desplegar versión WEB (gratis, sincronizada en PC y celular)

La versión web funciona en cualquier dispositivo con un navegador. Perfecta para usar en la PC del negocio.

### Opción A: Hosting de Firebase (recomendado)
```bash
npm install -g firebase-tools
firebase login
npx expo export --platform web
firebase init hosting
# Cuando pregunte por el directorio: escribe "dist"
firebase deploy
```

Te da una URL como `https://cas-express.web.app` — funciona en PC, celular y tablet.

### Opción B: Netlify (aún más fácil)
1. Ve a https://netlify.com → Signup gratis
2. `npx expo export --platform web` → genera carpeta `dist`
3. Arrastra la carpeta `dist` a Netlify
4. Listo — te da una URL pública

---

## Estructura del sistema

```
Roles y permisos:
├── Admin        → ve todo, crea usuarios, gestiona rutas
├── Supervisor   → ve todas las rutas, aprueba, reportes
├── Asesor       → solo ve sus clientes y préstamos
└── Cobrador     → solo registra pagos de su ruta

Datos sincronizados:
├── Clientes     → nombre, DUI, foto, teléfono, Google Maps
├── Préstamos    → monto, interés, plazo, frecuencia, estado
├── Pagos        → cuota, mora automática, firma
├── Ahorros      → depósitos y retiros
└── Rutas        → organización de asesores
```

---

## Cálculo de mora

El sistema calcula mora automáticamente:
- **5% de la cuota por día de atraso**
- Ejemplo: cuota $10, 3 días atrasada → mora $1.50
- Puedes cambiar el porcentaje en `src/utils/calculos.ts` (línea `pct = 5`)

---

## Flujo de trabajo diario

1. Asesor abre la app → **Cobros del día**
2. Ve la lista de clientes que tienen cuota hoy
3. Va casa por casa, cobra y presiona **"Cobrar"**
4. El sistema registra el pago con fecha y hora
5. Si hay mora, se calcula y cobra automáticamente
6. Al finalizar → **Reportes** → genera PDF → comparte por WhatsApp al supervisor

---

## Preguntas frecuentes

**¿El sistema funciona sin internet?**
No, requiere conexión para sincronizar datos. Con datos móviles funciona perfecto.

**¿Cuánto cuesta Firebase?**
El plan Spark (gratuito) incluye:
- 1 GB de base de datos
- 50,000 lecturas/día
- 20,000 escrituras/día
- 5 GB de storage para fotos
Para una financiera pequeña/mediana, el plan gratis es suficiente durante mucho tiempo.

**¿Cómo agregar nuevos asesores?**
Desde la app → tab **"Admin"** → botón "+" → completa los datos → el asesor recibe su correo y contraseña.

**¿Cómo crear nuevas rutas?**
Por ahora se crean directamente en Firebase Console → Firestore → Colección `rutas` → Agregar documento.
(Próxima versión: gestión de rutas desde la app)

**¿Puedo cambiar el porcentaje de interés?**
Sí, el interés se define por préstamo. Al crear un préstamo, puedes ingresar el porcentaje que quieras.

---

## Soporte técnico

Sistema desarrollado con ❤️ para Majahual Tamanique CAS Express.

Si algo no funciona:
1. Verifica que el archivo `.env` tiene las credenciales correctas
2. Verifica que las reglas de Firestore están publicadas
3. Revisa la consola del CMD para mensajes de error

---

*© 2025 Majahual Tamanique CAS Express — Creciendo Juntos*
