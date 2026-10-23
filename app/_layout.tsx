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
      <View style={{
        flex: 1, justifyContent: 'center', alignItems: 'center',
        backgroundColor: '#003875',
        ...(Platform.OS === 'web' ? {
          backgroundImage: 'linear-gradient(145deg, #005f99 0%, #003875 50%, #001535 100%)',
        } : {}),
      } as any}>
        {/* Logo card */}
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.10)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
          borderRadius: 24, padding: 32, alignItems: 'center',
          ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(20px)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
          } : {}),
        } as any}>
          <View style={{
            width: 80, height: 80, borderRadius: 40,
            backgroundColor: 'rgba(130,207,255,0.15)',
            borderWidth: 1.5, borderColor: 'rgba(130,207,255,0.4)',
            justifyContent: 'center', alignItems: 'center', marginBottom: 16,
          }}>
            <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color="#82cfff" />
            </View>
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
              <View style={{ width: 20, height: 3, borderRadius: 2, backgroundColor: '#82cfff', opacity: 0.9 }}/>
              <View style={{ width: 8, height: 3, borderRadius: 2, backgroundColor: '#82cfff', opacity: 0.5 }}/>
              <View style={{ width: 4, height: 3, borderRadius: 2, backgroundColor: '#82cfff', opacity: 0.3 }}/>
            </View>
          </View>
        </View>
        <View style={{ marginTop: 24, alignItems: 'center', gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: 'rgba(130,207,255,' + (0.8 - i * 0.25) + ')',
              }}/>
            ))}
          </View>
        </View>
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
