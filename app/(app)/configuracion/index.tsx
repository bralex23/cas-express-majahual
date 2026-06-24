/**
 * Configuración — solo APK móvil (Capacitor).
 * Permite cambiar PIN y gestionar huella dactilar.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, TouchableOpacity, Alert,
  StyleSheet, Switch, Animated,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '../../../src/theme';

/* ── Constantes (deben coincidir exactamente con PinLock.tsx) ──────────── */
const PIN_KEY      = 'cas_pin_hash';
const BIO_CRED_KEY = 'cas_bio_cred';
const BIO_ON_KEY   = 'cas_bio_on';
const PIN_LENGTH   = 4;

/* ── Helpers ────────────────────────────────────────────────────────────── */
function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor;
}

function hashPin(pin: string): string {
  let h = 5381;
  for (let i = 0; i < pin.length; i++) h = (Math.imul(31, h) + pin.charCodeAt(i)) | 0;
  return h.toString(16);
}
function getSavedHash(): string | null {
  try { return localStorage.getItem(PIN_KEY); } catch { return null; }
}
function saveHash(hash: string) {
  try { localStorage.setItem(PIN_KEY, hash); } catch {}
}

async function checkBioAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;
    return await (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64urlDecode(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p), c => c.charCodeAt(0));
}

async function registrarBio(): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'CAS Express', id: 'localhost' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'cas_user', displayName: 'CAS Usuario' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    } as any) as any;
    if (!cred) return false;
    const credId = b64url(cred.rawId);
    localStorage.setItem(BIO_CRED_KEY, credId);
    localStorage.setItem(BIO_ON_KEY, '1');
    return true;
  } catch { return false; }
}

async function quitarBio() {
  try {
    localStorage.removeItem(BIO_CRED_KEY);
    localStorage.removeItem(BIO_ON_KEY);
  } catch {}
}

/* ── Tipos ─────────────────────────────────────────────────────────────── */
type PinStep = 'idle' | 'enter_current' | 'enter_new' | 'confirm_new';

