import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, Alert, TouchableOpacity,
} from 'react-native';
import { Text, Card, Button, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, query, where, getDocs, orderBy, addDoc, serverTimestamp, limit } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle } from '../../../src/theme';
const w = (s: any) => s;
import { formatMoneda, hoy } from '../../../src/utils/calculos';

/* ── Abreviaturas de mes en español ───────────────────────────────── */
const MESES_ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MESES_LABEL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function labelFecha(fechaISO: string): string {
  // "2024-04-06" → "6-abr"
  if (!fechaISO) return '';
  const parts = fechaISO.split('-');
  if (parts.length < 3) return fechaISO;
  const day = parseInt(parts[2], 10);
  const mon = parseInt(parts[1], 10) - 1;
  return `${day}-${MESES_ABR[mon] || ''}`;
}

const FILAS_Q1 = 15; // días 1-15 (siempre fijo)
// FILAS_Q2 se calcula dentro del componente según los días reales del mes

interface Fila { fecha: string; monto: string; }
const filaVacia = (): Fila => ({ fecha: '', monto: '' });
const filasVacias = (n: number) => Array.from({ length: n }, filaVacia);

function diasDelMes(anio: number, mes: number) {
  return new Date(anio, mes, 0).getDate(); // ej: June → 30, Jan → 31
}

function numOr0(s: string) { const n = parseFloat(s); return isNaN(n) ? 0 : n; }

