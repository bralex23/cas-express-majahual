const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts');
const dst = path.join(__dirname, 'assets/fonts');

if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });

['MaterialCommunityIcons', 'FontAwesome', 'Ionicons'].forEach(name => {
  fs.copyFileSync(path.join(src, `${name}.ttf`), path.join(dst, `${name}.ttf`));
  console.log(`✓ Copiado: ${name}.ttf`);
});

console.log('Listo. Reinicia expo con: npx expo start --web --clear');
