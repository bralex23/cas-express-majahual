/**
 * PinLock — pantalla de seguridad PIN de 4 dígitos.
 * - Se activa al abrir la app
 * - Se reactiva tras 1 hora de inactividad
 * - Soporta autenticación biométrica (huella/face) vía @aparajita/capacitor-biometric-auth
 *   (solo en móvil Capacitor, no en escritorio Electron)
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { isAndroidApp } from '../lib/biometric';
import { useColors } from '../theme';

/* ── Helper: reloj en vivo ─────────────────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const PIN_KEY      = 'cas_pin_hash';
const BIO_ON_KEY   = 'cas_bio_on';       // '1' si biometría activada
const TIMEOUT_MS   = 60 * 60 * 1000;    // 1 hora
const PIN_LENGTH   = 4;
const DIGITS       = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

/** Hash simple — solo ofuscación local */
function hashPin(pin: string): string {
  let h = 0;
  for (let i = 0; i < pin.length; i++) {
    h = (Math.imul(31, h) + pin.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function getStored(): string | null {
  try { return localStorage.getItem(PIN_KEY); } catch { return null; }
}
function setStored(hash: string) {
  try { localStorage.setItem(PIN_KEY, hash); } catch {}
}

/** Detecta si la app corre en Capacitor (móvil) */
function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor;
}

/* ── Biometría nativa via @aparajita/capacitor-biometric-auth ─────────── */

async function checkBioAvailable(): Promise<boolean> {
  try {
    if (!isAndroidApp()) return false;
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable ?? false;
  } catch { return false; }
}

async function autenticarBio(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason: 'Verifica tu identidad para acceder',
      cancelTitle: 'Cancelar',
      allowDeviceCredential: true,
    } as any);
    return true;
  } catch (e) {
    console.warn('[Bio] auth error:', e);
    return false;
  }
}

async function registrarBio(): Promise<boolean> {
  // Con capacitor-biometric-auth no hay registro previo — autenticar una vez para confirmar
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason: 'Confirma tu huella para activarla',
      cancelTitle: 'Cancelar',
      allowDeviceCredential: false,
    } as any);
    try { localStorage.setItem(BIO_ON_KEY, '1'); } catch {}
    return true;
  } catch (e) {
    console.warn('[Bio] register error:', e);
    return false;
  }
}

interface Props { children: React.ReactNode; }
type Mode = 'locked' | 'setup' | 'confirm' | 'unlocked';

