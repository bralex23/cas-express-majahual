/**
 * PinLock — pantalla de seguridad PIN de 4 dígitos.
 * - Se activa al abrir la app
 * - Se reactiva tras 1 hora de inactividad
 * - Soporta autenticación biométrica (huella/face) vía WebAuthn
 *   (solo en móvil Capacitor, no en escritorio Electron)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const PIN_KEY      = 'cas_pin_hash';
const BIO_CRED_KEY = 'cas_bio_cred';    // base64 credential ID
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

/* ── WebAuthn helpers (solo en Capacitor/móvil) ────────────────────────── */

/** Comprueba si el dispositivo tiene autenticador biométrico de plataforma */
async function checkBioAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;
    return await (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

/** Registra una nueva credencial biométrica en el dispositivo */
async function registrarBio(): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId    = crypto.getRandomValues(new Uint8Array(16));

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp:   { name: 'CAS Express', id: 'localhost' },
        user: { id: userId, name: 'cas_user', displayName: 'CAS Express' },
        pubKeyCredParams: [
          { alg: -7,   type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    if (!cred) return false;

    const b64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    try {
      localStorage.setItem(BIO_CRED_KEY, b64);
      localStorage.setItem(BIO_ON_KEY,   '1');
    } catch {}
    return true;
  } catch (e) {
    console.warn('[Bio] register error:', e);
    return false;
  }
}

/** Autentica con la credencial biométrica registrada */
async function autenticarBio(): Promise<boolean> {
  try {
    const b64 = localStorage.getItem(BIO_CRED_KEY);
    if (!b64) return false;

    const credId    = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credId, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch (e) {
    console.warn('[Bio] auth error:', e);
    return false;
  }
}

interface Props { children: React.ReactNode; }
type Mode = 'locked' | 'setup' | 'confirm' | 'unlocked';

export function PinLock({ children }: Props) {
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
  const [showBioSetup, setShowBioSetup] = useState(false); // modal tras desbloquear con PIN

  const isPinEnabled = Platform.OS === 'web';

  // ── Chequeo inicial biometría (solo móvil) ──────────────────────────────
  useEffect(() => {
    if (!isPinEnabled || !isCapacitor()) return;
    checkBioAvailable().then(ok => {
      setBioAvailable(ok);
      if (ok) {
        const on = !!localStorage.getItem(BIO_ON_KEY);
        setBioEnabled(on);
      }
    });
  }, [isPinEnabled]);

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

  // ── Shake animation ─────────────────────────────────────────────────────
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

  // ── Desbloquear con PIN ─────────────────────────────────────────────────
  function unlock(fromBio = false) {
    setMode('unlocked');
    setInput('');
    setError('');
    resetTimer();
    // Ofrecer configurar huella si acaba de desbloquear con PIN y no tiene huella
    if (!fromBio && bioAvailable && !bioEnabled && isCapacitor()) {
      setShowBioSetup(true);
    }
  }

  // ── Autenticar con huella ───────────────────────────────────────────────
  async function usarHuella() {
    setBioLoading(true);
    setError('');
    try {
      const ok = await autenticarBio();
      if (ok) {
        unlock(true);
      } else {
        setError('Huella no reconocida');
      }
    } catch {
      setError('Error al leer huella');
    } finally {
      setBioLoading(false);
    }
  }

  // ── Registrar huella (desde modal post-desbloqueo) ──────────────────────
  async function configurarHuella() {
    setBioLoading(true);
    try {
      const ok = await registrarBio();
      if (ok) {
        setBioEnabled(true);
        setShowBioSetup(false);
      } else {
        setError('No se pudo registrar la huella');
      }
    } catch {
      setError('Error al registrar huella');
    } finally {
      setBioLoading(false);
    }
  }

  // ── Quitar huella ───────────────────────────────────────────────────────
  function quitarHuella() {
    try {
      localStorage.removeItem(BIO_CRED_KEY);
      localStorage.removeItem(BIO_ON_KEY);
      setBioEnabled(false);
    } catch {}
  }

  // ── Teclado numérico ────────────────────────────────────────────────────
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

  // ── App desbloqueada ────────────────────────────────────────────────────
  if (mode === 'unlocked') {
    return (
      <View style={{ flex: 1 }}>
        {children}

        {/* Modal "¿Activar huella?" (solo si se desbloqueó con PIN y es móvil) */}
        {showBioSetup && (
          <View style={p.bioModal}>
            <View style={p.bioBox}>
              <MaterialCommunityIcons name="fingerprint" size={48} color="#c8a951" style={{ marginBottom: 12 }}/>
              <Text style={p.bioTitle}>¿Activar huella digital?</Text>
              <Text style={p.bioDesc}>
                Podrás desbloquear CAS Express con tu huella dactilar en vez del PIN.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity onPress={() => setShowBioSetup(false)}
                  style={[p.bioBtn, { borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1 }]}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontWeight: '600' }}>Ahora no</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={configurarHuella}
                  disabled={bioLoading}
                  style={[p.bioBtn, { backgroundColor: '#c8a951' }]}>
                  <Text style={{ color: '#060f2f', fontWeight: '800' }}>
                    {bioLoading ? 'Registrando...' : 'Activar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Botón "Quitar huella" accesible desde app (esquina inferior) solo móvil */}
        {bioEnabled && isCapacitor() && !showBioSetup && (
          <TouchableOpacity onPress={quitarHuella} style={p.bioRemove}>
            <MaterialCommunityIcons name="fingerprint-off" size={18} color="rgba(200,169,81,0.5)"/>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Pantalla de PIN ─────────────────────────────────────────────────────
  const title = mode === 'setup' ? 'Configura tu PIN de seguridad'
    : mode === 'confirm' ? 'Confirma tu PIN'
    : 'Ingresa tu PIN';
  const subtitle = mode === 'setup' ? 'Elige 4 dígitos para proteger la app'
    : mode === 'confirm' ? 'Escribe el mismo PIN otra vez'
    : 'La app está bloqueada';

  return (
    <View style={p.root}>
      {/* Logo */}
      <View style={p.logoArea}>
        <View style={p.logoCircle}>
          <MaterialCommunityIcons name="shield-lock" size={40} color="#c8a951"/>
        </View>
        <Text style={p.appName}>CAS Express</Text>
        <Text style={p.title}>{title}</Text>
        <Text style={p.subtitle}>{subtitle}</Text>
      </View>

      {/* Puntos indicadores */}
      <Animated.View style={[p.dots, { transform: [{ translateX: shakeAnim }] }]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={[p.dot, i < input.length && p.dotFilled]}/>
        ))}
      </Animated.View>

      {/* Error */}
      {error ? <Text style={p.error}>{error}</Text> : <View style={{ height: 20 }}/>}

      {/* Teclado numérico */}
      <View style={p.pad}>
        {DIGITS.map((d, i) => {
          if (d === '') return <View key={i} style={p.padEmpty}/>;
          return (
            <TouchableOpacity key={i} style={[p.key, d === '⌫' && p.keyDel]}
              onPress={() => handleDigit(d)} activeOpacity={0.7}>
              <Text style={[p.keyTxt, d === '⌫' && p.keyDelTxt]}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Botón huella (solo en locked + móvil + huella activada) */}
      {mode === 'locked' && bioEnabled && isCapacitor() && (
        <TouchableOpacity onPress={usarHuella} disabled={bioLoading}
          style={p.bioButton}>
          <MaterialCommunityIcons
            name="fingerprint"
            size={38}
            color={bioLoading ? 'rgba(200,169,81,0.4)' : '#c8a951'}
          />
          <Text style={p.bioTxt}>
            {bioLoading ? 'Verificando...' : 'Usar huella digital'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Resetear PIN */}
      {mode === 'locked' && (
        <TouchableOpacity
          onPress={() => { setMode('setup'); setInput(''); setError(''); }}
          style={p.resetBtn}>
          <Text style={p.resetTxt}>¿Olvidaste tu PIN? Restablecer</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const p = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#060f2f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
    ...({
      backgroundImage: 'linear-gradient(160deg, #0a2463 0%, #060f2f 60%, #0a1a3a 100%)',
    } as any),
  },
  logoArea: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(200,169,81,0.15)',
    borderWidth: 1.5, borderColor: 'rgba(200,169,81,0.4)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
    ...({ boxShadow: '0 0 30px rgba(200,169,81,0.25)' } as any),
  },
  appName: { color: '#c8a951', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  title:   { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 6 },
  subtitle:{ color: 'rgba(200,220,255,0.6)', fontSize: 13, marginTop: 4 },

  dots: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  dot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: 'rgba(200,169,81,0.5)',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#c8a951', borderColor: '#c8a951',
    ...({ boxShadow: '0 0 8px #c8a951' } as any),
  },
  error: { color: '#ef5350', fontSize: 13, fontWeight: '600', height: 20 },

  pad: {
    flexDirection: 'row', flexWrap: 'wrap',
    width: 260, marginTop: 24, gap: 14,
    justifyContent: 'center',
  },
  key: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
    ...({ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' } as any),
  },
  keyDel: { backgroundColor: 'rgba(198,40,40,0.25)', borderColor: 'rgba(198,40,40,0.35)' },
  keyTxt: { color: '#fff', fontSize: 24, fontWeight: '600' },
  keyDelTxt: { color: '#ef9a9a', fontSize: 20 },
  padEmpty: { width: 72, height: 72 },

  // Botón huella (en pantalla locked)
  bioButton: {
    marginTop: 24, alignItems: 'center', padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(200,169,81,0.08)',
    borderWidth: 1, borderColor: 'rgba(200,169,81,0.25)',
    minWidth: 160,
  },
  bioTxt: {
    color: 'rgba(200,169,81,0.85)', fontSize: 13, marginTop: 4, fontWeight: '600',
  },

  resetBtn: { marginTop: 16, padding: 8 },
  resetTxt: { color: 'rgba(200,169,81,0.7)', fontSize: 13, textDecorationLine: 'underline' },

  // Modal de configuración biométrica
  bioModal: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(6,15,47,0.92)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 100,
  } as any,
  bioBox: {
    backgroundColor: '#0a1a3a',
    borderRadius: 20, padding: 28,
    marginHorizontal: 32,
    alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(200,169,81,0.3)',
    ...({ boxShadow: '0 8px 40px rgba(0,0,0,0.5)' } as any),
  },
  bioTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  bioDesc:  { color: 'rgba(200,220,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  bioBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  // Botón quitar huella (esquina inferior izquierda, invisible hasta que el user busca)
  bioRemove: {
    position: 'absolute', bottom: 8, left: 8, padding: 6, zIndex: 50,
  } as any,
});
