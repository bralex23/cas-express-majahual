import React, { useState, useMemo, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
import { formatMoneda, hoy } from '../../../src/utils/calculos';
import { FadeIn } from '../../../src/components/FadeIn';
import { AnimatedNumber } from '../../../src/components/AnimatedNumber';
import { useFocusEffect } from 'expo-router';

/* ────────────────────────────────────────────
   CATEGORÍAS DE GASTO
──────────────────────────────────────────── */
const CATEGORIAS = [
  { key: 'alquiler',     label: 'Alquiler / Local'            },
  { key: 'servicios',    label: 'Servicios básicos'           },
  { key: 'sueldos',      label: 'Sueldos / Salarios'          },
  { key: 'papeleria',    label: 'Papelería / Materiales'      },
  { key: 'transporte',   label: 'Transporte / Combustible'    },
  { key: 'comisiones',   label: 'Comisiones'                  },
  { key: 'publicidad',   label: 'Publicidad / Marketing'      },
  { key: 'impuestos',    label: 'Impuestos / Tasas'           },
  { key: 'otros',        label: 'Otros gastos'                },
];

interface Gasto {
  id: string;
  fecha: string;
  categoria: string;
  descripcion: string;
  monto: number;
  comprobante?: string;
  created_by?: string;
  created_at: string;
}

interface Pago {
  id: string;
  monto_pagado: number;
  mora?: number;
  multa?: number;
  fecha_pago: string;
  prestamo_id?: string;
}

/* Nombre del mes en español */
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mesAnio(year: number, month: number) {
  return `${MESES[month - 1]} ${year}`;
}

/* Prefijo YYYY-MM para filtrar por mes */
function prefijo(year: number, month: number) {
  return `${year}-${String(month).padStart(2,'0')}`;
}

export default function Contabilidad() {
  const C  = useColors();
  const s  = useMemo(() => makeStyles(C), [C]);
  const { perfil, isSupervisor } = useAuth();
  const { col } = useEmpresa();

  /* ── Mes seleccionado ── */
  const hoyStr = hoy();
  const [year,  setYear]  = useState(parseInt(hoyStr.slice(0,4)));
  const [month, setMonth] = useState(parseInt(hoyStr.slice(5,7)));

  /* ── Data ── */
  const [gastos,    setGastos]    = useState<Gasto[]>([]);
  const [cobros,    setCobros]    = useState<Pago[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [loadingXls,setLoadingXls]= useState(false);
  const [exportMsg, setExportMsg] = useState<{tipo:'ok'|'error'|'info'; texto:string}|null>(null);

  /* ── Modal agregar gasto ── */
  const [modal,       setModal]       = useState(false);
  const [gFecha,      setGFecha]      = useState(hoyStr);
  const [gCategoria,  setGCategoria]  = useState('otros');
  const [gDescripcion,setGDescripcion]= useState('');
  const [gMonto,      setGMonto]      = useState('');
  const [gComprobante,setGComprobante]= useState('');
  const [guardando,   setGuardando]   = useState(false);
  const [confirmDel,  setConfirmDel]  = useState<string|null>(null); // id del gasto a eliminar

  /* ── Carga de datos ── */
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const pref = prefijo(year, month);

      // Gastos del mes
      const gSnap = await getDocs(
        query(collection(db, col('gastos')), where('fecha', '>=', pref + '-01'), where('fecha', '<=', pref + '-31'))
      );
      const gData = gSnap.docs.map(d => ({ id: d.id, ...d.data() } as Gasto))
        .sort((a,b) => b.fecha.localeCompare(a.fecha));
      setGastos(gData);

      // Cobros del mes (pagos)
      const cSnap = await getDocs(
        query(collection(db, col('pagos')), where('fecha_pago', '>=', pref + '-01'), where('fecha_pago', '<=', pref + '-31'))
      );
      const cData = cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Pago));
      setCobros(cData);
    } catch(e) {
      console.error('Error cargando contabilidad:', e);
    }
    setLoading(false);
  }, [year, month]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar, col]));

  /* ── Totales ── */
  const totalIngresos = cobros.reduce((s, p) => s + (p.monto_pagado || 0) + (p.mora || 0) + (p.multa || 0), 0);
  const totalGastos   = gastos.reduce((s, g) => s + (g.monto || 0), 0);
  const utilidad      = totalIngresos - totalGastos;

  /* ── Navegación de mes ── */
  function mesAnterior() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function mesSiguiente() {
    const hoyYear = parseInt(hoyStr.slice(0,4));
    const hoyMonth = parseInt(hoyStr.slice(5,7));
    if (year > hoyYear || (year === hoyYear && month >= hoyMonth)) return;
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  /* ── Guardar gasto ── */
  async function guardarGasto() {
    const monto = parseFloat(gMonto);
    if (!gDescripcion.trim() || !monto || monto <= 0) return;
    setGuardando(true);
    try {
      await addDoc(collection(db, col('gastos')), {
        fecha: gFecha,
        categoria: gCategoria,
        descripcion: gDescripcion.trim(),
        monto,
        comprobante: gComprobante.trim(),
        created_by: perfil?.id || '',
        created_at: new Date().toISOString(),
      });
      setModal(false);
      setGDescripcion(''); setGMonto(''); setGComprobante('');
      setGFecha(hoyStr); setGCategoria('otros');
      cargar();
    } catch(e) { /* silencioso */ }
    setGuardando(false);
  }

  /* ── Eliminar gasto ── */
  async function eliminarGasto(id: string) {
    try {
      await deleteDoc(doc(db, col('gastos'), id));
      setConfirmDel(null);
      cargar();
    } catch(e: any) {
      setConfirmDel(null);
      setExportMsg({ tipo: 'error', texto: 'Error al eliminar: ' + String(e?.message || e) });
    }
  }

  /* ── Exportar Excel ── */
  async function exportarExcel() {
    setExportMsg(null);
    const api = (window as any).electronAPI;
    if (!api) {
      setExportMsg({ tipo: 'error', texto: 'Solo disponible en la app de escritorio.' });
      return;
    }
    if (typeof api.generateContabilidad !== 'function') {
      setExportMsg({ tipo: 'info', texto: '⚠️  Debes cerrar y volver a abrir CAS Express para activar esta función (cambio en preload).' });
      return;
    }
    setLoadingXls(true);
    try {
      const result = await api.generateContabilidad({
        year, month,
        mesLabel: mesAnio(year, month),
        totalIngresos, totalGastos, utilidad,
        cobros: cobros.map(c => ({
          fecha: c.fecha_pago,
          monto: (c.monto_pagado||0) + (c.mora||0) + (c.multa||0),
          cobrado: c.monto_pagado||0,
          mora: c.mora||0,
          multa: c.multa||0,
        })),
        gastos: gastos.map(g => ({
          fecha: g.fecha,
          categoria: CATEGORIAS.find(c => c.key === g.categoria)?.label || g.categoria,
          descripcion: g.descripcion,
          monto: g.monto,
          comprobante: g.comprobante||'',
        })),
      });
      if (result?.saved) {
        setExportMsg({ tipo: 'ok', texto: '✅ Guardado en: ' + result.filePath });
      } else if (result?.error) {
        setExportMsg({ tipo: 'error', texto: 'Error: ' + result.error });
      }
    } catch(e: any) {
      setExportMsg({ tipo: 'error', texto: 'Error: ' + String(e?.message || e) });
    }
    setLoadingXls(false);
  }

  /* ── Categoría por grupo (para mostrar resumen) ── */
  const gastosPorCategoria = useMemo(() => {
    const mapa: Record<string, number> = {};
    gastos.forEach(g => {
      mapa[g.categoria] = (mapa[g.categoria] || 0) + g.monto;
    });
    return Object.entries(mapa)
      .sort((a,b) => b[1] - a[1])
      .map(([key, total]) => ({
        key, total,
        label: CATEGORIAS.find(c => c.key === key)?.label || key,
      }));
  }, [gastos]);

  const esActual = year === parseInt(hoyStr.slice(0,4)) && month === parseInt(hoyStr.slice(5,7));

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* Encabezado */}
        <View style={s.header}>
          <View>
            <Text variant="titleLarge" style={s.titulo}>Contabilidad</Text>
            <Text style={s.subtitulo}>Registros para Hacienda / Contador</Text>
          </View>
          <Button
            mode="contained"
            icon="plus"
            onPress={() => setModal(true)}
            buttonColor={C.primary}
            textColor="#fff"
            style={{ borderRadius: 8 }}
          >
            Agregar gasto
          </Button>
        </View>

        {/* Selector de mes */}
        <View style={s.mesSel}>
          <TouchableOpacity style={s.mesBtn} onPress={mesAnterior}>
            <Text style={s.mesBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.mesLabel}>{mesAnio(year, month)}</Text>
          <TouchableOpacity style={[s.mesBtn, esActual && s.mesBtnDis]} onPress={mesSiguiente} disabled={esActual}>
            <Text style={[s.mesBtnTxt, esActual && { opacity: 0.3 }]}>›</Text>
          </TouchableOpacity>
        </View>

        {loading
          ? <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
          : <>
              {/* Resumen financiero */}
              <View style={s.resumenRow}>
                <_Card label="Ingresos" valor={totalIngresos} color={C.success} C={C} />
                <_Card label="Gastos"   valor={totalGastos}   color={C.danger}  C={C} />
                <_Card
                  label="Utilidad"
                  valor={utilidad}
                  color={utilidad >= 0 ? C.success : C.danger}
                  C={C}
                />
              </View>

              {/* Botón exportar */}
              <Button
                mode="outlined"
                icon="microsoft-excel"
                loading={loadingXls}
                disabled={loadingXls}
                onPress={exportarExcel}
                style={s.exportBtn}
                textColor={C.success}
              >
                Exportar Excel para contador
              </Button>

              {/* Mensaje de exportación inline */}
              {exportMsg && (
                <View style={[s.exportMsg, {
                  backgroundColor: exportMsg.tipo === 'ok'
                    ? C.success + '20'
                    : exportMsg.tipo === 'info'
                      ? C.warning + '20'
                      : C.danger + '20',
                  borderColor: exportMsg.tipo === 'ok'
                    ? C.success + '55'
                    : exportMsg.tipo === 'info'
                      ? C.warning + '55'
                      : C.danger + '55',
                }]}>
                  <Text style={{
                    fontSize: 13, fontWeight: '600', lineHeight: 20,
                    color: exportMsg.tipo === 'ok' ? C.success : exportMsg.tipo === 'info' ? C.warning : C.danger,
                  }}>
                    {exportMsg.texto}
                  </Text>
                </View>
              )}

              {/* Gastos por categoría */}
              {gastosPorCategoria.length > 0 && (
                <View style={s.panel}>
                  <Text style={s.panelTit}>Gastos por categoría</Text>
                  {gastosPorCategoria.map(cat => (
                    <View key={cat.key} style={s.catFila}>
                      <Text style={s.catLabel}>{cat.label}</Text>
                      <Text style={[s.catMonto, { color: C.danger }]}>{formatMoneda(cat.total)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Lista de gastos */}
              <View style={s.panel}>
                <Text style={s.panelTit}>
                  Gastos registrados — {gastos.length > 0 ? `${gastos.length} registro${gastos.length>1?'s':''}` : 'ninguno'}
                </Text>
                {gastos.length === 0
                  ? <Text style={s.vacio}>No hay gastos registrados para este mes.</Text>
                  : gastos.map(g => (
                    <View key={g.id} style={s.gastoFila}>
                      <View style={{ flex: 1 }}>
                        <View style={s.gastoTop}>
                          <Text style={s.gastoCat}>
                            {CATEGORIAS.find(c => c.key === g.categoria)?.label || g.categoria}
                          </Text>
                          <Text style={s.gastoFecha}>{g.fecha.split('-').reverse().join('/')}</Text>
                        </View>
                        <Text style={s.gastoDesc}>{g.descripcion}</Text>
                        {g.comprobante ? <Text style={s.gastoComp}>Comprobante: {g.comprobante}</Text> : null}
                      </View>
                      <View style={s.gastoRight}>
                        <Text style={s.gastoMonto}>{formatMoneda(g.monto)}</Text>
                        {isSupervisor && (
                          confirmDel === g.id
                            ? <View style={{ flexDirection: 'row', gap: 4 }}>
                                <TouchableOpacity
                                  onPress={() => eliminarGasto(g.id)}
                                  style={[s.delBtn, { backgroundColor: C.danger + '55' }]}
                                >
                                  <Text style={[s.delTxt, { color: '#fff' }]}>Sí</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => setConfirmDel(null)}
                                  style={[s.delBtn, { backgroundColor: C.border }]}
                                >
                                  <Text style={[s.delTxt, { color: C.text }]}>No</Text>
                                </TouchableOpacity>
                              </View>
                            : <TouchableOpacity onPress={() => setConfirmDel(g.id)} style={s.delBtn}>
                                <Text style={s.delTxt}>✕</Text>
                              </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))
                }
              </View>

              {/* Detalle de cobros del mes */}
              <View style={s.panel}>
                <Text style={s.panelTit}>
                  Cobros del mes — {cobros.length} pago{cobros.length !== 1 ? 's' : ''}
                </Text>
                {cobros.length === 0
                  ? <Text style={s.vacio}>No hay cobros registrados para este mes.</Text>
                  : <View>
                      <View style={s.cobroHead}>
                        <Text style={[s.cobroHd, { flex: 1 }]}>Fecha</Text>
                        <Text style={[s.cobroHd, { textAlign: 'right' }]}>Monto</Text>
                      </View>
                      {cobros.map(c => {
                        const total = (c.monto_pagado||0) + (c.mora||0) + (c.multa||0);
                        return (
                          <View key={c.id} style={s.cobroFila}>
                            <Text style={[s.cobroTxt, { flex: 1 }]}>{c.fecha_pago.split('-').reverse().join('/')}</Text>
                            <Text style={[s.cobroTxt, { textAlign: 'right', fontWeight: '700', color: C.success }]}>
                              {formatMoneda(total)}
                            </Text>
                          </View>
                        );
                      })}
                      <View style={s.cobroTotal}>
                        <Text style={s.cobroTotalLbl}>TOTAL COBROS</Text>
                        <Text style={[s.cobroTotalVal, { color: C.success }]}>{formatMoneda(totalIngresos)}</Text>
                      </View>
                    </View>
                }
              </View>
            </>
        }
      </ScrollView>

      {/* ── Modal agregar gasto ── */}
      <Modal visible={modal} transparent animationType="fade">
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>Registrar Gasto</Text>

            <Text style={s.lbl}>Fecha</Text>
            <RNTextInput
              style={s.txtInput}
              value={gFecha}
              onChangeText={setGFecha}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={C.textTer}
            />

            <Text style={s.lbl}>Categoría</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {CATEGORIAS.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[s.catChip, gCategoria === cat.key && s.catChipOn]}
                    onPress={() => setGCategoria(cat.key)}
                  >
                    <Text style={[s.catChipTxt, gCategoria === cat.key && { color: '#fff' }]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={s.lbl}>Descripción *</Text>
            <RNTextInput
              style={s.txtInput}
              value={gDescripcion}
              onChangeText={setGDescripcion}
              placeholder="Ej: Pago de alquiler mes de junio"
              placeholderTextColor={C.textTer}
              multiline
            />

            <Text style={s.lbl}>Monto ($) *</Text>
            <RNTextInput
              style={s.txtInput}
              value={gMonto}
              onChangeText={setGMonto}
              placeholder="0.00"
              placeholderTextColor={C.textTer}
              keyboardType="decimal-pad"
            />

            <Text style={s.lbl}>N° Comprobante / Factura (opcional)</Text>
            <RNTextInput
              style={[s.txtInput, { marginBottom: 20 }]}
              value={gComprobante}
              onChangeText={setGComprobante}
              placeholder="Ej: FAC-001234"
              placeholderTextColor={C.textTer}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                mode="outlined"
                onPress={() => { setModal(false); setGDescripcion(''); setGMonto(''); setGComprobante(''); }}
                style={{ flex: 1 }}
                disabled={guardando}
              >
                Cancelar
              </Button>
              <Button
                mode="contained"
                onPress={guardarGasto}
                loading={guardando}
                disabled={guardando}
                buttonColor={C.primary}
                textColor="#fff"
                style={{ flex: 1 }}
              >
                Guardar
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ── Card de resumen ── */
function _Card({ label, valor, color, C }: { label: string; valor: number; color: string; C: any }) {
  return (
    <FadeIn style={{
      flex: 1, borderRadius: 12, padding: 12, alignItems: 'center',
      backgroundColor: color + '18',
      borderWidth: 1, borderColor: color + '44',
    }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </Text>
      <AnimatedNumber
        value={valor}
        formatter={(n) => formatMoneda(n)}
        style={{ fontSize: 15, fontWeight: '800', color }}
      />
    </FadeIn>
  );
}

/* ── Estilos ── */
const makeStyles = (C: any) => StyleSheet.create({
  root:     { flex: 1, ...glassBgStyle(C) },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  titulo:   { color: C.primaryText, fontWeight: '800' },
  subtitulo:{ fontSize: 11, color: C.textSec, marginTop: 2 },

  /* Selector mes */
  mesSel:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 16 },
  mesBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', justifyContent: 'center', alignItems: 'center' },
  mesBtnDis:{ opacity: 0.3 },
  mesBtnTxt:{ fontSize: 22, color: C.text, fontWeight: '700', lineHeight: 26 },
  mesLabel: { fontSize: 18, fontWeight: '800', color: C.primaryText, minWidth: 160, textAlign: 'center' },

  /* Resumen */
  resumenRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },

  /* Export */
  exportBtn: { marginBottom: 8, borderColor: C.success },
  exportMsg: { borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1 },

  /* Panel */
  panel:    { borderRadius: 14, padding: 14, marginBottom: 14, ...glassStyle(C) },
  panelTit: { fontSize: 12, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  vacio:    { fontSize: 13, color: C.textTer, textAlign: 'center', paddingVertical: 10 },

  /* Categorías resumen */
  catFila:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
  catLabel: { fontSize: 13, color: C.textSec },
  catMonto: { fontSize: 13, fontWeight: '700' },

  /* Fila gasto */
  gastoFila:  { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', alignItems: 'flex-start' },
  gastoTop:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  gastoCat:   { fontSize: 11, fontWeight: '700', color: C.primary, textTransform: 'uppercase' },
  gastoFecha: { fontSize: 11, color: C.textTer },
  gastoDesc:  { fontSize: 13, color: C.text },
  gastoComp:  { fontSize: 11, color: C.textTer, marginTop: 1 },
  gastoRight: { alignItems: 'flex-end', gap: 6, marginLeft: 10 },
  gastoMonto: { fontSize: 14, fontWeight: '800', color: C.danger },
  delBtn:     { backgroundColor: C.danger + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  delTxt:     { fontSize: 11, color: C.danger, fontWeight: '700' },

  /* Filas cobros */
  cobroHead:    { flexDirection: 'row', marginBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 4 },
  cobroHd:      { fontSize: 10, fontWeight: '700', color: C.textSec, textTransform: 'uppercase' },
  cobroFila:    { flexDirection: 'row', paddingVertical: 5 },
  cobroTxt:     { fontSize: 12, color: C.textSec },
  cobroTotal:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  cobroTotalLbl:{ fontSize: 11, fontWeight: '700', color: C.textSec, textTransform: 'uppercase' },
  cobroTotalVal:{ fontSize: 14, fontWeight: '800' },

  /* Modal */
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalBox: { width: '100%', maxWidth: 480, borderRadius: 16, padding: 20, ...glassStyle(C), backgroundColor: C.surface },
  modalTit: { fontSize: 16, fontWeight: '800', color: C.primaryText, marginBottom: 16 },
  lbl:      { fontSize: 12, fontWeight: '600', color: C.textSec, marginBottom: 4 },
  txtInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    padding: 10, fontSize: 14, color: C.text,
    backgroundColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    marginBottom: 12,
  },
  catChip:   { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  catChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  catChipTxt:{ fontSize: 12, color: C.textSec },
});
