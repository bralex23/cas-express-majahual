// Parche necesario para expo-router en web/Electron
// Metro no puede resolver process.env.EXPO_ROUTER_APP_ROOT como string estatica
// Este script se corre automaticamente despues de npm install

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'expo-router', '_ctx.web.tsx');

if (!fs.existsSync(filePath)) {
  console.log('patch-expo-router: archivo no encontrado, saltando.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes("'../../app'")) {
  console.log('patch-expo-router: ya aplicado, OK.');
  process.exit(0);
}

content = content.replace(
  'process.env.EXPO_ROUTER_APP_ROOT',
  "'../../app'"
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('patch-expo-router: parche aplicado en _ctx.web.tsx');
