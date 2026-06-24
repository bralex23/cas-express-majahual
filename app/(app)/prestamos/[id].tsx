import React, { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Image, Platform, Alert } from 'react-native';
import * as ImagePicker from '../../../src/lib/imagePicker.web';
import { Text, Button, Card, ActivityIndicator, Divider, TextInput, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle, glassNavyStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Prestamo, Pago, CuotaCalendar, Frecuencia, EstadoPrestamo } from '../../../src/types';
import { usePersonaEntrega } from '../../../src/hooks/usePersonaEntrega';
import ModalPersonaEntrega from '../../../src/components/ModalPersonaEntrega';
import {
  generarCalendario, calcularMora, calcularMulta, calcularCuota, calcularTotal, calcularFechaFin,
  formatMoneda, formatFecha, hoy, FRECUENCIAS,
} from '../../../src/utils/calculos';
import { StaggerItem } from '../../../src/components/FadeIn';
import { generarPDFPrestamo, generarPDFContrato, generarPDFSolicitud, generarPDFFicha, generarPDFCopiaDUI, generarPDFReciboLuz, compartir } from '../../../src/utils/pdf';

const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
function diaSemana(fecha: string) {
  return DIAS[new Date(fecha + 'T00:00:00').getDay()];
}

const ESTADOS: { label: string; value: EstadoPrestamo; color: string }[] = [
  { label: 'Activo',     value: 'activo',     color: '#1565c0' },
  { label: 'Mora',       value: 'mora',       color: '#c62828' },
  { label: 'Completado', value: 'completado', color: '#2e7d32' },
  { label: 'Cancelado',  value: 'cancelado',  color: '#666'    },
];

