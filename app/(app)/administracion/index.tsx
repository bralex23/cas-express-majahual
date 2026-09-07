/**
 * Administración — Cargos por Servicios a Clientes
 * Se pueden agregar VARIOS cargos al mismo tiempo a un cliente:
 * visita domiciliar, papelería, gasolina, otros.
 * Genera una factura combinada inmediatamente al guardar.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  Modal, ScrollView, Platform,
} from 'react-native';
import { Text, Button, ActivityIndicator, Card, TextInput, Switch } from 'react-native-paper';
import {
  collection, query, getDocs, getDoc, addDoc, orderBy, where,
  deleteDoc, doc, updateDoc, increment,
} from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassNavyStyle, glassBgStyle } from '../../../src/theme';
import { useFocusEffect } from 'expo-router';
import { formatMoneda } from '../../../src/utils/calculos';

const elAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null;

/* ── Definición de tipos de cargo ── */
const TIPOS_BASE = [
  { key: 'visita',    label: 'Visita Domiciliar', icon: '🏠', sugerido: 3.00, color: '#1565c0' },
  { key: 'papeleria', label: 'Papelería',          icon: '📄', sugerido: 1.00, color: '#6a1b9a' },
  { key: 'gasolina',  label: 'Gasolina',           icon: '⛽', sugerido: 5.00, color: '#e65100' },
  { key: 'otro',      label: 'Otro',               icon: '📋', sugerido: 0,    color: '#37474f' },
] as const;
type TipoCargo = typeof TIPOS_BASE[number]['key'];

/** Estado de cada línea de cargo en el formulario */
interface LineaCargo {
  key: TipoCargo;
  label: string;
  icon: string;
  color: string;
  activo: boolean;
  concepto: string;
  monto: string; // string para el input
}

function lineasIniciales(): LineaCargo[] {
  return TIPOS_BASE.map(t => ({
    key:      t.key,
    label:    t.label,
    icon:     t.icon,
    color:    t.color,
    activo:   t.key === 'visita', // visita activa por defecto
    concepto: t.label,
    monto:    t.sugerido > 0 ? String(t.sugerido) : '',
  }));
}

interface PrestamoMin {
  id: string;
  monto: number;
  plazo: number;          // número de cuotas
  fecha_inicio: string;
  numero_credito?: number;
  estado: string;
  frecuencia?: string;    // 'diario' | 'semanal'
}

interface GastoAdmin {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_dui: string;
  concepto: string;
  monto: number;          // monto total del cargo
  items?: { tipo: string; concepto: string; monto: number }[];
  // Distribución por cuotas
  prestamo_frecuencia?: string;  // 'diario' | 'semanal'
  tipo_cobro: 'unico' | 'distribuido';
  monto_por_cuota?: number;
  cuotas_plan?: number;
  cuotas_cobradas?: number;
  // Metadata
  fecha: string;
  cobrador_id: string;
  cobrador_nombre: string;
  created_at: string;
  prestamo_id?: string | null;
  estado: 'activo' | 'cobrado';
  cobrado_at?: string | null;
  // backward compat
  tipo?: TipoCargo;
}

interface ClienteOpt { id: string; nombre: string; dui: string; }