export default function CuadroCobrador() {
  const { col, empresa } = useEmpresa();
  const { perfil, isSupervisor } = useAuth();
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  const hoyStr = hoy();
  const hoyDate = new Date(hoyStr + 'T00:00:00');

  const [anio, setAnio]   = useState(hoyDate.getFullYear());
  const [mes, setMes]     = useState(hoyDate.getMonth() + 1); // 1-12

  const [cobrador, setCobrador] = useState(perfil?.nombre || '');
  const [ruta, setRuta]         = useState(perfil?.ruta?.nombre || '');
  const [carteraAnt, setCarteraAnt] = useState('');
  const [carteraAct, setCarteraAct] = useState('');
  const [moraAmt, setMoraAmt]       = useState('');

  // Q2 dinámico: días 16..fin-de-mes (15 para meses de 30 días, 16 para meses de 31)
  const filasQ2 = useMemo(() => diasDelMes(anio, mes) - 15, [anio, mes]);
  const filasMax = Math.max(FILAS_Q1, filasQ2);

  const [q1, setQ1] = useState<Fila[]>(filasVacias(FILAS_Q1));
  const [q2, setQ2] = useState<Fila[]>(() => filasVacias(diasDelMes(hoyDate.getFullYear(), hoyDate.getMonth() + 1) - 15));

  const [cargando, setCargando]   = useState(false);
  const [exportando, setExport]   = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<any[]>([]);
  const [cargandoHist, setCargandoHist] = useState(false);

  /* ── Pre-llenar del Reporte Diario ──────────────────────────── */
  async function preLlenar() {
    setCargando(true);
    try {
      const prefijo = `${anio}-${String(mes).padStart(2,'0')}`;
      const snap = await getDocs(
        query(
          collection(db, col('reportes_diarios')),
          where('fecha', '>=', `${prefijo}-01`),
          where('fecha', '<=', `${prefijo}-31`),
          orderBy('fecha', 'asc')
        )
      );

      const myUid = perfil?.id || '';
      const reportes = snap.docs
        .map(d => d.data() as any)
        .filter(r => {
          // Filtrar por uid del usuario actual — más confiable que comparar
          // el campo "cobrador" (que guarda la persona que entrega, no el uid)
          if (!myUid) return true; // sin uid → mostrar todo (admin)
          if (r.created_by && r.created_by === myUid) return true;
          // Fallback: si el registro no tiene created_by (datos viejos), incluir
          if (!r.created_by) return true;
          return false;
        });

      // Separar Q1 (días 1-15) y Q2 (días 16-31)
      const q1Map: Record<string, number> = {};
      const q2Map: Record<string, number> = {};

      reportes.forEach(r => {
        const dia = parseInt((r.fecha || '').split('-')[2] || '0', 10);
        const monto = r.cobroDia || 0;
        if (dia >= 1 && dia <= 15) q1Map[r.fecha] = (q1Map[r.fecha] || 0) + monto;
        else if (dia >= 16)        q2Map[r.fecha] = (q2Map[r.fecha] || 0) + monto;
      });

      // Construir arrays (Q1: 15 filas, Q2: según días del mes)
      const q2n = diasDelMes(anio, mes) - 15;
      const q1Nuevo = filasVacias(FILAS_Q1);
      const q1Keys = Object.keys(q1Map).sort();
      q1Keys.slice(0, FILAS_Q1).forEach((fecha, i) => {
        q1Nuevo[i] = { fecha: labelFecha(fecha), monto: String(q1Map[fecha]) };
      });

      const q2Nuevo = filasVacias(q2n);
      const q2Keys = Object.keys(q2Map).sort();
      q2Keys.slice(0, q2n).forEach((fecha, i) => {
        q2Nuevo[i] = { fecha: labelFecha(fecha), monto: String(q2Map[fecha]) };
      });

      setQ1(q1Nuevo);
      setQ2(q2Nuevo);

      if (q1Keys.length === 0 && q2Keys.length === 0) {
        Alert.alert('Sin datos', `No hay reportes diarios para ${MESES_LABEL[mes-1]} ${anio}${cobrador ? ` — cobrador "${cobrador}"` : ''}.`);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || String(e));
    }
    setCargando(false);
  }

  /* ── Historial Firestore ────────────────────────────────────── */
  async function cargarHistorial() {
    setCargandoHist(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, col('cuadros_cobrador')),
          where('mes', '==', mes),
          where('anio', '==', anio),
          orderBy('created_at', 'desc'),
          limit(5)
        )
      );
      setHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (_) { /* Silencioso — no afecta el flujo */ }
    setCargandoHist(false);
  }

  useEffect(() => { cargarHistorial(); }, [mes, anio]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardarEnSistema() {
    setGuardando(true);
    try {
      await addDoc(collection(db, col('cuadros_cobrador')), {
        cobrador:    cobrador.trim(),
        ruta:        ruta.trim(),
        mes,
        mesLabel:    MESES_LABEL[mes - 1],
        anio,
        carteraAnt:  cartAnt,
        carteraAct:  cartAct,
        mora,
        cobroTotal,
        totQ1,
        totQ2,
        diferencia,
        efectividad,
        moraPct,
        q1: q1.map(f => ({ fecha: f.fecha, monto: numOr0(f.monto) })),
        q2: q2.map(f => ({ fecha: f.fecha, monto: numOr0(f.monto) })),
        created_at:  serverTimestamp(),
      });
      await cargarHistorial();
    } catch (e: any) {
      console.warn('Error guardando cuadro:', e?.message);
    }
    setGuardando(false);
  }

  function cargarDesdeHistorial(item: any) {
    setCobrador(item.cobrador || '');
    setRuta(item.ruta || '');
    setCarteraAnt(String(item.carteraAnt || ''));
    setCarteraAct(String(item.carteraAct || ''));
    setMoraAmt(String(item.mora || ''));
    setQ1((item.q1 || []).map((f: any) => ({ fecha: f.fecha || '', monto: String(f.monto || '') })));
    setQ2((item.q2 || []).map((f: any) => ({ fecha: f.fecha || '', monto: String(f.monto || '') })));
    // Rellenar filas vacías si vienen menos de las esperadas
    const q2nHist = diasDelMes(anio, mes) - 15;
    setQ1(prev => { const a = [...prev]; while (a.length < FILAS_Q1) a.push(filaVacia()); return a.slice(0, FILAS_Q1); });
    setQ2(prev => { const a = [...prev]; while (a.length < q2nHist) a.push(filaVacia()); return a.slice(0, q2nHist); });
  }

  /* ── Totales calculados ─────────────────────────────────────── */
  const totQ1 = useMemo(() => q1.reduce((s, f) => s + numOr0(f.monto), 0), [q1]);
  const totQ2 = useMemo(() => q2.reduce((s, f) => s + numOr0(f.monto), 0), [q2]);
  const cobroTotal  = totQ1 + totQ2;
  const cartAnt     = numOr0(carteraAnt);
  const cartAct     = numOr0(carteraAct);
  const diferencia  = cartAnt - cartAct;
  const mora        = numOr0(moraAmt);
  const efectividad = cartAnt > 0 ? (cobroTotal / cartAnt) * 100 : 0;
  const moraPct     = cartAnt > 0 ? (mora / cartAnt) * 100 : 0;

  /* ── Exportar Excel ─────────────────────────────────────────── */
  async function exportarExcel() {
    const api = (window as any).electronAPI;
    if (!api || typeof api.generateCuadroCobrador !== 'function') {
      Alert.alert('Reiniciar requerido', 'Cierra y vuelve a abrir CAS Express para habilitar esta exportación.');
      return;
    }
    setExport(true);
    try {
      const datos = {
        cobrador: cobrador.trim() || 'COBRADOR',
        ruta:     ruta.trim() || '',
        mes:      MESES_LABEL[mes - 1].toUpperCase(),
        anio,
        empresaNombre: empresa.nombre || empresa.nombreCorto,
        carteraAnt:  cartAnt,
        carteraAct:  cartAct,
        mora,
        q1: q1.map(f => ({ fecha: f.fecha, monto: numOr0(f.monto) })),
        q2: q2.map(f => ({ fecha: f.fecha, monto: numOr0(f.monto) })),
      };
      const result = await api.generateCuadroCobrador(datos);
      if (result && !result.saved && result.error) {
        Alert.alert('Error Excel', result.error);
      } else {
        // Guardar copia digital automáticamente al exportar con éxito
        guardarEnSistema();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || String(e));
    }
    setExport(false);
  }

  /* ── Helpers de edición de filas ────────────────────────────── */
  function setQ1Fila(i: number, campo: keyof Fila, val: string) {
    setQ1(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [campo]: val };
      return next;
    });
  }
  function setQ2Fila(i: number, campo: keyof Fila, val: string) {
    setQ2(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [campo]: val };
      return next;
    });
  }

  /* ── Selector de mes ────────────────────────────────────────── */
  function cambiarMes(delta: number) {
    let nm = mes + delta;
    let na = anio;
    if (nm > 12) { nm = 1; na++; }
    if (nm < 1)  { nm = 12; na--; }
    setMes(nm); setAnio(na);
    setQ1(filasVacias(FILAS_Q1));
    setQ2(filasVacias(diasDelMes(na, nm) - 15));
  }

  /* ── UI ─────────────────────────────────────────────────────── */
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* ── Cabecera: cobrador, ruta, mes ─────────────────────── */}
      <Card style={[s.card, glassStyle(C.isDark)]}>
        <Card.Content style={{ gap: 10 }}>
          <View style={s.row2}>
            <TextInput label="Cobrador" value={cobrador} onChangeText={setCobrador}
              mode="outlined" style={{ flex: 1 }} outlineColor={C.border} textColor={C.text}
              left={<TextInput.Icon icon="account" />}/>
            <TextInput label="Ruta / Zona" value={ruta} onChangeText={setRuta}
              mode="outlined" style={{ flex: 1 }} outlineColor={C.border} textColor={C.text}
              left={<TextInput.Icon icon="map-marker" />}/>
          </View>

          {/* Selector de mes */}
          <View style={[s.mesRow]}>
            <TouchableOpacity onPress={() => cambiarMes(-1)} style={s.mesBtn}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={C.primary} />
            </TouchableOpacity>
            <Text style={[s.mesLabel, { color: C.text }]}>
              {MESES_LABEL[mes - 1]} {anio}
            </Text>
            <TouchableOpacity onPress={() => cambiarMes(1)} style={s.mesBtn}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={C.primary} />
            </TouchableOpacity>
            <Button mode="contained" compact onPress={preLlenar} loading={cargando}
              disabled={cargando} style={{ marginLeft: 12, backgroundColor: C.primary, borderRadius: 8 }}
              icon="database-import">
              Pre-llenar del sistema
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* ── Cartera y mora ───────────────────────────────────── */}
      <Card style={[s.card, glassStyle(C.isDark)]}>
        <Card.Content style={{ gap: 10 }}>
          <Text style={[s.secLabel, { color: C.textSub }]}>CARTERA</Text>
          <View style={s.row2}>
            <TextInput label="Cartera anterior ($)" value={carteraAnt} onChangeText={setCarteraAnt}
              mode="outlined" keyboardType="decimal-pad" style={{ flex: 1 }}
              outlineColor={C.border} textColor={C.text}
              left={<TextInput.Icon icon="currency-usd" />}/>
            <TextInput label="Cartera actual ($)" value={carteraAct} onChangeText={setCarteraAct}
              mode="outlined" keyboardType="decimal-pad" style={{ flex: 1 }}
              outlineColor={C.border} textColor={C.text}
              left={<TextInput.Icon icon="currency-usd" />}/>
          </View>
          <View style={s.row2}>
            <TextInput label="Mora ($)" value={moraAmt} onChangeText={setMoraAmt}
              mode="outlined" keyboardType="decimal-pad" style={{ flex: 1 }}
              outlineColor={C.border} textColor={C.text}
              left={<TextInput.Icon icon="alert-circle-outline" />}/>
            <View style={{ flex: 1 }} />
          </View>
        </Card.Content>
      </Card>

      {/* ── Resumen ──────────────────────────────────────────── */}
      <Card style={[s.card, glassStyle(C.isDark)]}>
        <Card.Content>
          <Text style={[s.secLabel, { color: C.textSub, marginBottom: 10 }]}>RESUMEN AUTO-CALCULADO</Text>
          <View style={s.resumeGrid}>
            <ResumeItem label="Cobro Total"   value={formatMoneda(cobroTotal)} color={C.text} C={C} />
            <ResumeItem label="Diferencia cartera" value={formatMoneda(diferencia)} color={diferencia >= 0 ? '#2e7d32' : '#c62828'} C={C} />
            <ResumeItem label="Total Q1"      value={formatMoneda(totQ1)}      color={C.text} C={C} />
            <ResumeItem label="Total Q2"      value={formatMoneda(totQ2)}      color={C.text} C={C} />
            <ResumeItem label="Efectividad"   value={`${efectividad.toFixed(0)}%`} color="#1565c0" C={C} bold />
            <ResumeItem label="Mora %"        value={`${moraPct.toFixed(0)}%`} color={moraPct > 0 ? '#c62828' : '#888'} C={C} bold />
          </View>
        </Card.Content>
      </Card>

      {/* ── Tabla Q1 + Q2 ───────────────────────────────────── */}
      <Card style={[s.card, glassStyle(C.isDark)]}>
        <Card.Content style={{ gap: 0 }}>
          {/* Encabezados */}
          <View style={s.tableHdr}>
            <View style={s.halfHdr}>
              <Text style={[s.hdrLabel, { color: '#fff' }]}>COBRO</Text>
              <Text style={[s.hdrQ, { color: '#fff' }]}>Q1</Text>
            </View>
            <View style={[s.halfHdr, { backgroundColor: C.primary + 'dd' }]}>
              <Text style={[s.hdrLabel, { color: '#fff' }]}>{/* spacer */}</Text>
              <Text style={[s.hdrQ, { color: '#fff' }]}>Q2</Text>
            </View>
          </View>

          {/* Filas — Q1: 15, Q2: días del mes - 15 (dinámico) */}
          {Array.from({ length: filasMax }).map((_, i) => (
            <View key={i} style={[s.tableRow, i % 2 === 0 ? s.rowEven : s.rowOdd]}>
              {/* Q1 */}
              {i < FILAS_Q1 ? (
                <>
                  <TextInput
                    value={q1[i].fecha}
                    onChangeText={v => setQ1Fila(i, 'fecha', v)}
                    placeholder="fecha"
                    mode="flat" dense
                    style={[s.cellInput, s.cellFecha]}
                    contentStyle={{ fontSize: 14, paddingHorizontal: 4 }}
                    outlineColor="transparent" underlineColor="transparent"
                    activeUnderlineColor={C.primary}
                    textColor={C.text}
                  />
                  <TextInput
                    value={q1[i].monto}
                    onChangeText={v => setQ1Fila(i, 'monto', v)}
                    placeholder="$"
                    mode="flat" dense
                    keyboardType="decimal-pad"
                    style={[s.cellInput, s.cellMonto]}
                    contentStyle={{ fontSize: 14, textAlign: 'right', paddingHorizontal: 4 }}
                    outlineColor="transparent" underlineColor="transparent"
                    activeUnderlineColor={C.primary}
                    textColor={C.text}
                  />
                </>
              ) : (
                <><View style={[s.cellInput, s.cellFecha]} /><View style={[s.cellInput, s.cellMonto]} /></>
              )}
              {/* Q2 */}
              {i < filasQ2 ? (
                <>
                  <TextInput
                    value={q2[i].fecha}
                    onChangeText={v => setQ2Fila(i, 'fecha', v)}
                    placeholder="fecha"
                    mode="flat" dense
                    style={[s.cellInput, s.cellFecha, { borderLeftWidth: 1, borderLeftColor: C.border + '44' }]}
                    contentStyle={{ fontSize: 14, paddingHorizontal: 4 }}
                    outlineColor="transparent" underlineColor="transparent"
                    activeUnderlineColor={C.primary}
                    textColor={C.text}
                  />
                  <TextInput
                    value={q2[i].monto}
                    onChangeText={v => setQ2Fila(i, 'monto', v)}
                    placeholder="$"
                    mode="flat" dense
                    keyboardType="decimal-pad"
                    style={[s.cellInput, s.cellMonto]}
                    contentStyle={{ fontSize: 14, textAlign: 'right', paddingHorizontal: 4 }}
                    outlineColor="transparent" underlineColor="transparent"
                    activeUnderlineColor={C.primary}
                    textColor={C.text}
                  />
                </>
              ) : (
                <><View style={[s.cellInput, s.cellFecha, { borderLeftWidth: 1, borderLeftColor: C.border + '44' }]} /><View style={[s.cellInput, s.cellMonto]} /></>
              )}
            </View>
          ))}

          {/* Fila de totales */}
          <View style={[s.tableRow, s.totalRow]}>
            <Text style={[s.totalLabel, { flex: 1, color: C.text }]}>TOTAL</Text>
            <Text style={[s.totalVal, { flex: 1, color: '#1565c0' }]}>{formatMoneda(totQ1)}</Text>
            <Text style={[s.totalLabel, { flex: 1, color: C.text, borderLeftWidth: 1, borderLeftColor: C.border + '44' }]}>{''}</Text>
            <Text style={[s.totalVal, { flex: 1, color: '#1565c0' }]}>{formatMoneda(totQ2)}</Text>
          </View>

          {/* Fila EFECTIVIDAD */}
          <View style={s.efectRow}>
            <Text style={s.efectLabel}>EFECTIVIDAD</Text>
            <Text style={s.efectVal}>{efectividad.toFixed(0)}%</Text>
            <Text style={s.efectLabel}>MORA</Text>
            <Text style={s.efectVal}>{moraPct.toFixed(0)}%</Text>
          </View>
        </Card.Content>
      </Card>

      {/* ── Botones ──────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button mode="contained" icon="microsoft-excel" onPress={exportarExcel}
          loading={exportando} disabled={exportando || guardando}
          style={{ flex: 2, backgroundColor: '#1b7c3a', borderRadius: 10 }}
          contentStyle={{ paddingVertical: 6 }}>
          Exportar Excel
        </Button>
        <Button mode="outlined" icon="content-save-outline" onPress={guardarEnSistema}
          loading={guardando} disabled={guardando || exportando}
          style={{ flex: 1, borderRadius: 10, borderColor: C.primary }}
          contentStyle={{ paddingVertical: 6 }}>
          Guardar
        </Button>
      </View>

      {/* ── Historial guardado ────────────────────────────────── */}
      {(historial.length > 0 || cargandoHist) && (
        <Card style={[s.card, glassStyle(C.isDark)]}>
          <Card.Content>
            <Text style={[s.secLabel, { color: C.textSub, marginBottom: 8 }]}>
              GUARDADOS EN SISTEMA — {MESES_LABEL[mes - 1].toUpperCase()} {anio}
            </Text>
            {cargandoHist ? (
              <Text style={{ color: C.textSub, fontSize: 12 }}>Cargando historial…</Text>
            ) : historial.map((item, idx) => (
              <TouchableOpacity
                key={item.id}
                onPress={() => cargarDesdeHistorial(item)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingVertical: 8, paddingHorizontal: 4,
                  borderBottomWidth: idx < historial.length - 1 ? 1 : 0,
                  borderBottomColor: C.border + '44',
                }}>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: C.text }}>
                    {item.cobrador || '—'}
                    {item.ruta ? ` · ${item.ruta}` : ''}
                  </Text>
                  <Text style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>
                    Cobro: {formatMoneda(item.cobroTotal || 0)}  ·  Efectividad: {((item.efectividad || 0)).toFixed(0)}%
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <MaterialCommunityIcons name="arrow-down-circle-outline" size={22} color={C.primary} />
                  <Text style={{ fontSize: 9, color: C.textSub, marginTop: 2 }}>Cargar</Text>
                </View>
              </TouchableOpacity>
            ))}
          </Card.Content>
        </Card>
      )}

    </ScrollView>
  );
}