export default function DetallePrestamo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { perfil, isSupervisor, isAdmin } = useAuth();
  const [prestamo, setPrestamo]   = useState<Prestamo | null>(null);
  const [pagos, setPagos]         = useState<Pago[]>([]);
  const [cal, setCal]             = useState<CuotaCalendar[]>([]);
  const [loading, setLoading]     = useState(true);
  const [pdfLoading, setPdfLoad]  = useState(false);
  const [subiendoRecibo, setSubiendoRecibo] = useState(false);

  // ── Selector "Persona que entrega" (para Contrato) ─────────────────────
  const pe = usePersonaEntrega(perfil?.nombre);

  // ── Modal de pago ──────────────────────────────────────────────────────
  const [modalPago, setModalPago]   = useState(false);
  const [cuotaSel, setCuotaSel]     = useState<CuotaCalendar | null>(null);
  const [fechaPago, setFechaPago]   = useState(hoy());
  const [conMora, setConMora]       = useState(false);
  const [conMulta, setConMulta]     = useState(true);
  const [guardando, setGuardando]   = useState(false);
  const [pagoError, setPagoError]   = useState('');
  const [montoInput, setMontoInput] = useState('');
  // Mapa: numero_cuota → total abonado (para abonos parciales)
  const [pagadoXCuota, setPagadoXCuota] = useState<Map<number,number>>(new Map());

  // Distribución automática — DEBE ir después de todos los useState y antes de early returns
  const montoInputNum = parseFloat(montoInput.replace(',','.')) || 0;
  const distribucion = useMemo(() => {
    if (!prestamo || montoInputNum <= 0) return [];
    const pendientes = cal.filter(c => !c.pagada).sort((a,b) => a.numero - b.numero);
    let remaining = montoInputNum;
    const result: { cuota: CuotaCalendar; monto: number; completo: boolean }[] = [];
    for (const c of pendientes) {
      if (remaining <= 0) break;
      const abonado  = pagadoXCuota.get(c.numero) || 0;
      const saldo    = Math.max(0, (prestamo?.cuota ?? 0) - abonado);
      if (saldo <= 0) continue;
      const pagoEsta = Math.min(remaining, saldo);
      remaining     -= pagoEsta;
      result.push({ cuota: c, monto: pagoEsta, completo: pagoEsta >= saldo });
    }
    return result;
  }, [montoInputNum, cal, pagadoXCuota, prestamo]);

  // ── Modales de documentos ─────────────────────────────────────────────
  const [modalDUI,    setModalDUI]    = useState(false);
  const [modalRecibo, setModalRecibo] = useState(false);

  // ── Modal de borrado ───────────────────────────────────────────────────
  const [modalBorrar, setModalBorrar] = useState(false);
  const [borrando, setBorrando]       = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // ── Modal de edición ───────────────────────────────────────────────────
  const [modalEditar, setModalEditar] = useState(false);
  const [eMonto,       setEMonto]      = useState('');
  const [eInteres,     setEInteres]    = useState('');
  const [ePlazo,       setEPlazo]      = useState('');
  const [eFrecuencia,  setEFrecuencia] = useState<Frecuencia>('semanal');
  const [eFechaInicio, setEFechaInicio] = useState('');
  const [eEstado,      setEEstado]     = useState<EstadoPrestamo>('activo');
  const [eObservaciones, setEObs]      = useState('');
  const [editSaving,   setEditSaving]  = useState(false);
  const [editError,    setEditError]   = useState('');

  // Valores calculados en tiempo real dentro del modal
  const eCuota    = eMonto && eInteres && ePlazo
    ? calcularCuota(parseFloat(eMonto)||0, parseFloat(eInteres)||0, parseInt(ePlazo)||1)
    : 0;
  const eTotal    = eMonto && eInteres
    ? calcularTotal(parseFloat(eMonto)||0, parseFloat(eInteres)||0)
    : 0;

  useFocusEffect(useCallback(() => { cargar(); }, [id]));

  const { col } = useEmpresa();

  async function cargar() {
    const pSnap = await getDoc(doc(db, col('prestamos'),id));
    if (!pSnap.exists()) { router.push('/prestamos'); return; }
    const p = { id: pSnap.id, ...pSnap.data() } as Prestamo;
    const cSnap = await getDoc(doc(db, col('clientes'),p.cliente_id));
    if (cSnap.exists()) p.cliente = { id: cSnap.id, ...cSnap.data() } as any;
    const pagosSnap = await getDocs(collection(db, col('prestamos'), id, 'pagos'));
    const pgs = pagosSnap.docs.map(d => ({ id: d.id, ...d.data() } as Pago));

    // Calcular total abonado por cuota
    const mapa = new Map<number,number>();
    pgs.forEach(pg => {
      const n = pg.numero_cuota;
      mapa.set(n, (mapa.get(n) || 0) + (pg.monto_pagado || 0));
    });
    setPagadoXCuota(mapa);

    // Para generarCalendario, pasar solo pagos de cuotas completamente pagadas
    const pgsCompletos = pgs.filter(pg => (mapa.get(pg.numero_cuota) || 0) >= p.cuota);

    setPrestamo(p); setPagos(pgs);
    setCal(generarCalendario(p.plazo, p.cuota, p.frecuencia, p.fecha_inicio, pgsCompletos, p.fecha_fin));
    setLoading(false);
  }

  function generarContratoConPersona(nombre: string) {
    if (!prestamo) return Promise.resolve();
    return (async () => {
      setPdfLoad(true);
      try { const uri = await generarPDFContrato(prestamo, nombre); await compartir(uri); }
      catch(e) {}
      setPdfLoad(false);
    })();
  }

  function abrirEditar() {
    if (!prestamo) return;
    setEMonto(String(prestamo.monto));
    setEInteres(String(prestamo.interes));
    setEPlazo(String(prestamo.plazo));
    setEFrecuencia(prestamo.frecuencia);
    setEFechaInicio(prestamo.fecha_inicio);
    setEEstado(prestamo.estado);
    setEObs(prestamo.observaciones || '');
    setEditError('');
    setModalEditar(true);
  }

  async function guardarEdicion() {
    const monto   = parseFloat(eMonto);
    const interes = parseFloat(eInteres);
    const plazo   = parseInt(ePlazo);

    if (isNaN(monto) || monto <= 0)   { setEditError('El monto debe ser un número positivo.'); return; }
    if (isNaN(interes) || interes < 0) { setEditError('El interés no puede ser negativo.'); return; }
    if (isNaN(plazo) || plazo < 1)     { setEditError('El plazo debe ser al menos 1.'); return; }
    if (!eFechaInicio)                 { setEditError('La fecha de inicio es obligatoria.'); return; }

    setEditSaving(true); setEditError('');
    try {
      const cuota      = calcularCuota(monto, interes, plazo);
      const monto_total = calcularTotal(monto, interes);
      const fecha_fin  = calcularFechaFin(eFechaInicio, plazo, eFrecuencia);
      await updateDoc(doc(db, col('prestamos'),id), {
        monto, interes, plazo, cuota, monto_total,
        frecuencia:   eFrecuencia,
        fecha_inicio: eFechaInicio,
        fecha_fin,
        estado:       eEstado,
        observaciones: eObservaciones.trim() || null,
      });
      setModalEditar(false);
      cargar();
    } catch(e: any) {
      setEditError(e?.message || 'No se pudo guardar.');
    }
    setEditSaving(false);
  }

  function abrirPago(cuota: CuotaCalendar) {
    if (!prestamo) return;
    setCuotaSel(cuota);
    setFechaPago(hoy());
    setConMora(cuota.atrasada);
    const multaAplica = calcularMulta(cuota.fecha_vencimiento, prestamo.frecuencia) > 0;
    setConMulta(multaAplica);
    setPagoError('');
    const abonado = pagadoXCuota.get(cuota.numero) || 0;
    const saldo   = Math.max(0, prestamo.cuota - abonado);
    setMontoInput(saldo.toFixed(2));
    setModalPago(true);
  }

  async function confirmarPago() {
    if (!prestamo || !cuotaSel || distribucion.length === 0) return;
    if (montoInputNum <= 0) { setPagoError('Ingresa un monto válido mayor a $0'); return; }
    setGuardando(true); setPagoError('');
    try {
      const mora  = conMora  ? calcularMora(cuotaSel.fecha_vencimiento, prestamo.cuota, prestamo.frecuencia, prestamo.plazo) : 0;
      const multa = conMulta ? calcularMulta(cuotaSel.fecha_vencimiento, prestamo.frecuencia) : 0;

      await Promise.all(distribucion.map((d, idx) =>
        addDoc(collection(db, col('prestamos'), id, 'pagos'), {
          prestamo_id:       id,
          numero_cuota:      d.cuota.numero,
          monto_cuota:       prestamo.cuota,
          monto_pagado:      d.monto,
          mora:              idx === 0 ? mora  : 0,
          multa:             idx === 0 ? multa : 0,
          tipo:              d.completo ? 'completo' : 'abono',
          fecha_vencimiento: d.cuota.fecha_vencimiento,
          fecha_pago:        fechaPago,
          cobrador_id:       perfil?.id,
          created_at:        new Date().toISOString(),
        })
      ));

      const pgSnap = await getDocs(collection(db, col('prestamos'), id, 'pagos'));
      const mapaActualizado = new Map<number,number>();
      pgSnap.docs.forEach(d => {
        const pg = d.data();
        mapaActualizado.set(pg.numero_cuota, (mapaActualizado.get(pg.numero_cuota)||0) + (pg.monto_pagado||0));
      });
      const cuotasCompletas = [...mapaActualizado.entries()].filter(([_,t]) => t >= prestamo.cuota).length;
      if (cuotasCompletas >= prestamo.plazo) {
        await updateDoc(doc(db, col('prestamos'),id), { estado: 'completado' });
      }
      setModalPago(false);
      cargar();
    } catch(e: any) { setPagoError(e?.message || 'No se pudo registrar el pago.'); }
    setGuardando(false);
  }

  async function borrarPagoCuota(numeroCuota: number) {
    const ok = typeof window !== 'undefined'
      ? window.confirm(`¿Eliminar el pago registrado de la cuota #${numeroCuota}? Esta acción no se puede deshacer.`)
      : true;
    if (!ok) return;
    try {
      const pgSnap = await getDocs(collection(db, col('prestamos'), id, 'pagos'));
      const aBorrar = pgSnap.docs.filter(d => d.data().numero_cuota === numeroCuota);
      await Promise.all(aBorrar.map(d => deleteDoc(d.ref)));
      if (prestamo?.estado === 'completado') {
        await updateDoc(doc(db, col('prestamos'),id), { estado: 'activo' });
      }
      cargar();
    } catch(e: any) {
      alert('Error al borrar el pago: ' + (e?.message || ''));
    }
  }

  async function confirmarBorrar() {
    setBorrando(true); setDeleteError('');
    try {
      const pgSnap = await getDocs(collection(db, col('prestamos'), id, 'pagos'));
      for (const d of pgSnap.docs) await deleteDoc(d.ref);
      await deleteDoc(doc(db, col('prestamos'),id));
      setModalBorrar(false);
      setTimeout(() => router.push('/prestamos'), 200);
    } catch(e: any) {
      setDeleteError(e?.message || 'No se pudo eliminar.');
      setBorrando(false);
    }
  }

  async function generarPDF() {
    if (!prestamo) return;
    setPdfLoad(true);
    try { const uri = await generarPDFPrestamo(prestamo, cal); await compartir(uri); }
    catch(e) {}
    setPdfLoad(false);
  }
  function generarContrato() {
    if (!prestamo) return;
    pe.pedir(generarContratoConPersona);
  }
  async function generarSolicitud() {
    if (!prestamo?.cliente) return;
    setPdfLoad(true);
    try {
      const uri = await generarPDFSolicitud(prestamo.cliente as any, prestamo.cliente.numero_expediente || '');
      await compartir(uri);
    } catch(e) {}
    setPdfLoad(false);
  }
  async function generarFicha() {
    if (!prestamo) return;
    setPdfLoad(true);
    try { const uri = await generarPDFFicha([prestamo]); await compartir(uri); }
    catch(e) {}
    setPdfLoad(false);
  }
  async function imprimirDUI() {
    if (!prestamo?.cliente) return;
    setPdfLoad(true);
    try { await generarPDFCopiaDUI(prestamo.cliente as any); }
    catch(e) {}
    setPdfLoad(false);
  }
  async function imprimirRecibo() {
    if (!prestamo?.cliente) return;
    setPdfLoad(true);
    try { await generarPDFReciboLuz(prestamo.cliente as any); }
    catch(e) {}
    setPdfLoad(false);
  }

  function comprimirABase64(uri: string, maxW = 1600, calidad = 0.8): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new (window as any).Image() as HTMLImageElement;
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = reject;
      img.src = uri;
    });
  }

  async function guardarReciboLuz(uri: string) {
    if (!prestamo?.cliente_id) return;
    setSubiendoRecibo(true);
    try {
      const recibo_luz_url = await comprimirABase64(uri, 1600, 0.8);
      await updateDoc(doc(db, col('clientes'), prestamo.cliente_id), { recibo_luz_url });
      setPrestamo(p => p ? { ...p, cliente: { ...(p.cliente as any), recibo_luz_url } } : p);
    } catch (e) {}
    setSubiendoRecibo(false);
  }

  async function seleccionarReciboLuz() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a tus fotos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true,
    });
    if (!result.canceled) await guardarReciboLuz(result.assets[0].uri);
  }

  async function tomarReciboLuzConCamara() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
    if (!result.canceled) await guardarReciboLuz(result.assets[0].uri);
  }

  function agregarReciboLuz() {
    Alert.alert('Recibo de Luz', '¿Cómo quieres agregar la foto del recibo?', [
      { text: 'Cámara', onPress: tomarReciboLuzConCamara },
      { text: 'Galería', onPress: seleccionarReciboLuz },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary}/></View>;
  if (!prestamo) return null;

  const pagadas        = cal.filter(c => c.pagada).length;
  const atrasadas      = cal.filter(c => c.atrasada).length;
  const moraTot        = prestamo
    ? calcularMora(prestamo.fecha_fin, prestamo.cuota, prestamo.frecuencia, prestamo.plazo)
    : 0;
  const totalCobrado   = pagos.reduce((sum, pg) => sum + (pg.monto_pagado || 0), 0);
  const saldoPendiente = cal.reduce((sum, c) => {
    if (c.pagada) return sum;
    const abonado = pagadoXCuota.get(c.numero) || 0;
    return sum + Math.max(0, prestamo.cuota - abonado);
  }, 0);
  const proximaCuota   = cal.find(c => !c.pagada);
  const moraModal      = cuotaSel && conMora  ? calcularMora(cuotaSel.fecha_vencimiento, prestamo.cuota, prestamo.frecuencia, prestamo.plazo) : 0;
  const multaModal     = cuotaSel && conMulta ? calcularMulta(cuotaSel.fecha_vencimiento, prestamo.frecuencia) : 0;
  const multaAplicable = cuotaSel ? calcularMulta(cuotaSel.fecha_vencimiento, prestamo.frecuencia) > 0 : false;
  const abonadoSel = cuotaSel ? (pagadoXCuota.get(cuotaSel.numero) || 0) : 0;
  const saldoSel   = cuotaSel ? Math.max(0, prestamo.cuota - abonadoSel) : 0;

  const COLOR: Record<string,string> = { activo:'#1565c0', mora:'#c62828', completado:'#2e7d32', cancelado:'#666' };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>

      {/* ── Resumen ── */}
      <Card style={s.card} elevation={2}>
        <Card.Content>
          <View style={s.row}>
            <View style={{flex:1}}>
              <Text style={s.nombreCliente}>{prestamo.cliente?.nombre || 'Cliente'}</Text>
              {prestamo.cliente?.numero_expediente && (
                <Text style={s.expediente}>📋 Exp: {prestamo.cliente.numero_expediente}</Text>
              )}
            </View>
            <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
              <View style={[s.badge,{backgroundColor:(COLOR[prestamo.estado]||'#666')+'22'}]}>
                <Text style={[s.badgeTxt,{color:COLOR[prestamo.estado]||'#666'}]}>
                  {prestamo.estado.toUpperCase()}
                </Text>
              </View>
              <TouchableOpacity style={s.editIconBtn} onPress={cargar}>
                <MaterialCommunityIcons name="refresh" size={18} color={C.primaryText}/>
              </TouchableOpacity>
              {isSupervisor && (
                <TouchableOpacity style={s.editIconBtn} onPress={abrirEditar}>
                  <MaterialCommunityIcons name="pencil" size={18} color={C.primaryText}/>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Divider style={{ marginVertical: 10 }}/>
          <View style={s.statsRow}>
            <StatBox label="Monto"      valor={formatMoneda(prestamo.monto)}      />
            <StatBox label="Interés"    valor={`${prestamo.interes}%`}            />
            <StatBox label="Total"      valor={formatMoneda(prestamo.monto_total)} />
          </View>
          <View style={s.statsRow}>
            <StatBox label="Cuota"      valor={formatMoneda(prestamo.cuota)} color={C.primaryText}/>
            <StatBox label="Frecuencia" valor={prestamo.frecuencia.toUpperCase()} />
            <StatBox label="Plazo"      valor={`${prestamo.plazo} cuotas`}        />
          </View>
          <Divider style={{ marginVertical: 10 }}/>
          <View style={s.statsRow}>
            <StatBox label="Pagadas"    valor={String(pagadas)}   color={C.success}/>
            <StatBox label="Atrasadas"  valor={String(atrasadas)} color={C.danger}/>
            <StatBox label="Mora total" valor={formatMoneda(moraTot)} color={C.warning}/>
          </View>
          <Divider style={{ marginVertical: 10 }}/>
          <View style={s.statsRow}>
            <StatBox label="Total cobrado"   valor={formatMoneda(totalCobrado)}   color={C.success}/>
            <StatBox label="Saldo pendiente" valor={formatMoneda(saldoPendiente)} color={C.danger}/>
            <StatBox label="Próximo cobro"
              valor={proximaCuota ? formatFecha(proximaCuota.fecha_vencimiento) : '—'} color={C.primaryText}/>
          </View>
          <View style={s.statsRow}>
            <StatBox label="Día de cobro"
              valor={proximaCuota ? diaSemana(proximaCuota.fecha_vencimiento) : '—'} />
            <StatBox label="De un total de"  valor={formatMoneda(prestamo.monto_total)} color={C.textSec}/>
            <View style={{flex:1}}/>
          </View>
        </Card.Content>
      </Card>

      {/* ── Botones de acción ── */}
      <Card style={[s.card, {marginBottom:12}]} elevation={2}>
        <Card.Content style={{gap:8}}>
          <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
            <Button mode="outlined" icon="file-chart" onPress={generarPDF} loading={pdfLoading}
              style={{flex:1,borderColor:C.primaryText,borderRadius:8}} textColor={C.primaryText}>
              Estado
            </Button>
            <Button mode="outlined" icon="file-sign" onPress={generarContrato} loading={pdfLoading}
              style={{flex:1,borderColor:'#4caf50',borderRadius:8}} textColor="#4caf50">
              Solicitud
            </Button>
            <Button mode="outlined" icon="account-details" onPress={generarSolicitud} loading={pdfLoading}
              style={{flex:1,borderColor:'#ce93d8',borderRadius:8}} textColor="#ce93d8">
              Contrato
            </Button>
          </View>
          <Button mode="outlined" icon="card-account-details-outline" onPress={generarFicha}
            loading={pdfLoading}
            style={{borderColor:'#c8a951',borderRadius:8}} textColor="#c8a951">
            Ficha de Pago ({prestamo.plazo <= 22 ? '22 días' : '30 días'})
          </Button>
          <View style={{flexDirection:'row',gap:8}}>
            <Button mode="outlined" icon="card-account-details" onPress={imprimirDUI} loading={pdfLoading}
              style={{flex:1,borderColor:'#1565c0',borderRadius:8}} textColor="#1565c0">
              Imprimir DUI
            </Button>
            <Button mode="outlined" icon="lightning-bolt" onPress={imprimirRecibo} loading={pdfLoading}
              style={{flex:1,borderColor:'#f57f17',borderRadius:8}} textColor="#f57f17">
              Recibo Luz
            </Button>
            <Button mode="outlined" icon={prestamo.cliente?.recibo_luz_url ? 'camera-retake' : 'camera-plus'}
              onPress={agregarReciboLuz} loading={subiendoRecibo}
              style={{borderColor:'#f57f17',borderRadius:8,minWidth:48}} textColor="#f57f17"
              compact>
              {''}
            </Button>
          </View>
          {isSupervisor && (
            <View style={{flexDirection:'row',gap:8}}>
              <Button mode="outlined" icon="pencil" onPress={abrirEditar}
                style={{flex:1,borderColor:C.primaryText,borderRadius:8}} textColor={C.primaryText}>
                Editar préstamo
              </Button>
              {isAdmin && (
                <Button mode="outlined" icon="delete" onPress={()=>{ setDeleteError(''); setModalBorrar(true); }}
                  style={{borderColor:'#ef5350',borderRadius:8}} textColor="#ef5350">
                  Borrar
                </Button>
              )}
            </View>
          )}
        </Card.Content>
      </Card>

      {/* ── Observaciones ── */}
      {prestamo.observaciones ? (
        <Card style={[s.card,{backgroundColor:'#fffde7'}]} elevation={0}>
          <Card.Content>
            <Text style={{fontSize:12,color:'#f57f17',fontWeight:'700',marginBottom:4}}>📝 OBSERVACIONES</Text>
            <Text style={{fontSize:13,color:'#555'}}>{prestamo.observaciones}</Text>
          </Card.Content>
        </Card>
      ) : null}

      {/* ── Calendario de pagos ── */}
      <Text style={s.secTit}>Calendario de pagos</Text>

      {cal.map((c, calIdx) => {
        const abonado = pagadoXCuota.get(c.numero) || 0;
        const esAbono = !c.pagada && abonado > 0;
        const saldo   = Math.max(0, prestamo.cuota - abonado);
        const bgColor = c.pagada ? (C.isDark ? '#1b2e1b' : '#e8f5e9') : esAbono ? (C.isDark ? '#2e2b14' : '#fff8e1') : c.atrasada ? (C.isDark ? '#2e1e14' : '#fff3e0') : C.surface;
        return (
          <StaggerItem key={c.numero} index={Math.min(calIdx,10)} step={30}>
          <Card style={[s.cuotaCard,{backgroundColor: bgColor}]} elevation={0}>
            <Card.Content style={s.cuotaContent}>
              <View style={s.cuotaLeft}>
                <Text style={s.cuotaNum}>#{c.numero}</Text>
                <Text style={s.cuotaFecha}>{formatFecha(c.fecha_vencimiento)}</Text>
                <Text style={[s.cuotaFecha,{color:'#aaa'}]}>{diaSemana(c.fecha_vencimiento)}</Text>
              </View>
              <View style={s.cuotaMid}>
                <Text style={s.cuotaMonto}>{formatMoneda(c.monto)}</Text>
                {c.mora > 0 && !c.pagada && <Text style={s.cuotaMora}>+{formatMoneda(c.mora)} mora</Text>}
                {!c.pagada && calcularMulta(c.fecha_vencimiento, prestamo.frecuencia) > 0 && (
                  <Text style={s.cuotaMulta}>⚡ +$5.00 multa (2 sem.)</Text>
                )}
                {esAbono && (
                  <>
                    <Text style={{fontSize:11,color:'#f57f17',fontWeight:'700',marginTop:2}}>
                      💰 Abonado: {formatMoneda(abonado)}
                    </Text>
                    <Text style={{fontSize:11,color:'#e65100'}}>
                      Saldo: {formatMoneda(saldo)}
                    </Text>
                  </>
                )}
                {c.pagada && c.pago && (
                  <>
                    <Text style={s.pagadaFecha}>Pagado: {formatFecha(c.pago.fecha_pago)}</Text>
                    {(c.pago.multa ?? 0) > 0 && (
                      <Text style={s.pagadaMulta}>Multa cobrada: {formatMoneda(c.pago.multa)}</Text>
                    )}
                  </>
                )}
              </View>
              {c.pagada
                ? <View style={{alignItems:'center',gap:4}}>
                    <Text style={s.checkIcon}>✅</Text>
                    {isSupervisor && (
                      <TouchableOpacity
                        style={s.borrarPagoBtn}
                        onPress={() => borrarPagoCuota(c.numero)}>
                        <Text style={s.borrarPagoTxt}>🗑️ Borrar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                : <View style={{alignItems:'center',gap:4}}>
                    <TouchableOpacity
                      style={[s.pagarBtn, esAbono ? {backgroundColor:'#f57f17'} : c.atrasada ? {backgroundColor:'#c62828'} : {}]}
                      onPress={() => abrirPago(c)}>
                      <Text style={s.pagarTxt}>{esAbono ? '💰 Abonar' : c.atrasada ? '⚠️ Abonar' : 'Cobrar'}</Text>
                    </TouchableOpacity>
                    {isSupervisor && esAbono && (
                      <TouchableOpacity
                        style={s.borrarPagoBtn}
                        onPress={() => borrarPagoCuota(c.numero)}>
                        <Text style={s.borrarPagoTxt}>🗑️ Borrar abono</Text>
                      </TouchableOpacity>
                    )}
                  </View>
              }
            </Card.Content>
          </Card>
          </StaggerItem>
        );
      })}

      <Button onPress={() => router.push('/prestamos')} style={{ marginTop: 16 }}>Volver</Button>

      {/* MODAL: VER DUI */}
      <Modal visible={modalDUI} transparent animationType="fade" onRequestClose={() => setModalDUI(false)}>
        <TouchableOpacity
          style={{ flex:1, backgroundColor:'rgba(0,0,0,0.92)', justifyContent:'center', alignItems:'center' }}
          activeOpacity={1}
          onPress={() => setModalDUI(false)}>
          {prestamo.cliente?.foto_url && (
            <Image source={{ uri: prestamo.cliente.foto_url }}
              style={{ width:'90%', height:'40%', borderRadius:8, marginBottom:12 }}
              resizeMode="contain"/>
          )}
          {prestamo.cliente?.dui_reverso_url && (
            <Image source={{ uri: prestamo.cliente.dui_reverso_url }}
              style={{ width:'90%', height:'30%', borderRadius:8 }}
              resizeMode="contain"/>
          )}
          <Text style={{ color:'#ffffff88', marginTop:12, fontSize:13 }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>

      {/* MODAL: VER RECIBO DE LUZ */}
      <Modal visible={modalRecibo} transparent animationType="fade" onRequestClose={() => setModalRecibo(false)}>
        <TouchableOpacity
          style={{ flex:1, backgroundColor:'rgba(0,0,0,0.92)', justifyContent:'center', alignItems:'center' }}
          activeOpacity={1}
          onPress={() => setModalRecibo(false)}>
          {prestamo.cliente?.recibo_luz_url && (
            <Image source={{ uri: prestamo.cliente.recibo_luz_url }}
              style={{ width:'90%', height:'80%', borderRadius:8 }}
              resizeMode="contain"/>
          )}
          <Text style={{ color:'#ffffff88', marginTop:12, fontSize:13 }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>

      {/* MODAL: EDITAR PRÉSTAMO */}
      <Modal visible={modalEditar} transparent animationType="slide" onRequestClose={()=>setModalEditar(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <ScrollView style={s.modalScroll} contentContainerStyle={s.modalScrollContent}
            keyboardShouldPersistTaps="always">
            <Text style={s.modalTit}>✏️ Editar Préstamo</Text>
            <Text style={s.modalSubtit}>{prestamo.cliente?.nombre}</Text>

            {Platform.OS === 'web' ? (
              <>
                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Monto prestado ($)</Text>
                <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                    paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input type="text" value={eMonto}
                    onChange={e => setEMonto((e.target as any).value.replace(/[^0-9.]/g,''))}
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Interés (%)</Text>
                <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                    paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input type="text" value={eInteres}
                    onChange={e => setEInteres((e.target as any).value.replace(/[^0-9.]/g,''))}
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Plazo (número de cuotas)</Text>
                <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                    paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input type="text" value={ePlazo}
                    onChange={e => setEPlazo((e.target as any).value.replace(/[^0-9]/g,''))}
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              </>
            ) : (
              <>
                <TextInput label="Monto prestado ($)" value={eMonto} onChangeText={setEMonto}
                  mode="outlined" style={s.input} keyboardType="decimal-pad"/>
                <TextInput label="Interés (%)" value={eInteres} onChangeText={setEInteres}
                  mode="outlined" style={s.input} keyboardType="decimal-pad"/>
                <TextInput label="Plazo (número de cuotas)" value={ePlazo} onChangeText={setEPlazo}
                  mode="outlined" style={s.input} keyboardType="number-pad"/>
              </>
            )}

            {eCuota > 0 && (
              <View style={s.previewBox}>
                <View style={s.previewItem}>
                  <Text style={s.previewLbl}>Cuota calculada</Text>
                  <Text style={s.previewVal}>{formatMoneda(eCuota)}</Text>
                </View>
                <View style={s.previewItem}>
                  <Text style={s.previewLbl}>Total a pagar</Text>
                  <Text style={s.previewVal}>{formatMoneda(eTotal)}</Text>
                </View>
              </View>
            )}

            <Text style={s.label}>Frecuencia de pago</Text>
            <View style={s.optsRow}>
              {FRECUENCIAS.map(f => (
                <TouchableOpacity key={f.value}
                  style={[s.optBtn, eFrecuencia===f.value && s.optBtnSel]}
                  onPress={() => setEFrecuencia(f.value)}>
                  <Text style={[s.optTxt, eFrecuencia===f.value && s.optTxtSel]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Fecha de inicio (AAAA-MM-DD)</Text>
            {Platform.OS === 'web'
              ? <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                  paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input type="text" value={eFechaInicio}
                    onChange={e => setEFechaInicio((e.target as any).value)}
                    placeholder="2025-01-15"
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              : <TextInput label="Fecha de inicio (AAAA-MM-DD)" value={eFechaInicio}
                  onChangeText={setEFechaInicio} mode="outlined" style={s.input}
                  placeholder="2025-01-15" autoCapitalize="none"/>
            }

            <Text style={s.label}>Estado del préstamo</Text>
            <View style={s.optsRow}>
              {ESTADOS.map(e => (
                <TouchableOpacity key={e.value}
                  style={[s.optBtn, eEstado===e.value && {backgroundColor:e.color, borderColor:e.color}]}
                  onPress={() => setEEstado(e.value)}>
                  <Text style={[s.optTxt, eEstado===e.value && {color:'#fff'}]}>{e.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput label="Observaciones (opcional)" value={eObservaciones} onChangeText={setEObs}
              mode="outlined" style={s.input} multiline numberOfLines={3}/>

            {editError ? (
              <View style={s.errorBox}>
                <Text style={s.errorTxt}>⚠️ {editError}</Text>
              </View>
            ) : null}

            <Button mode="contained" onPress={guardarEdicion} loading={editSaving} disabled={editSaving}
              style={{marginTop:14, backgroundColor:C.primary}}>
              Guardar cambios
            </Button>
            <Button onPress={()=>setModalEditar(false)} style={{marginTop:6}}>Cancelar</Button>
          </ScrollView>
        </View>
      </Modal>

      {/* MODAL: BORRAR */}
      <Modal visible={modalBorrar} transparent animationType="fade" onRequestClose={()=>setModalBorrar(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={[s.modalTit,{color:'#c62828'}]}>⚠️ Eliminar Préstamo</Text>
            <Text style={{color:'#555',marginBottom:20}}>
              ¿Seguro que deseas eliminar este préstamo y todos sus pagos? Esta acción no se puede deshacer.
            </Text>
            {deleteError ? <Text style={{color:'#c62828',marginBottom:10,fontSize:13}}>{deleteError}</Text> : null}
            <View style={s.modalBtns}>
              <Button mode="outlined" onPress={()=>setModalBorrar(false)} style={{flex:1}} disabled={borrando}>Cancelar</Button>
              <Button mode="contained" onPress={confirmarBorrar} loading={borrando}
                style={{flex:1,backgroundColor:'#c62828'}}>
                Eliminar
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: PERSONA QUE ENTREGA */}
      <ModalPersonaEntrega
        visible={pe.visible}
        usuarios={pe.usuarios}
        value={pe.valor}
        onChange={pe.setValor}
        onConfirm={pe.confirmar}
        onCancel={pe.cancelar}
        loading={pe.loading}
        primaryColor={C.primaryText}
        titulo="¿Quién entrega el dinero?"
        subtitulo='Este nombre aparecerá como "PERSONA QUE ENTREGA" en el contrato.'
      />

      {/* MODAL: REGISTRAR PAGO */}
      <Modal visible={modalPago} transparent animationType="fade" onRequestClose={()=>setModalPago(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>Registrar Cobro — Cuota #{cuotaSel?.numero}</Text>

            <View style={s.modalRow}>
              <Text style={s.modalLbl}>Cuota:</Text>
              <Text style={s.modalVal}>{formatMoneda(prestamo.cuota)}</Text>
            </View>
            {abonadoSel > 0 && (
              <>
                <View style={s.modalRow}>
                  <Text style={s.modalLbl}>Ya abonado:</Text>
                  <Text style={[s.modalVal,{color:'#388e3c'}]}>{formatMoneda(abonadoSel)}</Text>
                </View>
                <View style={[s.modalRow,{backgroundColor:'#fff8e1',padding:8,borderRadius:8,marginBottom:8}]}>
                  <Text style={{color:'#f57f17',fontWeight:'600'}}>Saldo pendiente:</Text>
                  <Text style={{color:'#f57f17',fontWeight:'800'}}>{formatMoneda(saldoSel)}</Text>
                </View>
              </>
            )}

            <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Monto recibido del cliente</Text>
            {Platform.OS === 'web'
              ? <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:C.primary,
                  borderRadius:8, paddingHorizontal:10, paddingVertical:6, marginBottom:8, backgroundColor:C.surface }}>
                  <Text style={{ fontSize:16, color:C.textSec, marginRight:6 }}>$</Text>
                  <input type="text" value={montoInput}
                    onChange={e => setMontoInput((e.target as any).value.replace(/[^0-9.]/g,''))}
                    style={{ flex:1, fontSize:18, fontWeight:'700', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              : <TextInput label="Monto recibido del cliente" value={montoInput}
                  onChangeText={v => setMontoInput(v.replace(/[^0-9.]/g,''))}
                  mode="outlined" left={<TextInput.Affix text="$"/>} style={{ marginBottom:8 }}/>
            }
            {distribucion.length > 0 && (
              <View style={{backgroundColor:'#e8f5e9',borderRadius:8,padding:8,marginBottom:10}}>
                <Text style={{fontSize:12,fontWeight:'700',color:'#2e7d32',marginBottom:4}}>
                  📋 Se aplicará a:
                </Text>
                {distribucion.map((d, i) => (
                  <Text key={i} style={{fontSize:12,color:'#2e7d32'}}>
                    {d.completo ? '✅' : '⚡'} Cuota #{d.cuota.numero} — {formatMoneda(d.monto)}
                    {!d.completo ? ' (abono parcial)' : ''}
                  </Text>
                ))}
              </View>
            )}

            <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Fecha de pago (AAAA-MM-DD)</Text>
            {Platform.OS === 'web'
              ? <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                  paddingHorizontal:10, paddingVertical:6, marginBottom:12, backgroundColor:C.surface }}>
                  <input type="text" value={fechaPago}
                    onChange={e => setFechaPago((e.target as any).value)}
                    placeholder="2025-01-15"
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              : <TextInput label="Fecha de pago (AAAA-MM-DD)" value={fechaPago} onChangeText={setFechaPago}
                  mode="outlined" style={{ marginBottom: 12 }} placeholder="2025-01-15"/>
            }

            {cuotaSel?.atrasada && (
              <View style={s.switchRow}>
                <Text style={s.modalLbl}>¿Cobrar mora por atraso?</Text>
                <Switch value={conMora} onValueChange={setConMora} color="#c62828"/>
              </View>
            )}

            {conMora && moraModal > 0 && (
              <View style={[s.modalRow,{backgroundColor:C.isDark?'#2e1b1b':'#ffebee',padding:8,borderRadius:8,marginBottom:8}]}>
                <Text style={{color:C.danger,fontWeight:'600'}}>Mora:</Text>
                <Text style={{color:C.danger,fontWeight:'700'}}>{formatMoneda(moraModal)}</Text>
              </View>
            )}

            {multaAplicable && (
              <View style={[s.switchRow,{backgroundColor:C.isDark?'#2e2414':'#fff3e0',padding:8,borderRadius:8,marginBottom:8}]}>
                <View style={{flex:1}}>
                  <Text style={{fontSize:13,fontWeight:'600',color:C.warning}}>⚡ Multa por 2 semanas de atraso</Text>
                  <Text style={{fontSize:11,color:C.warning}}>$5.00 — pago semanal con 14+ días de retraso</Text>
                </View>
                <Switch value={conMulta} onValueChange={setConMulta} color={C.warning}/>
              </View>
            )}

            {conMulta && multaModal > 0 && (
              <View style={[s.modalRow,{backgroundColor:C.isDark?'#2e2414':'#fff3e0',padding:8,borderRadius:8,marginBottom:8}]}>
                <Text style={{color:C.warning,fontWeight:'600'}}>Multa:</Text>
                <Text style={{color:C.warning,fontWeight:'700'}}>{formatMoneda(multaModal)}</Text>
              </View>
            )}

            <View style={[s.modalRow,{backgroundColor:C.surfaceCard,padding:10,borderRadius:8,marginBottom:12}]}>
              <Text style={s.modalTotLbl}>TOTAL A REGISTRAR:</Text>
              <Text style={s.modalTotVal}>{formatMoneda(montoInputNum + moraModal + multaModal)}</Text>
            </View>

            {pagoError ? <Text style={{color:C.danger,marginBottom:10,fontSize:13}}>{pagoError}</Text> : null}

            <View style={s.modalBtns}>
              <Button mode="outlined" onPress={()=>setModalPago(false)} style={{flex:1}} disabled={guardando}>Cancelar</Button>
              <Button mode="contained" onPress={confirmarPago} loading={guardando}
                disabled={guardando || montoInputNum <= 0}
                style={{flex:1,backgroundColor:C.primary}}>
                Confirmar
              </Button>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

function StatBox({ label, valor, color }: { label:string; valor:string; color?:string }) {
  const C = useColors();
  return (
    <View style={{ flex:1, alignItems:'center' }}>
      <Text style={{ fontSize:11, color:C.textTer }}>{label}</Text>
      <Text style={{ fontSize:14, fontWeight:'700', color: color || C.text }}>{valor}</Text>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:      {flex:1, ...w(glassBgStyle(C))},
  center:         {flex:1, justifyContent:'center', alignItems:'center'},
  card:           {borderRadius:12, marginBottom:12, ...glassStyle(C)},
  row:            {flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'},
  nombreCliente:  {fontSize:18, fontWeight:'800', color:C.text},
  expediente:     {fontSize:12, color:C.textTer, marginTop:2},
  badge:          {paddingHorizontal:10, paddingVertical:4, borderRadius:12},
  badgeTxt:       {fontSize:11, fontWeight:'700'},
  editIconBtn:    {width:34, height:34, borderRadius:17, backgroundColor:C.surfaceCard,
                   justifyContent:'center', alignItems:'center'},
  statsRow:       {flexDirection:'row', justifyContent:'space-around', marginBottom:4},
  secTit:         {fontSize:14, fontWeight:'700', color:C.text, marginBottom:8, textTransform:'uppercase'},
  cuotaCard:      {marginBottom:6, borderRadius:10, borderWidth:1, borderColor: C.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'},
  cuotaContent:   {flexDirection:'row', alignItems:'center', paddingVertical:8},
  cuotaLeft:      {width:68},
  cuotaNum:       {fontSize:14, fontWeight:'700', color:C.primaryText},
  cuotaFecha:     {fontSize:11, color:C.textTer},
  cuotaMid:       {flex:1, paddingHorizontal:8},
  cuotaMonto:     {fontSize:14, fontWeight:'700', color:C.text},
  cuotaMora:      {fontSize:11, color:C.danger},
  cuotaMulta:     {fontSize:10, color:C.warning, fontWeight:'700'},
  pagadaFecha:    {fontSize:10, color:C.success},
  pagadaMulta:    {fontSize:10, color:C.warning},
  checkIcon:      {fontSize:20},
  pagarBtn:       {backgroundColor:C.primary, borderRadius:8, paddingHorizontal:12, paddingVertical:6},
  pagarTxt:       {color:'#fff', fontWeight:'700', fontSize:13},
  borrarPagoBtn:  {backgroundColor:C.surfaceAlt, borderRadius:6, paddingHorizontal:8, paddingVertical:4, borderWidth:1, borderColor:C.danger},
  borrarPagoTxt:  {color:C.danger, fontSize:11, fontWeight:'600'},
  overlay:        {flex:1, backgroundColor:'rgba(0,0,0,0.72)', justifyContent:'flex-end'},
  modalBox:       {...(glassNavyStyle() as any), borderTopLeftRadius:20, borderTopRightRadius:20,
                   borderTopWidth:1, borderTopColor:'rgba(200,169,81,0.28)',
                   borderLeftWidth:1, borderLeftColor:'rgba(255,255,255,0.1)',
                   borderRightWidth:1, borderRightColor:'rgba(255,255,255,0.1)',
                   padding:20},
  modalTit:       {fontSize:16, fontWeight:'800', color:'#c8a951', marginBottom:4},
  modalSubtit:    {fontSize:13, color:C.textTer, marginBottom:16},
  modalRow:       {flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10},
  modalLbl:       {fontSize:14, color:C.textSec},
  modalVal:       {fontSize:15, fontWeight:'700', color:C.text},
  switchRow:      {flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12},
  modalTotLbl:    {fontSize:14, fontWeight:'700', color:C.primaryText},
  modalTotVal:    {fontSize:18, fontWeight:'800', color:C.primaryText},
  modalBtns:      {flexDirection:'row', gap:10},
  modalScroll:    {...(glassNavyStyle() as any), borderTopLeftRadius:20, borderTopRightRadius:20,
                   borderTopWidth:1, borderTopColor:'rgba(200,169,81,0.28)',
                   borderLeftWidth:1, borderLeftColor:'rgba(255,255,255,0.1)',
                   borderRightWidth:1, borderRightColor:'rgba(255,255,255,0.1)',
                   maxHeight:'95%'},
  modalScrollContent: {padding:20, paddingBottom:40},
  input:          {marginBottom:12},
  label:          {fontSize:13, color:C.textSec, fontWeight:'600', marginBottom:8},
  optsRow:        {flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:14},
  optBtn:         {borderWidth:1, borderColor:C.border, borderRadius:20, paddingHorizontal:14, paddingVertical:6},
  optBtnSel:      {backgroundColor:C.primary, borderColor:C.primary},
  optTxt:         {fontSize:13, color:C.textSec},
  optTxtSel:      {color:'#fff'},
  previewBox:     {flexDirection:'row', gap:10, backgroundColor:C.surfaceCard, borderRadius:10,
                   padding:12, marginBottom:14},
  previewItem:    {flex:1, alignItems:'center'},
  previewLbl:     {fontSize:11, color:C.textSec},
  previewVal:     {fontSize:16, fontWeight:'800', color:C.primaryText},
  errorBox:       {backgroundColor:C.surfaceAlt, borderRadius:8, padding:10, marginTop:6, borderLeftWidth:3, borderLeftColor:C.danger},
  errorTxt:       {color:C.danger, fontSize:13},
});
