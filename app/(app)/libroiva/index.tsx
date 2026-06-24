import React, { useState, useMemo, useCallback, Component } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text, Button, TextInput, ActivityIndicator } from 'react-native-paper';

/* ── Error Boundary para capturar crashes y mostrar el error ── */
class LibroIVAErrorBoundary extends Component<{children: React.ReactNode}, {error: string|null}> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e: any) { return { error: String(e?.message || e) }; }
  componentDidCatch(e: any, info: any) { console.error('[LibroIVA crash]', e, info); }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex:1, justifyContent:'center', alignItems:'center', padding: 24 }}>
          <Text style={{ color:'#ef5350', fontSize:16, fontWeight:'800', marginBottom:12 }}>
            ⚠️ Error en Libros de IVA
          </Text>
          <Text style={{ color:'#ccc', fontSize:12, textAlign:'center', lineHeight:18 }}>
            {this.state.error}
          </Text>
          <TouchableOpacity
            style={{ marginTop:20, backgroundColor:'#0a2463', padding:12, borderRadius:8 }}
            onPress={() => this.setState({ error: null })}>
            <Text style={{ color:'#fff', fontWeight:'700' }}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
import { MaterialCommunityIcons } from '@expo/vector-icons';
// NOTA: expo-image-picker NO se importa aquí porque causa crash en web/Electron.
// En desktop se usa <input type="file"> nativo. En móvil se carga dinámicamente.
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
import { formatMoneda, hoy } from '../../../src/utils/calculos';

