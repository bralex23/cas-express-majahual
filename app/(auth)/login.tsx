import React, { useState, useMemo } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { router } from 'expo-router';
import { login } from '../../src/hooks/useAuth';
import { useColors } from '../../src/theme';

export default function Login() {
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
      // Standalone Majahual: no hay selección de empresa, va directo al app
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
          {Platform.OS === 'web'
            ? <Image
                source={require('../../assets/icon-liquid-glass.svg')}
                style={s.logoImg}
                resizeMode="contain"
              />
            : <View style={s.logo}>
                <Text style={s.logoTxt}>CAS</Text>
                <Text style={s.logoSub}>MAJAHUAL</Text>
              </View>
          }
          <Text style={s.empresa}>CAS Express Majahual</Text>
          <Text style={s.slogan}>Majahual · Tamanique</Text>
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

const makeStyles = (C: any) => StyleSheet.create({
  container:{
    flex:1, backgroundColor:'#071a0e',
    ...( Platform.OS === 'web' ? {
      backgroundImage:'linear-gradient(145deg,#051208 0%,#0a2e14 45%,#051208 100%)',
    } as any : {}),
  },
  scroll:{flexGrow:1, justifyContent:'center', padding:24},
  header:{alignItems:'center', marginBottom:32},
  logoImg:{width:120, height:120, marginBottom:16},
  logo:{width:100, height:100, borderRadius:50, backgroundColor:'#2e7d32',
        justifyContent:'center', alignItems:'center', marginBottom:12, elevation:6},
  logoTxt:{color:'#fff', fontSize:24, fontWeight:'900'},
  logoSub:{color:'#fff', fontSize:9, fontWeight:'700', letterSpacing:1.5},
  empresa:{color:'#ffffff', fontSize:18, fontWeight:'600'},
  slogan:{color:'#69f0ae', fontSize:13, marginTop:2},
  card:{
    backgroundColor:C.surface, borderRadius:18, padding:24, elevation:4,
    ...( Platform.OS === 'web' ? {
      backgroundColor:'rgba(255,255,255,0.90)',
      backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
      boxShadow:'0 8px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.95)',
      borderWidth:1, borderColor:'rgba(255,255,255,0.65)',
    } as any : {}),
  },
  titulo:{textAlign:'center', marginBottom:20, color:'#1b5e20', fontWeight:'700'},
  input:{marginBottom:12},
  btn:{marginTop:8, borderRadius:8},
  footer:{color:'#ffffff44', textAlign:'center', marginTop:24, fontSize:11},
});