export default function AdminScreen() {
  const { col } = useEmpresa();
  const { perfil } = useAuth();
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  const [lista, setLista]     = useState<GastoAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const hoyStr = new Date().toISOString().slice(0, 10);

  /* ── Filtro ── */
  const [filtroTipo, setFiltroTipo] = useState<TipoCargo | 'todos'>('todos');

  /* ── Modal nuevo cargo (múltiple) ── */
  const [modalNuevo, setModalNuevo]     = useState(false);
  const [guardando, setGuardando]       = useState(false);
  const [lineas, setLineas]             = useState<LineaCargo[]>(lineasIniciales());
  const [fechaCargo, setFechaCargo]     = useState(hoyStr);
  // Selector cobrador
  const [perfilesLista, setPerfilesLista] = useState<{id:string;nombre:string;rol:string}[]>([]);
  const [cobradorSel, setCobradorSel]   = useState<{id:string;nombre:string} | null>(null);
  // Selector cliente
  const [clientesLista, setClientesLista] = useState<ClienteOpt[]>([]);
  const [clienteSel, setClienteSel]     = useState<ClienteOpt | null>(null);
  const [busqueda, setBusqueda]         = useState('');
  const [cargandoCli, setCargandoCli]   = useState(false);
  // Préstamos activos del cliente seleccionado
  const [prestamosCliente, setPrestamosCliente] = useState<PrestamoMin[]>([]);
  const [prestamoSel, setPrestamoSel]   = useState<PrestamoMin | null>(null);
  const [cargandoPrest, setCargandoPrest] = useState(false);

  /* ── Borrar cargo (dos pasos — sin confirm() nativo para evitar bug de focus en Electron) ── */
  const [confirmarBorrarId, setConfirmarBorrarId] = useState<string | null>(null);
  const [borrandoId, setBorrandoId]               = useState<string | null>(null);

  async function borrarCargo(id: string) {
    setBorrandoId(id);
    setConfirmarBorrarId(null);
    try {
      await deleteDoc(doc(db, col('gastos_admin'), id));
      await load(); // re-fetch completo en lugar de filter local
    } catch (e) { console.error(e); }
    setBorrandoId(null);
    // Devolver foco al documento para que Electron vuelva a registrar teclado
    if (typeof document !== 'undefined') {
      setTimeout(() => { document.body.focus(); }, 50);
    }
  }

  /* ── Ajuste manual de cuotas cobradas ── */
  const [ajustandoId, setAjustandoId]   = useState<string | null>(null);
  const [ajusteValor, setAjusteValor]   = useState('');
  const [guardandoAjuste, setGuardandoAjuste] = useState(false);

  function abrirAjuste(cargo: GastoAdmin) {
    setAjustandoId(cargo.id);
    setAjusteValor(String(cargo.cuotas_cobradas ?? 0));
  }

  async function guardarAjuste(cargo: GastoAdmin) {
    const nuevo = parseInt(ajusteValor, 10);
    if (isNaN(nuevo) || nuevo < 0) return;
    const plan = cargo.cuotas_plan || 1;
    setGuardandoAjuste(true);
    try {
      await updateDoc(doc(db, col('gastos_admin'), cargo.id), {
        cuotas_cobradas: Math.min(nuevo, plan),
        ...(nuevo >= plan ? { estado: 'cobrado', cobrado_at: new Date().toISOString() } : { estado: 'activo', cobrado_at: null }),
      });
      setAjustandoId(null);
      await load(); // re-fetch en lugar de setLista optimista
    } catch (e) { console.error(e); }
    setGuardandoAjuste(false);
    if (typeof document !== 'undefined') {
      setTimeout(() => { document.body.focus(); }, 50);
    }
  }

  /* ── Cargar historial ── */
  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, col('gastos_admin')), orderBy('created_at', 'desc'))
      );
      setLista(snap.docs.map(d => ({ id: d.id, ...d.data() } as GastoAdmin)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(); }, [col]));

  /* ── Abrir modal ── */
  async function abrirNuevo() {
    setLineas(lineasIniciales());
    setFechaCargo(hoyStr);
    setClienteSel(null);
    setBusqueda('');
    setPrestamosCliente([]);
    setPrestamoSel(null);
    // Pre-seleccionar el usuario actual como cobrador
    setCobradorSel(perfil ? { id: perfil.id, nombre: perfil.nombre } : null);
    setModalNuevo(true);
    // Cargar perfiles activos para el selector de cobrador
    try {
      const snap = await getDocs(
        query(collection(db, 'perfiles'), where('activo', '==', true))
      );
      setPerfilesLista(
        snap.docs.map(d => ({
          id: d.id,
          nombre: (d.data().nombre as string) || '—',
          rol: (d.data().rol as string) || '',
        })).sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
    } catch (e) { console.warn('perfiles:', e); }
    // Forzar foco al documento para que Electron registre el teclado en los inputs del modal
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const inp = document.querySelector('input[placeholder="Concepto..."]') as HTMLInputElement
               ?? document.querySelector('input') as HTMLInputElement;
        inp?.focus();
      }, 150);
    }
    setCargandoCli(true);
    try {
      const snap = await getDocs(
        query(collection(db, col('clientes')), where('activo', '==', true))
      );
      setClientesLista(
        snap.docs
          .map(d => { const dd = d.data(); return { id:d.id, nombre:dd.nombre||'—', dui:dd.dui||'' }; })
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
    } catch (e) { console.error(e); }
    setCargandoCli(false);
  }

  /* ── Cargar préstamos activos de un cliente ── */
  async function fetchPrestamosCliente(clienteId: string) {
    setCargandoPrest(true);
    setPrestamosCliente([]);
    setPrestamoSel(null);
    try {
      const snap = await getDocs(
        query(
          collection(db, col('prestamos')),
          where('cliente_id', '==', clienteId),
          where('estado', 'in', ['activo', 'mora']),
        )
      );
      const lista: PrestamoMin[] = snap.docs.map(d => ({
        id: d.id,
        monto:          (d.data().monto as number) || 0,
        plazo:          (d.data().plazo as number) || 1,
        fecha_inicio:   (d.data().fecha_inicio as string) || '',
        numero_credito: (d.data().numero_credito as number | undefined),
        estado:         (d.data().estado as string) || 'activo',
        frecuencia:     (d.data().frecuencia as string) || 'diario',
      }));
      // Ordenar por fecha_inicio desc (más reciente primero)
      lista.sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
      setPrestamosCliente(lista);
      // Auto-asignar si solo hay uno
      if (lista.length === 1) setPrestamoSel(lista[0]);
    } catch (e) { console.error(e); }
    setCargandoPrest(false);
  }

  /* ── Helpers para editar líneas ── */
  function toggleLinea(key: TipoCargo, val: boolean) {
    setLineas(prev => prev.map(l => l.key === key ? { ...l, activo: val } : l));
  }
  function setLineaConcepto(key: TipoCargo, val: string) {
    setLineas(prev => prev.map(l => l.key === key ? { ...l, concepto: val } : l));
  }
  function setLineaMonto(key: TipoCargo, val: string) {
    setLineas(prev => prev.map(l => l.key === key ? { ...l, monto: val.replace(/[^0-9.]/g,'') } : l));
  }

  /* ── Cálculo de distribución por cuota ── */
  const lineasActivas = useMemo(() => lineas.filter(l => l.activo), [lineas]);
  const totalActivo   = useMemo(() =>
    lineasActivas.reduce((a, l) => a + (parseFloat(l.monto) || 0), 0),
    [lineasActivas]
  );
  // Monto por cuota (redondeado a 2 decimales)
  const cuotasPlan     = prestamoSel?.plazo || 0;
  const montoPorCuota  = cuotasPlan > 0
    ? Math.round((totalActivo / cuotasPlan) * 100) / 100
    : 0;

  async function guardarCargos() {
    if (!clienteSel) { alert('Selecciona un cliente.'); return; }
    if (lineasActivas.length === 0) { alert('Activa al menos un tipo de cargo.'); return; }
    const invalidas = lineasActivas.filter(l => !parseFloat(l.monto) || parseFloat(l.monto) <= 0);
    if (invalidas.length > 0) {
      alert(`Ingresa un monto válido en: ${invalidas.map(l=>l.label).join(', ')}`);
      return;
    }

    setGuardando(true);
    try {
      const items = lineasActivas.map(l => ({
        tipo:     l.key,
        concepto: l.concepto.trim() || l.label,
        monto:    parseFloat(l.monto),
      }));
      const tieneDistribucion = prestamoSel && prestamoSel.plazo > 0;

      // Guardar UN SOLO registro agrupado con distribución por cuota
      await addDoc(collection(db, col('gastos_admin')), {
        cliente_id:      clienteSel.id,
        cliente_nombre:  clienteSel.nombre,
        cliente_dui:     clienteSel.dui,
        concepto:        items.map(i => i.concepto).join(' + '),
        items,
        monto:           totalActivo,
        tipo_cobro:      tieneDistribucion ? 'distribuido' : 'unico',
        monto_por_cuota: tieneDistribucion ? montoPorCuota : totalActivo,
        cuotas_plan:     tieneDistribucion ? prestamoSel!.plazo : 1,
        cuotas_cobradas: 0,
        fecha:           fechaCargo || hoyStr,
        cobrador_id:     cobradorSel?.id || perfil?.id || '',
        cobrador_nombre: cobradorSel?.nombre || perfil?.nombre || '',
        created_at:      new Date().toISOString(),
        prestamo_id:        prestamoSel?.id || null,
        prestamo_monto:     prestamoSel?.monto || null,
        prestamo_frecuencia: prestamoSel?.frecuencia || 'diario',
        estado:          'activo',
        cobrado_at:      null,
      });

      setModalNuevo(false);
      // Cargo único → factura inmediata por el total
      // Cargo distribuido → sin PDF aquí; cada cobro genera su propia factura de $X/cuota
      if (!tieneDistribucion) {
        imprimirFactura(
          clienteSel,
          items.map(i => ({ concepto: i.concepto, monto: i.monto })),
          fechaCargo || hoyStr,
          cobradorSel?.nombre || perfil?.nombre,
        );
      }
      load();
    } catch (e) { console.error(e); alert('Error al guardar'); }
    setGuardando(false);
  }

  /* ── Generar PDF (igual al formato colecta/reportes) ── */
  function imprimirFactura(
    cliente: ClienteOpt,
    items: { concepto: string; monto: number }[],
    fecha: string,
    cobrador?: string,
  ) {
    const total = items.reduce((a, b) => a + b.monto, 0);
    const fechaStr = fecha
      ? new Date(fecha + 'T12:00:00').toLocaleDateString('es-SV', {
          day:'2-digit', month:'2-digit', year:'numeric',
        })
      : new Date().toLocaleDateString('es-SV', { day:'2-digit', month:'2-digit', year:'numeric' });
    const cobradorNom = cobrador || perfil?.nombre || 'Cobrador';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Cargos Administración</title>
<style>
  @page { size: A4 portrait; margin: 18mm 15mm 15mm 15mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #222; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; }
  .htitle { font-size:18px; font-weight:900; color:#0a2463; letter-spacing:1px; }
  .hsub { font-size:10px; color:#555; margin-top:3px; }
  .hdate { font-size:12px; font-weight:700; color:#0a2463; white-space:nowrap; }
  table { width:100%; border-collapse:collapse; margin-bottom:10px; }
  thead tr { background:#0a2463; }
  thead th { color:#fff; font-size:10px; font-weight:700; padding:7px 8px; text-align:left; }
  tbody tr:nth-child(even) { background:#f5f7ff; }
  tbody td { padding:6px 8px; font-size:11px; border-bottom:1px solid #e0e0e0; }
  .r { text-align:right; }
  .bold { font-weight:700; }
  .cl { font-weight:700; color:#0a2463; }
  .total-row td { background:#0a2463; color:#fff; font-weight:800; font-size:12px; padding:8px 8px; }
  .firmas { display:flex; gap:40px; margin-top:32px; }
  .fbox { flex:1; text-align:center; }
  .fline { border-top:1px solid #333; margin-top:28px; margin-bottom:4px; }
  .flbl { font-size:9px; color:#666; }
  .footer { text-align:center; margin-top:14px; font-size:9px; color:#999;
    border-top:1px dashed #ccc; padding-top:7px; }
</style></head><body>

<div class="header">
  <div>
    <div class="htitle">CARGOS · ADMINISTRACIÓN</div>
    <div class="hsub">Cobrador: <b>${cobradorNom}</b> &nbsp;·&nbsp; SOLUCIONES FINANCIERAS CAS EXPRESS</div>
  </div>
  <div class="hdate">${fechaStr}</div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:4%">#</th>
      <th style="width:30%">Nombre</th>
      <th style="width:16%">DUI</th>
      <th style="width:36%">Concepto</th>
      <th style="width:14%; text-align:right">Monto</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="cl">${cliente.nombre.toUpperCase()}</td>
        <td style="font-size:10px; color:#666">${cliente.dui || '—'}</td>
        <td>${it.concepto}</td>
        <td class="r bold">$${it.monto.toFixed(2)}</td>
      </tr>`).join('')}
    <tr class="total-row">
      <td colspan="4">TOTALES</td>
      <td class="r">$${total.toFixed(2)}</td>
    </tr>
  </tbody>
</table>

<div class="firmas">
  <div class="fbox"><div class="fline"></div><div class="flbl">Asesor</div></div>
  <div class="fbox"><div class="fline"></div><div class="flbl">Firma</div></div>
  <div class="fbox"><div class="fline"></div><div class="flbl">Efectivo $</div></div>
</div>

<div class="footer">
  SOLUCIONES FINANCIERAS CAS EXPRESS &nbsp;·&nbsp; Colecta generada automáticamente &nbsp;·&nbsp; ${fechaStr}
</div>
</body></html>`;

    // Mismo canal que colecta/reportes → genera PDF en temp y abre en Edge
    if (elAPI?.printPreview) {
      elAPI.printPreview(html);
    } else {
      const blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    }
  }

  /* ── Imprimir plan de distribución — tabla igual a amortización del préstamo ── */
  function imprimirPlanDistribucion(
    cliente: ClienteOpt,
    items: { concepto: string; monto: number }[],
    total: number,
    cuotasPlan: number,
    montoPorCuota: number,
    fecha: string,
    cobrador?: string,
    cuotasCobradas?: number,
    frecuenciaPrestamo?: string,
  ) {
    // Textos según frecuencia del préstamo
    const esSemanal = frecuenciaPrestamo === 'semanal';
    const lblCuota     = esSemanal ? 'semanal'   : 'diaria';
    const lblCuotas    = esSemanal ? 'semanales' : 'diarias';
    const lblDia       = esSemanal ? 'Semana'    : 'Día';
    const fechaStr = fecha
      ? new Date(fecha + 'T12:00:00').toLocaleDateString('es-SV', {
          day:'2-digit', month:'2-digit', year:'numeric',
        })
      : new Date().toLocaleDateString('es-SV', { day:'2-digit', month:'2-digit', year:'numeric' });
    const cobradorNom = cobrador || perfil?.nombre || 'Cobrador';
    const cobradas = cuotasCobradas ?? 0;

    // Fecha de inicio del plan (usa la fecha del cargo)
    const fechaBase = fecha ? new Date(fecha + 'T12:00:00') : new Date();
    const pasoDias  = esSemanal ? 7 : 1;

    // Generar filas en dos columnas para ahorrar espacio vertical
    const mitad = Math.ceil(cuotasPlan / 2);
    const filasCol = (desde: number, hasta: number) =>
      Array.from({ length: hasta - desde }, (_, i) => {
        const num = desde + i + 1;
        const pagada = num <= cobradas;
        // Calcular fecha real de esta cuota
        const fechaCuota = new Date(fechaBase);
        fechaCuota.setDate(fechaBase.getDate() + (num - 1) * pasoDias);
        const fechaCuotaStr = fechaCuota.toLocaleDateString('es-SV', {
          day: '2-digit', month: '2-digit', year: 'numeric',
        });
        return `<tr style="${pagada ? 'background:#e8f5e9;' : ''}">
          <td style="text-align:center; font-weight:700; color:#0a2463; width:12%">${num}</td>
          <td style="text-align:center; font-size:9.5px; white-space:nowrap; width:38%">${fechaCuotaStr}</td>
          <td style="text-align:right; width:25%">$${montoPorCuota.toFixed(2)}</td>
          <td style="text-align:center; width:25%; color:${pagada ? '#2e7d32' : '#aaa'}; font-weight:${pagada ? '700' : '400'}">
            ${pagada ? '✓' : '—'}
          </td>
        </tr>`;
      }).join('');
    const filasA = filasCol(0, mitad);
    const filasB = filasCol(mitad, cuotasPlan);

    const totalCobrado = cobradas * montoPorCuota;
    const totalPendiente = total - totalCobrado;

    // Detalle de cada cargo (visita, papelería, etc.)
    const itemsHtml = items.map((it, i) => `
      <tr>
        <td style="text-align:center; color:#555">${i + 1}</td>
        <td style="font-weight:600">${it.concepto}</td>
        <td style="text-align:right; font-weight:700; color:#0a2463">$${it.monto.toFixed(2)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Plan de Cobros Administrativos</title>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm 12mm 14mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 11.5px; color: #222; }
  /* Header */
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:9px;
    padding-bottom:7px; border-bottom:2px solid #0a2463; }
  .htitle { font-size:17px; font-weight:900; color:#0a2463; letter-spacing:0.5px; }
  .hsubtitle { font-size:11px; font-weight:700; color:#1565c0; margin-top:2px; }
  .hsub { font-size:10px; color:#555; margin-top:2px; }
  .hdate { font-size:11px; font-weight:700; color:#0a2463; text-align:right; }
  /* Cliente box */
  .cli-box { background:#f0f4ff; border-left:4px solid #0a2463; padding:8px 14px;
    margin-bottom:9px; display:flex; justify-content:space-between; align-items:center; }
  .cli-nom { font-size:14px; font-weight:800; color:#0a2463; }
  .cli-dui { font-size:10.5px; color:#444; margin-top:2px; }
  .monto-cuota { text-align:right; }
  .monto-cuota-lbl { font-size:10px; color:#555; text-transform:capitalize; }
  .monto-cuota-val { font-size:22px; font-weight:900; color:#1565c0; }
  /* Clausula */
  .clausula { background:#fffde7; border:1px solid #f9a825; border-radius:5px;
    padding:8px 11px; font-size:10.5px; color:#333; line-height:1.6; }
  .clausula b { color:#0a2463; }
  /* Detalle cargos */
  .sec-title { font-size:10px; font-weight:700; color:#1565c0; text-transform:uppercase;
    letter-spacing:0.5px; margin-bottom:5px; }
  table { width:100%; border-collapse:collapse; }
  .tbl-det thead tr { background:#0a2463; }
  .tbl-det thead th { color:#fff; font-size:10px; font-weight:700; padding:5px 8px; }
  .tbl-det tbody td { padding:4px 8px; font-size:11px; border-bottom:1px solid #e0e0e0; }
  .tbl-det tfoot td { background:#e8f0fe; font-weight:800; font-size:11px; padding:5px 8px; color:#0a2463; }
  /* Plan cuotas */
  .tbl-plan thead tr { background:#1565c0; }
  .tbl-plan thead th { color:#fff; font-size:10px; font-weight:700; padding:5px 7px; }
  .tbl-plan tbody td { padding:4px 7px; font-size:11px; border-bottom:1px solid #ececec; }
  .tbl-plan tbody tr:nth-child(even) { background:#f7f9ff; }
  .tbl-plan .cobrado-row { background:#e8f5e9 !important; }
  /* Resumen */
  .res-box { flex:1; border-radius:5px; padding:6px 10px; text-align:center; }
  .res-val { font-size:14px; font-weight:800; }
  .res-lbl { font-size:9.5px; color:#555; margin-top:2px; }
  /* Aceptación */
  .aceptacion { border:1.5px solid #0a2463; border-radius:5px; padding:9px 12px;
    margin-bottom:10px; font-size:10.5px; color:#333; line-height:1.65; }
  .aceptacion b { color:#0a2463; }
  /* Firmas */
  .firmas { display:flex; gap:28px; margin-top:10px; }
  .fbox { flex:1; }
  .fspace { height:52px; }
  .fline { border-top:1.5px solid #333; margin-bottom:5px; }
  .fnom { font-size:10.5px; font-weight:700; color:#222; }
  .flbl { font-size:9.5px; color:#666; }
  .fextra { display:flex; gap:4px; align-items:center; margin-top:7px; }
  .fextra-lbl { font-size:10px; color:#555; white-space:nowrap; }
  .fextra-line { flex:1; border-bottom:1px solid #555; }
  /* Footer */
  .footer { text-align:center; margin-top:10px; font-size:9px; color:#999;
    border-top:1px dashed #ccc; padding-top:6px; }
</style></head><body>

<!-- HEADER -->
<div class="header">
  <div>
    <div class="htitle">SOLUCIONES FINANCIERAS CAS EXPRESS</div>
    <div class="hsubtitle">PLAN DE COBROS ADMINISTRATIVOS</div>
    <div class="hsub">Asesor: ${cobradorNom}</div>
  </div>
  <div class="hdate">
    Fecha: ${fechaStr}<br>
  </div>
</div>

<!-- DATOS DEL CLIENTE -->
<div class="cli-box">
  <div>
    <div class="cli-nom">${cliente.nombre.toUpperCase()}</div>
    ${cliente.dui ? `<div class="cli-dui">DUI: ${cliente.dui}</div>` : ''}
  </div>
  <div class="monto-cuota">
    <div class="monto-cuota-lbl">Cargo por cuota ${lblCuota}</div>
    <div class="monto-cuota-val">$${montoPorCuota.toFixed(2)}</div>
  </div>
</div>

<!-- FILA: cláusula + detalle de cargos (lado a lado) -->
<div style="display:flex; gap:8px; margin-bottom:5px;">
  <!-- Cláusula -->
  <div class="clausula" style="flex:1.2">
    La empresa <b>SOLUCIONES FINANCIERAS CAS EXPRESS</b> le informa al cliente que, adicional a las cuotas
    de su préstamo, se le aplicarán los siguientes cargos administrativos por los servicios prestados.
    Dichos cargos serán distribuidos en <b>${cuotasPlan} cuotas ${lblCuotas} de $${montoPorCuota.toFixed(2)}</b>
    cada una, cobradas junto con la cuota ordinaria del crédito.
  </div>
  <!-- Detalle de cargos -->
  <div style="flex:1">
    <div class="sec-title">Detalle de cargos</div>
    <table class="tbl-det">
      <thead>
        <tr>
          <th style="width:8%; text-align:center">#</th>
          <th>Descripción</th>
          <th style="width:25%; text-align:right">Monto</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="font-weight:800">TOTAL</td>
          <td style="text-align:right; font-weight:800">$${total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>

<!-- PLAN DE CUOTAS — dos columnas -->
<div class="sec-title">Plan de cobro — ${cuotasPlan} cuotas ${lblCuotas} de $${montoPorCuota.toFixed(2)}</div>
<div style="display:flex; gap:6px; margin-bottom:5px;">
  <!-- Columna A -->
  <table class="tbl-plan" style="flex:1">
    <thead>
      <tr>
        <th style="text-align:center; width:12%">#</th>
        <th style="text-align:center; width:38%">Fecha</th>
        <th style="text-align:right; width:25%">Cargo</th>
        <th style="text-align:center; width:25%">Estado</th>
      </tr>
    </thead>
    <tbody>${filasA}</tbody>
  </table>
  <!-- Columna B -->
  <table class="tbl-plan" style="flex:1">
    <thead>
      <tr>
        <th style="text-align:center; width:12%">#</th>
        <th style="text-align:center; width:38%">Fecha</th>
        <th style="text-align:right; width:25%">Cargo</th>
        <th style="text-align:center; width:25%">Estado</th>
      </tr>
    </thead>
    <tbody>${filasB}</tbody>
  </table>
</div>

<!-- Totales + resumen en una fila -->
<div style="display:flex; gap:6px; margin-bottom:5px; align-items:stretch;">
  <div style="flex:1; background:#0a2463; color:#fff; border-radius:4px; padding:4px 8px; display:flex; justify-content:space-between; align-items:center;">
    <span style="font-size:8px; font-weight:700">TOTAL CARGOS ADMIN</span>
    <span style="font-size:11px; font-weight:900">$${total.toFixed(2)}</span>
  </div>
  ${cobradas > 0 ? `
  <div class="res-box" style="flex:1; background:#e8f5e9">
    <div class="res-val" style="color:#2e7d32">$${totalCobrado.toFixed(2)}</div>
    <div class="res-lbl">Cobrado · ${cobradas} cuota${cobradas !== 1 ? 's' : ''}</div>
  </div>
  <div class="res-box" style="flex:1; background:#fff3e0">
    <div class="res-val" style="color:#e65100">$${totalPendiente.toFixed(2)}</div>
    <div class="res-lbl">Pendiente · ${cuotasPlan - cobradas} cuota${(cuotasPlan - cobradas) !== 1 ? 's' : ''}</div>
  </div>` : ''}
</div>

<!-- ACEPTACIÓN DEL CLIENTE -->
<div class="aceptacion">
  Yo, <b>${cliente.nombre.toUpperCase()}</b>${cliente.dui ? `, con DUI <b>${cliente.dui}</b>` : ''},
  declaro haber recibido información completa sobre los cargos administrativos detallados en el
  presente documento y <b>acepto que dichos montos serán cobrados de forma distribuida</b> junto
  con las cuotas ordinarias de mi préstamo, conforme al plan indicado. Entiendo que cada cuota
  incluirá un cargo adicional de <b>$${montoPorCuota.toFixed(2)}</b> por ${cuotasPlan} ${lblCuotas}
  hasta completar el monto total de <b>$${total.toFixed(2)}</b>.
</div>

<!-- FIRMAS -->
<div class="firmas">
  <!-- Acreedor -->
  <div class="fbox">
    <div class="fspace"></div>
    <div class="fline"></div>
    <div class="fnom">SOLUCIONES FINANCIERAS CAS EXPRESS</div>
    <div class="flbl">ACREEDOR — ASTRID SIBRIAN</div>
  </div>
  <!-- Deudor -->
  <div class="fbox">
    <div class="fspace"></div>
    <div class="fline"></div>
    <div class="fnom">${cliente.nombre.toUpperCase()}</div>
    <div class="flbl">DEUDOR${cliente.dui ? ` — DUI: ${cliente.dui}` : ''}</div>
    <div class="fextra" style="margin-top:8px">
      <span class="fextra-lbl">Fecha:</span>
      <span class="fextra-line"></span>
    </div>
    <div class="fextra">
      <span class="fextra-lbl">Lugar:</span>
      <span class="fextra-line"></span>
    </div>
  </div>
</div>

<div class="footer">
  SOLUCIONES FINANCIERAS CAS EXPRESS &nbsp;·&nbsp; Documento generado el ${fechaStr}
</div>
</body></html>`;

    if (elAPI?.printPreview) {
      elAPI.printPreview(html);
    } else {
      const blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    }
  }

  /* ── Reimprimir factura individual de una cuota ya cobrada ── */
  function imprimirCuotaAdmin(
    cliente: ClienteOpt,
    concepto: string,
    montoCuota: number,
    numeroCuota: number,
    totalCuotas: number,
    fecha: string,
  ) {
    const fechaStr = fecha
      ? new Date(fecha + 'T12:00:00').toLocaleDateString('es-SV', {
          day:'2-digit', month:'2-digit', year:'numeric',
        })
      : new Date().toLocaleDateString('es-SV', { day:'2-digit', month:'2-digit', year:'numeric' });
    const numRec = `ADM-${Date.now().toString().slice(-6)}`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Factura Admin</title>
<style>
  @page{size:80mm auto;margin:4mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:11px;color:#000}
  .hdr{text-align:center;border-bottom:2px solid #0a2463;padding-bottom:8px;margin-bottom:8px}
  .emp{font-size:15px;font-weight:900;color:#0a2463;letter-spacing:1px}
  .sub{font-size:9px;color:#555;margin-top:2px}
  .badge{display:inline-block;background:#0a2463;color:#fff;font-size:9px;
    padding:2px 8px;border-radius:10px;margin:4px 0;font-weight:700;letter-spacing:0.5px}
  .meta{font-size:10px;color:#333;margin:6px 0}
  .cli{background:#f5f7ff;border-left:3px solid #0a2463;padding:6px 8px;margin-bottom:10px;border-radius:0 4px 4px 0}
  .clinm{font-size:13px;font-weight:700;color:#0a2463}
  table{width:100%;border-collapse:collapse;margin-bottom:10px}
  th{background:#0a2463;color:#fff;font-size:9px;padding:5px 6px;text-align:left}
  td{padding:5px 6px;border-bottom:1px solid #e0e0e0;font-size:11px}
  .r{text-align:right;font-weight:600}
  .tot td{font-size:13px;font-weight:800;color:#0a2463;padding:8px 6px;
    border-top:2px solid #0a2463;border-bottom:none;background:#f0f4ff}
  .cobrador{font-size:9px;color:#555;margin-top:10px;text-align:center;border-top:1px dashed #ccc;padding-top:6px}
</style></head><body>
<div class="hdr">
  <div class="emp">CAS EXPRESS</div>
  <div class="sub">Soluciones Financieras · Majahual</div>
  <div class="badge">CARGOS DE ADMINISTRACIÓN</div>
</div>
<div class="meta"><b>Recibo:</b> ${numRec} &nbsp;|&nbsp; <b>Fecha:</b> ${fechaStr}</div>
<div class="cli">
  <div class="clinm">${cliente.nombre.toUpperCase()}</div>
  ${cliente.dui ? `<div class="sub">DUI: ${cliente.dui}</div>` : ''}
</div>
<table>
  <thead><tr><th style="width:70%">CONCEPTO</th><th style="width:30%;text-align:right">MONTO</th></tr></thead>
  <tbody>
    <tr>
      <td>${concepto}<br><span style="font-size:9px;color:#888">Cuota ${numeroCuota} de ${totalCuotas}</span></td>
      <td class="r">$${montoCuota.toFixed(2)}</td>
    </tr>
    <tr class="tot">
      <td>TOTAL</td>
      <td class="r">$${montoCuota.toFixed(2)}</td>
    </tr>
  </tbody>
</table>
<div class="cobrador">Cobrador: ${perfil?.nombre || '—'}</div>
</body></html>`;

    if (elAPI?.printPreview) {
      elAPI.printPreview(html);
    } else {
      const blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    }
  }

  /* ── Datos derivados ── */
  const listaFiltrada = useMemo(() =>
    filtroTipo === 'todos' ? lista : lista.filter(g => g.tipo === filtroTipo),
    [lista, filtroTipo]
  );

  /** Cargos agrupados por cliente (para el render en tarjetas) */
  interface GrupoCliente {
    cliente_id: string;
    cliente_nombre: string;
    cliente_dui: string;
    fecha: string;
    cargos: GastoAdmin[];
    total: number;
  }
  const gruposCliente = useMemo<GrupoCliente[]>(() => {
    const map = new Map<string, GrupoCliente>();
    listaFiltrada.forEach(g => {
      if (!map.has(g.cliente_id)) {
        map.set(g.cliente_id, {
          cliente_id:     g.cliente_id,
          cliente_nombre: g.cliente_nombre,
          cliente_dui:    g.cliente_dui,
          fecha:          g.fecha,
          cargos:         [],
          total:          0,
        });
      }
      const grp = map.get(g.cliente_id)!;
      grp.cargos.push(g);
      grp.total += g.monto;
      // Keep most recent fecha
      if (g.fecha > grp.fecha) grp.fecha = g.fecha;
    });
    return Array.from(map.values());
  }, [listaFiltrada]);
  const totalGeneral = useMemo(() => lista.reduce((a, b) => a + b.monto, 0), [lista]);
  const clientesFiltrados = useMemo(() =>
    clientesLista.filter(c =>
      !busqueda || c.nombre.toLowerCase().includes(busqueda.toLowerCase())
    ), [clientesLista, busqueda]
  );

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color={C.primary}/></View>
  );

  return (
    <View style={s.container}>

      {/* ── HEADER ── */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Administración</Text>
          <Text style={s.subtitle}>
            {lista.length} cargo{lista.length!==1?'s':''} · {formatMoneda(totalGeneral)} total
          </Text>
        </View>
        <View style={{ flexDirection:'row', gap:6 }}>
          <Button icon="refresh" mode="outlined" compact onPress={load}
            textColor="#fff" style={{ borderColor:'rgba(255,255,255,0.4)' }}>
            Recargar
          </Button>
          <TouchableOpacity style={s.btnNuevo} onPress={abrirNuevo}>
            <Text style={s.btnNuevoTxt}>+ Nuevo Cargo</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── FILTROS ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.filtroScroll} contentContainerStyle={s.filtroRow}>
        {([
          { key:'todos', label:'📋 Todos', count: lista.length },
          ...TIPOS_BASE.map(t => ({ key:t.key, label:`${t.icon} ${t.label}`, count: lista.filter(g=>g.tipo===t.key).length }))
        ] as {key:string;label:string;count:number}[]).map(f => (
          <TouchableOpacity key={f.key}
            style={[s.filtroChip, filtroTipo===f.key && s.filtroChipActive]}
            onPress={() => setFiltroTipo(f.key as any)}>
            <Text style={[s.filtroTxt, filtroTipo===f.key && s.filtroTxtActive]}>
              {f.label} ({f.count})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── LISTA AGRUPADA POR CLIENTE ── */}
      <FlatList
        data={gruposCliente}
        keyExtractor={g => g.cliente_id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ padding:12 }}
        renderItem={({ item: grp }) => (
          <Card style={s.card} elevation={2}>
            {/* ── Cabecera de cliente ── */}
            <View style={s.grpHeader}>
              <View style={{ flex:1, minWidth:0 }}>
                <Text style={s.clienteNom} numberOfLines={1}>
                  {grp.cliente_nombre.toUpperCase()}
                </Text>
                {grp.cliente_dui ? (
                  <Text style={s.sub}>DUI: {grp.cliente_dui} · {grp.fecha}</Text>
                ) : (
                  <Text style={s.sub}>{grp.fecha}</Text>
                )}
              </View>
              <View style={{ alignItems:'flex-end' }}>
                <Text style={s.grpTotal}>{formatMoneda(grp.total)}</Text>
                <Text style={{ fontSize:10, color:C.textTer }}>
                  {grp.cargos.length} cargo{grp.cargos.length!==1?'s':''}
                </Text>
              </View>
            </View>

            {/* ── Líneas de cargo ── */}
            {grp.cargos.map((cargo, idx) => {
              const tipo = TIPOS_BASE.find(t => t.key === (cargo as any).tipo);
              const esBorrando = borrandoId === cargo.id;
              const esDistribuido = cargo.tipo_cobro === 'distribuido';
              const cobradas = cargo.cuotas_cobradas || 0;
              const plan     = cargo.cuotas_plan || 1;
              const pct      = Math.round((cobradas / plan) * 100);
              return (
                <View key={cargo.id}
                  style={[s.cargoRow, idx < grp.cargos.length - 1 && s.cargoRowBorder,
                    { flexDirection:'column', alignItems:'stretch', gap:6 }]}>
                  {/* Fila principal */}
                  <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                    {/* Badge tipo o distribución */}
                    {esDistribuido
                      ? <View style={[s.tipoBadge, { backgroundColor:'#1565c020' }]}>
                          <Text style={[s.tipoBadgeTxt, { color:'#1565c0' }]}>📊 Distribuido</Text>
                        </View>
                      : tipo
                        ? <View style={[s.tipoBadge, { backgroundColor:(tipo.color)+'1a' }]}>
                            <Text style={[s.tipoBadgeTxt, { color:tipo.color }]}>
                              {tipo.icon} {tipo.label}
                            </Text>
                          </View>
                        : null
                    }
                    {/* Concepto */}
                    <Text style={{ flex:1, fontSize:12, color:C.text }} numberOfLines={1}>
                      {cargo.concepto}
                    </Text>
                    {/* Monto total */}
                    <Text style={s.monto}>{formatMoneda(cargo.monto)}</Text>
                    {/* Borrar — dos pasos */}
                    {esBorrando ? (
                      <ActivityIndicator size={14} color="#c62828" style={{ width:30 }}/>
                    ) : confirmarBorrarId === cargo.id ? (
                      <View style={{ flexDirection:'row', gap:4 }}>
                        <TouchableOpacity onPress={() => borrarCargo(cargo.id)}
                          style={[s.btnBorrar, { backgroundColor:'#c62828', paddingHorizontal:8 }]}>
                          <Text style={{ fontSize:11, color:'#fff', fontWeight:'700' }}>✓ Sí</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setConfirmarBorrarId(null)}
                          style={[s.btnBorrar, { backgroundColor:C.isDark?'rgba(255,255,255,0.1)':'#eee' }]}>
                          <Text style={{ fontSize:11, color:C.text, fontWeight:'700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setConfirmarBorrarId(cargo.id)} style={s.btnBorrar}>
                        <Text style={{ fontSize:14, color:'#c62828' }}>🗑</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Barra de progreso + ajuste manual (solo para distribuidos) */}
                  {esDistribuido && (
                    <View style={{ gap:4 }}>
                      {/* Fila progreso + botón ajustar */}
                      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                        <Text style={{ fontSize:10, color:C.textSec }}>
                          {cobradas}/{plan} cuotas · {formatMoneda(cargo.monto_por_cuota||0)}/cuota
                        </Text>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                          <Text style={{ fontSize:10, fontWeight:'700',
                            color: pct >= 100 ? '#2e7d32' : '#1565c0' }}>
                            {pct}% cobrado
                          </Text>
                          {ajustandoId !== cargo.id && (
                            <TouchableOpacity onPress={() => abrirAjuste(cargo)}
                              style={{ borderWidth:1, borderColor:'#1565c0', borderRadius:4,
                                paddingHorizontal:6, paddingVertical:2 }}>
                              <Text style={{ fontSize:10, color:'#1565c0', fontWeight:'700' }}>
                                ✏ Ajustar
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Editor inline de cuotas cobradas */}
                      {ajustandoId === cargo.id && (
                        <View style={{ flexDirection:'row', alignItems:'center', gap:8,
                          backgroundColor:C.isDark?'rgba(21,101,192,0.12)':'#e8f0fe',
                          borderRadius:8, padding:8, borderWidth:1, borderColor:'#1565c0' }}>
                          <Text style={{ fontSize:12, color:'#1565c0', fontWeight:'600' }}>
                            Cuotas cobradas:
                          </Text>
                          {Platform.OS === 'web'
                            ? <input
                                type="number"
                                value={ajusteValor}
                                min={0}
                                max={plan}
                                onChange={e => setAjusteValor((e.target as any).value)}
                                style={{ width:60, fontSize:14, fontWeight:'700', textAlign:'center',
                                  border:'1.5px solid #1565c0', borderRadius:6, padding:'4px 6px',
                                  background:'#fff', color:'#0d47a1', outline:'none' } as any}
                              />
                            : <TextInput value={ajusteValor} onChangeText={setAjusteValor}
                                keyboardType="number-pad" mode="outlined" dense
                                style={{ width:70 }}/>
                          }
                          <Text style={{ fontSize:12, color:'#555' }}>de {plan}</Text>
                          <TouchableOpacity onPress={() => guardarAjuste(cargo)}
                            disabled={guardandoAjuste}
                            style={{ backgroundColor:'#1565c0', borderRadius:6,
                              paddingHorizontal:10, paddingVertical:5 }}>
                            {guardandoAjuste
                              ? <ActivityIndicator size={14} color="#fff"/>
                              : <Text style={{ color:'#fff', fontSize:12, fontWeight:'700' }}>✓ Guardar</Text>
                            }
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setAjustandoId(null)}
                            style={{ paddingHorizontal:6, paddingVertical:5 }}>
                            <Text style={{ fontSize:12, color:'#888' }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Barra de progreso */}
                      <View style={{ height:6, backgroundColor:C.isDark?'rgba(255,255,255,0.1)':'#e0e0e0',
                        borderRadius:3, overflow:'hidden' }}>
                        <View style={{ height:6, borderRadius:3, width:`${pct}%` as any,
                          backgroundColor: pct >= 100 ? '#2e7d32' : '#1565c0' }}/>
                      </View>
                      <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
                        <Text style={{ fontSize:10, color:'#2e7d32' }}>
                          Cobrado: {formatMoneda((cargo.monto_por_cuota||0) * cobradas)}
                        </Text>
                        <Text style={{ fontSize:10, color: pct >= 100 ? '#2e7d32' : '#e65100' }}>
                          {pct >= 100 ? '✅ Completado' : `Pendiente: ${formatMoneda((cargo.monto_por_cuota||0) * (plan - cobradas))}`}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            {/* ── Pie: total + reimprimir ── */}
            <View style={s.grpFooter}>
              {grp.cargos.some(c => c.tipo_cobro === 'distribuido')
                ? (() => {
                    const c = grp.cargos.find(c => c.tipo_cobro === 'distribuido')!;
                    const cobradas = c.cuotas_cobradas || 0;
                    const clienteRef = { id: grp.cliente_id, nombre: grp.cliente_nombre, dui: grp.cliente_dui };
                    const itemsRef = c.items
                      ? c.items.map(i => ({ concepto: i.concepto, monto: i.monto }))
                      : [{ concepto: c.concepto, monto: c.monto }];
                    return (
                      <View style={{ flexDirection:'column', gap:4 }}>
                        {/* Plan siempre visible */}
                        <TouchableOpacity style={s.btnFactura}
                          onPress={async () => {
                            let freq = c.prestamo_frecuencia;
                            // Si el cargo es antiguo y no tiene frecuencia guardada, buscarla del préstamo
                            if (!freq && c.prestamo_id) {
                              try {
                                const snap = await getDoc(doc(db, col('prestamos'), c.prestamo_id));
                                if (snap.exists()) freq = snap.data().frecuencia as string;
                              } catch {}
                            }
                            imprimirPlanDistribucion(
                              clienteRef, itemsRef, c.monto,
                              c.cuotas_plan || 1, c.monto_por_cuota || 0,
                              grp.fecha, c.cobrador_nombre, cobradas, freq,
                            );
                          }}>
                          <Text style={s.btnFacturaTxt}>📋 Plan de cobros</Text>
                        </TouchableOpacity>
                        {/* Factura individual solo si ya hay cuotas cobradas */}
                        {cobradas > 0 && (
                          <TouchableOpacity style={s.btnFactura}
                            onPress={() => imprimirCuotaAdmin(
                              clienteRef, c.concepto, c.monto_por_cuota || 0,
                              cobradas, c.cuotas_plan || 1, grp.fecha,
                            )}>
                            <Text style={s.btnFacturaTxt}>
                              🖨 Factura ${(c.monto_por_cuota||0).toFixed(2)} (cuota {cobradas})
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })()
                : (
                  <TouchableOpacity style={s.btnFactura}
                    onPress={() => imprimirFactura(
                      { id:grp.cliente_id, nombre:grp.cliente_nombre, dui:grp.cliente_dui },
                      grp.cargos.map(c => ({ concepto:c.concepto, monto:c.monto })),
                      grp.fecha,
                    )}>
                    <Text style={s.btnFacturaTxt}>🖨 Reimprimir factura</Text>
                  </TouchableOpacity>
                )
              }
              <View style={s.grpTotalRow}>
                <Text style={s.grpTotalLbl}>TOTAL</Text>
                <Text style={s.grpTotalVal}>{formatMoneda(grp.total)}</Text>
              </View>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize:40 }}>📋</Text>
            <Text style={s.emptyTxt}>No hay cargos registrados</Text>
            <Text style={s.emptyNote}>Usa "+ Nuevo Cargo" para agregar visitas, papelería o gasolina</Text>
            <Button mode="contained" onPress={abrirNuevo}
              style={{ marginTop:16, backgroundColor:C.primary }}>
              + Agregar primer cargo
            </Button>
          </View>
        }
      />

      {/* ════════════════════════════════════════════════
          MODAL: NUEVO CARGO (MÚLTIPLE)
      ════════════════════════════════════════════════ */}
      <Modal visible={modalNuevo} transparent animationType="fade"
        onRequestClose={() => setModalNuevo(false)}>
        <View style={s.overlay}>
          <ScrollView contentContainerStyle={{ flexGrow:1, justifyContent:'center', padding:20 }}
            keyboardShouldPersistTaps="always">
            <View style={s.modalBox}>
              <Text style={s.modalTit}>📋 Nuevo Cargo de Administración</Text>

              {/* ── LÍNEAS DE CARGO (todas visibles, toggle activo/inactivo) ── */}
              <Text style={s.secLbl}>CARGOS A INCLUIR</Text>
              {lineas.map(l => (
                <View key={l.key} style={[s.lineaBox, l.activo && { borderColor:l.color, borderWidth:1.5 }]}>
                  {/* Toggle + ícono + label */}
                  <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                    <Switch
                      value={l.activo}
                      onValueChange={v => toggleLinea(l.key, v)}
                      color={l.color}
                      style={{ transform:[{scaleX:0.85},{scaleY:0.85}] }}
                    />
                    <Text style={{ fontSize:20 }}>{l.icon}</Text>
                    <Text style={[s.lineaLabel, l.activo && { color:l.color, fontWeight:'700' }]}>
                      {l.label}
                    </Text>
                  </View>

                  {/* Concepto + Monto (solo visibles si activo) */}
                  {l.activo && (
                    <View style={{ marginTop:8, gap:6 }}>
                      {/* Concepto */}
                      {Platform.OS === 'web'
                        ? <View style={[s.inputWeb, { borderColor:l.color }]}>
                            <input
                              type="text"
                              value={l.concepto}
                              onChange={e => setLineaConcepto(l.key, (e.target as any).value)}
                              placeholder="Concepto..."
                              style={{ flex:1, fontSize:12, border:'none', outline:'none',
                                background:'transparent', color:C.text, width:'100%' } as any}
                            />
                          </View>
                        : <TextInput value={l.concepto}
                            onChangeText={v => setLineaConcepto(l.key, v)}
                            mode="flat" dense
                            style={{ backgroundColor:'transparent', height:36 }}
                            placeholder="Concepto..." />
                      }
                      {/* Monto */}
                      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                        <Text style={{ fontSize:12, color:C.textSec, fontWeight:'600' }}>Monto:</Text>
                        {Platform.OS === 'web'
                          ? <View style={[s.montoWeb, { borderColor:l.color }]}>
                              <Text style={{ color:C.textSec, fontSize:13 }}>$</Text>
                              <input
                                type="text"
                                value={l.monto}
                                onChange={e => setLineaMonto(l.key, (e.target as any).value)}
                                placeholder="0.00"
                                style={{ width:70, fontSize:15, fontWeight:'700', border:'none',
                                  outline:'none', background:'transparent',
                                  color:l.color, textAlign:'right' } as any}
                              />
                            </View>
                          : <TextInput value={l.monto}
                              onChangeText={v => setLineaMonto(l.key, v)}
                              mode="flat" dense keyboardType="decimal-pad"
                              style={{ width:90, backgroundColor:'transparent' }}
                              left={<TextInput.Affix text="$"/>} />
                        }
                      </View>
                    </View>
                  )}
                </View>
              ))}

              {/* ── RESUMEN TOTAL ── */}
              {lineasActivas.length > 0 && (
                <View style={s.resumenBox}>
                  {lineasActivas.map(l => (
                    <View key={l.key} style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:3 }}>
                      <Text style={{ fontSize:12, color:C.textSec }}>{l.icon} {l.concepto||l.label}</Text>
                      <Text style={{ fontSize:12, fontWeight:'700', color:l.color }}>
                        {formatMoneda(parseFloat(l.monto)||0)}
                      </Text>
                    </View>
                  ))}
                  <View style={s.resumenTotal}>
                    <Text style={s.resumenTotalLbl}>TOTAL</Text>
                    <Text style={s.resumenTotalVal}>{formatMoneda(totalActivo)}</Text>
                  </View>
                </View>
              )}

              {/* ── COBRADOR ── */}
              <Text style={[s.secLbl, { marginTop:10 }]}>COBRADOR</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={{ marginBottom:10 }} contentContainerStyle={{ gap:6, paddingVertical:2 }}>
                {perfilesLista.map(p => {
                  const sel = cobradorSel?.id === p.id;
                  return (
                    <TouchableOpacity key={p.id}
                      onPress={() => setCobradorSel({ id:p.id, nombre:p.nombre })}
                      style={{
                        paddingHorizontal:12, paddingVertical:7, borderRadius:20,
                        borderWidth:1.5,
                        borderColor: sel ? '#0a2463' : C.border,
                        backgroundColor: sel
                          ? (C.isDark ? 'rgba(10,36,99,0.6)' : '#e8f0ff')
                          : 'transparent',
                      }}>
                      <Text style={{ fontSize:12, fontWeight: sel ? '800' : '500',
                        color: sel ? (C.isDark ? '#90caf9' : '#0a2463') : C.textSec }}>
                        {sel ? '✓ ' : ''}{p.nombre}
                      </Text>
                      <Text style={{ fontSize:9, color: sel ? '#c8a951' : C.textTer,
                        textAlign:'center', marginTop:1 }}>
                        {p.rol}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── FECHA ── */}
              <Text style={[s.secLbl, { marginTop:10 }]}>FECHA</Text>
              {Platform.OS === 'web'
                ? <View style={[s.inputWeb, { marginBottom:10 }]}>
                    <input
                      type="text"
                      value={fechaCargo}
                      onChange={e => setFechaCargo((e.target as any).value)}
                      placeholder="AAAA-MM-DD"
                      style={{ flex:1, fontSize:14, fontWeight:'600', border:'none', outline:'none',
                        background:'transparent', color:C.text, width:'100%' } as any}
                    />
                  </View>
                : <TextInput label="Fecha (AAAA-MM-DD)" value={fechaCargo}
                    onChangeText={setFechaCargo} mode="outlined"
                    style={{ marginBottom:10 }} />
              }

              {/* ── CLIENTE ── */}
              <Text style={s.secLbl}>CLIENTE *</Text>
              {clienteSel ? (
                <TouchableOpacity onPress={() => { setClienteSel(null); setBusqueda(''); }}
                  style={s.clienteSelBox}>
                  <View style={{ flex:1 }}>
                    <Text style={{ color:'#fff', fontWeight:'700', fontSize:14 }}>
                      {clienteSel.nombre.toUpperCase()}
                    </Text>
                    {clienteSel.dui ? (
                      <Text style={{ color:'rgba(255,255,255,0.7)', fontSize:11 }}>
                        DUI: {clienteSel.dui}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ color:'rgba(255,200,150,0.9)', fontSize:12 }}>✕ cambiar</Text>
                </TouchableOpacity>
              ) : (
                <>
                  {Platform.OS === 'web'
                    ? <View style={[s.inputWeb, { marginBottom:6 }]}>
                        <Text style={{ fontSize:14, color:C.textSec, marginRight:6 }}>🔍</Text>
                        <input
                          type="text"
                          value={busqueda}
                          onChange={e => setBusqueda((e.target as any).value)}
                          placeholder="Buscar cliente..."
                          style={{ flex:1, fontSize:13, border:'none', outline:'none',
                            background:'transparent', color:C.text, width:'100%' } as any}
                        />
                      </View>
                    : <TextInput label="Buscar cliente..." value={busqueda}
                        onChangeText={setBusqueda} mode="outlined"
                        style={{ marginBottom:6 }}
                        left={<TextInput.Icon icon="magnify"/>} />
                  }
                  {cargandoCli
                    ? <ActivityIndicator style={{ marginVertical:8 }}/>
                    : (
                      <View style={s.clientesList}>
                        <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled>
                          {clientesFiltrados.length === 0
                            ? <Text style={{ padding:12, color:C.textSec, fontSize:12 }}>
                                Sin resultados
                              </Text>
                            : clientesFiltrados.slice(0, 80).map(c => (
                              <TouchableOpacity key={c.id} onPress={() => { setClienteSel(c); fetchPrestamosCliente(c.id); }}
                                style={s.clienteRow}>
                                <Text style={s.clienteRowNom}>{c.nombre.toUpperCase()}</Text>
                                {c.dui ? <Text style={s.clienteRowDui}>{c.dui}</Text> : null}
                              </TouchableOpacity>
                            ))
                          }
                        </ScrollView>
                      </View>
                    )
                  }
                </>
              )}

              {/* ── PRÉSTAMO VINCULADO ── */}
              {clienteSel && (
                <View style={{ marginTop:12 }}>
                  <Text style={s.secLbl}>PRÉSTAMO VINCULADO</Text>
                  {cargandoPrest
                    ? <ActivityIndicator size="small" style={{ marginVertical:6 }}/>
                    : prestamosCliente.length === 0
                      ? <View style={{ padding:8, backgroundColor:'#fff3e0', borderRadius:8, marginBottom:8 }}>
                          <Text style={{ fontSize:11, color:'#e65100', fontWeight:'600' }}>
                            ⚠️ Este cliente no tiene préstamos activos. El cargo se guardará sin vincular a un préstamo.
                          </Text>
                        </View>
                      : prestamosCliente.length === 1
                        ? (
                          <View style={[s.prestamoBadge, { borderColor:'#2e7d32' }]}>
                            <Text style={{ fontSize:12, fontWeight:'700', color:'#2e7d32' }}>
                              ✅ Auto-vinculado: Préstamo #{prestamosCliente[0].numero_credito || prestamosCliente[0].id.slice(-6).toUpperCase()}
                            </Text>
                            <Text style={{ fontSize:11, color:'#555', marginTop:2 }}>
                              {formatMoneda(prestamosCliente[0].monto)} · desde {prestamosCliente[0].fecha_inicio}
                            </Text>
                          </View>
                        )
                        : (
                          <>
                            <Text style={{ fontSize:11, color:'#555', marginBottom:6 }}>
                              Tiene {prestamosCliente.length} préstamos activos. Selecciona a cuál vincular:
                            </Text>
                            {prestamosCliente.map(p => (
                              <TouchableOpacity key={p.id}
                                onPress={() => setPrestamoSel(p)}
                                style={[s.prestamoBadge, prestamoSel?.id === p.id && { borderColor:'#0a2463', backgroundColor:'#e8f0ff' }]}>
                                <Text style={{ fontSize:12, fontWeight:'700', color: prestamoSel?.id===p.id ? '#0a2463' : '#333' }}>
                                  {prestamoSel?.id===p.id ? '✅ ' : '○ '}
                                  Préstamo #{p.numero_credito || p.id.slice(-6).toUpperCase()}
                                </Text>
                                <Text style={{ fontSize:11, color:'#555', marginTop:2 }}>
                                  {formatMoneda(p.monto)} · desde {p.fecha_inicio} · {p.estado}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        )
                  }
                </View>
              )}

              {/* ── VISTA PREVIA DE DISTRIBUCIÓN ── */}
              {prestamoSel && totalActivo > 0 && (
                <View style={s.distribucionBox}>
                  <Text style={{ fontSize:11, fontWeight:'800', color:'#1565c0',
                    textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>
                    📊 Distribución por Cuotas
                  </Text>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
                    <Text style={{ fontSize:12, color:'#555' }}>Total cargos admin</Text>
                    <Text style={{ fontSize:13, fontWeight:'700', color:'#0a2463' }}>
                      {formatMoneda(totalActivo)}
                    </Text>
                  </View>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
                    <Text style={{ fontSize:12, color:'#555' }}>Cuotas del préstamo</Text>
                    <Text style={{ fontSize:13, fontWeight:'700', color:'#555' }}>
                      {cuotasPlan} cuotas
                    </Text>
                  </View>
                  <View style={{ borderTopWidth:1.5, borderTopColor:'#1565c0', marginTop:6, paddingTop:8,
                    flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                    <Text style={{ fontSize:13, fontWeight:'800', color:'#1565c0' }}>
                      Cargo por cuota
                    </Text>
                    <Text style={{ fontSize:20, fontWeight:'900', color:'#2e7d32' }}>
                      {formatMoneda(montoPorCuota)}
                    </Text>
                  </View>
                  <Text style={{ fontSize:10, color:'#888', marginTop:4, fontStyle:'italic' }}>
                    Se cobrará {formatMoneda(montoPorCuota)} extra con cada cuota del préstamo.
                    Factura de administración separada por cuota.
                  </Text>
                </View>
              )}

              {/* ── BOTONES ── */}
              <View style={{ flexDirection:'row', gap:10, marginTop:16 }}>
                <Button mode="outlined" onPress={() => setModalNuevo(false)}
                  style={{ flex:1 }} disabled={guardando}>
                  Cancelar
                </Button>
                <Button mode="contained" onPress={guardarCargos}
                  loading={guardando}
                  disabled={guardando || !clienteSel || lineasActivas.length === 0 || totalActivo <= 0}
                  style={{ flex:1, backgroundColor:C.primary }}
                  icon="receipt">
                  Guardar + Factura {lineasActivas.length > 0 ? `(${lineasActivas.length})` : ''}
                </Button>
              </View>

            </View>
          </ScrollView>
        </View>
      </Modal>


    </View>
  );
}

/* ── Estilos ── */
const makeStyles = (C: any) => StyleSheet.create({
  container:        { flex:1, backgroundColor:C.bg, ...glassBgStyle(C) as any },
  center:           { flex:1, justifyContent:'center', alignItems:'center' },
  header:           { padding:16, flexDirection:'row', justifyContent:'space-between',
                      alignItems:'center', ...glassNavyStyle() as any },
  title:            { color:'#fff', fontSize:18, fontWeight:'700' },
  subtitle:         { color:'#c8a951', fontSize:12, marginTop:2 },
  btnNuevo:         { backgroundColor:'#c8a951', borderRadius:8, paddingHorizontal:14, paddingVertical:8 },
  btnNuevoTxt:      { color:'#0a2463', fontWeight:'800', fontSize:13 },
  filtroScroll:     { maxHeight:52,
                      backgroundColor: C.isDark?'rgba(20,30,70,0.50)':'rgba(255,255,255,0.55)',
                      borderBottomWidth:1, borderBottomColor:C.border },
  filtroRow:        { flexDirection:'row', paddingHorizontal:10, paddingVertical:8, gap:6 },
  filtroChip:       { borderRadius:20, borderWidth:1, borderColor:C.border,
                      paddingHorizontal:10, paddingVertical:4 },
  filtroChipActive: { backgroundColor:C.primary, borderColor:C.primary },
  filtroTxt:        { fontSize:11, color:C.textSec, fontWeight:'600' },
  filtroTxtActive:  { color:'#fff' },
  card:             { marginBottom:12, borderRadius:14, ...glassStyle(C) as any, overflow:'hidden' },
  // Grupo cliente
  grpHeader:        { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                      paddingHorizontal:14, paddingTop:12, paddingBottom:8,
                      borderBottomWidth:1, borderBottomColor:C.border },
  grpTotal:         { fontSize:17, fontWeight:'900', color:C.primaryText },
  cargoRow:         { flexDirection:'row', alignItems:'center', gap:6,
                      paddingHorizontal:14, paddingVertical:9 },
  cargoRowBorder:   { borderBottomWidth:1, borderBottomColor: C.isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)' },
  grpFooter:        { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                      paddingHorizontal:14, paddingVertical:10,
                      borderTopWidth:1.5, borderTopColor:C.border,
                      backgroundColor: C.isDark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.02)' },
  grpTotalRow:      { flexDirection:'row', alignItems:'center', gap:8 },
  grpTotalLbl:      { fontSize:11, fontWeight:'700', color:C.textSec, letterSpacing:0.5 },
  grpTotalVal:      { fontSize:15, fontWeight:'900', color:'#2e7d32' },
  tipoBadge:        { alignSelf:'flex-start', borderRadius:4, paddingHorizontal:6,
                      paddingVertical:2 },
  tipoBadgeTxt:     { fontSize:10, fontWeight:'700' },
  clienteNom:       { fontSize:14, fontWeight:'700', color:C.text },
  concepto:         { fontSize:12, color:C.textSec, marginTop:1 },
  sub:              { fontSize:11, color:C.textTer, marginTop:2 },
  monto:            { fontSize:13, fontWeight:'800', color:C.primaryText },
  btnFactura:       { borderWidth:1, borderColor:C.border, borderRadius:6,
                      paddingHorizontal:8, paddingVertical:5 },
  btnFacturaTxt:    { fontSize:11, color:C.textSec, fontWeight:'600' },
  btnBorrar:        { minWidth:30, height:30, justifyContent:'center', alignItems:'center',
                      borderRadius:6, backgroundColor:C.isDark?'rgba(198,40,40,0.12)':'#ffebee',
                      paddingHorizontal:4 },
  empty:            { alignItems:'center', padding:40 },
  emptyTxt:         { color:C.textSec, fontSize:15, marginTop:8, fontWeight:'600' },
  emptyNote:        { color:C.textTer, fontSize:12, marginTop:6, textAlign:'center' },
  // Modal
  overlay:          { flex:1, backgroundColor:'rgba(0,0,0,0.55)' },
  modalBox:         { borderRadius:18, padding:20, ...glassStyle(C) as any,
                      backgroundColor: C.isDark?'rgba(15,25,65,0.95)':'rgba(255,255,255,0.97)' },
  modalTit:         { fontSize:16, fontWeight:'800', color:C.primaryText, marginBottom:12 },
  secLbl:           { fontSize:10, fontWeight:'700', color:C.textSec, letterSpacing:0.8,
                      textTransform:'uppercase', marginBottom:8 },
  // Líneas de cargo
  lineaBox:         { borderWidth:1, borderColor:C.border, borderRadius:12,
                      padding:12, marginBottom:8, backgroundColor:C.isDark
                        ?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.02)' },
  lineaLabel:       { fontSize:13, fontWeight:'500', color:C.textSec },
  // Inputs
  inputWeb:         { flexDirection:'row', alignItems:'center', borderWidth:1.5,
                      borderColor:C.primary, borderRadius:8, paddingHorizontal:10,
                      paddingVertical:7, backgroundColor:C.surface },
  montoWeb:         { flexDirection:'row', alignItems:'center', borderWidth:1.5,
                      borderRadius:8, paddingHorizontal:10, paddingVertical:5,
                      backgroundColor:C.surface },
  // Resumen total
  resumenBox:       { backgroundColor:C.isDark?'rgba(255,255,255,0.05)':'#f5f7ff',
                      borderRadius:10, padding:12, marginTop:4, marginBottom:2 },
  resumenTotal:     { flexDirection:'row', justifyContent:'space-between',
                      borderTopWidth:1.5, borderTopColor:C.primary,
                      marginTop:6, paddingTop:6 },
  resumenTotalLbl:  { fontSize:14, fontWeight:'800', color:C.primaryText },
  resumenTotalVal:  { fontSize:16, fontWeight:'900', color:'#2e7d32' },
  // Distribución preview
  distribucionBox:  { backgroundColor:C.isDark?'rgba(21,101,192,0.12)':'#e3f2fd',
                      borderRadius:10, padding:12, marginTop:4, marginBottom:2,
                      borderWidth:1.5, borderColor:'#1565c0' },
  // Préstamo badge
  prestamoBadge:    { borderWidth:1.5, borderColor:C.border, borderRadius:8,
                      padding:10, marginBottom:6,
                      backgroundColor:C.isDark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.02)' },
  // Selector cliente
  clienteSelBox:    { flexDirection:'row', alignItems:'center', backgroundColor:C.primary,
                      borderRadius:10, padding:12, marginBottom:4, gap:8 },
  clientesList:     { maxHeight:160, borderWidth:1, borderColor:C.border,
                      borderRadius:8, marginBottom:8, overflow:'hidden' },
  clienteRow:       { padding:10, borderBottomWidth:1, borderBottomColor:C.border },
  clienteRowNom:    { fontSize:13, color:C.text, fontWeight:'600' },
  clienteRowDui:    { fontSize:10, color:C.textSec, marginTop:1 },
});
