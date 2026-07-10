import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, ScrollView, FlatList, StyleSheet, TouchableOpacity, Alert, TextInput as RNTextInput } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, addDoc, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Cliente, Frecuencia, Prestamo } from '../../../src/types';
import { calcularFechaFin, formatMoneda, hoy, FRECUENCIAS, calcularCuotaAmort, calcularTotalAmort, tablaAmortizacion, TASA_ANUAL_BCR as BCR_RATE } from '../../../src/utils/calculos';
import { cache } from '../../../src/utils/cache';

const TASA_ANUAL_BCR = BCR_RATE;

/* ── Plazos fijos según modalidad ── */
const PLAZOS_DIARIO = [
  { dias: 22, cuotas: 22, label: '22 días' },
  { dias: 29, cuotas: 29, label: '29 días' },
  { dias: 40, cuotas: 40, label: '40 días' },
];
const PLAZOS_SEMANAL = [
  { dias: 28, cuotas: 4, label: '4 semanas' },
  { dias: 42, cuotas: 6, label: '6 semanas' },
  { dias: 56, cuotas: 8, label: '8 semanas' },
];

export default function NuevoPrestamo() {
  const { perfil } = useAuth();
  const { col } = useEmpresa();
  const params = useLocalSearchParams<{ cliente_id?: string }>();

  const [clientes, setClientes]         = useState<Cliente[]>([]);
  const [clienteId, setClienteId]       = useState(params.cliente_id || '');
  const [clienteNombre, setCNombre]     = useState('');
  const clienteLockRef                  = useRef(false);
  const [prestamosActivos, setActivos]  = useState<Prestamo[]>([]);

  const [monto, setMonto]               = useState('');
  const [modalidad, setModalidad]       = useState<'diario' | 'semanal'>('diario');
  // plazoSel guarda el objeto completo del plazo seleccionado
  const [plazoSel, setPlazoSel]         = useState<{dias:number;cuotas:number;label:string}|null>(null);
  const [diaCobro, setDiaCobro]         = useState<number | null>(null);
  const [fechaInicio, setFechaI]        = useState(hoy());
  const [obs, setObs]                   = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [busqueda, setBusqueda]         = useState('');

  const frecuencia: Frecuencia = modalidad; // mapeo directo

  /* ── Cálculos por amortización (interés sobre saldo pendiente — método BCR) ── */
  const montoN    = parseFloat(monto) || 0;
  const diasN     = plazoSel?.dias   || 0;
  const numCuotas = plazoSel?.cuotas || 0;
  const cuota     = montoN > 0 && numCuotas > 0 ? calcularCuotaAmort(montoN, numCuotas, frecuencia) : 0;
  const total     = montoN > 0 && numCuotas > 0 ? calcularTotalAmort(montoN, numCuotas, frecuencia) : 0;
  const interesAmt   = Math.round((total - montoN) * 100) / 100;
  const interesPorc  = montoN > 0 ? parseFloat((interesAmt / montoN * 100).toFixed(4)) : 0;
  const tabla        = montoN > 0 && numCuotas > 0 ? tablaAmortizacion(montoN, numCuotas, frecuencia) : [];
  const fechaFin     = diasN > 0 && montoN > 0 && fechaInicio.length === 10
    ? calcularFechaFin(fechaInicio, numCuotas, frecuencia)
    : '';

  useEffect(() => {
    getDocs(query(collection(db, col('clientes')))).then(snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Cliente))
                            .sort((a,b) => a.nombre.localeCompare(b.nombre));
      setClientes(data);
    });
    if (params.cliente_id) {
      const cid = params.cliente_id;
      getDoc(doc(db, col('clientes'), cid)).then(snap => {
        if (!clienteLockRef.current && snap.exists()) setCNombre(snap.data().nombre);
      });
      cargarActivos(params.cliente_id);
    }
  }, []);

  async function cargarActivos(cid: string) {
    const snap = await getDocs(query(
      collection(db, col('prestamos')),
      where('cliente_id','==',cid),
      where('estado','in',['activo','mora'])
    ));
    setActivos(snap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo)));
  }

  function seleccionarCliente(id: string, nombre: string) {
    clienteLockRef.current = true;
    setClienteId(id);
    setCNombre(nombre);
    cargarActivos(id);
  }

  async function guardar() {
    if (!clienteId)  { setError('Selecciona un cliente.'); return; }
    if (montoN <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (!plazoSel)   { setError('Selecciona un plazo.'); return; }
    setLoading(true); setError('');
    try {
      const snapCount = await getDocs(query(collection(db, col('prestamos')), where('cliente_id','==',clienteId)));
      const numerCredito = snapCount.size + 1;

      await addDoc(collection(db, col('prestamos')), {
        cliente_id:       clienteId,
        monto:            montoN,
        interes:          interesPorc,
        plazo:            numCuotas,
        dias_plazo:       diasN,
        cuota,
        frecuencia,
        fecha_inicio:     fechaInicio,
        fecha_desembolso: hoy(),
        fecha_fin:        fechaFin,
        monto_total:      total,
        estado:           'activo',
        asesor_id:        perfil?.id ?? null,
        observaciones:    obs || '',
        numero_credito:   numerCredito,
        tasa_anual_bcr:   TASA_ANUAL_BCR,
        created_at:       new Date().toISOString(),
      });

      cache.invalidate('prestamos_');
      cache.invalidate('dashboard_');
      Alert.alert(
        '✅ Préstamo creado',
        `Crédito #${numerCredito}\nPlazo: ${plazoSel.label} · ${numCuotas} cuotas\nCuota ${frecuencia}: ${formatMoneda(cuota)}\nInterés: ${interesPorc.toFixed(2)}% (BCR 82.87% anual)`
      );
      router.back();
    } catch(e: any) {
      console.error('Error guardando préstamo:', e);
      setError('Error: ' + (e?.message || e?.code || JSON.stringify(e)));
    }
    setLoading(false);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Text variant="titleLarge" style={s.titulo}>Nuevo Préstamo</Text>

      {/* Aviso tasa BCR */}
      <View style={s.bcrBanner}>
        <Text style={s.bcrTxt}>🏛️ Tasa BCR: 82.87% anual máxima legal</Text>
        <Text style={s.bcrSub}>Seg. 3 — Crédito consumo sin descuento · Vig. Jul–Dic 2026</Text>
      </View>

      {/* Cliente */}
      <Text style={s.label}>Cliente *</Text>
      {clienteNombre
        ? <View>
            <View style={s.clienteBox}>
              <Text style={s.clienteNombre}>{clienteNombre.toUpperCase()}</Text>
              <Button compact onPress={() => { clienteLockRef.current = true; setClienteId(''); setCNombre(''); setActivos([]); }}>Cambiar</Button>
            </View>
            {prestamosActivos.length > 0 && (
              <View style={s.avisoCredito}>
                <Text style={s.avisoTit}>⚠️ Cliente con {prestamosActivos.length} crédito{prestamosActivos.length>1?'s':''} activo{prestamosActivos.length>1?'s':''}</Text>
                {prestamosActivos.map((p,i) => (
                  <Text key={p.id} style={s.avisoSub}>
                    {'  '}· Crédito #{p.numero_credito||i+1}: {formatMoneda(p.monto)} — saldo aprox. {formatMoneda(p.monto_total)}
                  </Text>
                ))}
                <Text style={s.avisoInfo}>Se creará un {prestamosActivos.length===1?'segundo':'tercer'} crédito para este cliente.</Text>
              </View>
            )}
          </View>
        : <View style={s.clienteLista}>
            <RNTextInput
              placeholder="Buscar cliente..."
              placeholderTextColor={C.textTer}
              value={busqueda}
              onChangeText={setBusqueda}
              style={s.clienteBusqueda}
            />
            <FlatList
              data={clientes.filter(c => c.nombre.toLowerCase().includes(busqueda.toLowerCase()))}
              keyExtractor={c => c.id}
              style={{maxHeight:280}}
              keyboardShouldPersistTaps="handled"
              renderItem={({item:c}) => (
                <TouchableOpacity style={[s.clienteItem, clienteId===c.id&&s.clienteItemSel]}
                  onPress={() => { seleccionarCliente(c.id, c.nombre); setBusqueda(''); }}>
                  <Text style={[s.clienteItemTxt, clienteId===c.id&&{color:'#fff'}]}>{c.nombre.toUpperCase()}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
      }

      <View style={s.formPanel}>
        {/* Monto */}
        <TextInput
          label="Monto a prestar ($) *"
          value={monto}
          onChangeText={setMonto}
          mode="outlined"
          keyboardType="decimal-pad"
          style={s.input}
          left={<TextInput.Icon icon="currency-usd"/>}
        />

        {/* Modalidad */}
        <Text style={s.label}>Modalidad de pago *</Text>
        <View style={[s.frecRow,{marginBottom:14}]}>
          {(['diario','semanal'] as const).map(m => (
            <TouchableOpacity key={m}
              style={[s.frecBtn, modalidad===m && s.frecBtnActive]}
              onPress={() => { setModalidad(m); setPlazoSel(null); setDiaCobro(null); }}>
              <Text style={[s.frecTxt, modalidad===m && {color:'#fff'}]}>
                {m === 'diario' ? '📅 Diario' : '📆 Semanal'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Plazo fijo según modalidad */}
        <Text style={s.label}>Plazo *</Text>
        <View style={s.plazoRow}>
          {(modalidad === 'diario' ? PLAZOS_DIARIO : PLAZOS_SEMANAL).map(p => {
            const pct     = ((TASA_ANUAL_BCR/100)*(p.dias/365)*100).toFixed(2);
            const selected = plazoSel?.dias === p.dias;
            return (
              <TouchableOpacity
                key={p.dias}
                style={[s.plazoBtn, selected && s.plazoBtnActive]}
                onPress={() => { setPlazoSel(p); setDiaCobro(null); }}
              >
                <Text style={[s.plazoDias, selected && {color:'#fff'}]}>{p.label}</Text>
                <Text style={[s.plazoTasa, selected && {color:'rgba(255,255,255,0.8)'}]}>{pct}% interés</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Día de cobro — solo para semanal */}
        {modalidad === 'semanal' && (
          <>
            <Text style={s.label}>Día de cobro semanal</Text>
            <View style={[s.frecRow,{flexWrap:'wrap'}]}>
              {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d, i) => (
                <TouchableOpacity key={i}
                  style={[s.frecBtn, {flex:0,paddingHorizontal:10}, diaCobro===i&&s.frecBtnActive]}
                  onPress={() => {
                    setDiaCobro(i);
                    const base = new Date(fechaInicio.length===10 ? fechaInicio+'T00:00:00' : new Date());
                    const diff = (i - base.getDay() + 7) % 7;
                    const nueva = new Date(base);
                    nueva.setDate(base.getDate() + (diff === 0 ? 7 : diff));
                    setFechaI(nueva.toISOString().split('T')[0]);
                  }}>
                  <Text style={[s.frecTxt, diaCobro===i&&{color:'#fff'}]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <TextInput
          label="Fecha de inicio"
          value={fechaInicio}
          onChangeText={v => { setFechaI(v); setDiaCobro(null); }}
          mode="outlined"
          style={[s.input,{marginBottom:0}]}
          placeholder="AAAA-MM-DD"
        />
      </View>

      {/* Resumen automático + Tabla de amortización */}
      {montoN > 0 && diasN > 0 && (
        <View style={s.resumen}>
          <Text style={s.resumenTit}>📊 Resumen del préstamo</Text>
          <Text style={{fontSize:11,color:'#2e7d32',marginBottom:10,fontStyle:'italic'}}>
            ✅ Interés calculado sobre saldo pendiente (método legal BCR)
          </Text>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Capital prestado:</Text>
            <Text style={s.resumenVal}>{formatMoneda(montoN)}</Text>
          </View>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Interés total ({diasN} días):</Text>
            <Text style={s.resumenVal}>{formatMoneda(interesAmt)}</Text>
          </View>
          <View style={[s.resumenRow,{borderTopWidth:1,borderTopColor:'rgba(0,0,0,0.1)',paddingTop:8,marginTop:4}]}>
            <Text style={[s.resumenLbl,{fontWeight:'700'}]}>Total a pagar:</Text>
            <Text style={[s.resumenVal,{fontSize:18}]}>{formatMoneda(total)}</Text>
          </View>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Cuota {frecuencia} ({numCuotas} cuotas):</Text>
            <Text style={[s.resumenVal,{color:C.primaryText,fontSize:22,fontWeight:'900'}]}>{formatMoneda(cuota)}</Text>
          </View>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Fecha de fin:</Text>
            <Text style={s.resumenVal}>{fechaFin}</Text>
          </View>

          {/* Tabla de amortización */}
          <Text style={[s.resumenTit,{marginTop:16,marginBottom:6,fontSize:11}]}>
            TABLA DE AMORTIZACIÓN (Interés sobre saldo pendiente)
          </Text>
          {/* Encabezado */}
          <View style={s.tablaHead}>
            <Text style={[s.tablaH,{flex:0.6}]}>{modalidad==='semanal'?'Sem.':'Día'}</Text>
            <Text style={s.tablaH}>Saldo</Text>
            <Text style={s.tablaH}>Cuota</Text>
            <Text style={s.tablaH}>Interés</Text>
            <Text style={s.tablaH}>Abono</Text>
          </View>
          {tabla.map(r => (
            <View key={r.numero} style={[s.tablaRow, r.numero%2===0 && {backgroundColor:'rgba(0,0,0,0.03)'}]}>
              <Text style={[s.tablaC,{flex:0.6}]}>{r.numero}</Text>
              <Text style={s.tablaC}>{formatMoneda(r.saldo)}</Text>
              <Text style={[s.tablaC,{fontWeight:'700'}]}>{formatMoneda(r.cuota)}</Text>
              <Text style={[s.tablaC,{color:'#c62828'}]}>{formatMoneda(r.interes)}</Text>
              <Text style={[s.tablaC,{color:'#2e7d32'}]}>{formatMoneda(r.abono)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.formPanel}>
        <TextInput label="Observaciones" value={obs} onChangeText={setObs}
          mode="outlined" style={[s.input,{marginBottom:0}]} multiline numberOfLines={3}/>
      </View>

      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      <Button mode="contained" onPress={guardar} loading={loading} disabled={loading || !plazoSel || montoN <= 0}
        buttonColor={C.primary} textColor="#ffffff"
        style={s.btn} contentStyle={{ paddingVertical: 6 }}>
        Crear Préstamo
      </Button>
      <Button onPress={() => router.back()} style={{ marginTop: 8 }}>Cancelar</Button>
    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:      {flex:1, ...w(glassBgStyle(C))},
  titulo:         {color:C.primaryText,fontWeight:'800',marginBottom:12},
  label:          {fontSize:13,color:C.textSec,fontWeight:'600',marginBottom:8},
  input:          {marginBottom:12},
  // Banner BCR
  bcrBanner:      {backgroundColor: C.isDark ? '#0d2b0d' : '#e8f5e9', borderRadius:10, padding:10,
                   marginBottom:14, borderLeftWidth:4, borderLeftColor:'#2e7d32'},
  bcrTxt:         {fontSize:13,fontWeight:'700',color:'#2e7d32'},
  bcrSub:         {fontSize:11,color: C.isDark ? '#81c784' : '#388e3c', marginTop:2},
  // Cliente
  clienteBox:     {flexDirection:'row',justifyContent:'space-between',alignItems:'center',
                   borderRadius:12,padding:12,marginBottom:12, ...glassStyle(C)},
  clienteNombre:  {fontSize:15,fontWeight:'700',color:C.primaryText},
  clienteLista:   {borderRadius:12,marginBottom:12, ...glassStyle(C)},
  clienteBusqueda:{padding:10,fontSize:14,color:C.text,borderBottomWidth:1,
                   borderBottomColor: C.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                   backgroundColor:'transparent',borderTopLeftRadius:12,borderTopRightRadius:12},
  clienteItem:    {padding:12,borderBottomWidth:1,borderBottomColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'},
  clienteItemSel: {backgroundColor:C.primary},
  clienteItemTxt: {fontSize:14,color:C.text},
  avisoCredito:   {backgroundColor:C.surfaceAlt,borderRadius:8,padding:12,marginBottom:12,borderLeftWidth:4,borderLeftColor:C.warning},
  avisoTit:       {fontSize:13,fontWeight:'700',color:C.warning,marginBottom:4},
  avisoSub:       {fontSize:12,color:C.textSec,marginBottom:2},
  avisoInfo:      {fontSize:12,color:C.warning,fontWeight:'600',marginTop:6},
  // Formulario
  formPanel:      {borderRadius:16,padding:12,marginBottom:12, ...glassStyle(C)},
  // Plazos fijos
  plazoRow:       {flexDirection:'row',gap:10,marginBottom:14},
  plazoBtn:       {flex:1,borderWidth:2,borderColor:C.border,borderRadius:12,padding:12,alignItems:'center'},
  plazoBtnActive: {backgroundColor:C.primary,borderColor:C.primary},
  plazoDias:      {fontSize:15,fontWeight:'800',color:C.text},
  plazoTasa:      {fontSize:11,color:C.textTer,marginTop:2},
  // Frecuencia
  frecRow:        {flexDirection:'row',gap:10,marginBottom:12},
  frecBtn:        {flex:1,borderWidth:1,borderColor:C.border,borderRadius:8,padding:10,alignItems:'center'},
  frecBtnActive:  {backgroundColor:C.primary,borderColor:C.primary},
  frecTxt:        {fontSize:13,color:C.textSec,fontWeight:'600'},
  // Resumen
  resumen:        {borderRadius:12,padding:16,marginBottom:12, ...glassStyle(C)},
  resumenTit:     {fontSize:13,fontWeight:'700',color:C.primaryText,marginBottom:10,textTransform:'uppercase'},
  resumenRow:     {flexDirection:'row',justifyContent:'space-between',marginBottom:6,alignItems:'center'},
  resumenLbl:     {color:C.textSec,fontSize:13,flex:1},
  resumenVal:     {fontWeight:'700',color:C.text,fontSize:14},
  btn:            {borderRadius:8,marginTop:4},
  // Tabla de amortización
  tablaHead:      {flexDirection:'row',borderBottomWidth:2,borderBottomColor:'rgba(0,0,0,0.15)',paddingBottom:4,marginBottom:2},
  tablaH:         {flex:1,fontSize:10,fontWeight:'800',color:C.textTer,textTransform:'uppercase',textAlign:'right'},
  tablaRow:       {flexDirection:'row',paddingVertical:3},
  tablaC:         {flex:1,fontSize:11,color:C.text,textAlign:'right'},
});