/* ── Componente principal ───────────────────────────────────────────────── */
export default function ConfiguracionScreen() {
  const C = useColors();

  /* Biometría */
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioLoading,   setBioLoading]   = useState(false);

  /* PIN change flow */
  const [pinStep,     setPinStep]    = useState<PinStep>('idle');
  const [input,       setInput]      = useState('');
  const [newPinTemp,  setNewPinTemp] = useState('');
  const [pinError,    setPinError]   = useState('');
  const shakeAnim = useState(new Animated.Value(0))[0];

  /* Cargar estado inicial */
  useEffect(() => {
    if (!isCapacitor()) return;
    checkBioAvailable().then(setBioAvailable);
    setBioEnabled(!!localStorage.getItem(BIO_ON_KEY));
  }, []);

  /* Shake al error */
  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  /* ── Flujo cambio de PIN ──────────────────────────────────────────────── */
  const handleDigit = (d: string) => {
    if (input.length >= PIN_LENGTH) return;
    setPinError('');
    const next = input + d;
    setInput(next);
    if (next.length < PIN_LENGTH) return;

    // Procesar cuando PIN completo
    setTimeout(() => processPin(next), 80);
  };

  const handleDelete = () => {
    setPinError('');
    setInput(p => p.slice(0, -1));
  };

  const processPin = (pin: string) => {
    if (pinStep === 'enter_current') {
      const saved = getSavedHash();
      if (!saved || hashPin(pin) === saved) {
        setInput('');
        setPinStep('enter_new');
      } else {
        setPinError('PIN incorrecto');
        shake();
        setInput('');
      }
    } else if (pinStep === 'enter_new') {
      setNewPinTemp(pin);
      setInput('');
      setPinStep('confirm_new');
    } else if (pinStep === 'confirm_new') {
      if (pin !== newPinTemp) {
        setPinError('Los PIN no coinciden');
        shake();
        setInput('');
        setPinStep('enter_new');
        setNewPinTemp('');
      } else {
        saveHash(hashPin(pin));
        setInput('');
        setNewPinTemp('');
        setPinStep('idle');
        Alert.alert('✅ PIN actualizado', 'Tu PIN de seguridad fue cambiado correctamente.');
      }
    }
  };

  const cancelPin = () => {
    setPinStep('idle');
    setInput('');
    setNewPinTemp('');
    setPinError('');
  };

  /* ── Toggle huella ───────────────────────────────────────────────────── */
  const toggleBio = async (val: boolean) => {
    if (val) {
      setBioLoading(true);
      const ok = await registrarBio();
      setBioLoading(false);
      if (ok) {
        setBioEnabled(true);
        Alert.alert('✅ Huella activada', 'Ahora puedes desbloquear CAS con tu huella dactilar.');
      } else {
        Alert.alert('Error', 'No se pudo registrar la huella. Intenta de nuevo.');
      }
    } else {
      Alert.alert(
        'Quitar huella',
        '¿Desactivar desbloqueo con huella dactilar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Desactivar', style: 'destructive', onPress: async () => {
            await quitarBio();
            setBioEnabled(false);
          }},
        ]
      );
    }
  };

  /* ── Títulos del paso de PIN ─────────────────────────────────────────── */
  const pinTitle = pinStep === 'enter_current' ? 'Ingresa tu PIN actual'
    : pinStep === 'enter_new' ? 'Ingresa el nuevo PIN'
    : 'Confirma el nuevo PIN';
  const pinSub = pinStep === 'enter_current' ? 'Verifica tu identidad antes de cambiar'
    : pinStep === 'enter_new' ? 'Elige un PIN de 4 dígitos'
    : 'Escríbelo de nuevo para confirmar';

  /* ── Si no es Capacitor: aviso ───────────────────────────────────────── */
  if (!isCapacitor()) {
    return (
      <View style={[s.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <MaterialCommunityIcons name="cellphone-lock" size={60} color={C.muted} />
        <Text style={[s.noMobileTitle, { color: C.text }]}>Solo disponible en la app móvil</Text>
        <Text style={[s.noMobileSub, { color: C.muted }]}>
          Estas configuraciones son exclusivas del APK Android.
        </Text>
      </View>
    );
  }

  /* ── Pantalla de entrada de PIN ─────────────────────────────────────── */
  if (pinStep !== 'idle') {
    return (
      <View style={[s.root, { backgroundColor: C.bg }]}>
        {/* Header */}
        <View style={[s.pinHeader, { backgroundColor: C.primary }]}>
          <TouchableOpacity onPress={cancelPin} style={s.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={s.pinHeaderTitle}>Cambiar PIN</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={s.pinBody}>
          <MaterialCommunityIcons name="shield-lock-outline" size={52} color={C.primary} style={{ marginBottom: 12 }} />
          <Text style={[s.pinTitle, { color: C.text }]}>{pinTitle}</Text>
          <Text style={[s.pinSub, { color: C.muted }]}>{pinSub}</Text>

          {/* Puntos */}
          <Animated.View style={[s.dots, { transform: [{ translateX: shakeAnim }] }]}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <View
                key={i}
                style={[
                  s.dot,
                  { borderColor: pinError ? '#ef5350' : C.primary },
                  i < input.length && { backgroundColor: pinError ? '#ef5350' : C.primary },
                ]}
              />
            ))}
          </Animated.View>
          {!!pinError && <Text style={s.errorTxt}>{pinError}</Text>}

          {/* Teclado numérico */}
          <View style={s.keypad}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
              <TouchableOpacity
                key={i}
                style={[s.key, !k && s.keyEmpty, { backgroundColor: k ? C.surface : 'transparent', borderColor: C.border }]}
                onPress={() => {
                  if (!k) return;
                  if (k === '⌫') handleDelete();
                  else handleDigit(k);
                }}
                disabled={!k}
                activeOpacity={0.6}
              >
                {k === '⌫'
                  ? <MaterialCommunityIcons name="backspace-outline" size={22} color={C.text} />
                  : <Text style={[s.keyTxt, { color: C.text }]}>{k}</Text>
                }
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={cancelPin} style={{ marginTop: 20 }}>
            <Text style={{ color: C.muted, fontSize: 14 }}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* ── Pantalla principal de configuración ────────────────────────────── */
  return (
    <View style={[s.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: C.primary }]}>
        <MaterialCommunityIcons name="cog-outline" size={24} color="#fff" />
        <Text style={s.headerTitle}>Configuración</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>

        {/* ── Sección: Seguridad ── */}
        <Text style={[s.sectionLabel, { color: C.muted }]}>SEGURIDAD</Text>
        <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>

          {/* Cambiar PIN */}
          <TouchableOpacity
            style={[s.row, { borderBottomColor: C.border }]}
            onPress={() => {
              setPinStep(getSavedHash() ? 'enter_current' : 'enter_new');
              setInput('');
              setPinError('');
            }}
            activeOpacity={0.7}
          >
            <View style={[s.rowIcon, { backgroundColor: C.primary + '20' }]}>
              <MaterialCommunityIcons name="lock-reset" size={22} color={C.primary} />
            </View>
            <View style={s.rowBody}>
              <Text style={[s.rowTitle, { color: C.text }]}>
                {getSavedHash() ? 'Cambiar PIN' : 'Configurar PIN'}
              </Text>
              <Text style={[s.rowSub, { color: C.muted }]}>
                {getSavedHash() ? 'Actualiza tu código de seguridad de 4 dígitos' : 'Crea un PIN de 4 dígitos para proteger la app'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={C.muted} />
          </TouchableOpacity>

          {/* Huella dactilar */}
          {bioAvailable && (
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: '#4caf5020' }]}>
                <MaterialCommunityIcons name="fingerprint" size={22} color="#4caf50" />
              </View>
              <View style={s.rowBody}>
                <Text style={[s.rowTitle, { color: C.text }]}>Huella dactilar</Text>
                <Text style={[s.rowSub, { color: C.muted }]}>
                  {bioEnabled
                    ? 'Activa — desbloquea con tu huella'
                    : 'Desactiva — solo PIN al abrir la app'}
                </Text>
              </View>
              <Switch
                value={bioEnabled}
                onValueChange={toggleBio}
                disabled={bioLoading}
                trackColor={{ false: C.border, true: '#4caf5066' }}
                thumbColor={bioEnabled ? '#4caf50' : C.muted}
              />
            </View>
          )}

          {!bioAvailable && (
            <View style={[s.row, { opacity: 0.5 }]}>
              <View style={[s.rowIcon, { backgroundColor: C.muted + '20' }]}>
                <MaterialCommunityIcons name="fingerprint-off" size={22} color={C.muted} />
              </View>
              <View style={s.rowBody}>
                <Text style={[s.rowTitle, { color: C.muted }]}>Huella dactilar</Text>
                <Text style={[s.rowSub, { color: C.muted }]}>No disponible en este dispositivo</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Sección: Información ── */}
        <Text style={[s.sectionLabel, { color: C.muted }]}>INFORMACIÓN</Text>
        <View style={[s.card, { backgroundColor: C.surface, borderColor: C.border }]}>
          <View style={[s.row, { borderBottomColor: C.border }]}>
            <View style={[s.rowIcon, { backgroundColor: '#1565c020' }]}>
              <MaterialCommunityIcons name="cellphone" size={22} color="#1565c0" />
            </View>
            <View style={s.rowBody}>
              <Text style={[s.rowTitle, { color: C.text }]}>Plataforma</Text>
              <Text style={[s.rowSub, { color: C.muted }]}>Android (APK)</Text>
            </View>
          </View>
          <View style={s.row}>
            <View style={[s.rowIcon, { backgroundColor: '#c8a95120' }]}>
              <MaterialCommunityIcons name="shield-check-outline" size={22} color="#c8a951" />
            </View>
            <View style={s.rowBody}>
              <Text style={[s.rowTitle, { color: C.text }]}>Estado de seguridad</Text>
              <Text style={[s.rowSub, { color: C.muted }]}>
                {getSavedHash()
                  ? `PIN activo${bioEnabled ? ' · Huella activa' : ''}`
                  : 'Sin PIN configurado'}
              </Text>
            </View>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

/* ── Estilos ─────────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  root:         { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 14, paddingTop: 18 },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: '#fff', flex: 1 },
  scroll:       { padding: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 20, marginBottom: 6, marginLeft: 4 },
  card:         { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  row:          { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderBottomWidth: 1 },
  rowIcon:      { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  rowBody:      { flex: 1 },
  rowTitle:     { fontSize: 15, fontWeight: '600' },
  rowSub:       { fontSize: 12, marginTop: 2 },

  /* PIN screen */
  pinHeader:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, paddingTop: 18 },
  backBtn:      { padding: 8 },
  pinHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#fff' },
  pinBody:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  pinTitle:     { fontSize: 20, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  pinSub:       { fontSize: 13, textAlign: 'center', marginBottom: 32 },
  dots:         { flexDirection: 'row', gap: 16, marginBottom: 12 },
  dot:          { width: 18, height: 18, borderRadius: 9, borderWidth: 2.5 },
  errorTxt:     { color: '#ef5350', fontSize: 13, marginBottom: 16, marginTop: 4 },
  keypad:       { flexDirection: 'row', flexWrap: 'wrap', width: 240, gap: 12, marginTop: 16 },
  key:          { width: 68, height: 64, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  keyEmpty:     { borderWidth: 0, backgroundColor: 'transparent' },
  keyTxt:       { fontSize: 24, fontWeight: '500' },

  /* No mobile */
  noMobileTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  noMobileSub:   { fontSize: 13, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
});
