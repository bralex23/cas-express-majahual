import React, { useState, useMemo } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Image, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { router } from 'expo-router';
import { login } from '../../src/hooks/useAuth';
import { useColors, hexToRgba, actionGradientStyle } from '../../src/theme';
import { isAndroidApp } from '../../src/lib/biometric';

/* ══════════════════════════════════════════════════════════════
   DESKTOP LOGIN — solo Electron + navegador
   ══════════════════════════════════════════════════════════════ */
function DesktopLogin() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [showPass, setShowPass] = useState(false);
  const C = useColors();

  async function handleLogin() {
    if (!email || !password) { setError('Ingresa tu correo y contraseña.'); return; }
    setLoading(true); setError('');
    try {
      await login(email.trim(), password);
      router.replace('/(app)');
    } catch { setError('Correo o contraseña incorrectos.'); }
    setLoading(false);
  }

  const primary = C.primary;
  const grad = actionGradientStyle(primary);

  return (
    <View style={[ds.root, {
      backgroundColor: primary,
      backgroundImage: `linear-gradient(145deg, ${primary} 0%, #0d1f3c 100%)`,
    } as any]}>
      {/* manchas difuminadas de fondo */}
      <View style={[ds.blob, ds.blobGold,  { filter: 'blur(70px)' } as any]} />
      <View style={[ds.blob, ds.blobPrimary, { backgroundColor: hexToRgba(primary, 0.35), filter: 'blur(80px)' } as any]} />

      {/* tarjeta central */}
      <View style={ds.card as any}>
        {/* logo */}
        <View style={ds.logoWrap}>
          <Image
            source={require('../../assets/icon-liquid-glass.svg')}
            style={ds.logoImg}
            resizeMode="contain"
          />
        </View>

        <Text style={ds.empresa}>CAS Express Majahual</Text>
        <Text style={ds.slogan}>CAS Express</Text>

        <Text style={ds.titulo}>Iniciar Sesión</Text>

        {/* campo email */}
        <View style={ds.fieldWrap}>
          <View style={[ds.iconChip, { backgroundColor: primary }]}>
            <Text style={ds.iconTxt}>✉</Text>
          </View>
          <input
            type="email"
            value={email}
            onChange={(e: any) => setEmail(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && handleLogin()}
            placeholder="Correo electrónico"
            autoComplete="email"
            style={inputStyle}
          />
        </View>

        {/* campo contraseña */}
        <View style={ds.fieldWrap}>
          <View style={[ds.iconChip, { backgroundColor: primary }]}>
            <Text style={ds.iconTxt}>🔒</Text>
          </View>
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={(e: any) => setPassword(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && handleLogin()}
            placeholder="Contraseña"
            autoComplete="current-password"
            style={inputStyle}
          />
          <TouchableOpacity onPress={() => setShowPass(v => !v)} style={ds.eyeBtn}>
            <Text style={ds.eyeTxt}>{showPass ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={ds.error}>{error}</Text> : null}

        {/* botón */}
        <TouchableOpacity
          onPress={handleLogin}
          disabled={loading}
          style={[ds.btnLogin, grad as any, loading && ds.btnDisabled]}
          activeOpacity={0.82}
        >
          <Text style={ds.btnTxt}>{loading ? 'Ingresando...' : 'Ingresar'}</Text>
        </TouchableOpacity>

        <Text style={ds.footer}>© 2025 CAS Express Majahual</Text>
      </View>
    </View>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 14,
  color: '#111',
  padding: '0 8px',
  fontFamily: 'inherit',
};

const ds = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh' as any,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.55,
  },
  blobGold: {
    width: 260, height: 260,
    backgroundColor: '#c8a951',
    top: -60, right: -40,
  },
  blobPrimary: {
    width: 320, height: 320,
    bottom: -80, left: -60,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    backdropFilter: 'blur(28px)',
    WebkitBackdropFilter: 'blur(28px)',
    borderRadius: 28,
    padding: 36,
    width: 380,
    maxWidth: '92vw',
    boxShadow: '0 24px 64px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    alignItems: 'center',
  },
  logoWrap: {
    width: 88, height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  logoImg: { width: 70, height: 70 },
  empresa: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 2 },
  slogan:  { fontSize: 12, color: '#888', marginBottom: 20 },
  titulo:  { fontSize: 22, fontWeight: '800', color: '#111', marginBottom: 18, alignSelf: 'flex-start' },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f4f9',
    borderRadius: 12,
    height: 48,
    marginBottom: 12,
    width: '100%',
    paddingRight: 8,
    overflow: 'hidden',
  },
  iconChip: {
    width: 48, height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    marginRight: 4,
  },
  iconTxt: { fontSize: 18 },
  eyeBtn: { paddingHorizontal: 8 },
  eyeTxt: { fontSize: 16 },
  error: { color: '#c62828', fontSize: 12, marginBottom: 8, alignSelf: 'flex-start' },
  btnLogin: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 16,
    transition: 'transform 0.15s ease',
  },
  btnDisabled: { opacity: 0.6 },
  btnTxt: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  footer: { color: '#aaa', fontSize: 11 },
});