export function PinLock({ children }: Props) {
  const C = useColors();
  const storedHash = getStored();
  const [mode, setMode]       = useState<Mode>(storedHash ? 'locked' : 'setup');
  const [input, setInput]     = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError]     = useState('');
  const shakeAnim             = useRef(new Animated.Value(0)).current;
  const timerRef              = useRef<any>(null);

  // Estado biométrico
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioLoading,   setBioLoading]   = useState(false);
  const [showBioSetup, setShowBioSetup] = useState(false);

  // PIN en escritorio (Electron) Y en Android (Capacitor)
  const isPinEnabled = Platform.OS === 'web';

  // Estilos dinámicos según tema
  const D = useMemo(() => {
    const dark = C.isDark;
    return {
      rootBg: dark ? '#070d1b' : '#f0f4ff',
      rootGrad: dark
        ? 'linear-gradient(160deg, #0d1526 0%, #070d1b 60%, #0a1020 100%)'
        : 'linear-gradient(160deg, #eff6ff 0%, #f8fafc 60%, #f1f5f9 100%)',
      logoCircleBg:   dark ? 'rgba(0,212,176,0.10)' : '#eff6ff',
      logoCircleBdr:  dark ? 'rgba(0,212,176,0.30)' : '#bfdbfe',
      logoIconColor:  dark ? '#00d4b0' : '#2563eb',
      logoShadow:     dark ? '0 4px 20px rgba(0,212,176,0.18)' : '0 4px 20px rgba(37,99,235,0.12)',
      titleColor:     dark ? '#f1f5f9' : '#0f172a',
      subtitleColor:  dark ? '#94a3b8' : '#64748b',
      dotBdr:         dark ? 'rgba(255,255,255,0.18)' : '#cbd5e1',
      dotFilledBg:    C.primary,
      keyBg:          dark ? 'rgba(16,30,58,0.92)' : '#ffffff',
      keyBdr:         dark ? 'rgba(255,255,255,0.10)' : '#e2e8f0',
      keyShadow:      dark
        ? '0 2px 8px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)'
        : '0 2px 8px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
      keyTxtColor:    dark ? '#f1f5f9' : '#0f172a',
      keyDelBg:       dark ? 'rgba(220,38,38,0.15)' : '#fff1f2',
      keyDelBdr:      dark ? 'rgba(220,38,38,0.30)' : '#fecdd3',
      bioBtnBg:       dark ? 'rgba(0,212,176,0.09)' : '#eff6ff',
      bioBtnBdr:      dark ? 'rgba(0,212,176,0.25)' : '#bfdbfe',
      bioShadow:      dark ? '0 2px 8px rgba(0,212,176,0.12)' : '0 2px 8px rgba(37,99,235,0.10)',
      bioTxtColor:    dark ? '#00d4b0' : '#2563eb',
      resetTxtColor:  dark ? 'rgba(148,163,184,0.55)' : '#94a3b8',
      bioBoxBg:       dark ? '#111c35' : '#ffffff',
      bioBoxBdr:      dark ? 'rgba(255,255,255,0.10)' : '#e2e8f0',
      bioBoxShadow:   dark ? '0 16px 48px rgba(0,0,0,0.6)' : '0 16px 48px rgba(15,23,42,0.18)',
      bioTitleColor:  dark ? '#f1f5f9' : '#0f172a',
      bioDescColor:   dark ? '#94a3b8' : '#64748b',
    };
  }, [C]);

  // ── Chequeo inicial biometría ──────────────────────────────────────────
  useEffect(() => {
    if (!isPinEnabled || !isCapacitor()) return;
    checkBioAvailable().then(ok => {
      setBioAvailable(ok);
      if (ok) {
        const on = !!localStorage.getItem(BIO_ON_KEY);
        setBioEnabled(on);
        // Auto-trigger huella si ya estaba activada
        if (on && storedHash) {
          setTimeout(() => triggerBioAuto(), 600);
        }
      }
    });
  }, [isPinEnabled]);

  async function triggerBioAuto() {
    setBioLoading(true);
    try {
      const ok = await autenticarBio();
      if (ok) unlock(true);
    } catch {}
    finally { setBioLoading(false); }
  }

  // ── Timer inactividad ───────────────────────────────────────────────────
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setMode('locked');
      setInput('');
      setError('');
    }, TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (!isPinEnabled || mode !== 'unlocked') return;
    resetTimer();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const handler = () => resetTimer();
    events.forEach(e => window.addEventListener(e, handler));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(e => window.removeEventListener(e, handler));
    };
  }, [mode, resetTimer, isPinEnabled]);

  if (!isPinEnabled) return <>{children}</>;

  // ── Shake ─────────────────────────────────────────────────────────────
  const doShake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8,   duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 5,   duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 55, useNativeDriver: true }),
    ]).start();
  };

  // ── Desbloquear ─────────────────────────────────────────────────────────
  function unlock(fromBio = false) {
    setMode('unlocked');
    setInput('');
    setError('');
    resetTimer();
    if (!fromBio && bioAvailable && !bioEnabled && isCapacitor()) {
      setShowBioSetup(true);
    }
  }

  // ── Huella ──────────────────────────────────────────────────────────────
  async function usarHuella() {
    setBioLoading(true);
    setError('');
    try {
      const ok = await autenticarBio();
      if (ok) { unlock(true); } else { setError('Huella no reconocida'); }
    } catch { setError('Error al leer huella'); }
    finally  { setBioLoading(false); }
  }

  async function configurarHuella() {
    setBioLoading(true);
    try {
      const ok = await registrarBio();
      if (ok) { setBioEnabled(true); setShowBioSetup(false); }
      else    { setError('No se pudo registrar la huella'); }
    } catch { setError('Error al registrar huella'); }
    finally { setBioLoading(false); }
  }

  function quitarHuella() {
    try {
      localStorage.removeItem(BIO_ON_KEY);
      setBioEnabled(false);
    } catch {}
  }

  // ── Teclado ─────────────────────────────────────────────────────────────
  const handleDigit = (d: string) => {
    if (d === '⌫') { setInput(p => p.slice(0, -1)); setError(''); return; }
    if (input.length >= PIN_LENGTH) return;
    const next = input + d;
    setInput(next);
    if (next.length < PIN_LENGTH) return;

    if (mode === 'locked') {
      if (hashPin(next) === getStored()) {
        unlock(false);
      } else {
        doShake();
        setError('PIN incorrecto');
        setTimeout(() => setInput(''), 400);
      }
    } else if (mode === 'setup') {
      setConfirm(next);
      setInput('');
      setMode('confirm');
    } else if (mode === 'confirm') {
      if (next === confirm) {
        setStored(hashPin(next));
        unlock(false);
        setConfirm('');
      } else {
        doShake();
        setError('Los PIN no coinciden, intenta de nuevo');
        setConfirm('');
        setTimeout(() => { setInput(''); setMode('setup'); }, 600);
      }
    }
  };

  // ── Teclado físico (escritorio) ──────────────────────────────────────────
  useEffect(() => {
    if (!isPinEnabled || mode === 'unlocked') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
      else if (e.key === 'Backspace') handleDigit('⌫');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, input, confirm, isPinEnabled]);

  // ── App desbloqueada ──────────────────────────────────────────────────────
  if (mode === 'unlocked') {
    return (
      <View style={{ flex: 1 }}>
        {children}

        {/* Modal "¿Activar huella?" */}
        {showBioSetup && (
          <View style={p.bioModal}>
            <View style={[p.bioBox, {
              backgroundColor: D.bioBoxBg,
              borderColor: D.bioBoxBdr,
              ...({ boxShadow: D.bioBoxShadow } as any),
            }]}>
              <MaterialCommunityIcons name="fingerprint" size={52} color={D.bioTxtColor} style={{ marginBottom: 12 }}/>
              <Text style={[p.bioTitle, { color: D.bioTitleColor }]}>¿Activar huella digital?</Text>
              <Text style={[p.bioDesc, { color: D.bioDescColor }]}>
                Desbloquea CAS Express con tu huella dactilar en lugar del PIN.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <TouchableOpacity onPress={() => setShowBioSetup(false)}
                  style={[p.bioBtn, { borderColor: D.bioBoxBdr, borderWidth: 1 }]}>
                  <Text style={{ color: D.subtitleColor, fontWeight: '600' }}>Ahora no</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={configurarHuella}
                  disabled={bioLoading}
                  style={[p.bioBtn, { backgroundColor: D.logoIconColor }]}>
                  <Text style={{ color: '#ffffff', fontWeight: '800' }}>
                    {bioLoading ? 'Registrando...' : 'Activar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Botón quitar huella — esquina inferior, solo móvil */}
        {bioEnabled && isCapacitor() && !showBioSetup && (
          <TouchableOpacity onPress={quitarHuella} style={p.bioRemove}>
            <MaterialCommunityIcons name="fingerprint-off" size={18} color="rgba(200,169,81,0.5)"/>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Textos de modo ───────────────────────────────────────────────────────
  const title = mode === 'setup' ? 'Configura tu PIN'
    : mode === 'confirm' ? 'Confirma tu PIN'
    : 'Ingresa tu PIN';
  const subtitle = mode === 'setup' ? 'Elige 4 dígitos para proteger la app'
    : mode === 'confirm' ? 'Escribe el mismo PIN otra vez'
    : 'La app está bloqueada';

  const isDesktop = Platform.OS === 'web' && !isAndroidApp();

  /* ── Keypad compartido ── */
  const KeypadSection = () => (
    <View style={{ alignItems: 'center' }}>
      {/* Ícono candado */}
      <View style={[p.logoCircle, {
        backgroundColor: D.logoCircleBg,
        borderColor: D.logoCircleBdr,
        ...({ boxShadow: D.logoShadow } as any),
      }]}>
        <MaterialCommunityIcons name="shield-lock" size={36} color={D.logoIconColor}/>
      </View>

      {/* Título */}
      <Text style={[p.title, { color: D.titleColor }]}>{title}</Text>
      <Text style={[p.subtitle, { color: D.subtitleColor }]}>{subtitle}</Text>

      {/* Puntos PIN */}
      <Animated.View style={[p.dots, { transform: [{ translateX: shakeAnim }] }]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={[
            p.dot,
            { borderColor: D.dotBdr },
            i < input.length && {
              backgroundColor: D.dotFilledBg,
              borderColor: D.dotFilledBg,
              ...({ boxShadow: `0 0 10px ${D.dotFilledBg}66` } as any),
            },
          ]}/>
        ))}
      </Animated.View>

      {/* Error */}
      {error
        ? <Text style={p.error}>{error}</Text>
        : <View style={{ height: 20 }}/>
      }

      {/* Teclado numérico */}
      <View style={p.pad}>
        {DIGITS.map((d, i) => {
          if (d === '') return <View key={i} style={p.padEmpty}/>;
          const isDel = d === '⌫';
          return (
            <TouchableOpacity
              key={i}
              style={[p.key, {
                backgroundColor: isDel ? D.keyDelBg : D.keyBg,
                borderColor:     isDel ? D.keyDelBdr : D.keyBdr,
                ...({ boxShadow: D.keyShadow } as any),
              }]}
              onPress={() => handleDigit(d)}
              activeOpacity={0.70}
            >
              <Text style={[p.keyTxt, {
                color: isDel ? '#ef4444' : D.keyTxtColor,
                fontSize: isDel ? 20 : 24,
              }]}>
                {d}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Huella */}
      {mode === 'locked' && bioAvailable && isCapacitor() && (
        <TouchableOpacity
          onPress={bioEnabled ? usarHuella : configurarHuella}
          disabled={bioLoading}
          style={[p.bioButton, {
            backgroundColor: D.bioBtnBg,
            borderColor: D.bioBtnBdr,
            ...({ boxShadow: D.bioShadow } as any),
          }]}
        >
          <MaterialCommunityIcons
            name="fingerprint"
            size={38}
            color={bioLoading ? `${D.bioTxtColor}55` : D.bioTxtColor}
          />
          <Text style={[p.bioTxt, { color: D.bioTxtColor }]}>
            {bioLoading
              ? 'Verificando...'
              : bioEnabled
                ? 'Usar huella digital'
                : 'Activar huella digital'
            }
          </Text>
        </TouchableOpacity>
      )}

      {/* Resetear PIN */}
      {mode === 'locked' && (
        <TouchableOpacity
          onPress={() => { setMode('setup'); setInput(''); setError(''); }}
          style={p.resetBtn}
        >
          <Text style={[p.resetTxt, { color: D.resetTxtColor }]}>
            ¿Olvidaste tu PIN? Restablecer
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  /* ── Layout DESKTOP: 2 columnas ── */
  if (isDesktop) {
    return <PinSplitLayout KeypadSection={KeypadSection} D={D}/>;
  }

  /* ── Layout MÓVIL: columna única con fondo oscuro ── */
  return (
    <View style={[p.root, {
      backgroundColor: D.rootBg,
      ...({ backgroundImage: D.rootGrad } as any),
    }]}>
      <KeypadSection/>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════════
   SPLIT LAYOUT — solo desktop (Electron)
   ══════════════════════════════════════════════════════════════ */
function PinSplitLayout({ KeypadSection, D }: { KeypadSection: React.FC; D: any }) {
  const now = useClock();
  const C = useColors();

  const hora = now.toLocaleTimeString('es-SV', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const fecha = now.toLocaleDateString('es-SV', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const fechaFmt = fecha.charAt(0).toUpperCase() + fecha.slice(1);

  return (
    <View style={sp.root}>
      {/* ── Columna izquierda: Hero card ── */}
      <View style={sp.heroCol}>
        <View style={sp.badge}>
          <MaterialCommunityIcons name="briefcase-check" size={14} color="#93c5fd"/>
          <Text style={sp.badgeTxt}>CAS Express Tamanique</Text>
        </View>

        <Text style={sp.clock}>{hora}</Text>
        <Text style={sp.date}>{fechaFmt}</Text>

        <View style={sp.sep}/>

        <View style={sp.infoCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <MaterialCommunityIcons name="shield-check-outline" size={18} color="#93c5fd"/>
            <Text style={sp.infoLabel}>Sistema protegido</Text>
          </View>
          <View style={sp.progressBar}>
            <View style={[sp.progressFill, { width: '78%' }]}/>
          </View>
          <Text style={sp.infoSub}>Sesión segura · Autenticación local</Text>
        </View>

        <View style={sp.heroFoot}>
          <View style={sp.heroAvatar}>
            <MaterialCommunityIcons name="account-circle" size={22} color="#93c5fd"/>
          </View>
          <View>
            <Text style={sp.heroUser}>CAS Express</Text>
            <Text style={sp.heroRole}>Sistema de Gestión Financiera</Text>
          </View>
        </View>
      </View>

      {/* ── Columna derecha: keypad ── */}
      <View style={[sp.keypadCol, {
        backgroundColor: D.rootBg,
        ...({ backgroundImage: D.rootGrad } as any),
      }]}>
        <KeypadSection/>
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════
//   ESTILOS ESTÁTICOS (colores dinámicos se pasan inline)
// ══════════════════════════════════════════════════════════════

const p = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },

  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },

  title: {
    fontSize: 18, fontWeight: '800',
    marginTop: 4, textAlign: 'center',
  },
  subtitle: {
    fontSize: 13, marginTop: 4,
    textAlign: 'center',
  },

  dots: { flexDirection: 'row', gap: 16, marginTop: 28, marginBottom: 8 },
  dot: {
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  error: { color: '#ef4444', fontSize: 13, fontWeight: '600', height: 20, marginTop: 4 },

  pad: {
    flexDirection: 'row', flexWrap: 'wrap',
    width: 264, marginTop: 20, gap: 12,
    justifyContent: 'center',
  },
  key: {
    width: 76, height: 76, borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  keyTxt:    { fontWeight: '600' },
  padEmpty:  { width: 76, height: 76 },

  bioButton: {
    marginTop: 20, alignItems: 'center', padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 168,
  },
  bioTxt: { fontSize: 13, marginTop: 5, fontWeight: '600' },

  resetBtn: { marginTop: 14, padding: 8 },
  resetTxt: { fontSize: 13, textDecorationLine: 'underline' },

  bioModal: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(7,13,27,0.75)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 100,
  } as any,
  bioBox: {
    borderRadius: 24, padding: 28,
    marginHorizontal: 32,
    alignItems: 'center',
    borderWidth: 1,
  },
  bioTitle: { fontSize: 17, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  bioDesc:  { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  bioBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  bioRemove: {
    position: 'absolute', bottom: 8, left: 8, padding: 6, zIndex: 50,
  } as any,
});

const sp = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0f172a',
  },
  heroCol: {
    flex: 1,
    backgroundColor: '#1e3a5f',
    justifyContent: 'center',
    padding: 48,
    ...({
      backgroundImage: 'linear-gradient(145deg, #1d4ed8 0%, #1e3a5f 55%, #0f172a 100%)',
    } as any),
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    alignSelf: 'flex-start', marginBottom: 40,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  badgeTxt: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  clock: {
    color: '#ffffff',
    fontSize: 72, fontWeight: '800',
    letterSpacing: -2, lineHeight: 80,
  },
  date: {
    color: '#93c5fd', fontSize: 15, fontWeight: '500',
    marginTop: 8, marginBottom: 36,
  },
  sep: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginBottom: 28,
  },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: 'auto' as any,
  },
  infoLabel: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  progressBar: {
    height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginBottom: 8, overflow: 'hidden',
  },
  progressFill: {
    height: '100%' as any, borderRadius: 3,
    backgroundColor: '#60a5fa',
  },
  infoSub: { color: 'rgba(148,163,184,0.8)', fontSize: 11, marginTop: 2 },
  heroFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 36, paddingTop: 24,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  heroAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  heroUser: { color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  heroRole: { color: '#64748b', fontSize: 11, marginTop: 2 },
  keypadCol: {
    width: 420,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
});
