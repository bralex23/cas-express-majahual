/**
 * isAndroidApp()
 * Devuelve true SOLO dentro del WebView nativo de Android/iOS real.
 * Da false en Electron, navegador y expo-web — aunque window.Capacitor exista.
 *
 * IMPORTANTE: no usar Platform.OS para separar escritorio de Android en este
 * proyecto, porque el APK se compila como export web → Platform.OS === 'web'
 * da true tanto en Electron como en el celular real.
 */
export function isAndroidApp(): boolean {
  const cap = typeof window !== 'undefined' ? (window as any).Capacitor : undefined;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}
