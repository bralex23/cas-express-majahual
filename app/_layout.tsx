import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { View, ActivityIndicator, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import * as Font from 'expo-font';
import { AuthContext, useAuthProvider } from '../src/hooks/useAuth';
import { ThemeProvider, usePaperTheme } from '../src/theme';
import { EmpresaProvider } from '../src/context/empresa';
import { PinLock } from '../src/components/PinLock';

// ─── Carga de fuente de íconos en Web ────────────────────────────────────────
// @expo/vector-icons usa internamente 'material-community' como font family
// (ver: node_modules/@expo/vector-icons/build/MaterialCommunityIcons.js).
//
// El componente Icon revisa Font.isLoaded('material-community') en el constructor.
// Si es true → renderiza el ícono directo, sin llamar Font.loadAsync(assetId).
// Si es false → llama Font.loadAsync(assetId) en componentDidMount SIN try/catch
//              → en web el assetId puede ser undefined → "Cannot read properties of undefined" ×22
//
// Solución: pre-cargar 'material-community' en expo-font ANTES de que monten los iconos,
// usando una URI estática confiable (public/fonts/ que Metro sirve en / directamente).
const FONT_FAMILY = 'material-community';

// URIs donde Metro puede servir la fuente en web/Electron
const FONT_URIS = [
  '/fonts/MaterialCommunityIcons.ttf',   // public/fonts/ → Metro lo sirve aquí
  '/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf',
  './assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf',
];

/** Registra 'material-community' en expo-font con Font.loadAsync directo.
 *  Una vez registrado, Font.isLoaded() devuelve true → los Icon components
 *  no intentan llamar Font.loadAsync(assetId=undefined) al montar. */
async function loadIconFontWeb(): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (Font.isLoaded(FONT_FAMILY)) return;

  for (const uri of FONT_URIS) {
    try {
      await Promise.race([
        Font.loadAsync({ [FONT_FAMILY]: { uri } }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 800)),
      ]);
      return; // ✓ éxito
    } catch (_) {
      // intentar siguiente URI
    }
  }
}

const fontReadyPromise = loadIconFontWeb().catch(() => {});

// ─── Componentes ─────────────────────────────────────────────────────────────

function ThemedApp() {
  const paperTheme = usePaperTheme();
  return (
    <PaperProvider theme={paperTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </PaperProvider>
  );
}

export default function RootLayout() {
  const auth = useAuthProvider();
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    // Espera hasta 2000 ms para que cargue la fuente antes de mostrar íconos
    const timeout = setTimeout(() => setFontReady(true), 2000);
    fontReadyPromise.then(() => {
      clearTimeout(timeout);
      setFontReady(true);
    });
    return () => clearTimeout(timeout);
  }, []);

  if (!fontReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#051208' }}>
        <ActivityIndicator size="large" color="#69f0ae" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <ThemeProvider>
        <EmpresaProvider>
          <PinLock>
            <ThemedApp />
          </PinLock>
        </EmpresaProvider>
      </ThemeProvider>
    </AuthContext.Provider>
  );
}
