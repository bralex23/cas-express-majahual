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
import { calcularCuota, calcularTotal, calcularFechaFin, formatMoneda, hoy, FRECUENCIAS } from '../../../src/utils/calculos';
import { cache } from '../../../src/utils/cache';

export default function NuevoPrestamo() {
  const { perfil } = useAuth();
  // col debe declararse ANTES del useEffect que lo usa
  const { col } = useEmpresa();
  const params = useLocalSearchParams<{ cliente_id?: string }>();

  const [clientes, setClientes]         = useState<Cliente[]>([]);
  const [clienteId, setClienteId]       = useState(params.cliente_id || '');
  const [clienteNombre, setCNombre]     = useState('');
  // Ref para prevenir que el fetch asíncrono sobreescriba una selección manual
  const clienteLockRef = useRef(false);
  const [prestamosActivos, setActivos]  = useState<Prestamo[]>([]);
  const [monto, setMonto]               = useState('');
  const [interes, setInteres]           = useState('20');
  const [plazo, setPlazo]               = useState('');
  const [frecuencia, setFrec]           = useState<Frecuencia>('diario');
  const [fechaInicio, setFechaI]        = useState(hoy());
  const [diaCobro, setDiaCobro]         = useState<number | null>(null); // 0=Dom..6=Sáb
  const [obs, setObs]                   = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [busqueda, setBusqueda]         = useState('');

  // Cálculos automáticos
  const montoN   = parseFloat(monto) || 0;
  const interesN = parseFloat(interes) || 0;
  const plazoN   = parseInt(plazo) || 0;
  const cuota    = plazoN > 0 ? calcularCuota(montoN, interesN, plazoN) : 0;
  const total    = calcularTotal(montoN, interesN);
  const fechaFin = plazoN > 0 && montoN > 0 && fechaInicio.length === 10 ? calcularFechaFin(fechaInicio, plazoN, frecuencia) : '';

  useEffect(() => {
    getDocs(query(collection(db, col('clientes')))).then(snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Cliente))
                            .sort((a,b) => a.nombre.localeCompare(b.nombre));
      setClientes(data);
    });
    if (params.cliente_id) {
      const cid = params.cliente_id;
      getDoc(doc(db, col('clientes'),cid)).then(snap => {
        // Solo aplica si el usuario NO cambió de cliente manualmente
        if (!clienteLockRef.current && snap.exists()) {
          setCNombre(snap.data().nombre);
        }
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
    clienteLockRef.current = true; // bloquea fetch inicial
    setClienteId(id);
    setCNombre(nombre);
    cargarActivos(id);
  }

  async function guardar() {
    if (!clienteId) { setError('Selecciona un cliente.'); return; }
    if (montoN <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (plazoN <= 0) { setError('El plazo debe ser mayor a 0.'); return; }
    setLoading(true); setError('');
    try {
      // Determinar número de crédito del cliente
      const snapCount = await getDocs(query(collection(db, col('prestamos')), where('cliente_id','==',clienteId)));
      const numerCredito = snapCount.size + 1;

      await addDoc(collection(db, col('prestamos')), {
        cliente_id: clienteId,
        monto: montoN, interes: interesN, plazo: plazoN,
        cuota, frecuencia, fecha_inicio: fechaInicio,
        fecha_desembolso: hoy(),
        fecha_fin: fechaFin, monto_total: total,
        estado: 'activo', asesor_id: perfil?.id,
        observaciones: obs,
        numero_credito: numerCredito,
        created_at: new Date().toISOString(),
      });
      // Invalidar caché para que las listas muestren el nuevo préstamo de inmediato
      cache.invalidate('prestamos_');
      cache.invalidate('dashboard_');
      Alert.alert('✅ Préstamo creado', `Crédito #${numerCredito} · Cuota ${frecuencia}: ${formatMoneda(cuota)}`);
      router.back();
    } catch(e) { setError('Error al guardar. Intenta de nuevo.'); }
    setLoading(false);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Text variant="titleLarge" style={s.titulo}>Nuevo Préstamo</Text>

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
                    {'  '}· Crédito #{p.numero_credito||i+1}: {formatMoneda(p.monto)} — saldo pendiente aprox. {formatMoneda(p.monto_total)}
                  </Text>
                ))}
                <Text style={s.avisoInfo}>Se creará un {prestamosActivos.length===1?'segundo':'tercer'} crédito para este cliente.</Text>
              </View>
            )}
          </View>
        : <View style={s.clienteLista}>
            {/* Buscador */}
            <RNTextInput
              placeholder="Buscar cliente..."
              placeholderTextColor={C.textTer}
              value={busqueda}
              onChangeText={setBusqueda}
              style={s.clienteBusqueda}
            />
            <FlatList
              data={clientes.filter(c =>
                c.nombre.toLowerCase().includes(busqueda.toLowerCase())
              )}
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
        <TextInput label="Monto a prestar ($) *" value={monto} onChangeText={setMonto}
          mode="outlined" keyboardType="decimal-pad" style={s.input}
          left={<TextInput.Icon icon="currency-usd"/>}/>
        <TextInput label="Interés (%)" value={interes} onChangeText={setInteres}
          mode="outlined" keyboardType="decimal-pad" style={s.input}/>
        <TextInput label="Plazo (número de cuotas) *" value={plazo} onChangeText={setPlazo}
          mode="outlined" keyboardType="numeric" style={s.input}/>

        {/* Frecuencia */}
        <Text style={s.label}>Frecuencia de pago</Text>
        <View style={s.frecRow}>
          {FRECUENCIAS.map(f => (
            <TouchableOpacity key={f.value} style={[s.frecBtn, frecuencia===f.value&&s.frecBtnActive]}
              onPress={() => { setFrec(f.value); setDiaCobro(null); }}>
              <Text style={[s.frecTxt, frecuencia===f.value&&{color:'#fff'}]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Día de cobro — solo para semanal */}
        {frecuencia === 'semanal' && (
          <>
            <Text style={s.label}>Día de cobro</Text>
            <View style={[s.frecRow,{flexWrap:'wrap'}]}>
              {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d, i) => (
                <TouchableOpacity key={i}
                  style={[s.frecBtn, {flex:0,paddingHorizontal:10}, diaCobro===i&&s.frecBtnActive]}
                  onPress={() => {
                    setDiaCobro(i);
                    // Ajustar fecha_inicio al próximo día seleccionado
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

        <TextInput label="Fecha de inicio" value={fechaInicio} onChangeText={v => { setFechaI(v); setDiaCobro(null); }}
          mode="outlined" style={[s.input,{marginBottom:0}]} placeholder="AAAA-MM-DD"/>
      </View>

      {/* Resumen calculado */}
      {montoN > 0 && plazoN > 0 && (
        <View style={s.resumen}>
          <Text style={s.resumenTit}>Resumen del préstamo</Text>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Total a pagar:</Text>
            <Text style={s.resumenVal}>{formatMoneda(total)}</Text>
          </View>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Cuota {frecuencia}:</Text>
            <Text style={[s.resumenVal,{color:C.primaryText,fontSize:20}]}>{formatMoneda(cuota)}</Text>
          </View>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Fecha de fin:</Text>
            <Text style={s.resumenVal}>{fechaFin}</Text>
          </View>
          <View style={s.resumenRow}>
            <Text style={s.resumenLbl}>Interés total:</Text>
            <Text style={s.resumenVal}>{formatMoneda(total - montoN)}</Text>
          </View>
        </View>
      )}

      <View style={s.formPanel}>
        <TextInput label="Observaciones" value={obs} onChangeText={setObs}
          mode="outlined" style={[s.input,{marginBottom:0}]} multiline numberOfLines={3}/>
      </View>

      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      <Button mode="contained" onPress={guardar} loading={loading} disabled={loading}
        buttonColor={C.primary} textColor="#ffffff"
        style={s.btn} contentStyle={{ paddingVertical: 6 }}>
        Crear Préstamo
      </Button>
      <Button onPress={() => router.back()} style={{ marginTop: 8 }}>Cancelar</Button>
    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:{flex:1, ...w(glassBgStyle(C))},
  titulo:{color:C.primaryText,fontWeight:'800',marginBottom:16},
  label:{fontSize:13,color:C.textSec,fontWeight:'600',marginBottom:8},
  input:{marginBottom:12},
  clienteBox:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',
              borderRadius:12,padding:12,marginBottom:12, ...glassStyle(C)},
  clienteNombre:{fontSize:15,fontWeight:'700',color:C.primaryText},
  clienteLista:{borderRadius:12,marginBottom:12, ...glassStyle(C)},
  clienteBusqueda:{padding:10,fontSize:14,color:C.text,borderBottomWidth:1,
                  borderBottomColor: C.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                  backgroundColor:'transparent',borderTopLeftRadius:12,borderTopRightRadius:12},
  clienteItem:{padding:12,borderBottomWidth:1,borderBottomColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'},
  clienteItemSel:{backgroundColor:C.primary},
  clienteItemTxt:{fontSize:14,color:C.text},
  avisoCredito:{backgroundColor:C.surfaceAlt,borderRadius:8,padding:12,marginBottom:12,borderLeftWidth:4,borderLeftColor:C.warning},
  avisoTit:{fontSize:13,fontWeight:'700',color:C.warning,marginBottom:4},
  avisoSub:{fontSize:12,color:C.textSec,marginBottom:2},
  avisoInfo:{fontSize:12,color:C.warning,fontWeight:'600',marginTop:6},
  formPanel:{borderRadius:16,padding:12,marginBottom:12, ...glassStyle(C)},
  frecRow:{flexDirection:'row',gap:10,marginBottom:12},
  frecBtn:{flex:1,borderWidth:1,borderColor:C.border,borderRadius:8,padding:10,alignItems:'center'},
  frecBtnActive:{backgroundColor:C.primary,borderColor:C.primary},
  frecTxt:{fontSize:13,color:C.textSec,fontWeight:'600'},
  resumen:{borderRadius:12,padding:16,marginBottom:12, ...glassStyle(C)},
  resumenTit:{fontSize:13,fontWeight:'700',color:C.primaryText,marginBottom:10,textTransform:'uppercase'},
  resumenRow:{flexDirection:'row',justifyContent:'space-between',marginBottom:6},
  resumenLbl:{color:C.textSec,fontSize:13},
  resumenVal:{fontWeight:'700',color:C.text,fontSize:14},
  btn:{borderRadius:8,marginTop:4},
});