/* ════════════════════════════════════════════════════════════════
   TIPOS
════════════════════════════════════════════════════════════════ */
interface FilaCompra {
  id: string; mes: string; fecha: string;
  noComp: string; noReg: string; proveedor: string;
  exentaLocal: number; exentaImport: number;
  gravadaLocal: number; gravadaImport: number;
  ivaPercibido: number; retencion: number; clasificacion: string;
  origen?: string; foto?: string;
}
interface FilaVentaCF {
  id: string; mes: string; dia: number;
  docDel: string; docAl: string;
  ventasExentas: number; ventasGravadas: number; exportaciones: number;
  ventasTerceros: number;
  origen?: string;
}
interface FilaVentaCont {
  id: string; mes: string; fecha: string;
  noCorrelativo: string; noControl: string; cliente: string; nrc: string;
  exentaPropia: number; gravadaPropia: number;
  exentaTercero: number; gravadaTercero: number;
  ivaRetenido: number;
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const CLASIFICACIONES = [
  'Alquiler / Local', 'Servicios básicos', 'Sueldos / Salarios',
  'Papelería / Materiales', 'Transporte / Combustible', 'Comisiones',
  'Publicidad / Marketing', 'Equipamiento', 'Honorarios', 'Otros gastos',
];

/* ════════════════════════════════════════════════════════════════
   HELPERS NUMÉRICOS
════════════════════════════════════════════════════════════════ */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const iva13 = (gravado: number) => r2(gravado * 0.13);
const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

function totalCompra(f: { exentaLocal:number; exentaImport:number; gravadaLocal:number; gravadaImport:number }) {
  return r2(f.exentaLocal + f.exentaImport + f.gravadaLocal + f.gravadaImport + iva13(f.gravadaLocal + f.gravadaImport));
}
function totalVentaCF(f: { ventasExentas:number; ventasGravadas:number; exportaciones:number }) {
  return r2(f.ventasExentas + f.ventasGravadas + f.exportaciones);
}
function totalVentaCont(f: { exentaPropia:number; gravadaPropia:number; exentaTercero:number; gravadaTercero:number; ivaRetenido:number }) {
  return r2(f.exentaPropia + f.gravadaPropia + iva13(f.gravadaPropia)
          + f.exentaTercero + f.gravadaTercero + iva13(f.gravadaTercero)
          - f.ivaRetenido);
}

// Comprime una imagen (uri o data URL) a base64 JPEG pequeño, para guardar en Firestore
async function comprimirImagenABase64(uri: string, maxW = 1000, calidad = 0.5): Promise<string> {
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

/* ════════════════════════════════════════════════════════════════
   PANTALLA
════════════════════════════════════════════════════════════════ */
function LibroIVAInner() {
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);
  const { col, empresa } = useEmpresa();
  const { perfil, isSupervisor } = useAuth();

  const hoyStr = hoy();
  const [year,  setYear]  = useState(parseInt(hoyStr.slice(0,4)));
  const [month, setMonth] = useState(parseInt(hoyStr.slice(5,7)));
  const mesStr = `${year}-${String(month).padStart(2,'0')}`;
  const esActual = year === parseInt(hoyStr.slice(0,4)) && month === parseInt(hoyStr.slice(5,7));

  const [tab, setTab] = useState<'compras'|'ventasCF'|'ventasCont'>('compras');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{tipo:'ok'|'error'|'info'; texto:string}|null>(null);

  const [compras,    setCompras]    = useState<FilaCompra[]>([]);
  const [ventasCF,   setVentasCF]   = useState<FilaVentaCF[]>([]);
  const [ventasCont, setVentasCont] = useState<FilaVentaCont[]>([]);

  /* ── Carga ── */
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [snapC, snapVCF, snapVCont] = await Promise.all([
        getDocs(query(collection(db, col('libroiva_compras')), where('mes', '==', mesStr))),
        getDocs(query(collection(db, col('libroiva_ventas_cf')), where('mes', '==', mesStr))),
        getDocs(query(collection(db, col('libroiva_ventas_cont')), where('mes', '==', mesStr))),
      ]);
      setCompras(snapC.docs.map(d => ({ id: d.id, ...d.data() } as FilaCompra)).sort((a,b)=>a.fecha.localeCompare(b.fecha)));
      setVentasCF(snapVCF.docs.map(d => ({ id: d.id, ...d.data() } as FilaVentaCF)).sort((a,b)=>a.dia-b.dia));
      setVentasCont(snapVCont.docs.map(d => ({ id: d.id, ...d.data() } as FilaVentaCont)).sort((a,b)=>a.fecha.localeCompare(b.fecha)));
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [mesStr, col]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  function mesAnterior() {
    if (month === 1) { setYear(y=>y-1); setMonth(12); } else setMonth(m=>m-1);
  }
  function mesSiguiente() {
    if (esActual) return;
    if (month === 12) { setYear(y=>y+1); setMonth(1); } else setMonth(m=>m+1);
  }

  /* ── Resumen de IVA del mes (guía interna) ── */
  const resumen = useMemo(() => {
    const creditoCompras = compras.reduce((s,f) => s + iva13(f.gravadaLocal+f.gravadaImport) + (f.ivaPercibido||0), 0);
    const debitoCont = ventasCont.reduce((s,f) => s + iva13(f.gravadaPropia) + iva13(f.gravadaTercero), 0);
    // Las ventas a consumidor final se registran con IVA incluido → se extrae el 13%
    const debitoCF = ventasCF.reduce((s,f) => s + r2(f.ventasGravadas - f.ventasGravadas/1.13), 0);
    const debito = debitoCont + debitoCF;
    return {
      creditoFiscal: r2(creditoCompras),
      debitoFiscal:  r2(debito),
      resultado:     r2(debito - creditoCompras),
      totalCompras:  r2(compras.reduce((s,f)=>s+totalCompra(f),0)),
      totalVentas:   r2(ventasCF.reduce((s,f)=>s+totalVentaCF(f),0) + ventasCont.reduce((s,f)=>s+totalVentaCont(f),0)),
    };
  }, [compras, ventasCF, ventasCont]);

  /* ── Pre-carga: gastos/facturas del mes → Compras ── */
  async function cargarGastosDelMes() {
    setLoading(true); setMsg(null);
    try {
      const existentes = new Set(compras.map(c => c.origen).filter(Boolean));
      const [gSnap, fSnap] = await Promise.all([
        getDocs(query(collection(db, col('gastos')), where('fecha', '>=', mesStr+'-01'), where('fecha', '<=', mesStr+'-31'))),
        getDocs(query(collection(db, col('facturas')), where('fecha', '>=', mesStr+'-01'), where('fecha', '<=', mesStr+'-31'))),
      ]);
      let agregados = 0;
      for (const d of [...gSnap.docs, ...fSnap.docs]) {
        const data: any = d.data();
        const origen = `${gSnap.docs.includes(d) ? 'gasto' : 'factura'}:${d.id}`;
        if (existentes.has(origen)) continue;
        const monto = Number(data.monto || 0);
        const gravadaLocal = r2(monto / 1.13);
        await addDoc(collection(db, col('libroiva_compras')), {
          mes: mesStr, fecha: data.fecha, noComp: '', noReg: '',
          proveedor: data.descripcion || '',
          exentaLocal: 0, exentaImport: 0,
          gravadaLocal, gravadaImport: 0,
          ivaPercibido: 0, retencion: 0,
          clasificacion: data.categoria || 'Otros gastos',
          origen,
        });
        agregados++;
      }
      await cargar();
      setMsg({ tipo: agregados > 0 ? 'ok' : 'info',
        texto: agregados > 0
          ? `Se importaron ${agregados} gasto(s)/factura(s) como borrador. Completa Nº de comprobante, NIT/Proveedor y clasifica exenta/gravada según corresponda.`
          : 'No hay gastos o facturas nuevas este mes para importar.' });
    } catch(e:any) {
      setMsg({ tipo:'error', texto: 'Error al importar: ' + (e?.message||'') });
    }
    setLoading(false);
  }

  /* ── Pre-carga: cobros diarios → Ventas Consumidor Final ── */
  async function cargarCobrosDelMes() {
    setLoading(true); setMsg(null);
    try {
      const existentes = new Set(ventasCF.map(v => v.origen).filter(Boolean));
      const snap = await getDocs(query(collection(db, col('pagos')),
        where('fecha_pago', '>=', mesStr+'-01'), where('fecha_pago', '<=', mesStr+'-31')));
      const porDia: Record<number, number> = {};
      snap.docs.forEach(d => {
        const data: any = d.data();
        const dia = parseInt(String(data.fecha_pago).slice(8,10), 10);
        const total = Number(data.monto_pagado||0) + Number(data.mora||0) + Number(data.multa||0);
        porDia[dia] = (porDia[dia]||0) + total;
      });
      let agregados = 0;
      for (const [diaStr, total] of Object.entries(porDia)) {
        const dia = Number(diaStr);
        const origen = `cobros:${dia}`;
        if (existentes.has(origen)) continue;
        await addDoc(collection(db, col('libroiva_ventas_cf')), {
          mes: mesStr, dia, docDel: '', docAl: '',
          ventasExentas: r2(total), ventasGravadas: 0, exportaciones: 0, ventasTerceros: 0,
          origen,
        });
        agregados++;
      }
      await cargar();
      setMsg({ tipo: agregados > 0 ? 'ok' : 'info',
        texto: agregados > 0
          ? `Se importaron ${agregados} día(s) con cobros como Ventas Exentas (intereses sobre préstamos). Revisa si alguno corresponde a venta gravada.`
          : 'No hay cobros nuevos este mes para importar.' });
    } catch(e:any) {
      setMsg({ tipo:'error', texto: 'Error al importar: ' + (e?.message||'') });
    }
    setLoading(false);
  }

  /* ── Exportar a Excel ── */
  async function exportarExcel() {
    setMsg(null);
    setLoading(true);
    try {
      const api = (window as any).electronAPI;

      // ── Escritorio (Electron) ──────────────────────────────────
      if (api && typeof api.generateLibroIva === 'function') {
        const result = await api.generateLibroIva({
          year, month, mesLabel: `${MESES[month-1]} ${year}`,
          empresaNombre: empresa?.nombre || '',
          titular: empresa?.titular || empresa?.nombre || '',
          nit: empresa?.nit || '',
          registroIva: empresa?.registroIva || '',
          compras:    compras.map(f => ({ ...f, iva13: iva13(f.gravadaLocal+f.gravadaImport), total: totalCompra(f) })),
          ventasCF:   ventasCF.map(f => ({ ...f, total: totalVentaCF(f) })),
          ventasCont: ventasCont.map(f => ({ ...f, debitoPropia: iva13(f.gravadaPropia), debitoTercero: iva13(f.gravadaTercero), total: totalVentaCont(f) })),
          resumen,
        });
        if (result?.saved) setMsg({ tipo:'ok', texto: '✅ Guardado en: ' + result.filePath });
        else if (result?.error) setMsg({ tipo:'error', texto: 'Error: ' + result.error });
        setLoading(false);
        return;
      }

      // ── Web / Móvil en browser — generación con SheetJS + descarga nativa ──
      // Usa solo la API del browser (Blob + <a download>), sin dependencias nativas.
      const XLSX = require('xlsx') as typeof import('xlsx');

      const mesLabel = `${MESES[month-1]} ${year}`;
      const wb = XLSX.utils.book_new();

      // — Hoja 1: Libro de Compras —
      const hdrC = ['Fecha','Nº Comp/CCF','Nº Reg','Proveedor','Clasificación',
                    'Exenta Local','Exenta Import.','Gravada Local','Gravada Import.',
                    'IVA 13%','IVA Percibido','Retención','Total'];
      const rowsC = compras.map(f => [
        f.fecha, f.noComp, f.noReg, f.proveedor, f.clasificacion,
        f.exentaLocal, f.exentaImport, f.gravadaLocal, f.gravadaImport,
        r2(iva13(f.gravadaLocal+f.gravadaImport)), f.ivaPercibido, f.retencion, r2(totalCompra(f)),
      ]);
      const totC = ['TOTAL','','','','',
        r2(compras.reduce((s,f)=>s+f.exentaLocal,0)),
        r2(compras.reduce((s,f)=>s+f.exentaImport,0)),
        r2(compras.reduce((s,f)=>s+f.gravadaLocal,0)),
        r2(compras.reduce((s,f)=>s+f.gravadaImport,0)),
        r2(compras.reduce((s,f)=>s+iva13(f.gravadaLocal+f.gravadaImport),0)),
        r2(compras.reduce((s,f)=>s+(f.ivaPercibido||0),0)),
        r2(compras.reduce((s,f)=>s+(f.retencion||0),0)),
        r2(compras.reduce((s,f)=>s+totalCompra(f),0)),
      ];
      const wsC = XLSX.utils.aoa_to_sheet([[`LIBRO DE COMPRAS — ${mesLabel}`],[],[...hdrC],...rowsC,[...totC]]);
      XLSX.utils.book_append_sheet(wb, wsC, 'Compras');

      // — Hoja 2: Ventas Consumidor Final —
      const hdrVCF = ['Día','Doc. Del','Doc. Al','Ventas Exentas','Ventas Gravadas (c/IVA)',
                      'Exportaciones','Ventas Terceros','Débito Fiscal (13%)','Total'];
      const rowsVCF = ventasCF.map(f => [
        f.dia, f.docDel, f.docAl,
        f.ventasExentas, f.ventasGravadas, f.exportaciones, f.ventasTerceros,
        r2(f.ventasGravadas - f.ventasGravadas/1.13), r2(totalVentaCF(f)),
      ]);
      const totVCF = ['TOTAL','','',
        r2(ventasCF.reduce((s,f)=>s+f.ventasExentas,0)),
        r2(ventasCF.reduce((s,f)=>s+f.ventasGravadas,0)),
        r2(ventasCF.reduce((s,f)=>s+f.exportaciones,0)),
        r2(ventasCF.reduce((s,f)=>s+f.ventasTerceros,0)),
        r2(ventasCF.reduce((s,f)=>s+r2(f.ventasGravadas-f.ventasGravadas/1.13),0)),
        r2(ventasCF.reduce((s,f)=>s+totalVentaCF(f),0)),
      ];
      const wsVCF = XLSX.utils.aoa_to_sheet([[`VENTAS A CONSUMIDOR FINAL — ${mesLabel}`],[],[...hdrVCF],...rowsVCF,[...totVCF]]);
      XLSX.utils.book_append_sheet(wb, wsVCF, 'Ventas CF');

      // — Hoja 3: Ventas a Contribuyentes —
      const hdrVC = ['Fecha','Nº Correlativo','Nº Control','Cliente','NRC',
                     'Exenta Propia','Gravada Propia','Débito Propio',
                     'Exenta Tercero','Gravada Tercero','Débito Tercero',
                     'IVA Retenido','Total'];
      const rowsVC = ventasCont.map(f => [
        f.fecha, f.noCorrelativo, f.noControl, f.cliente, f.nrc,
        f.exentaPropia, f.gravadaPropia, r2(iva13(f.gravadaPropia)),
        f.exentaTercero, f.gravadaTercero, r2(iva13(f.gravadaTercero)),
        f.ivaRetenido, r2(totalVentaCont(f)),
      ]);
      const totVC = ['TOTAL','','','','',
        r2(ventasCont.reduce((s,f)=>s+f.exentaPropia,0)),
        r2(ventasCont.reduce((s,f)=>s+f.gravadaPropia,0)),
        r2(ventasCont.reduce((s,f)=>s+iva13(f.gravadaPropia),0)),
        r2(ventasCont.reduce((s,f)=>s+f.exentaTercero,0)),
        r2(ventasCont.reduce((s,f)=>s+f.gravadaTercero,0)),
        r2(ventasCont.reduce((s,f)=>s+iva13(f.gravadaTercero),0)),
        r2(ventasCont.reduce((s,f)=>s+(f.ivaRetenido||0),0)),
        r2(ventasCont.reduce((s,f)=>s+totalVentaCont(f),0)),
      ];
      const wsVC = XLSX.utils.aoa_to_sheet([[`VENTAS A CONTRIBUYENTES — ${mesLabel}`],[],[...hdrVC],...rowsVC,[...totVC]]);
      XLSX.utils.book_append_sheet(wb, wsVC, 'Ventas Contrib.');

      // — Hoja 4: Resumen —
      const wsR = XLSX.utils.aoa_to_sheet([
        [`RESUMEN IVA — ${mesLabel}`],[],
        ['Total Compras',       resumen.totalCompras],
        ['Total Ventas',        resumen.totalVentas],
        ['Crédito Fiscal (compras)', resumen.creditoFiscal],
        ['Débito Fiscal (ventas)',   resumen.debitoFiscal],
        [resumen.resultado >= 0 ? 'IVA a pagar' : 'IVA a favor', Math.abs(resumen.resultado)],
      ]);
      XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

      // Descargar usando la API del navegador (funciona en web móvil y web escritorio)
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `LibroIVA_${(empresa?.nombre || 'empresa').replace(/\s+/g,'_')}_${mesLabel.replace(/\s+/g,'_')}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg({ tipo:'ok', texto: '✅ Descargando ' + fileName });
    } catch(e:any) {
      setMsg({ tipo:'error', texto: 'Error al exportar: ' + (e?.message||String(e)) });
    }
    setLoading(false);
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

        {/* Encabezado */}
        <View style={s.header}>
          <View>
            <Text variant="titleLarge" style={s.titulo}>📚 Libros de IVA</Text>
            <Text style={s.subtitulo}>Compras · Ventas a Consumidor Final · Ventas a Contribuyentes</Text>
          </View>
        </View>

        {/* Selector de mes */}
        <View style={s.mesSel}>
          <TouchableOpacity style={s.mesBtn} onPress={mesAnterior}>
            <Text style={s.mesBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.mesLabel}>{MESES[month-1]} {year}</Text>
          <TouchableOpacity style={[s.mesBtn, esActual && s.mesBtnDis]} onPress={mesSiguiente} disabled={esActual}>
            <Text style={[s.mesBtnTxt, esActual && { opacity: 0.3 }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Resumen / guía de IVA */}
        <View style={s.panel}>
          <Text style={s.panelTit}>Resumen del mes (guía interna)</Text>
          <View style={{ flexDirection:'row', gap: 8, marginBottom: 10 }}>
            <_Card label="Total Compras" valor={resumen.totalCompras} color={C.danger} C={C}/>
            <_Card label="Total Ventas" valor={resumen.totalVentas} color={C.success} C={C}/>
          </View>
          <View style={{ flexDirection:'row', gap: 8 }}>
            <_Card label="Crédito Fiscal (compras)" valor={resumen.creditoFiscal} color="#1565c0" C={C}/>
            <_Card label="Débito Fiscal (ventas)" valor={resumen.debitoFiscal} color="#7c4dff" C={C}/>
            <_Card label={resumen.resultado >= 0 ? 'IVA a pagar' : 'IVA a favor'}
              valor={Math.abs(resumen.resultado)}
              color={resumen.resultado >= 0 ? C.danger : C.success} C={C}/>
          </View>
          <Text style={s.nota}>
            ⚠️ Este cálculo es una guía para evitar descuidos al llenar los libros. Verifica siempre el
            resultado final con tu contador antes de declarar a Hacienda.
          </Text>
        </View>

        {/* Mensaje de export/importación */}
        {msg && (
          <View style={[s.msgBox, {
            backgroundColor: msg.tipo === 'ok' ? C.success+'20' : msg.tipo === 'info' ? C.warning+'20' : C.danger+'20',
            borderColor:     msg.tipo === 'ok' ? C.success+'55' : msg.tipo === 'info' ? C.warning+'55' : C.danger+'55',
          }]}>
            <Text style={{ fontSize:13, fontWeight:'600', lineHeight:20,
              color: msg.tipo === 'ok' ? C.success : msg.tipo === 'info' ? C.warning : C.danger }}>
              {msg.texto}
            </Text>
          </View>
        )}

        {/* Tabs */}
        <View style={s.tabs}>
          {([
            { key:'compras',    label:'Compras',              icon:'cart-outline' },
            { key:'ventasCF',   label:'Ventas Cons. Final',   icon:'cash-register' },
            { key:'ventasCont', label:'Ventas Contribuyentes',icon:'office-building-outline' },
          ] as const).map(t => (
            <TouchableOpacity key={t.key} style={[s.tabBtn, tab===t.key && s.tabBtnOn]} onPress={() => setTab(t.key)}>
              <MaterialCommunityIcons name={t.icon as any} size={16} color={tab===t.key ? '#fff' : C.textSec}/>
              <Text style={[s.tabTxt, tab===t.key && { color:'#fff' }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }}/>}

        {/* Botón exportar (siempre visible) */}
        <Button mode="outlined" icon="microsoft-excel" onPress={exportarExcel}
          loading={loading} disabled={loading} style={s.exportBtn} textColor={C.success}>
          Exportar Libros de IVA a Excel
        </Button>

        {tab === 'compras' && (
          <SeccionCompras C={C} s={s} col={col} mesStr={mesStr}
            compras={compras} recargar={cargar}
            onImportar={cargarGastosDelMes} isSupervisor={!!isSupervisor}/>
        )}
        {tab === 'ventasCF' && (
          <SeccionVentasCF C={C} s={s} col={col} mesStr={mesStr}
            filas={ventasCF} recargar={cargar}
            onImportar={cargarCobrosDelMes} isSupervisor={!!isSupervisor}/>
        )}
        {tab === 'ventasCont' && (
          <SeccionVentasCont C={C} s={s} col={col} mesStr={mesStr}
            filas={ventasCont} recargar={cargar} isSupervisor={!!isSupervisor}/>
        )}

      </ScrollView>
    </View>
  );
}

export default function LibroIVA() {
  return (
    <LibroIVAErrorBoundary>
      <LibroIVAInner />
    </LibroIVAErrorBoundary>
  );
}

/* ════════════════════════════════════════════════════════════════
   SECCIÓN: LIBRO DE COMPRAS
════════════════════════════════════════════════════════════════ */
function SeccionCompras({ C, s, col, mesStr, compras, recargar, onImportar, isSupervisor }: any) {
  const [editId, setEditId] = useState<string|null>(null);
  const [f, setF] = useState(blank());
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  function blank() {
    return { fecha: mesStr+'-01', noComp:'', noReg:'', proveedor:'',
      exentaLocal:'', exentaImport:'', gravadaLocal:'', gravadaImport:'',
      ivaPercibido:'', retencion:'', clasificacion: CLASIFICACIONES[0], foto:'' };
  }
  function cargarEdicion(c: FilaCompra) {
    setEditId(c.id);
    setF({ fecha:c.fecha, noComp:c.noComp||'', noReg:c.noReg||'', proveedor:c.proveedor||'',
      exentaLocal:String(c.exentaLocal||''), exentaImport:String(c.exentaImport||''),
      gravadaLocal:String(c.gravadaLocal||''), gravadaImport:String(c.gravadaImport||''),
      ivaPercibido:String(c.ivaPercibido||''), retencion:String(c.retencion||''),
      clasificacion: c.clasificacion || CLASIFICACIONES[0], foto: c.foto || '' });
  }

  async function elegirFoto(_desdeCamara: boolean) {
    // En web/Electron usamos <input type="file"> nativo
    setSubiendoFoto(true);
    try {
      await new Promise<void>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) { resolve(); return; }
          const reader = new FileReader();
          reader.onload = async (e) => {
            const uri = e.target?.result as string;
            if (!uri) { resolve(); return; }
            const b64 = await comprimirImagenABase64(uri);
            setF((prev:any) => ({ ...prev, foto: b64 }));
            resolve();
          };
          reader.readAsDataURL(file);
        };
        input.oncancel = () => resolve();
        input.click();
      });
    } catch(e:any) { window.alert('Error al procesar la imagen: ' + (e?.message||e)); }
    setSubiendoFoto(false);
  }

  const previewIva = iva13(num(f.gravadaLocal)+num(f.gravadaImport));
  const previewTotal = totalCompra({ exentaLocal:num(f.exentaLocal), exentaImport:num(f.exentaImport),
    gravadaLocal:num(f.gravadaLocal), gravadaImport:num(f.gravadaImport) });

  async function guardar() {
    if (!f.fecha) return;
    setGuardando(true);
    const datos = {
      mes: mesStr, fecha: f.fecha, noComp: f.noComp.trim(), noReg: f.noReg.trim(),
      proveedor: f.proveedor.trim(),
      exentaLocal: num(f.exentaLocal), exentaImport: num(f.exentaImport),
      gravadaLocal: num(f.gravadaLocal), gravadaImport: num(f.gravadaImport),
      ivaPercibido: num(f.ivaPercibido), retencion: num(f.retencion),
      clasificacion: f.clasificacion, foto: f.foto || '',
    };
    try {
      if (editId) await updateDoc(doc(db, col('libroiva_compras'), editId), datos);
      else await addDoc(collection(db, col('libroiva_compras')), datos);
      setEditId(null); setF(blank());
      await recargar();
    } catch(e:any) { console.error(e); window.alert('Error al guardar: ' + (e?.message || e)); }
    setGuardando(false);
  }

  async function borrar(id: string) {
    if (!window.confirm('¿Eliminar este registro de compra?')) return;
    await deleteDoc(doc(db, col('libroiva_compras'), id));
    await recargar();
  }

  const totalExentas  = r2(compras.reduce((s:number,c:FilaCompra)=>s+c.exentaLocal+c.exentaImport,0));
  const totalGravadas = r2(compras.reduce((s:number,c:FilaCompra)=>s+c.gravadaLocal+c.gravadaImport,0));
  const totalIva13    = r2(compras.reduce((s:number,c:FilaCompra)=>s+iva13(c.gravadaLocal+c.gravadaImport),0));
  const totalGeneral  = r2(compras.reduce((s:number,c:FilaCompra)=>s+totalCompra(c),0));

  return (
    <View>
      <Button mode="text" icon="download" onPress={onImportar} compact style={{ alignSelf:'flex-start', marginBottom: 8 }}>
        Importar gastos/facturas del mes
      </Button>

      {/* Formulario */}
      <View style={s.panel}>
        <Text style={s.panelTit}>{editId ? 'Editar compra' : 'Agregar compra'}</Text>
        <View style={s.fila}>
          <Field s={s} label="Fecha (AAAA-MM-DD)" value={f.fecha} onChange={v=>setF({...f, fecha:v})} flex={2}/>
          <Field s={s} label="Nº Comp./CCF" value={f.noComp} onChange={v=>setF({...f, noComp:v})} flex={2}/>
          <Field s={s} label="Nº Registro" value={f.noReg} onChange={v=>setF({...f, noReg:v})} flex={2}/>
        </View>
        <View style={s.fila}>
          <Field s={s} label="Proveedor" value={f.proveedor} onChange={v=>setF({...f, proveedor:v})} flex={1}/>
        </View>
        <View style={s.fila}>
          <Field s={s} label="Exenta local ($)" value={f.exentaLocal} onChange={v=>setF({...f, exentaLocal:v})} numeric/>
          <Field s={s} label="Exenta import. ($)" value={f.exentaImport} onChange={v=>setF({...f, exentaImport:v})} numeric/>
          <Field s={s} label="Gravada local ($)" value={f.gravadaLocal} onChange={v=>setF({...f, gravadaLocal:v})} numeric/>
          <Field s={s} label="Gravada import. ($)" value={f.gravadaImport} onChange={v=>setF({...f, gravadaImport:v})} numeric/>
        </View>
        <View style={s.fila}>
          <Field s={s} label="IVA percibido 1% ($)" value={f.ivaPercibido} onChange={v=>setF({...f, ivaPercibido:v})} numeric/>
          <Field s={s} label="Retención a terceros ($)" value={f.retencion} onChange={v=>setF({...f, retencion:v})} numeric/>
          <View style={{ flex:1, justifyContent:'center' }}>
            <Text style={s.calcLbl}>IVA 13% (auto)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewIva)}</Text>
          </View>
          <View style={{ flex:1, justifyContent:'center' }}>
            <Text style={s.calcLbl}>Total compra (auto)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewTotal)}</Text>
          </View>
        </View>

        <Text style={s.lbl}>Foto/archivo de la factura (respaldo digital)</Text>
        <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginBottom: 12 }}>
          <Button mode="outlined" icon="camera" loading={subiendoFoto} onPress={()=>elegirFoto(true)} compact>
            Tomar foto
          </Button>
          <Button mode="outlined" icon="file-upload-outline" loading={subiendoFoto} onPress={()=>elegirFoto(false)} compact>
            Subir archivo
          </Button>
          {!!f.foto && (
            <>
              <Image source={{ uri: f.foto }} style={{ width:40, height:40, borderRadius:4 }} />
              <TouchableOpacity onPress={()=>setF({...f, foto:''})}>
                <MaterialCommunityIcons name="close-circle" size={20} color={C.danger}/>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={s.lbl}>Clasificación de gastos</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection:'row', gap:6 }}>
            {CLASIFICACIONES.map(c => (
              <TouchableOpacity key={c} style={[s.chip, f.clasificacion===c && s.chipOn]} onPress={()=>setF({...f, clasificacion:c})}>
                <Text style={[s.chipTxt, f.clasificacion===c && { color:'#fff' }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={{ flexDirection:'row', gap:10 }}>
          {editId && (
            <Button mode="outlined" onPress={()=>{ setEditId(null); setF(blank()); }} style={{ flex:1 }}>
              Cancelar
            </Button>
          )}
          <Button mode="contained" loading={guardando} onPress={guardar} buttonColor={C.primary} textColor="#fff" style={{ flex:1 }}>
            {editId ? 'Guardar cambios' : 'Agregar a la lista'}
          </Button>
        </View>
      </View>

      {/* Lista */}
      <View style={s.panel}>
        <Text style={s.panelTit}>Registros ({compras.length})</Text>
        {compras.length === 0
          ? <Text style={s.vacio}>Sin registros este mes.</Text>
          : compras.map((c: FilaCompra) => (
              <View key={c.id} style={s.rowItem}>
                <View style={{ flex:1 }}>
                  <Text style={s.rowTit}>{c.proveedor || '(sin proveedor)'} — {c.fecha.split('-').reverse().join('/')}</Text>
                  <Text style={s.rowSub}>
                    Nº {c.noComp || '—'} · {c.clasificacion} · Exenta {formatMoneda(c.exentaLocal+c.exentaImport)} · Gravada {formatMoneda(c.gravadaLocal+c.gravadaImport)} · IVA {formatMoneda(iva13(c.gravadaLocal+c.gravadaImport))}
                  </Text>
                </View>
                <View style={{ alignItems:'flex-end', gap:6 }}>
                  <Text style={s.rowMonto}>{formatMoneda(totalCompra(c))}</Text>
                  <View style={{ flexDirection:'row', gap:10 }}>
                    {!!c.foto && (
                      <TouchableOpacity onPress={()=>window.open(c.foto)}>
                        <MaterialCommunityIcons name="image-outline" size={18} color="#66bb6a"/>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={()=>cargarEdicion(c)}>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color="#42a5f5"/>
                    </TouchableOpacity>
                    {isSupervisor && (
                      <TouchableOpacity onPress={()=>borrar(c.id)}>
                        <MaterialCommunityIcons name="delete-outline" size={18} color={C.danger}/>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
        }
        {compras.length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalTxt}>Exentas: {formatMoneda(totalExentas)}   Gravadas: {formatMoneda(totalGravadas)}   IVA: {formatMoneda(totalIva13)}</Text>
            <Text style={s.totalVal}>TOTAL: {formatMoneda(totalGeneral)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   SECCIÓN: LIBRO DE VENTAS A CONSUMIDOR FINAL
════════════════════════════════════════════════════════════════ */
function SeccionVentasCF({ C, s, col, mesStr, filas, recargar, onImportar, isSupervisor }: any) {
  const [editId, setEditId] = useState<string|null>(null);
  const [f, setF] = useState(blank());
  const [guardando, setGuardando] = useState(false);

  function blank() {
    return { dia:'1', docDel:'', docAl:'', ventasExentas:'', ventasGravadas:'', exportaciones:'', ventasTerceros:'' };
  }
  function cargarEdicion(v: FilaVentaCF) {
    setEditId(v.id);
    setF({ dia:String(v.dia), docDel:v.docDel||'', docAl:v.docAl||'',
      ventasExentas:String(v.ventasExentas||''), ventasGravadas:String(v.ventasGravadas||''),
      exportaciones:String(v.exportaciones||''), ventasTerceros:String(v.ventasTerceros||'') });
  }

  const previewTotal = totalVentaCF({ ventasExentas:num(f.ventasExentas), ventasGravadas:num(f.ventasGravadas), exportaciones:num(f.exportaciones) });
  const previewDebito = r2(num(f.ventasGravadas) - num(f.ventasGravadas)/1.13);

  async function guardar() {
    const dia = parseInt(f.dia,10);
    if (!dia || dia < 1 || dia > 31) return;
    setGuardando(true);
    const datos = {
      mes: mesStr, dia, docDel: f.docDel.trim(), docAl: f.docAl.trim(),
      ventasExentas: num(f.ventasExentas), ventasGravadas: num(f.ventasGravadas),
      exportaciones: num(f.exportaciones), ventasTerceros: num(f.ventasTerceros),
    };
    try {
      if (editId) await updateDoc(doc(db, col('libroiva_ventas_cf'), editId), datos);
      else await addDoc(collection(db, col('libroiva_ventas_cf')), datos);
      setEditId(null); setF(blank());
      await recargar();
    } catch(e:any) { console.error(e); window.alert('Error al guardar: ' + (e?.message || e)); }
    setGuardando(false);
  }

  async function borrar(id: string) {
    if (!window.confirm('¿Eliminar este registro?')) return;
    await deleteDoc(doc(db, col('libroiva_ventas_cf'), id));
    await recargar();
  }

  const totalExentas  = r2(filas.reduce((s:number,v:FilaVentaCF)=>s+v.ventasExentas,0));
  const totalGravadas = r2(filas.reduce((s:number,v:FilaVentaCF)=>s+v.ventasGravadas,0));
  const totalExport   = r2(filas.reduce((s:number,v:FilaVentaCF)=>s+v.exportaciones,0));
  const totalDebito   = r2(filas.reduce((s:number,v:FilaVentaCF)=>s+r2(v.ventasGravadas - v.ventasGravadas/1.13),0));
  const totalGeneral  = r2(filas.reduce((s:number,v:FilaVentaCF)=>s+totalVentaCF(v),0));

  return (
    <View>
      <Button mode="text" icon="download" onPress={onImportar} compact style={{ alignSelf:'flex-start', marginBottom: 8 }}>
        Importar cobros diarios del mes
      </Button>

      <View style={s.panel}>
        <Text style={s.panelTit}>{editId ? 'Editar día' : 'Agregar día'}</Text>
        <View style={s.fila}>
          <Field s={s} label="Día del mes (1-31)" value={f.dia} onChange={v=>setF({...f, dia:v})} numeric/>
          <Field s={s} label="Doc. del Nº" value={f.docDel} onChange={v=>setF({...f, docDel:v})}/>
          <Field s={s} label="Doc. al Nº" value={f.docAl} onChange={v=>setF({...f, docAl:v})}/>
        </View>
        <View style={s.fila}>
          <Field s={s} label="Ventas exentas ($)" value={f.ventasExentas} onChange={v=>setF({...f, ventasExentas:v})} numeric/>
          <Field s={s} label="Ventas gravadas (con IVA) ($)" value={f.ventasGravadas} onChange={v=>setF({...f, ventasGravadas:v})} numeric/>
          <Field s={s} label="Exportaciones ($)" value={f.exportaciones} onChange={v=>setF({...f, exportaciones:v})} numeric/>
          <Field s={s} label="Ventas a cuenta de terceros ($)" value={f.ventasTerceros} onChange={v=>setF({...f, ventasTerceros:v})} numeric/>
        </View>
        <View style={s.fila}>
          <View style={{ flex:1, justifyContent:'center' }}>
            <Text style={s.calcLbl}>Débito fiscal del día (auto, 13% de gravadas)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewDebito)}</Text>
          </View>
          <View style={{ flex:1, justifyContent:'center' }}>
            <Text style={s.calcLbl}>Total ventas del día (auto)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewTotal)}</Text>
          </View>
        </View>
        <View style={{ flexDirection:'row', gap:10 }}>
          {editId && (
            <Button mode="outlined" onPress={()=>{ setEditId(null); setF(blank()); }} style={{ flex:1 }}>
              Cancelar
            </Button>
          )}
          <Button mode="contained" loading={guardando} onPress={guardar} buttonColor={C.primary} textColor="#fff" style={{ flex:1 }}>
            {editId ? 'Guardar cambios' : 'Agregar a la lista'}
          </Button>
        </View>
      </View>

      <View style={s.panel}>
        <Text style={s.panelTit}>Registros ({filas.length})</Text>
        {filas.length === 0
          ? <Text style={s.vacio}>Sin registros este mes.</Text>
          : filas.map((v: FilaVentaCF) => (
              <View key={v.id} style={s.rowItem}>
                <View style={{ flex:1 }}>
                  <Text style={s.rowTit}>Día {v.dia}</Text>
                  <Text style={s.rowSub}>
                    Exenta {formatMoneda(v.ventasExentas)} · Gravada {formatMoneda(v.ventasGravadas)} · Export. {formatMoneda(v.exportaciones)} · Terceros {formatMoneda(v.ventasTerceros)}
                  </Text>
                </View>
                <View style={{ alignItems:'flex-end', gap:6 }}>
                  <Text style={s.rowMonto}>{formatMoneda(totalVentaCF(v))}</Text>
                  <View style={{ flexDirection:'row', gap:10 }}>
                    <TouchableOpacity onPress={()=>cargarEdicion(v)}>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color="#42a5f5"/>
                    </TouchableOpacity>
                    {isSupervisor && (
                      <TouchableOpacity onPress={()=>borrar(v.id)}>
                        <MaterialCommunityIcons name="delete-outline" size={18} color={C.danger}/>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
        }
        {filas.length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalTxt}>Exentas: {formatMoneda(totalExentas)}   Gravadas: {formatMoneda(totalGravadas)}   Export: {formatMoneda(totalExport)}   Débito IVA: {formatMoneda(totalDebito)}</Text>
            <Text style={s.totalVal}>TOTAL: {formatMoneda(totalGeneral)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   SECCIÓN: LIBRO DE VENTAS A CONTRIBUYENTES
════════════════════════════════════════════════════════════════ */
function SeccionVentasCont({ C, s, col, mesStr, filas, recargar, isSupervisor }: any) {
  const [editId, setEditId] = useState<string|null>(null);
  const [f, setF] = useState(blank());
  const [guardando, setGuardando] = useState(false);

  function blank() {
    return { fecha: mesStr+'-01', noCorrelativo:'', noControl:'', cliente:'', nrc:'',
      exentaPropia:'', gravadaPropia:'', exentaTercero:'', gravadaTercero:'', ivaRetenido:'' };
  }
  function cargarEdicion(v: FilaVentaCont) {
    setEditId(v.id);
    setF({ fecha:v.fecha, noCorrelativo:v.noCorrelativo||'', noControl:v.noControl||'', cliente:v.cliente||'', nrc:v.nrc||'',
      exentaPropia:String(v.exentaPropia||''), gravadaPropia:String(v.gravadaPropia||''),
      exentaTercero:String(v.exentaTercero||''), gravadaTercero:String(v.gravadaTercero||''),
      ivaRetenido:String(v.ivaRetenido||'') });
  }

  const fObj = { exentaPropia:num(f.exentaPropia), gravadaPropia:num(f.gravadaPropia),
    exentaTercero:num(f.exentaTercero), gravadaTercero:num(f.gravadaTercero), ivaRetenido:num(f.ivaRetenido) };
  const previewDebitoP = iva13(fObj.gravadaPropia);
  const previewDebitoT = iva13(fObj.gravadaTercero);
  const previewTotal = totalVentaCont(fObj);

  async function guardar() {
    if (!f.fecha) return;
    setGuardando(true);
    const datos = {
      mes: mesStr, fecha: f.fecha, noCorrelativo: f.noCorrelativo.trim(), noControl: f.noControl.trim(),
      cliente: f.cliente.trim(), nrc: f.nrc.trim(), ...fObj,
    };
    try {
      if (editId) await updateDoc(doc(db, col('libroiva_ventas_cont'), editId), datos);
      else await addDoc(collection(db, col('libroiva_ventas_cont')), datos);
      setEditId(null); setF(blank());
      await recargar();
    } catch(e:any) { console.error(e); window.alert('Error al guardar: ' + (e?.message || e)); }
    setGuardando(false);
  }

  async function borrar(id: string) {
    if (!window.confirm('¿Eliminar este registro?')) return;
    await deleteDoc(doc(db, col('libroiva_ventas_cont'), id));
    await recargar();
  }

  const totalGeneral = r2(filas.reduce((s:number,v:FilaVentaCont)=>s+totalVentaCont(v),0));
  const totalDebito  = r2(filas.reduce((s:number,v:FilaVentaCont)=>s+iva13(v.gravadaPropia)+iva13(v.gravadaTercero),0));

  return (
    <View>
      <View style={s.panel}>
        <Text style={s.panelTit}>{editId ? 'Editar venta a contribuyente' : 'Agregar venta a contribuyente (CCF)'}</Text>
        <View style={s.fila}>
          <Field s={s} label="Fecha emisión (AAAA-MM-DD)" value={f.fecha} onChange={v=>setF({...f, fecha:v})} flex={1}/>
          <Field s={s} label="Nº Correlativo" value={f.noCorrelativo} onChange={v=>setF({...f, noCorrelativo:v})} flex={1}/>
          <Field s={s} label="Nº Control interno" value={f.noControl} onChange={v=>setF({...f, noControl:v})} flex={1}/>
        </View>
        <View style={s.fila}>
          <Field s={s} label="Cliente / Mandante" value={f.cliente} onChange={v=>setF({...f, cliente:v})} flex={2}/>
          <Field s={s} label="N.R.C." value={f.nrc} onChange={v=>setF({...f, nrc:v})} flex={1}/>
        </View>
        <Text style={s.lbl}>Propias</Text>
        <View style={s.fila}>
          <Field s={s} label="Exentas ($)" value={f.exentaPropia} onChange={v=>setF({...f, exentaPropia:v})} numeric/>
          <Field s={s} label="Internas gravadas ($)" value={f.gravadaPropia} onChange={v=>setF({...f, gravadaPropia:v})} numeric/>
          <View style={{ flex:1, justifyContent:'center' }}>
            <Text style={s.calcLbl}>Débito fiscal (auto)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewDebitoP)}</Text>
          </View>
        </View>
        <Text style={s.lbl}>A cuenta de terceros</Text>
        <View style={s.fila}>
          <Field s={s} label="Exentas ($)" value={f.exentaTercero} onChange={v=>setF({...f, exentaTercero:v})} numeric/>
          <Field s={s} label="Internas gravadas ($)" value={f.gravadaTercero} onChange={v=>setF({...f, gravadaTercero:v})} numeric/>
          <View style={{ flex:1, justifyContent:'center' }}>
            <Text style={s.calcLbl}>Débito fiscal (auto)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewDebitoT)}</Text>
          </View>
        </View>
        <View style={s.fila}>
          <Field s={s} label="IVA Retenido ($)" value={f.ivaRetenido} onChange={v=>setF({...f, ivaRetenido:v})} numeric/>
          <View style={{ flex:2, justifyContent:'center' }}>
            <Text style={s.calcLbl}>Ventas totales (auto)</Text>
            <Text style={s.calcVal}>{formatMoneda(previewTotal)}</Text>
          </View>
        </View>
        <View style={{ flexDirection:'row', gap:10 }}>
          {editId && (
            <Button mode="outlined" onPress={()=>{ setEditId(null); setF(blank()); }} style={{ flex:1 }}>
              Cancelar
            </Button>
          )}
          <Button mode="contained" loading={guardando} onPress={guardar} buttonColor={C.primary} textColor="#fff" style={{ flex:1 }}>
            {editId ? 'Guardar cambios' : 'Agregar a la lista'}
          </Button>
        </View>
      </View>

      <View style={s.panel}>
        <Text style={s.panelTit}>Registros ({filas.length})</Text>
        {filas.length === 0
          ? <Text style={s.vacio}>Sin registros este mes.</Text>
          : filas.map((v: FilaVentaCont) => (
              <View key={v.id} style={s.rowItem}>
                <View style={{ flex:1 }}>
                  <Text style={s.rowTit}>{v.cliente || '(sin cliente)'} — {v.fecha.split('-').reverse().join('/')}</Text>
                  <Text style={s.rowSub}>
                    Nº {v.noCorrelativo || '—'} · NRC {v.nrc || '—'} · Gravada propia {formatMoneda(v.gravadaPropia)} · IVA ret. {formatMoneda(v.ivaRetenido)}
                  </Text>
                </View>
                <View style={{ alignItems:'flex-end', gap:6 }}>
                  <Text style={s.rowMonto}>{formatMoneda(totalVentaCont(v))}</Text>
                  <View style={{ flexDirection:'row', gap:10 }}>
                    <TouchableOpacity onPress={()=>cargarEdicion(v)}>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color="#42a5f5"/>
                    </TouchableOpacity>
                    {isSupervisor && (
                      <TouchableOpacity onPress={()=>borrar(v.id)}>
                        <MaterialCommunityIcons name="delete-outline" size={18} color={C.danger}/>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
        }
        {filas.length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalTxt}>Débito fiscal: {formatMoneda(totalDebito)}</Text>
            <Text style={s.totalVal}>TOTAL: {formatMoneda(totalGeneral)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   COMPONENTES AUXILIARES
════════════════════════════════════════════════════════════════ */
function Field({ s, label, value, onChange, flex = 1, numeric = false }: any) {
  return (
    <View style={{ flex }}>
      <TextInput
        label={label}
        value={value}
        onChangeText={onChange}
        mode="outlined"
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={s.input}
        dense
      />
    </View>
  );
}

function _Card({ label, valor, color, C }: { label: string; valor: number; color: string; C: any }) {
  return (
    <View style={{
      flex: 1, borderRadius: 12, padding: 10, alignItems: 'center',
      backgroundColor: color + '18', borderWidth: 1, borderColor: color + '44',
    }}>
      <Text style={{ fontSize: 9, fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, textAlign:'center' }}>
        {label}
      </Text>
      <Text style={{ fontSize: 14, fontWeight: '800', color }}>{formatMoneda(valor)}</Text>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   ESTILOS
════════════════════════════════════════════════════════════════ */
const makeStyles = (C: any) => StyleSheet.create({
  root:     { flex: 1, ...glassBgStyle(C) },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  titulo:   { color: C.primaryText, fontWeight: '800' },
  subtitulo:{ fontSize: 11, color: C.textSec, marginTop: 2 },

  mesSel:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 16 },
  mesBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', justifyContent: 'center', alignItems: 'center' },
  mesBtnDis:{ opacity: 0.3 },
  mesBtnTxt:{ fontSize: 22, color: C.text, fontWeight: '700', lineHeight: 26 },
  mesLabel: { fontSize: 18, fontWeight: '800', color: C.primaryText, minWidth: 160, textAlign: 'center' },

  panel:    { borderRadius: 14, padding: 14, marginBottom: 14, ...glassStyle(C) },
  panelTit: { fontSize: 12, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  vacio:    { fontSize: 13, color: C.textTer, textAlign: 'center', paddingVertical: 10 },
  nota:     { fontSize: 11, color: C.textTer, marginTop: 8, lineHeight: 16 },

  msgBox:   { borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1 },

  tabs:     { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  tabBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 10, borderWidth: 1, borderColor: C.border },
  tabBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabTxt:   { fontSize: 12, fontWeight: '700', color: C.textSec },

  exportBtn:{ marginBottom: 14, borderColor: C.success },

  fila:     { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  input:    { marginBottom: 8 },
  lbl:      { fontSize: 12, fontWeight: '600', color: C.textSec, marginBottom: 6, marginTop: 2 },

  calcLbl:  { fontSize: 10, color: C.textTer, marginBottom: 2 },
  calcVal:  { fontSize: 15, fontWeight: '800', color: C.primaryText },

  chip:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  chipOn:   { backgroundColor: C.primary, borderColor: C.primary },
  chipTxt:  { fontSize: 12, color: C.textSec },

  rowItem:  { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1,
              borderBottomColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', alignItems:'flex-start' },
  rowTit:   { fontSize: 13, fontWeight: '700', color: C.text },
  rowSub:   { fontSize: 11, color: C.textTer, marginTop: 2 },
  rowMonto: { fontSize: 14, fontWeight: '800', color: C.primaryText },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems:'center', marginTop: 8, paddingTop: 8,
              borderTopWidth: 1, borderTopColor: C.border, flexWrap:'wrap', gap: 6 },
  totalTxt: { fontSize: 11, color: C.textSec, fontWeight:'600' },
  totalVal: { fontSize: 14, fontWeight: '800', color: C.primaryText },
});
