// Parche para expo-router en web/Electron
// Metro no puede resolver variables de entorno como strings estaticas en require.context()

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'expo-router', '_ctx.web.tsx');

if (!fs.existsSync(filePath)) {
  console.log('patch-expo-router: archivo no encontrado, saltando.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');
let changed = false;

// Parche 1: Reemplazar EXPO_ROUTER_APP_ROOT con path fijo
if (content.includes('process.env.EXPO_ROUTER_APP_ROOT')) {
  content = content.replace(/process\.env\.EXPO_ROUTER_APP_ROOT/g, "'../../app'");
  changed = true;
  console.log('patch-expo-router: parche 1 OK (APP_ROOT)');
}

// Parche 2: Eliminar 4to argumento EXPO_ROUTER_IMPORT_MODE_WEB (Metro lo rechaza)
if (content.includes('process.env.EXPO_ROUTER_IMPORT_MODE_WEB')) {
  // Con comentario @ts-expect-error
  content = content.replace(/,[\s\n]*\/\/\s*@ts-expect-error[^\n]*\n[\s]*process\.env\.EXPO_ROUTER_IMPORT_MODE_WEB/g, '');
  // Sin comentario
  content = content.replace(/,[\s\n]*process\.env\.EXPO_ROUTER_IMPORT_MODE_WEB/g, '');
  changed = true;
  console.log('patch-expo-router: parche 2 OK (IMPORT_MODE_WEB)');
}

if (changed) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('patch-expo-router: archivo actualizado.');
} else {
  console.log('patch-expo-router: ya estaba correcto, OK.');
}