/* ══════════════════════════════════════════════════════════════
   ANDROID / NATIVO — sin cambios (igual que antes)
   ══════════════════════════════════════════════════════════════ */
function NativeLogin() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [showPass, setShowPass] = useState(false);

  async function handleLogin() {
    if (!email || !password) { setError('Ingresa tu correo y contraseña.'); return; }
    setLoading(true); setError('');
    try {
      await login(email.trim(), password);
      router.replace('/(app)');
    } catch { setError('Correo o contraseña incorrectos.'); }
    setLoading(false);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS==='ios'?'padding':undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <View style={s.logo}>
            <Text style={s.logoTxt}>CAS</Text>
            <Text style={s.logoSub}>MAJAHUAL</Text>
          </View>
          <Text style={s.empresa}>CAS Express Majahual</Text>
          <Text style={s.slogan}>CAS Express</Text>
        </View>

        <View style={s.card}>
          <Text variant="headlineSmall" style={s.titulo}>Iniciar Sesión</Text>
          <TextInput label="Correo electrónico" value={email} onChangeText={setEmail}
            mode="outlined" keyboardType="email-address" autoCapitalize="none" style={s.input}
            left={<TextInput.Icon icon="email"/>} />
          <TextInput label="Contraseña" value={password} onChangeText={setPassword}
            mode="outlined" secureTextEntry={!showPass} style={s.input}
            left={<TextInput.Icon icon="lock"/>}
            right={<TextInput.Icon icon={showPass?'eye-off':'eye'} onPress={()=>setShowPass(!showPass)}/>} />
          {error?<HelperText type="error" visible>{error}</HelperText>:null}
          <Button mode="contained" onPress={handleLogin} loading={loading} disabled={loading}
            style={s.btn} contentStyle={{paddingVertical:6}}>
            Ingresar
          </Button>
        </View>
        <Text style={s.footer}>© 2025 CAS Express Majahual — Todos los derechos reservados</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function Login() {
  if (Platform.OS === 'web' && !isAndroidApp()) return <DesktopLogin />;
  return <NativeLogin />;
}

const makeStyles = (C: any) => StyleSheet.create({
  container:{ flex:1, backgroundColor:'#071a0e' },
  scroll:{ flexGrow:1, justifyContent:'center', padding:24 },
  header:{ alignItems:'center', marginBottom:32 },
  logo:{ width:100, height:100, borderRadius:50, backgroundColor:'#2e7d32',
         justifyContent:'center', alignItems:'center', marginBottom:12, elevation:6 },
  logoTxt:{ color:'#fff', fontSize:24, fontWeight:'900' },
  logoSub:{ color:'#fff', fontSize:9, fontWeight:'700', letterSpacing:1.5 },
  empresa:{ color:'#ffffff', fontSize:18, fontWeight:'600' },
  slogan:{ color:'#69f0ae', fontSize:13, marginTop:2 },
  card:{
    backgroundColor:C.surface, borderRadius:18, padding:24, elevation:4,
  },
  titulo:{ textAlign:'center', marginBottom:20, color:'#1b5e20', fontWeight:'700' },
  input:{ marginBottom:12 },
  btn:{ marginTop:8, borderRadius:8 },
  footer:{ color:'#ffffff44', textAlign:'center', marginTop:24, fontSize:11 },
});