/* ── Componente resumen item ─────────────────────────────────────── */
function ResumeItem({ label, value, color, C, bold }: any) {
  return (
    <View style={{ flex: 1, minWidth: 130, alignItems: 'center', paddingVertical: 6 }}>
      <Text style={{ fontSize: 9, color: C.textSub, fontWeight: '600', letterSpacing: 0.4 }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: bold ? '800' : '600', color, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ── Estilos ─────────────────────────────────────────────────────── */
function makeStyles(C: any) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: C.bg },
    content: { padding: 14, gap: 12, paddingBottom: 40 },
    card:    { borderRadius: 12 },
    row2:    { flexDirection: 'row', gap: 10 },
    secLabel:{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

    mesRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
    mesBtn:  { padding: 6 },
    mesLabel:{ fontSize: 16, fontWeight: '700', minWidth: 140, textAlign: 'center' },

    resumeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },

    tableHdr: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', marginBottom: 2 },
    halfHdr:  { flex: 1, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.primary + 'cc', paddingHorizontal: 10, paddingVertical: 6 },
    hdrLabel: { fontSize: 10, fontWeight: '700' },
    hdrQ:     { fontSize: 12, fontWeight: '800' },

    tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border + '33', minHeight: 38 },
    rowEven:  { backgroundColor: 'transparent' },
    rowOdd:   { backgroundColor: C.surface + '60' },

    cellInput: { backgroundColor: 'transparent' },
    cellFecha: { flex: 1, maxWidth: 90 },
    cellMonto: { flex: 1 },

    totalRow:   { backgroundColor: C.primary + '18', borderTopWidth: 2, borderTopColor: C.primary + '55', paddingVertical: 4 },
    totalLabel: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6 },
    totalVal:   { fontSize: 13, fontWeight: '800', textAlign: 'right', paddingHorizontal: 6 },

    efectRow: {
      flexDirection: 'row', backgroundColor: '#f9c74f33',
      borderTopWidth: 2, borderTopColor: '#f9c74f88',
      paddingVertical: 8, paddingHorizontal: 6,
    },
    efectLabel: { flex: 1, fontSize: 11, fontWeight: '700', color: '#7c6000', textAlign: 'center' },
    efectVal:   { flex: 1, fontSize: 14, fontWeight: '900', color: '#0a2463', textAlign: 'center' },
  });
}
