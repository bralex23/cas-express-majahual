import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Text, Card, Button, TextInput, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, orderBy } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle, glassNavyStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Prestamo, Pago } from '../../../src/types';
import { generarPDFReporteDiario, generarPDFReportesJuntos, compartir } from '../../../src/utils/pdf';
import { guardarReporteDiario } from '../../../src/utils/reporteXls';
import { formatMoneda, formatFecha, hoy } from '../../../src/utils/calculos';
import { StaggerItem } from '../../../src/components/FadeIn';
import { usePersonaEntrega } from '../../../src/hooks/usePersonaEntrega';
import ModalPersonaEntrega from '../../../src/components/ModalPersonaEntrega';

export default function ReporteDiario() {
  const { perfil, isSupervisor } = useAuth();
  const { col } = useEmpresa();
  const hoyStr = hoy();

  const [loading, setLoading]       = useState(false);
  const [modalAbierto, setModal]    = useState(false);
  const [saldoAnt, setSaldoAnt]       = useState('');
  const [zona, setZona]               = useState('');
  const [ingresoEfec, setIngresoEfec] = useState('');
  const [deposito, setDeposito]       = useState('');
  const [cajaChica, setCajaChica]     = useState('');
  const [retiroCaja, setRetiroCaja]           = useState('');
  const [retiroCajaRazon, setRetiroCajaRazon] = useState('');
  const [gastosItems, setGastosItems] = useState<{desc:string; monto:string}[]>([{desc:'',monto:''}]);
  const [fechaRep, setFechaRep]     = useState(hoyStr);
  const [fechaInput, setFechaInput] = useState(hoyStr);
  const [editandoFecha, setEditandoFecha] = useState(false);
  const [historial, setHistorial]   = useState<any[]>([]);
  const [verHistorial, setVerH]     = useState(true);
  const [modoSeleccion, setModoSel] = useState(false);
  const [seleccionados, setSelec]   = useState<string[]>([]);

  // Selector "Cobrador" para Reporte Diario
  const pe = usePersonaEntrega(perfil?.nombre);

  const FONDO_KEY = 'cas_fondo_caja';

  // Cargar fondo guardado al abrir
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FONDO_KEY);
      if (saved) setCajaChica(saved);
    } catch {}
  }, []);

  function guardarFondo() {
    try {
      localStorage.setItem(FONDO_KEY, cajaChica);
      Alert.alert('Fondo guardado', `$${cajaChica || '0'} se usará como caja chica por defecto.`);
    } catch {}
  }

  // ── Modal edición ──────────────────────────────────────
  const [editando, setEditando]         = useState<any | null>(null);
  const [editSaldo, setEditSaldo]       = useState('');
  const [editZona, setEditZona]         = useState('');
  const [editIngreso, setEditIngreso]   = useState('');
  const [editDeposito, setEditDeposito] = useState('');
  const [editCaja, setEditCaja]         = useState('');
  const [editRetiroCaja, setEditRetiroCaja]           = useState('');
  const [editRetiroCajaRazon, setEditRetiroCajaRazon] = useState('');
  const [editGastos, setEditGastos]     = useState<{desc:string;monto:string}[]>([]);
  const [editExpItems, setEditExpItems] = useState<{descripcion:string;monto:number}[]>([]);
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  function abrirEdicion(r: any) {
    setEditando(r);
    setEditSaldo(String(r.saldoAnterior || ''));
    setEditZona(r.zona || '');
    setEditIngreso(String(r.ingresoEfectivo || ''));
    setEditDeposito(String(r.deposito || ''));
    setEditCaja(String(r.cajaChica || ''));
    setEditRetiroCaja(String(r.retiroCajaChica || ''));
    setEditRetiroCajaRazon(r.retiroCajaRazon || '');
    // Separar automáticos (EXP = préstamos, FAC = facturas, GTO = gastos contabilidad) de gastos manuales
    const renovaciones = r.renovaciones || [];
    setEditExpItems(renovaciones.filter((rv: any) => rv.descripcion?.match(/^EXP\s/i)));
    const gastosManuales = renovaciones.filter((rv: any) =>
      !rv.descripcion?.match(/^(EXP|FAC|GTO)\s/i)
    );
    setEditGastos(gastosManuales.length > 0
      ? gastosManuales.map((g: any) => ({ desc: g.descripcion, monto: String(g.monto) }))
      : [{ desc: '', monto: '' }]
    );
  }

  async function guardarEdicion() {
    if (!editando) return;
    setGuardandoEdit(true);
    try {
      const saldoAnterior   = parseFloat(editSaldo)    || 0;
      const ingresoEfectivo = parseFloat(editIngreso)  || 0;
      const depositoVal     = parseFloat(editDeposito) || 0;
      const cajaChicaVal    = parseFloat(editCaja)     || 0;
      const retiroCajaVal   = parseFloat(editRetiroCaja) || 0;
      const cajaChicaNeto   = cajaChicaVal - retiroCajaVal;  // solo para acumulado

      // EXP editables (el usuario pudo borrar algunos) + FAC/GTO intactos
      const facAuto = (editando.renovaciones || []).filter((rv: any) =>
        rv.descripcion?.match(/^(FAC|GTO)\s/i)
      );
      const renovAuto = [...editExpItems, ...facAuto];
      const gastosExtra = editGastos.filter(g => g.desc.trim()).map(g => ({
        descripcion: g.desc.trim(),
        monto: parseFloat(g.monto) || 0,
      }));
      const renovaciones = [...renovAuto, ...gastosExtra];
      const totalRenov   = renovaciones.reduce((s, r) => s + r.monto, 0);
      const totalEntrada = saldoAnterior + editando.cobroDia + ingresoEfectivo;
      const totalSalida  = depositoVal + cajaChicaVal + totalRenov;  // retiro es movimiento interno, no afecta total
      const saldoFinal   = totalEntrada - totalSalida;

      // ── Recalcular caja chica acumulada para esta fecha ──
      const cajaChicaPrevia = historial
        .filter((r: any) => (r.created_by || '') === (editando.created_by || '') && r.id !== editando.id && r.fecha < editando.fecha)
        .reduce((s: number, r: any) => s + ((r.cajaChica || 0) - (r.retiroCajaChica || 0)), 0);
      const cajaChicaAcum = cajaChicaPrevia + cajaChicaNeto;

      await updateDoc(doc(db, col('reportes_diarios'), editando.id), {
        zona: editZona, saldoAnterior, ingresoEfectivo,
        deposito: depositoVal, cajaChica: cajaChicaVal, retiroCajaChica: retiroCajaVal,
        retiroCajaRazon: editRetiroCajaRazon.trim(),
        cajaChicaAcum,
        renovaciones, totalEntrada, totalSalida, saldoFinal,
      });
      setEditando(null);
      await cargarHistorial();
    } catch (e: any) {
      window.alert('Error al guardar: ' + (e?.message || String(e)));
    }
    setGuardandoEdit(false);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  /* ── Cargar historial ─────────────────────────────────── */
  useFocusEffect(useCallback(() => {
    cargarHistorial();
  }, [perfil?.id, isSupervisor]));

  async function cargarHistorial() {
    try {
      const constraints: any[] = [orderBy('fecha', 'desc')];
      if (!isSupervisor && perfil?.id) constraints.unshift(where('created_by', '==', perfil.id));
      const snap = await getDocs(query(collection(db, col('reportes_diarios')), ...constraints));
      setHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  }

  /* ── Caja chica acumulada (fallback para reportes antiguos sin el campo) ── */
  function cajaChicaAcumFor(r: any): number {
    if (r.cajaChicaAcum != null) return r.cajaChicaAcum;
    return historial
      .filter((h: any) => (h.created_by || '') === (r.created_by || '') && h.fecha <= r.fecha)
      .reduce((s: number, h: any) => s + (h.cajaChica || 0) - (h.retiroCajaChica || 0), 0);
  }

  /* ── Navegar fecha ─────────────────────────────────────── */
  function cambiarDia(delta: number) {
    const d = new Date(fechaRep + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const nueva = d.toISOString().split('T')[0];
    if (nueva <= hoyStr) { setFechaRep(nueva); setFechaInput(nueva); }
  }

  function confirmarFecha() {
    const v = fechaInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= hoyStr) setFechaRep(v);
    else setFechaInput(fechaRep);
    setEditandoFecha(false);
  }

  /* ── Parsear renovaciones ──────────────────────────────── */
  function parsearRenovaciones(txt: string) {
    return txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^(.*?)\s+([\d.]+)$/);
      return m ? { descripcion: m[1].trim(), monto: parseFloat(m[2]) } : { descripcion: l, monto: 0 };
    });
  }

  /* ── Generar y guardar reporte ─────────────────────────── */
  async function generarReporte() {
    setModal(false);
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, col('prestamos')), where('estado', 'in', ['activo', 'mora', 'completado']))
      );
      const prestamos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo));
      const pagosResults = await Promise.all(
        prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))
      );

      let cobroDia = 0;
      for (const ps of pagosResults)
        for (const pd of ps.docs) {
          const pg = pd.data() as Pago;
          if (pg.fecha_pago === fechaRep) cobroDia += pg.monto_pagado;
        }
      try {
        const multasSnap = await getDocs(query(collection(db, col('multas')), where('fecha', '==', fechaRep)));
        multasSnap.docs.forEach(d => { cobroDia += (d.data().monto || 0); });
      } catch (_) {}

      // ── Préstamos desembolsados hoy (usan fecha_desembolso; fallback a fecha_inicio para préstamos viejos) ──
      const [snapDesembolso, snapFechaInicio, clientesSnap, facturasSnap, gastosContabSnap] = await Promise.all([
        getDocs(query(collection(db, col('prestamos')), where('fecha_desembolso', '==', fechaRep))),
        getDocs(query(collection(db, col('prestamos')), where('fecha_inicio', '==', fechaRep))),
        getDocs(collection(db, col('clientes'))),
        getDocs(query(collection(db, col('facturas')), where('fecha', '==', fechaRep))),
        getDocs(query(collection(db, col('gastos')), where('fecha', '==', fechaRep))),
      ]);
      // Unir ambas queries sin duplicados
      const idsVistos = new Set<string>();
      const nuevosPrestamoSnap = { docs: [...snapDesembolso.docs, ...snapFechaInicio.docs].filter(d => {
        if (idsVistos.has(d.id)) return false;
        idsVistos.add(d.id);
        return true;
      })};
      const clienteMap: Record<string, any> = {};
      clientesSnap.docs.forEach(d => { clienteMap[d.id] = d.data(); });

      const renovacionesAuto = nuevosPrestamoSnap.docs.map(d => {
        const p = d.data();
        const c = clienteMap[p.cliente_id];
        const rawExp = c?.numero_expediente || '';
        const numExp = rawExp.replace(/^EXP-?/i, '').trim();
        const exp = numExp ? `EXP ${numExp}` : 'NUEVO';
        const nombre = c?.nombre ? c.nombre.split(' ').slice(0,2).join(' ') : '';
        return { descripcion: `${exp} ${nombre}`.trim(), monto: p.monto || 0 };
      });

      // ── Facturas/gastos del día (salidas automáticas) ──
      const facturasAuto = facturasSnap.docs.map(d => {
        const f = d.data();
        return { descripcion: `FAC ${f.descripcion}`, monto: f.monto || 0 };
      });

      // ── Gastos de Contabilidad del día (salidas automáticas) ──
      const gastosContabAuto = gastosContabSnap.docs.map(d => {
        const g = d.data();
        return { descripcion: `GTO ${g.descripcion}`, monto: g.monto || 0 };
      });

      // Gastos manuales (cabezal, pagos extra, etc.)
      const gastosExtra = gastosItems.filter(g => g.desc.trim()).map(g => ({
        descripcion: g.desc.trim(),
        monto: parseFloat(g.monto) || 0,
      }));
      const renovaciones = [...renovacionesAuto, ...facturasAuto, ...gastosContabAuto, ...gastosExtra];
      const saldoAnterior  = parseFloat(saldoAnt)    || 0;
      const ingresoEfectivo = parseFloat(ingresoEfec) || 0;
      const depositoVal    = parseFloat(deposito)    || 0;
      const cajaChicaVal   = parseFloat(cajaChica)   || 0;
      const retiroCajaVal  = parseFloat(retiroCaja)  || 0;
      const cajaChicaNeto  = cajaChicaVal - retiroCajaVal;  // solo para acumulado
      const totalRenov     = renovaciones.reduce((s, r) => s + r.monto, 0);
      const totalEntrada   = saldoAnterior + cobroDia + ingresoEfectivo;
      const totalSalida    = depositoVal + cajaChicaVal + totalRenov;  // retiro es movimiento interno, no afecta total
      const saldoFinal     = totalEntrada - totalSalida;

      // ── Caja chica acumulada (suma de días anteriores + hoy) ──
      const cajaChicaPrevia = historial
        .filter((r: any) => (r.created_by || '') === (perfil?.id || '') && r.fecha < fechaRep)
        .reduce((s: number, r: any) => s + (r.cajaChica || 0) - (r.retiroCajaChica || 0), 0);
      const cajaChicaAcum = cajaChicaPrevia + cajaChicaNeto;

      pe.pedir(async (nombre) => {
      // ── 1. Firestore PRIMERO (siempre se guarda) ──
      await addDoc(collection(db, col('reportes_diarios')), {
        fecha: fechaRep, cobrador: nombre,
        ruta: perfil?.ruta?.nombre || zona || 'General',
        zona, saldoAnterior, cobroDia, ingresoEfectivo,
        deposito: depositoVal, cajaChica: cajaChicaVal, retiroCajaChica: retiroCajaVal,
        retiroCajaRazon: retiroCajaRazon.trim(),
        cajaChicaAcum,
        totalEntrada, totalSalida, saldoFinal,
        renovaciones, created_at: new Date().toISOString(),
        created_by: perfil?.id || '',
      });
      await cargarHistorial();
      Alert.alert('✅ Guardado', 'Reporte guardado en el historial.');

      // ── 2. PDF (independiente — si falla no afecta el guardado) ──
      try {
        const uri = await generarPDFReporteDiario(
          fechaRep, cobroDia, saldoAnterior,
          nombre, perfil?.ruta?.nombre || zona || 'General', zona, renovaciones,
          ingresoEfectivo, depositoVal, cajaChicaVal, cajaChicaAcum,
          retiroCajaRazon.trim(), retiroCajaVal
        );
        await compartir(uri);
      } catch (ePdf) { console.warn('PDF error:', ePdf); }

      // ── 3. Excel (independiente) ──
      try {
        await guardarReporteDiario({
          fecha: fechaRep, cobrador: nombre,
          ruta: perfil?.ruta?.nombre || zona || 'General',
          zona, saldoAnterior, cobroDia,
          ingresoEfectivo, deposito: depositoVal, cajaChica: cajaChicaVal,
          retiroCajaChica: retiroCajaVal, retiroCajaRazon: retiroCajaRazon.trim(),
          renovaciones,
        });
      } catch (eXls) { console.warn('Excel error:', eXls); }
      });

    } catch (e: any) {
      console.error(e);
      Alert.alert('❌ Error al guardar', String(e?.message || e));
    }
    setLoading(false);
  }

  /* ── Borrar reporte (solo admin/supervisor) ────────────── */
  async function borrarReporte(r: any) {
    const ok = window.confirm(`¿Eliminar el reporte del ${formatFecha(r.fecha)} de ${r.cobrador}?\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, col('reportes_diarios'), r.id));
      await cargarHistorial();
    } catch (e: any) {
      window.alert('Error al eliminar: ' + (e?.message || String(e)));
    }
  }

  /* ── Selección múltiple para imprimir ─────────────────── */
  function toggleSeleccion(id: string) {
    setSelec(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) return prev; // máximo 3 reportes
      return [...prev, id];
    });
  }

  function cancelarSeleccion() {
    setModoSel(false);
    setSelec([]);
  }

  async function imprimirSeleccionados() {
    if (seleccionados.length === 0) return;
    setLoading(true);
    try {
      const reportes = seleccionados
        .map(id => historial.find(r => r.id === id))
        .filter(Boolean)
        .map(r => ({
          fecha: r.fecha, cobroDia: r.cobroDia, saldoAnterior: r.saldoAnterior,
          cobrador: r.cobrador, ruta: r.ruta, zona: r.zona || '',
          renovaciones: r.renovaciones || [],
          ingresoEfectivo: r.ingresoEfectivo || 0,
          deposito: r.deposito || 0, cajaChica: r.cajaChica || 0,
          retiroCajaRazon: r.retiroCajaRazon || '', retiroCajaChica: r.retiroCajaChica || 0,
          cajaChicaAcum: cajaChicaAcumFor(r),
          created_by: r.created_by || '',
        }));
      const uri = await generarPDFReportesJuntos(reportes);
      await compartir(uri);
      cancelarSeleccion();
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  /* ── Regenerar PDF del historial ───────────────────────── */
  async function regenerarPDF(r: any) {
    setLoading(true);
    try {
      const uri = await generarPDFReporteDiario(
        r.fecha, r.cobroDia, r.saldoAnterior,
        r.cobrador, r.ruta, r.zona || '', r.renovaciones || [],
        r.ingresoEfectivo || 0, r.deposito || 0, r.cajaChica || 0, cajaChicaAcumFor(r),
        r.retiroCajaRazon || '', r.retiroCajaChica || 0
      );
      await compartir(uri);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={s.titulo}>📊 Reporte Diario de Disponible</Text>

      {/* ── Modal: Cobrador del Reporte Diario ── */}
      <ModalPersonaEntrega
        visible={pe.visible}
        usuarios={pe.usuarios}
        value={pe.valor}
        onChange={pe.setValor}
        onConfirm={pe.confirmar}
        onCancel={pe.cancelar}
        loading={pe.loading}
        primaryColor={C.primaryText}
        titulo="¿A nombre de quién va este reporte?"
        subtitulo='Este nombre aparecerá como "Cobrador" en el reporte diario.'
      />

      {/* ── Selector de fecha ───────────────────────────── */}
      <Card style={s.card} elevation={0}>
        <Card.Content>
          <Text style={s.secLabel}>📅 Fecha del reporte</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Button mode="outlined" compact icon="chevron-left" onPress={() => cambiarDia(-1)}
              textColor={C.primaryText} style={{ borderColor: C.border, minWidth: 40 }}>{''}</Button>
            {editandoFecha ? (
              <TextInput value={fechaInput} onChangeText={setFechaInput} mode="outlined"
                style={{ flex: 1, height: 38, fontSize: 14 }} dense autoFocus
                onBlur={confirmarFecha} onSubmitEditing={confirmarFecha}/>
            ) : (
              <Button mode="text" compact onPress={() => { setFechaInput(fechaRep); setEditandoFecha(true); }}
                textColor={C.primaryText} style={{ flex: 1 }}>
                {fechaRep === hoyStr ? `${fechaRep}  (Hoy)` : fechaRep}
              </Button>
            )}
            <Button mode="outlined" compact icon="chevron-right" onPress={() => cambiarDia(1)}
              disabled={fechaRep >= hoyStr} textColor={C.primaryText}
              style={{ borderColor: C.border, minWidth: 40 }}>{''}</Button>
          </View>
          {fechaRep !== hoyStr && (
            <Button compact mode="text" onPress={() => { setFechaRep(hoyStr); setFechaInput(hoyStr); }}
              textColor={C.textTer} style={{ alignSelf: 'flex-end', marginTop: 2 }}>
              Volver a hoy
            </Button>
          )}
        </Card.Content>
      </Card>

      {/* ── Botón generar ───────────────────────────────── */}
      <Card style={s.card} elevation={1}>
        <Card.Content style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={s.iconBox}>
            <MaterialCommunityIcons name="cash-clock" size={28} color="#e65100"/>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTit}>Generar Reporte</Text>
            <Text style={s.cardDesc}>
              Calcula cobro del día automáticamente. Genera PDF + Excel y guarda en el historial.
            </Text>
            <Button mode="contained" onPress={() => setModal(true)} loading={loading}
              disabled={loading} style={{ marginTop: 10, backgroundColor: '#e65100', borderRadius: 8 }}>
              Generar Reporte del {fechaRep === hoyStr ? 'Día' : fechaRep}
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* ── Historial ───────────────────────────────────── */}
      <Card style={s.card} elevation={1}>
        <Card.Content>
          <TouchableOpacity
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            onPress={() => setVerH(v => !v)}>
            <Text style={s.cardTit}>
              📋 Historial {historial.length > 0 ? `(${historial.length} reportes)` : ''}
            </Text>
            <MaterialCommunityIcons name={verHistorial ? 'chevron-up' : 'chevron-down'}
              size={20} color={C.primaryText}/>
          </TouchableOpacity>
          {verHistorial && historial.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {modoSeleccion ? (
                <>
                  <Button mode="contained" compact icon="printer"
                    onPress={imprimirSeleccionados}
                    disabled={seleccionados.length === 0 || loading}
                    loading={loading}
                    buttonColor="#1b5e20" textColor="#fff"
                    style={{ flex: 1, borderRadius: 8 }}>
                    Imprimir {seleccionados.length > 0 ? `(${seleccionados.length})` : ''}
                  </Button>
                  <Button mode="outlined" compact onPress={cancelarSeleccion}
                    textColor={C.textSec} style={{ borderColor: C.border, borderRadius: 8 }}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button mode="outlined" compact icon="checkbox-multiple-marked-outline"
                  onPress={() => setModoSel(true)}
                  textColor="#1b5e20" style={{ borderColor: '#1b5e20', borderRadius: 8 }}>
                  Seleccionar para imprimir
                </Button>
              )}
            </View>
          )}

          {verHistorial && (
            <>
              <Divider style={{ marginVertical: 10 }}/>
              {historial.length === 0 ? (
                <Text style={{ color: C.textTer, fontSize: 12, textAlign: 'center', paddingVertical: 16 }}>
                  Aún no hay reportes guardados.{'\n'}Genera el primero arriba.
                </Text>
              ) : historial.map((r, i) => (
                <StaggerItem key={r.id} index={Math.min(i,8)} step={45}>
                  <TouchableOpacity
                    onPress={() => modoSeleccion ? toggleSeleccion(r.id) : undefined}
                    activeOpacity={modoSeleccion ? 0.6 : 1}
                    style={modoSeleccion && seleccionados.includes(r.id)
                      ? { backgroundColor: '#1b5e2014', borderRadius: 8 } : {}}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }}>
                    {modoSeleccion && (
                      <View style={{
                        width: 22, height: 22, borderRadius: 5, borderWidth: 2,
                        borderColor: seleccionados.includes(r.id) ? '#1b5e20' : C.border,
                        backgroundColor: seleccionados.includes(r.id) ? '#1b5e20' : 'transparent',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {seleccionados.includes(r.id) && (
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>✓</Text>
                        )}
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: C.text, fontSize: 14 }}>
                        {formatFecha(r.fecha)}
                        {r.zona ? `  ·  ${r.zona}` : ''}
                      </Text>
                      <Text style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>
                        {r.cobrador}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        <View style={s.statChip}>
                          <Text style={s.statLabel}>Saldo Ant.</Text>
                          <Text style={s.statVal}>{formatMoneda(r.saldoAnterior)}</Text>
                        </View>
                        <View style={s.statChip}>
                          <Text style={s.statLabel}>Cobro Día</Text>
                          <Text style={[s.statVal, { color: C.success }]}>{formatMoneda(r.cobroDia)}</Text>
                        </View>
                        {r.ingresoEfectivo > 0 && (
                          <View style={s.statChip}>
                            <Text style={s.statLabel}>Ing. Ef.</Text>
                            <Text style={[s.statVal, { color: '#42a5f5' }]}>{formatMoneda(r.ingresoEfectivo)}</Text>
                          </View>
                        )}
                        <View style={s.statChip}>
                          <Text style={s.statLabel}>Total Ent.</Text>
                          <Text style={[s.statVal, { color: '#e65100' }]}>{formatMoneda(r.totalEntrada)}</Text>
                        </View>
                        <View style={s.statChip}>
                          <Text style={s.statLabel}>Saldo</Text>
                          <Text style={[s.statVal, { color: '#c8a951' }]}>{formatMoneda(r.saldoFinal)}</Text>
                        </View>
                      </View>
                      {r.renovaciones?.length > 0 && (
                        <Text style={{ fontSize: 10, color: C.textTer, marginTop: 3 }}>
                          {r.renovaciones.map((rv: any) => rv.descripcion).join(', ')}
                        </Text>
                      )}
                      {(r.retiroCajaChica || 0) > 0 && (
                        <View style={{ flexDirection:'row', alignItems:'center', gap:4, marginTop:3,
                          backgroundColor:'#e65100' + '15', borderRadius:6,
                          paddingHorizontal:6, paddingVertical:3, alignSelf:'flex-start' }}>
                          <Text style={{ fontSize:10, color:'#e65100', fontWeight:'700' }}>
                            🏧 Retiro caja: {formatMoneda(r.retiroCajaChica)}
                          </Text>
                          {r.retiroCajaRazon ? (
                            <Text style={{ fontSize:10, color:'#e65100' }}>
                              — {r.retiroCajaRazon}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                    {!modoSeleccion && (
                      <View style={{ gap: 6 }}>
                        <Button mode="outlined" compact onPress={() => regenerarPDF(r)}
                          disabled={loading} textColor="#e65100"
                          style={{ borderColor: '#e65100', borderRadius: 8 }}>
                          PDF
                        </Button>
                        {isSupervisor && (
                          <Button mode="outlined" compact onPress={() => abrirEdicion(r)}
                            disabled={loading} textColor="#42a5f5"
                            style={{ borderColor: '#42a5f5', borderRadius: 8 }}>
                            Editar
                          </Button>
                        )}
                        {isSupervisor && (
                          <Button mode="outlined" compact onPress={() => borrarReporte(r)}
                            disabled={loading} textColor="#ef5350"
                            style={{ borderColor: '#ef5350', borderRadius: 8 }}>
                            Borrar
                          </Button>
                        )}
                      </View>
                    )}
                  </View>
                  </TouchableOpacity>
                  {i < historial.length - 1 && <Divider/>}
                </StaggerItem>
              ))}
            </>
          )}
        </Card.Content>
      </Card>

      {/* ── Modal edición ────────────────────────────────── */}
      {!!editando && (
        <View style={s.overlay} pointerEvents="box-none">
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            <Text style={s.modalTit}>✏️ Editar Reporte</Text>
            {editando && (
              <Text style={{ color: C.textSec, fontSize: 12, marginBottom: 10 }}>
                {formatFecha(editando.fecha)} · {editando.cobrador}
              </Text>
            )}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always">
              <Text style={{ color: '#4caf50', fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 }}>▲ ENTRADAS</Text>
              <TextInput label="Saldo anterior ($)" value={editSaldo} onChangeText={setEditSaldo}
                mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
              <TextInput label="Ingreso de efectivo ($)" value={editIngreso} onChangeText={setEditIngreso}
                mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
              <TextInput label="Zona" value={editZona} onChangeText={setEditZona}
                mode="outlined" style={{ marginBottom: 12 }}/>

              <Text style={{ color: '#ef5350', fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 }}>▼ SALIDAS</Text>
              <TextInput label="Depósito ($)" value={editDeposito} onChangeText={setEditDeposito}
                mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
              <TextInput label="Caja Chica ($)" value={editCaja} onChangeText={setEditCaja}
                mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
              <TextInput label="Retiro de Caja Chica ($)" value={editRetiroCaja} onChangeText={setEditRetiroCaja}
                mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 6 }}/>
              {(parseFloat(editRetiroCaja) || 0) > 0 && (
                <TextInput label="Razón del retiro de caja chica" value={editRetiroCajaRazon}
                  onChangeText={setEditRetiroCajaRazon} mode="outlined" style={{ marginBottom: 8 }}
                  placeholder="Ej: compra de materiales, pago de servicio..."/>
              )}
              {!(parseFloat(editRetiroCaja) || 0) && <View style={{ marginBottom: 8 }}/>}

              <Text style={{ color: C.textTer, fontSize: 10, marginBottom: 6 }}>
                Préstamos EXP (toca 🗑️ para quitar del reporte):
              </Text>
              {editExpItems.map((rv, i) => (
                <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  backgroundColor:'#1565c018', borderRadius:6, paddingHorizontal:10, paddingVertical:6, marginBottom:4 }}>
                  <Text style={{ fontSize:12, color:'#1565c0', fontWeight:'600', flex:1 }}>
                    📋 {rv.descripcion}
                  </Text>
                  <Text style={{ fontSize:12, color:'#1565c0', fontWeight:'700', marginRight:10 }}>${rv.monto.toFixed(2)}</Text>
                  <TouchableOpacity onPress={() => setEditExpItems(editExpItems.filter((_,j) => j!==i))}>
                    <MaterialCommunityIcons name="delete-outline" size={18} color="#ef5350"/>
                  </TouchableOpacity>
                </View>
              ))}
              {/* Facturas automáticas — solo lectura */}
              {(editando?.renovaciones || []).filter((rv: any) => rv.descripcion?.match(/^FAC\s/i)).map((rv: any, i: number) => (
                <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  backgroundColor:'#7c4dff18', borderRadius:6, paddingHorizontal:10, paddingVertical:6, marginBottom:4 }}>
                  <Text style={{ fontSize:12, color:'#7c4dff', fontWeight:'600' }}>
                    🧾 {rv.descripcion.replace(/^FAC\s/i, '')}
                  </Text>
                  <Text style={{ fontSize:12, color:'#7c4dff', fontWeight:'700' }}>${rv.monto.toFixed(2)}</Text>
                </View>
              ))}
              <Text style={{ color: C.textTer, fontSize: 10, marginBottom: 6, marginTop: 4 }}>
                Gastos extras:
              </Text>
              {editGastos.map((g, i) => (
                <View key={i} style={{ flexDirection:'row', gap:6, marginBottom:6, alignItems:'center' }}>
                  <TextInput label="Descripción" value={g.desc} mode="outlined" style={{ flex:2 }}
                    onChangeText={v => { const arr=[...editGastos]; arr[i]={...arr[i],desc:v}; setEditGastos(arr); }}/>
                  <TextInput label="Monto $" value={g.monto} mode="outlined"
                    keyboardType="decimal-pad" style={{ flex:1 }}
                    onChangeText={v => { const arr=[...editGastos]; arr[i]={...arr[i],monto:v}; setEditGastos(arr); }}/>
                  {editGastos.length > 1 && (
                    <TouchableOpacity onPress={() => setEditGastos(editGastos.filter((_,j)=>j!==i))}>
                      <MaterialCommunityIcons name="close-circle" size={22} color="#ef5350"/>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <Button mode="text" compact icon="plus" textColor={C.primaryText}
                onPress={() => setEditGastos([...editGastos, {desc:'',monto:''}])}
                style={{ alignSelf:'flex-start', marginBottom: 10 }}>
                Agregar gasto
              </Button>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Button mode="outlined" onPress={() => setEditando(null)} style={{ flex: 1 }} disabled={guardandoEdit}>
                Cancelar
              </Button>
              <Button mode="contained" onPress={guardarEdicion} loading={guardandoEdit}
                style={{ flex: 1, backgroundColor: '#42a5f5' }}>
                Guardar cambios
              </Button>
            </View>
          </View>
        </View>
      )}

      {/* ── Modal formulario ──────────────────────────────── */}
      {modalAbierto && (
        <View style={s.overlay} pointerEvents="box-none">
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            <Text style={s.modalTit}>📊 Reporte Diario</Text>
            <Text style={{ color: C.textSec, fontSize: 12, marginBottom: 10 }}>
              Fecha: <Text style={{ fontWeight: '700', color: C.primaryText }}>{fechaRep}</Text>
              {fechaRep === hoyStr ? '  (Hoy)' : ''}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always">
            <Text style={{ color: '#4caf50', fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 }}>
              ▲ ENTRADAS
            </Text>
            <TextInput label="Saldo anterior ($)" value={saldoAnt} onChangeText={setSaldoAnt}
              mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
            <TextInput label="Ingreso de efectivo ($)" value={ingresoEfec} onChangeText={setIngresoEfec}
              mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
            <TextInput label="Zona" value={zona} onChangeText={setZona}
              mode="outlined" style={{ marginBottom: 12 }}/>
            <Text style={{ color: '#ef5350', fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 }}>
              ▼ SALIDAS
            </Text>
            <TextInput label="Depósito ($)" value={deposito} onChangeText={setDeposito}
              mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 8 }}/>
            <View style={{ flexDirection:'row', alignItems:'center', marginBottom: 8, gap: 6 }}>
              <TextInput label="Caja Chica ($)" value={cajaChica} onChangeText={setCajaChica}
                mode="outlined" keyboardType="decimal-pad" style={{ flex: 1 }}/>
              <TouchableOpacity onPress={guardarFondo} style={{
                backgroundColor: 'rgba(200,169,81,0.15)', borderRadius: 8,
                borderWidth: 1, borderColor: 'rgba(200,169,81,0.4)',
                padding: 10, alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name="content-save-outline" size={20} color="#c8a951"/>
                <Text style={{ fontSize: 9, color: '#c8a951', marginTop: 2 }}>Fondo</Text>
              </TouchableOpacity>
            </View>
            <TextInput label="Retiro de Caja Chica ($)" value={retiroCaja} onChangeText={setRetiroCaja}
              mode="outlined" keyboardType="decimal-pad" style={{ marginBottom: 6 }}/>
            {(parseFloat(retiroCaja) || 0) > 0 && (
              <TextInput label="Razón del retiro de caja chica" value={retiroCajaRazon}
                onChangeText={setRetiroCajaRazon} mode="outlined" style={{ marginBottom: 8 }}
                placeholder="Ej: compra de materiales, pago de servicio..."/>
            )}
            {!(parseFloat(retiroCaja) || 0) && <View style={{ marginBottom: 8 }}/>}
            <Text style={{ color: C.textTer, fontSize: 10, marginBottom: 8 }}>
              Los préstamos creados hoy se agregan automáticamente.{'\n'}
              Agrega aquí solo gastos extras (cabezal, honorarios, etc.):
            </Text>
            {gastosItems.map((g, i) => (
              <View key={i} style={{ flexDirection:'row', gap:6, marginBottom:6, alignItems:'center' }}>
                <TextInput
                  label="Descripción" value={g.desc} mode="outlined"
                  style={{ flex:2 }}
                  onChangeText={v => {
                    const arr = [...gastosItems]; arr[i] = {...arr[i], desc:v}; setGastosItems(arr);
                  }}/>
                <TextInput
                  label="Monto $" value={g.monto} mode="outlined"
                  keyboardType="decimal-pad" style={{ flex:1 }}
                  onChangeText={v => {
                    const arr = [...gastosItems]; arr[i] = {...arr[i], monto:v}; setGastosItems(arr);
                  }}/>
                {gastosItems.length > 1 && (
                  <TouchableOpacity onPress={() => setGastosItems(gastosItems.filter((_,j)=>j!==i))}>
                    <MaterialCommunityIcons name="close-circle" size={22} color="#ef5350"/>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <Button mode="text" compact icon="plus" textColor={C.primaryText}
              onPress={() => setGastosItems([...gastosItems, {desc:'',monto:''}])}
              style={{ alignSelf:'flex-start', marginBottom: 10 }}>
              Agregar gasto
            </Button>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Button mode="outlined" onPress={() => setModal(false)} style={{ flex: 1 }}>Cancelar</Button>
              <Button mode="contained" onPress={generarReporte} loading={loading}
                style={{ flex: 1, backgroundColor: '#e65100' }}>
                Generar y Guardar
              </Button>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:  { flex: 1, backgroundColor:C.bg, ...w(glassBgStyle(C)) },
  titulo:     { fontSize: 18, fontWeight: '800', color: C.primaryText, marginBottom: 16 },
  card:       { marginBottom: 12, borderRadius: 12, ...glassStyle(C) },
  secLabel:   { fontSize: 11, color: C.textSec, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
  iconBox:    { width: 52, height: 52, borderRadius: 12, backgroundColor: '#e6510022',
                justifyContent: 'center', alignItems: 'center' },
  cardTit:    { fontSize: 14, fontWeight: '700', color: C.text },
  cardDesc:   { fontSize: 11, color: C.textTer, marginTop: 2 },
  statChip:   { alignItems: 'center', backgroundColor: C.surfaceCard, borderRadius: 8,
                paddingHorizontal: 8, paddingVertical: 4 },
  statLabel:  { fontSize: 9, color: C.textTer, textTransform: 'uppercase' },
  statVal:    { fontSize: 13, fontWeight: '700', color: C.text },
  overlay:    { ...(Platform.OS === 'web' ? { position: 'fixed' as any } : { position: 'absolute' }),
                top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
                backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 24 },
  modalBox:   { borderRadius: 16, padding: 20, backgroundColor: C.surface,
                borderWidth: 1, borderColor: C.border },
  modalTit:   { fontSize: 16, fontWeight: '800', color: C.primaryText, marginBottom: 8 },
});
