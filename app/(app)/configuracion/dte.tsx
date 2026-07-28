/**
 * Configuración de Facturación Electrónica DTE
 * Hacienda El Salvador — Factura de Consumidor Final (FCF tipo 01)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { Text, TextInput, Button, Card, Divider, Switch, Chip, ActivityIndicator } from 'react-native-paper';

const elAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null;

const DEPTO_OPTIONS = [
  { code:'01', label:'Ahuachapán' }, { code:'02', label:'Santa Ana' },
  { code:'03', label:'Sonsonate' }, { code:'04', label:'Chalatenango' },
  { code:'05', label:'Cuscatlán' }, { code:'06', label:'La Libertad' },
  { code:'07', label:'San Salvador' }, { code:'08', label:'La Paz' },
  { code:'09', label:'Cabañas' }, { code:'10', label:'San Vicente' },
  { code:'11', label:'Usulután' }, { code:'12', label:'San Miguel' },
  { code:'13', label:'Morazán' }, { code:'14', label:'La Unión' },
];

const DEFAULT_CONFIG = {
  nit:                '',
  nrc:                '',
  nombre:             'SOLUCIONES FINANCIERAS CAS EXPRESS',
  nombreComercial:    'CAS EXPRESS',
  codActividad:       '6492',
  descActividad:      'Otras actividades de concesión de crédito',
  tipoEstablecimiento:'02',
  departamento:       '06',
  municipio:          '22',
  complemento:        'Distrito de Tamanique, La Libertad Costa, El Salvador',
  telefono:           '',
  correoEmisor:       '',
  passwordCert:       '',
  ambiente:           '01' as '00'|'01',
  correlativo:        1,
  establecimiento:    'M001P001',
  gmailUser:          '',
  gmailPass:          '',
};

export default function ConfigDTEScreen() {
  const [config, setConfig]     = useState({ ...DEFAULT_CONFIG });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showGmailPass, setShowGmailPass] = useState(false);

  useEffect(() => {
    (async () => {
      if (!elAPI) { setLoading(false); return; }
      const cfg = await elAPI.leerConfigDTE();
      if (cfg) setConfig({ ...DEFAULT_CONFIG, ...cfg });
      setLoading(false);
    })();
  }, []);

  const set = useCallback((key: string, val: string | number) => {
    setConfig(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }, []);

  const guardar = async () => {
    if (!config.nit.trim()) return Alert.alert('Error','El NIT del emisor es obligatorio.');
    if (!config.nrc.trim()) return Alert.alert('Error','El NRC es obligatorio.');
    if (!config.correoEmisor.trim()) return Alert.alert('Error','El correo del emisor es obligatorio.');
    setSaving(true);
    const res = await elAPI?.guardarConfigDTE(config);
    setSaving(false);
    if (res?.ok) { setSaved(true); Alert.alert('✅ Guardado','Configuración DTE guardada correctamente.'); }
    else Alert.alert('Error', res?.error || 'No se pudo guardar.');
  };

  const probarEmail = async () => {
    if (!config.gmailUser || !config.gmailPass)
      return Alert.alert('Error','Configure Gmail primero.');
    setSaving(true);
    const res = await elAPI?.enviarEmailCobro({
      cliente: { nombre: 'PRUEBA CAS EXPRESS', dui:'00000000-0', correo: config.gmailUser },
      numeroCuota: 0,
      monto: 0.01,
      mora: 0,
      prestamo: { id:'test', frecuencia:'diario', plazo:22 },
    });
    setSaving(false);
    if (res?.ok) Alert.alert('✅ Email enviado','Correo de prueba enviado a '+config.gmailUser);
    else Alert.alert('Error al enviar',res?.error||'Verifique usuario y contraseña de aplicación Gmail.');
  };

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color="#0a2463" />
      <Text style={{marginTop:12,color:'#888'}}>Cargando configuración...</Text>
    </View>
  );

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Facturación Electrónica DTE</Text>
        <Text style={s.subtitle}>Ministerio de Hacienda · El Salvador</Text>
      </View>

      {/* Ambiente */}
      <Card style={s.card}>
        <Card.Content>
          <Text style={s.sectionTitle}>Ambiente</Text>
          <View style={s.row}>
            <Chip
              selected={config.ambiente === '01'}
              onPress={() => set('ambiente','01')}
              style={[s.chip, config.ambiente==='01' && s.chipActive]}
              textStyle={config.ambiente==='01' ? s.chipTextActive : s.chipText}
            >Producción</Chip>
            <Chip
              selected={config.ambiente === '00'}
              onPress={() => set('ambiente','00')}
              style={[s.chip, config.ambiente==='00' && s.chipWarn]}
              textStyle={config.ambiente==='00' ? {color:'#fff'} : s.chipText}
            >Pruebas (apitest)</Chip>
          </View>
          {config.ambiente === '00' && (
            <Text style={s.warn}>⚠️ Modo pruebas — los DTEs NO tienen validez fiscal</Text>
          )}
        </Card.Content>
      </Card>

      {/* Datos del Emisor */}
      <Card style={s.card}>
        <Card.Content>
          <Text style={s.sectionTitle}>Datos del Emisor</Text>

          <TextInput label="NIT del emisor *" value={config.nit}
            onChangeText={v=>set('nit',v)} style={s.input} mode="outlined"
            placeholder="0614-XXXXXX-XXX-X" keyboardType="default" />

          <TextInput label="NRC (Registro IVA) *" value={config.nrc}
            onChangeText={v=>set('nrc',v)} style={s.input} mode="outlined"
            placeholder="XXXXXX-X" />

          <TextInput label="Nombre legal de la empresa" value={config.nombre}
            onChangeText={v=>set('nombre',v)} style={s.input} mode="outlined" />

          <TextInput label="Nombre comercial" value={config.nombreComercial}
            onChangeText={v=>set('nombreComercial',v)} style={s.input} mode="outlined" />

          <TextInput label="Código de actividad económica" value={config.codActividad}
            onChangeText={v=>set('codActividad',v)} style={s.input} mode="outlined"
            placeholder="6492" />

          <TextInput label="Descripción actividad" value={config.descActividad}
            onChangeText={v=>set('descActividad',v)} style={s.input} mode="outlined" />

          <TextInput label="Teléfono" value={config.telefono}
            onChangeText={v=>set('telefono',v)} style={s.input} mode="outlined"
            keyboardType="phone-pad" />

          <TextInput label="Correo del emisor *" value={config.correoEmisor}
            onChangeText={v=>set('correoEmisor',v)} style={s.input} mode="outlined"
            keyboardType="email-address" autoCapitalize="none" />
        </Card.Content>
      </Card>

      {/* Dirección */}
      <Card style={s.card}>
        <Card.Content>
          <Text style={s.sectionTitle}>Dirección</Text>

          <Text style={s.label}>Departamento (código MH)</Text>
          <View style={s.chipRow}>
            {DEPTO_OPTIONS.map(d => (
              <Chip key={d.code}
                selected={config.departamento===d.code}
                onPress={()=>set('departamento',d.code)}
                style={[s.chipSm, config.departamento===d.code && s.chipActive]}
                textStyle={config.departamento===d.code ? s.chipTextActive : {fontSize:11}}
              >{d.label}</Chip>
            ))}
          </View>

          <TextInput label="Código municipio (MH)" value={config.municipio}
            onChangeText={v=>set('municipio',v)} style={s.input} mode="outlined"
            placeholder="22 = Tamanique" keyboardType="numeric" />

          <TextInput label="Dirección complemento" value={config.complemento}
            onChangeText={v=>set('complemento',v)} style={s.input} mode="outlined"
            multiline numberOfLines={2} />
        </Card.Content>
      </Card>

      {/* Certificado Hacienda */}
      <Card style={s.card}>
        <Card.Content>
          <Text style={s.sectionTitle}>Certificado Digital Hacienda</Text>
          <Text style={s.hint}>
            Contraseña del certificado .p12 registrado en el portal DTE de Hacienda.
          </Text>

          <TextInput
            label="Contraseña del certificado *"
            value={config.passwordCert}
            onChangeText={v=>set('passwordCert',v)}
            style={s.input} mode="outlined"
            secureTextEntry={!showPass}
            right={<TextInput.Icon icon={showPass?'eye-off':'eye'} onPress={()=>setShowPass(p=>!p)} />}
          />

          <TextInput label="Establecimiento + Punto venta" value={config.establecimiento}
            onChangeText={v=>set('establecimiento',v.toUpperCase())} style={s.input} mode="outlined"
            placeholder="M001P001" autoCapitalize="characters" />

          <Text style={s.hint}>
            Formato del número de control: DTE-01-M001P001-000000000000001{'\n'}
            Correlativo actual: <Text style={{fontWeight:'bold',color:'#0a2463'}}>{config.correlativo}</Text>
          </Text>
        </Card.Content>
      </Card>

      {/* Gmail */}
      <Card style={s.card}>
        <Card.Content>
          <Text style={s.sectionTitle}>Correo Gmail para envío</Text>
          <Text style={s.hint}>
            Active la verificación en 2 pasos en su cuenta Gmail, luego vaya a{' '}
            <Text style={{color:'#0a2463'}}>myaccount.google.com → Seguridad → Contraseñas de aplicaciones</Text>{' '}
            y genere una contraseña de 16 caracteres.
          </Text>

          <TextInput label="Correo Gmail" value={config.gmailUser}
            onChangeText={v=>set('gmailUser',v)} style={s.input} mode="outlined"
            keyboardType="email-address" autoCapitalize="none" />

          <TextInput
            label="Contraseña de aplicación Gmail"
            value={config.gmailPass}
            onChangeText={v=>set('gmailPass',v.replace(/\s/g,''))}
            style={s.input} mode="outlined"
            secureTextEntry={!showGmailPass}
            placeholder="xxxxxxxxxxxx (sin espacios)"
            right={<TextInput.Icon icon={showGmailPass?'eye-off':'eye'} onPress={()=>setShowGmailPass(p=>!p)} />}
          />

          <Button mode="outlined" onPress={probarEmail} loading={saving}
            style={s.btnTest} textColor="#0a2463">
            Enviar correo de prueba
          </Button>
        </Card.Content>
      </Card>

      {/* Botón guardar */}
      <Button
        mode="contained"
        onPress={guardar}
        loading={saving}
        style={s.btnSave}
        buttonColor="#0a2463"
        icon={saved ? 'check-circle' : 'content-save'}
      >
        {saved ? 'Configuración guardada' : 'Guardar configuración'}
      </Button>

      <Text style={s.foot}>
        Los servicios financieros (préstamos) están exentos de IVA en El Salvador según Art. 46 LIVA.{'\n'}
        Toda la información sensible se guarda localmente en este equipo, nunca en la nube.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:    { flex:1, backgroundColor:'#f0f4ff' },
  content: { padding:16, paddingBottom:40 },
  center:  { flex:1, alignItems:'center', justifyContent:'center' },
  header:  { alignItems:'center', marginBottom:16, paddingVertical:12 },
  title:   { fontSize:20, fontWeight:'900', color:'#0a2463' },
  subtitle:{ fontSize:12, color:'#888', marginTop:2 },
  card:    { marginBottom:12, borderRadius:10 },
  sectionTitle: { fontSize:14, fontWeight:'700', color:'#0a2463', marginBottom:10 },
  input:   { marginBottom:8, backgroundColor:'#fff' },
  label:   { fontSize:12, color:'#555', marginBottom:6, marginTop:4 },
  hint:    { fontSize:11, color:'#888', marginBottom:10, lineHeight:17 },
  warn:    { fontSize:12, color:'#e65100', backgroundColor:'#fff3e0', padding:8,
             borderRadius:6, marginTop:6 },
  row:     { flexDirection:'row', gap:8, flexWrap:'wrap', marginBottom:4 },
  chipRow: { flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:10 },
  chip:    { borderRadius:20, borderWidth:1, borderColor:'#ccc' },
  chipSm:  { borderRadius:20, borderWidth:1, borderColor:'#ccc', height:28 },
  chipActive:{ backgroundColor:'#0a2463', borderColor:'#0a2463' },
  chipWarn:{ backgroundColor:'#e65100', borderColor:'#e65100' },
  chipText:{ color:'#333', fontSize:12 },
  chipTextActive:{ color:'#fff', fontSize:12 },
  btnTest: { marginTop:6, borderColor:'#0a2463' },
  btnSave: { marginTop:8, borderRadius:10, paddingVertical:4 },
  foot:    { fontSize:10, color:'#aaa', textAlign:'center', marginTop:16, lineHeight:16 },
});
