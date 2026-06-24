import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Modal, Switch, TouchableOpacity } from 'react-native';
import { Text, Card, Button, TextInput, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, query, where, getDocs, getDoc, doc, addDoc, orderBy } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Prestamo, Pago, Cliente } from '../../../src/types';
import {
  generarPDFColecta, generarPDFCartera, generarPDFCuadratura,
  generarPDFCuadraturaDiaria, generarPDFReporteDiario, generarPDFFicha,
  generarPDFTirasBilletes, TiraBillete,
  compartir, setModoCMY, ItemColecta, ItemCartera, ItemCuadratura, SlotCuadratura,
} from '../../../src/utils/pdf';
import { guardarReporteDiario } from '../../../src/utils/reporteXls';
import { calcularVencimiento, calcularMora, formatMoneda, formatFecha, hoy } from '../../../src/utils/calculos';
import { FadeIn } from '../../../src/components/FadeIn';
import { usePersonaEntrega } from '../../../src/hooks/usePersonaEntrega';
import ModalPersonaEntrega from '../../../src/components/ModalPersonaEntrega';

export default function Reportes() {
  const { perfil, isSupervisor } = useAuth();
  const { col } = useEmpresa();
  const [loading, setLoading]   = useState<string | null>(null);
  const [stats, setStats]        = useState<any>(null);
  // Modal Reporte Diario
  const [modalReporte, setModalReporte] = useState(false);
  const [saldoAnt, setSaldoAnt]         = useState('');
  const [zona, setZona]                 = useState('');
  // Renovaciones: texto libre, una por línea → "REFIL 28.5"
  const [renovTxt, setRenovTxt]         = useState('');
  const hoyStr = hoy();
  // ── Modo CMY (impresora sin tinta negra) ──────────────────
  const [modoCMY, setModoCMYLocal] = useState(false);
  function toggleModoCMY(v: boolean) { setModoCMYLocal(v); setModoCMY(v); }
  // Selector "Cobrador" para Colecta del Día
  const pe = usePersonaEntrega(perfil?.nombre);

  // ── Tiras / fajas para billetes ───────────────────────────
  const DENOMINACIONES = [300, 200, 100, 50, 20, 10, 5, 1];
  const [tirasQty, setTirasQty] = useState<Record<number, string>>({});
  const peTiras = usePersonaEntrega(perfil?.nombre);

  function generarTiras() {
    const tiras: TiraBillete[] = DENOMINACIONES
      .map(d => ({ denominacion: d, cantidad: parseInt(tirasQty[d] || '0', 10) || 0 }))
      .filter(t => t.cantidad > 0);
    if (tiras.length === 0) return;
    peTiras.pedir(async (nombre) => {
      const uri = await generarPDFTirasBilletes(tiras, nombre);
      await compartir(uri);
    });
  }

  // ── Historial de reportes diarios ────────────────────────
  const [historial, setHistorial]       = useState<any[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);

  useFocusEffect(useCallback(() => {
    async function cargarHistorial() {
      try {
        const constraints: any[] = [orderBy('fecha','desc')];
        if (!isSupervisor && perfil?.id) constraints.unshift(where('created_by','==',perfil.id));
        const snap = await getDocs(query(collection(db, col('reportes_diarios')), ...constraints));
        setHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch(e) { console.error(e); }
    }
    cargarHistorial();
  }, [perfil?.id, isSupervisor]));

  // ── Selector de fecha para reportes diarios ────────────────
  const [fechaRep, setFechaRep]         = useState(hoyStr);
  const [editandoFecha, setEditandoFecha] = useState(false);
  const [fechaInput, setFechaInput]     = useState(hoyStr);

  /** Fecha de mañana en formato 'YYYY-MM-DD' */
  const mananaStr = (() => {
    const d = new Date(hoyStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  /** Avanza o retrocede un día en el selector de fecha (no permite fecha futura) */
  function cambiarDia(delta: number) {
    const d = new Date(fechaRep + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const nueva = d.toISOString().split('T')[0];
    if (nueva <= hoyStr) {
      setFechaRep(nueva);
      setFechaInput(nueva);
    }
  }

  function confirmarFechaInput() {
    const limpia = fechaInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(limpia) && limpia <= hoyStr) {
      setFechaRep(limpia);
    } else {
      setFechaInput(fechaRep); // revertir si formato incorrecto o fecha futura
    }
    setEditandoFecha(false);
  }

  /* ── Cache de clientes (promise-cache: evita fetches duplicados en paralelo) ── */
  const cc: Record<string, Promise<any>> = {};
  function gc(cid: string) {
    if (!cc[cid]) {
      cc[cid] = getDoc(doc(db, col('clientes'),cid)).then(s =>
        s.exists() ? s.data() : { nombre:'Cliente', telefono:'', numero_expediente:'', geo_codigo:'' }
      );
    }
    return cc[cid];
  }

  /* ── Núcleo de generación de colecta (reutilizable para hoy y mañana) ── */
  async function generarColecta(fechaStr: string, loadingKey: string) {
    setLoading(loadingKey);
    try {
      const constraints: any[] = [where('estado','in',['activo','mora'])];
      if (!isSupervisor && perfil?.id) constraints.push(where('asesor_id','==',perfil.id));
      const snap = await getDocs(query(collection(db, col('prestamos')), ...constraints));
      const prestamos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo));
      if (!prestamos.length) { alert('No hay clientes activos.'); setLoading(null); return; }

      // Fetch pagos y clientes EN PARALELO
      const [pagosResults, clientes] = await Promise.all([
        Promise.all(prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))),
        Promise.all(prestamos.map(p => gc(p.cliente_id))),
      ]);

      const items: ItemColecta[] = [];
      for (let i = 0; i < prestamos.length; i++) {
        const p       = prestamos[i];
        const cliente = clientes[i];

        // Acumular lo pagado por cuota (sólo cuotas reales, numero_cuota > 0)
        const pagadoXCuota = new Map<number, number>();
        pagosResults[i].docs.forEach(d => {
          const pg = d.data();
          if ((pg.numero_cuota || 0) > 0)
            pagadoXCuota.set(pg.numero_cuota, (pagadoXCuota.get(pg.numero_cuota) || 0) + (pg.monto_pagado || 0));
        });
        // Solo cuotas COMPLETAMENTE pagadas cuentan como "pagadas"
        const pagadas = new Set(
          [...pagadoXCuota.entries()]
            .filter(([_, total]) => total >= p.cuota)
            .map(([n]) => n)
        );

        // Primera cuota con saldo pendiente + cuotas vencidas
        let nextN = -1, nextFv = '', cuotasAtrasadas = 0;
        for (let n = 1; n <= p.plazo; n++) {
          if (pagadas.has(n)) continue;
          const fv = calcularVencimiento(p.fecha_inicio, n, p.frecuencia);
          if (nextN === -1) { nextN = n; nextFv = fv; }
          if (fv <= fechaStr) cuotasAtrasadas++;
          else break;
        }
        if (nextN === -1) continue; // todas pagadas

        // Saldo real de la próxima cuota (descontando abonos parciales)
        const abonoParcial = pagadoXCuota.get(nextN) || 0;
        const cuotaACobrar = p.cuota - abonoParcial;

        // Deuda total real: suma de saldos pendientes en todas las cuotas no pagadas
        let deudaTotal = 0;
        for (let n = 1; n <= p.plazo; n++) {
          if (pagadas.has(n)) continue;
          deudaTotal += p.cuota - (pagadoXCuota.get(n) || 0);
        }

        const mora = cuotasAtrasadas * p.cuota;

        items.push({
          cliente:          cliente.nombre,
          expediente:       cliente.numero_expediente || '',
          telefono:         cliente.telefono || '',
          geoLocal:         cliente.geo_codigo || '',
          fechaVencimiento: p.fecha_fin,
          plazo:            p.plazo,
          monto:            p.monto,
          cuota:            cuotaACobrar,   // saldo real a cobrar (no la cuota completa si hay abono)
          frecuencia:       p.frecuencia,
          numeroCuota:      nextN,
          mora,
          deudaTotal,
        });
      }
      if (!items.length) { alert('No hay clientes en la ruta.'); setLoading(null); return; }
      // Ordenar por número de expediente (EXP-01, EXP-02, ...) — si no tiene expediente va al final
      items.sort((a, b) => {
        const numA = parseInt((a.expediente || '').replace(/\D/g, '')) || 9999;
        const numB = parseInt((b.expediente || '').replace(/\D/g, '')) || 9999;
        return numA - numB;
      });
      pe.pedir(async (nombre) => {
        const uri = await generarPDFColecta(fechaStr, items, perfil?.ruta?.nombre||'General', nombre);
        await compartir(uri);
      });
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── 1a. Colecta de HOY ─────────────────────────────────────── */
  const reporteColectaHoy    = () => generarColecta(hoyStr,    'colecta');
  /* ── 1b. Colecta de MAÑANA ─────────────────────────────────── */
  const reporteColectaManana = () => generarColecta(mananaStr, 'colecta_manana');

  /* ── 2. Cuadratura Diaria (grid físico) ─────────────────────── */
  async function reporteCuadraturaDiaria() {
    setLoading('cuadratura');
    try {
      // IGUAL que pagos del día: incluir activo + mora + completado
      // para que el total cuadre con los cobros registrados
      const constraints: any[] = [where('estado','in',['activo','mora','completado'])];
      if (!isSupervisor && perfil?.id) constraints.push(where('asesor_id','==',perfil.id));
      const snap = await getDocs(query(collection(db, col('prestamos')), ...constraints));
      const prestamos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo));

      // Fetch en paralelo
      const [pagosResults, clientes] = await Promise.all([
        Promise.all(prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))),
        Promise.all(prestamos.map(p => gc(p.cliente_id))),
      ]);

      const clienteMap: Record<string,{nombre:string;montoDia:number|null}> = {};
      for (let i = 0; i < prestamos.length; i++) {
        const p       = prestamos[i];
        const pagos   = pagosResults[i].docs.map(d => d.data() as Pago);
        const cliente = clientes[i];
        if (!clienteMap[p.cliente_id]) clienteMap[p.cliente_id] = {nombre:cliente.nombre, montoDia:null};
        // CORRECCIÓN: sumar TODOS los pagos del día del préstamo.
        // Antes: .find() tomaba solo el 1er pago → totales incorrectos
        // cuando un cliente tiene múltiples préstamos o cuotas en el mismo día.
        for (const pg of pagos) {
          if (pg.fecha_pago === fechaRep) {
            clienteMap[p.cliente_id].montoDia =
              (clienteMap[p.cliente_id].montoDia || 0) + pg.monto_pagado;
          }
        }
      }

      // Sumar multas sueltas del día como slot adicional al final
      let totalMultas = 0;
      try {
        const multasSnap = await getDocs(
          query(collection(db, col('multas')), where('fecha','==', fechaRep))
        );
        multasSnap.docs.forEach(d => { totalMultas += (d.data().monto || 0); });
      } catch(_) {}

      const slots: SlotCuadratura[] = Object.values(clienteMap)
        .sort((a,b) => a.nombre.localeCompare(b.nombre))
        .map((c,i) => ({ numero:i+1, cliente:c.nombre, monto:c.montoDia }));

      // Agregar slot de multas si hay
      if (totalMultas > 0) {
        slots.push({ numero: slots.length+1, cliente: 'MULTAS', monto: totalMultas });
      }

      pe.pedir(async (nombre) => {
        const uri = await generarPDFCuadraturaDiaria(
          fechaRep, slots, nombre, perfil?.ruta?.nombre||'', ''
        );
        await compartir(uri);
      });
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── Parsear renovaciones desde texto libre ─────────────────── */
  function parsearRenovaciones(txt: string) {
    return txt.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => {
        // "REFIL 28.5"  →  { descripcion: "REFIL", monto: 28.5 }
        const match = l.match(/^(.*?)\s+([\d.]+)$/);
        if (match) return { descripcion: match[1].trim(), monto: parseFloat(match[2]) };
        return { descripcion: l, monto: 0 };
      });
  }

  /* ── 3. Reporte Diario por Ruta ─────────────────────────────── */
  async function reporteDiario() {
    setModalReporte(false);
    setLoading('diario');
    try {
      // Solo préstamos que pueden tener pagos (excluye cancelados)
      const snap = await getDocs(
        query(collection(db, col('prestamos')), where('estado','in',['activo','mora','completado']))
      );
      const prestamos = snap.docs.map(d => ({ id:d.id, ...d.data() } as Prestamo));

      // Fetch todos los pagos en paralelo
      const pagosResults = await Promise.all(
        prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))
      );

      let cobroDia = 0;
      for (const pagosSnap of pagosResults)
        for (const pgDoc of pagosSnap.docs) {
          const pg = pgDoc.data() as Pago;
          if (pg.fecha_pago === fechaRep) cobroDia += pg.monto_pagado;
        }
      // Sumar multas sueltas
      try {
        const multasSnap = await getDocs(
          query(collection(db, col('multas')), where('fecha','==', fechaRep))
        );
        multasSnap.docs.forEach(d => { cobroDia += (d.data().monto || 0); });
      } catch(_) {}

      const renovaciones = parsearRenovaciones(renovTxt);
      const saldoAnterior = parseFloat(saldoAnt) || 0;
      const cobroDiaFinal = cobroDia;

      pe.pedir(async (nombre) => {
        // ── Generar PDF (impresión) ──
        const uri = await generarPDFReporteDiario(
          fechaRep, cobroDiaFinal, saldoAnterior,
          nombre, perfil?.ruta?.nombre||'', zona, renovaciones
        );
        await compartir(uri);

        // ── Guardar copia Excel en disco ──
        await guardarReporteDiario({
          fecha:         fechaRep,
          cobrador:      nombre,
          ruta:          perfil?.ruta?.nombre || zona || 'General',
          zona,
          saldoAnterior,
          cobroDia:      cobroDiaFinal,
          renovaciones,
        });

        // ── Guardar en Firestore ──
        const totalEntrada = saldoAnterior + cobroDiaFinal;
        await addDoc(collection(db, col('reportes_diarios')), {
          fecha:         fechaRep,
          cobrador:      nombre,
          ruta:          perfil?.ruta?.nombre || zona || 'General',
          zona,
          saldoAnterior,
          cobroDia:      cobroDiaFinal,
          totalEntrada,
          renovaciones,
          created_at:    new Date().toISOString(),
          created_by:    perfil?.id || '',
        });
        // Recargar historial
        const constraints2: any[] = [orderBy('fecha','desc')];
        if (!isSupervisor && perfil?.id) constraints2.unshift(where('created_by','==',perfil.id));
        const snap2 = await getDocs(query(collection(db, col('reportes_diarios')), ...constraints2));
        setHistorial(snap2.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── Regenerar PDF de un reporte del historial ─────────────── */
  async function regenerarPDF(r: any) {
    setLoading('diario');
    try {
      const uri = await generarPDFReporteDiario(
        r.fecha, r.cobroDia, r.saldoAnterior,
        r.cobrador, r.ruta, r.zona || '', r.renovaciones || []
      );
      await compartir(uri);
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── 4. Cartera general ─────────────────────────────────────── */
  async function reporteCartera() {
    setLoading('cartera');
    try {
      // Solo préstamos activos y en mora (completados y cancelados no aparecen)
      const snap = await getDocs(
        query(collection(db, col('prestamos')), where('estado','in',['activo','mora']))
      );
      const prestamos = snap.docs.map(d => ({ id:d.id, ...d.data() } as Prestamo));
      // Traer pagos y clientes de todos los préstamos EN PARALELO
      const [pagosArr, clientesArr] = await Promise.all([
        Promise.all(prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))),
        Promise.all(prestamos.map(p => gc(p.cliente_id))),
      ]);
      const items: ItemCartera[] = prestamos.map((p, i) => {
        const pagadas = pagosArr[i].docs.length;
        const cliente = clientesArr[i];
        const mora    = calcularMora(p.fecha_fin, p.cuota, p.frecuencia, p.plazo);
        return { cliente:cliente.nombre, expediente:cliente.numero_expediente||'',
          monto:p.monto, cuota:p.cuota, frecuencia:p.frecuencia, plazo:p.plazo,
          pagadas, saldo:Math.max(0,(p.plazo-pagadas)*p.cuota),
          mora, estado:p.estado, fechaInicio:p.fecha_inicio };
      });
      items.sort((a,b)=>a.cliente.localeCompare(b.cliente));
      const uri = await generarPDFCartera(items, hoyStr);
      await compartir(uri);
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── 5. Pagos cobrados hoy (cuadratura tabla) ───────────────── */
  async function reportePagosDia() {
    setLoading('pagosdia');
    try {
      const snap = await getDocs(
        query(collection(db, col('prestamos')), where('estado','in',['activo','mora','completado']))
      );
      const prestamos = snap.docs.map(d => ({ id:d.id, ...d.data() } as Prestamo));

      // Fetch todos los pagos en paralelo
      const pagosResults = await Promise.all(
        prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))
      );

      // Recopilar solo los pagos de la fecha seleccionada
      const rawItems: { p: Prestamo; pg: Pago }[] = [];
      for (let i = 0; i < prestamos.length; i++)
        for (const pgDoc of pagosResults[i].docs) {
          const pg = pgDoc.data() as Pago;
          if (pg.fecha_pago === fechaRep) rawItems.push({ p: prestamos[i], pg });
        }

      if (!rawItems.length) { alert(`No hay pagos registrados el ${fechaRep}.`); setLoading(null); return; }

      // Fetch clientes y cobradores en paralelo
      const [clientes, cobradores] = await Promise.all([
        Promise.all(rawItems.map(({ p }) => gc(p.cliente_id))),
        Promise.all(rawItems.map(async ({ pg }) => {
          if (!pg.cobrador_id) return 'Asesor';
          try {
            const cs = await getDoc(doc(db,'perfiles',pg.cobrador_id));
            return cs.exists() ? cs.data().nombre : (pg.cobrador_id || 'Asesor');
          } catch { return pg.cobrador_id || 'Asesor'; }
        })),
      ]);

      const items: ItemCuadratura[] = rawItems.map(({ pg }, i) => ({
        cliente:     clientes[i].nombre,
        expediente:  clientes[i].numero_expediente || '',
        numeroCuota: pg.numero_cuota,
        montoCuota:  pg.monto_cuota,
        mora:        pg.mora || 0,
        total:       pg.monto_pagado,
        cobrador:    cobradores[i],
        fechaPago:   pg.fecha_pago,
      }));

      const uri = await generarPDFCuadratura(fechaRep, items, perfil?.ruta?.nombre||'General');
      await compartir(uri);
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── 6. Fichas de pago en lote ─────────────────────────────── */
  async function reporteFichas() {
    setLoading('fichas');
    try {
      const constraints: any[] = [where('estado','in',['activo','mora']), where('frecuencia','==','diario')];
      if (!isSupervisor && perfil?.id) constraints.push(where('asesor_id','==',perfil.id));
      const snap = await getDocs(query(collection(db, col('prestamos')), ...constraints));
      const prestamos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo));
      if (!prestamos.length) { alert('No hay préstamos diarios activos.'); setLoading(null); return; }

      // Cargar todos los clientes en paralelo
      const clientesData = await Promise.all(prestamos.map(p => gc(p.cliente_id)));
      for (let i = 0; i < prestamos.length; i++) {
        const cs = clientesData[i];
        prestamos[i].cliente = { id: prestamos[i].cliente_id, nombre: cs.nombre,
          telefono: cs.telefono||'', dui: cs.dui||'',
          numero_expediente: cs.numero_expediente||'', activo: true, created_at: '' } as any;
      }
      const uri = await generarPDFFicha(prestamos);
      await compartir(uri);
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  /* ── 7. Resumen mora ────────────────────────────────────────── */
  async function resumenMora() {
    setLoading('mora');
    try {
      const snap = await getDocs(query(collection(db, col('prestamos')),where('estado','in',['activo','mora'])));
      const todos = snap.docs.map(d => ({ id:d.id, ...d.data() } as Prestamo));
      // Pre-filtrar: solo los préstamos ya vencidos (evita fetch innecesario)
      const vencidos = todos.filter(p => p.fecha_fin && p.fecha_fin < hoyStr);
      if (!vencidos.length) { setStats({ count:0, totalMora:0, totalSaldo:0 }); setLoading(null); return; }

      // Fetch en paralelo
      const pagosResults = await Promise.all(
        vencidos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))
      );
      let count=0, totalMora=0, totalSaldo=0;
      for (let i = 0; i < vencidos.length; i++) {
        const p = vencidos[i];
        const pagadas = pagosResults[i].docs.length;
        if (pagadas < p.plazo) {
          count++;
          totalMora  += calcularMora(p.fecha_fin, p.cuota, p.frecuencia, p.plazo);
          totalSaldo += (p.plazo - pagadas) * p.cuota;
        }
      }
      setStats({ count, totalMora, totalSaldo });
    } catch(e) { console.error(e); }
    setLoading(null);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <FadeIn delay={0} duration={250} dy={6} style={{flex:1}}>
    <ScrollView style={s.container} contentContainerStyle={{ padding:16 }}>
      <Text variant="titleLarge" style={s.titulo}>Reportes y Exportación</Text>

      <ReporteCard icon="calendar-today" color={C.primary}
        titulo="Colecta del Día"
        desc="Todos los clientes activos con su próxima cuota pendiente. PDF horizontal listo para imprimir."
        btnLabel="PDF Colecta Hoy" loading={loading==='colecta'} onPress={reporteColectaHoy}
        btnLabel2="PDF Colecta Mañana" loading2={loading==='colecta_manana'} onPress2={reporteColectaManana}
        disabled={!!loading}/>

      {/* ── Selector de fecha para reportes diarios ─────────── */}
      <Card style={s.card} elevation={0}>
        <Card.Content>
          <Text style={{fontSize:11,color:C.textSec,marginBottom:6,fontWeight:'600',letterSpacing:0.5}}>
            📅 FECHA PARA REPORTES DIARIOS
          </Text>
          <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
            <Button mode="outlined" compact onPress={()=>cambiarDia(-1)}
              icon="chevron-left" textColor={C.primaryText}
              style={{borderColor:C.border,minWidth:40}}>
              {''}
            </Button>
            {editandoFecha ? (
              <TextInput
                value={fechaInput}
                onChangeText={setFechaInput}
                mode="outlined"
                placeholder="YYYY-MM-DD"
                style={{flex:1,height:38,fontSize:14}}
                dense
                autoFocus
                onBlur={confirmarFechaInput}
                onSubmitEditing={confirmarFechaInput}
              />
            ) : (
              <Button mode="text" compact
                onPress={()=>{ setFechaInput(fechaRep); setEditandoFecha(true); }}
                textColor={C.primaryText} style={{flex:1}}>
                {fechaRep === hoyStr ? `${fechaRep}  (Hoy)` : fechaRep}
              </Button>
            )}
            <Button mode="outlined" compact
              onPress={()=>cambiarDia(1)} icon="chevron-right"
              disabled={fechaRep >= hoyStr} textColor={C.primaryText}
              style={{borderColor:C.border,minWidth:40}}>
              {''}
            </Button>
          </View>
          {fechaRep !== hoyStr && (
            <Button compact mode="text" onPress={()=>{ setFechaRep(hoyStr); setFechaInput(hoyStr); }}
              textColor={C.textTer} style={{alignSelf:'flex-end',marginTop:2}}>
              Volver a hoy
            </Button>
          )}
        </Card.Content>
      </Card>

      {/* ── Modo CMY ─────────────────────────────────────────── */}
      <Card style={[s.card, modoCMY&&{borderColor:'#c8a951',borderWidth:1}]} elevation={0}>
        <Card.Content>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
            <View style={{flexDirection:'row',alignItems:'center',gap:10,flex:1}}>
              <MaterialCommunityIcons
                name="printer-off-outline"
                size={22}
                color={modoCMY ? '#c8a951' : C.textTer}/>
              <View style={{flex:1}}>
                <Text style={{fontSize:13,fontWeight:'700',color:modoCMY?'#c8a951':C.text}}>
                  Modo CMY (sin negro)
                </Text>
                <Text style={{fontSize:10,color:C.textTer,marginTop:1}}>
                  {modoCMY
                    ? 'Activo — PDFs en gris oscuro (C+M+Y), sin usar cartucho negro'
                    : 'Activar si la impresora no detecta tinta negra'}
                </Text>
              </View>
            </View>
            <Switch
              value={modoCMY}
              onValueChange={toggleModoCMY}
              thumbColor={modoCMY ? '#c8a951' : '#ccc'}
              trackColor={{false:'#555', true:'#7a6020'}}
            />
          </View>
        </Card.Content>
      </Card>

      <ReporteCard icon="grid" color="#6a1b9a"
        titulo="Cuadratura Diaria (Planilla)"
        desc={`Planilla de 125 celdas estilo físico — clientes con montos cobrados el ${fechaRep === hoyStr ? 'hoy' : fechaRep}.`}
        btnLabel="PDF Cuadratura" loading={loading==='cuadratura'} onPress={reporteCuadraturaDiaria}/>

      <ReporteCard icon="cash-register" color="#1b5e20"
        titulo="Pagos Cobrados (Tabla)"
        desc={`Lista detallada de pagos registrados el ${fechaRep === hoyStr ? 'hoy' : fechaRep} con totales de cuota, mora y efectivo.`}
        btnLabel="PDF Pagos del Día" loading={loading==='pagosdia'} onPress={reportePagosDia}/>

      <ReporteCard icon="table-large" color="#e65100"
        titulo="Reporte Diario de Disponible"
        desc={`Resumen tipo Excel: saldo anterior + cobro del ${fechaRep === hoyStr ? 'día' : fechaRep} + renovaciones = total disponible.`}
        btnLabel="Generar Reporte" loading={loading==='diario'} onPress={()=>setModalReporte(true)}/>

      {/* ── Historial de Reportes Diarios ─────────────────── */}
      {historial.length > 0 && (
        <Card style={s.card} elevation={1}>
          <Card.Content>
            <TouchableOpacity
              style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:4}}
              onPress={()=>setVerHistorial(v=>!v)}>
              <Text style={{fontWeight:'700',color:C.primaryText,fontSize:13}}>
                📋 Historial de Reportes ({historial.length})
              </Text>
              <MaterialCommunityIcons
                name={verHistorial ? 'chevron-up' : 'chevron-down'}
                size={20} color={C.primaryText}/>
            </TouchableOpacity>
            {verHistorial && (
              <>
                <Divider style={{marginBottom:8}}/>
                {historial.map((r, i) => (
                  <View key={r.id}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6}}>
                      <View style={{flex:1}}>
                        <Text style={{fontWeight:'700',color:C.text,fontSize:13}}>
                          {formatFecha(r.fecha)}
                          {r.zona ? `  ·  ${r.zona}` : ''}
                        </Text>
                        <Text style={{fontSize:11,color:C.textSec,marginTop:1}}>
                          {r.cobrador}  ·  Cobro: {formatMoneda(r.cobroDia)}  ·  Total: {formatMoneda(r.totalEntrada)}
                        </Text>
                        {r.saldoAnterior > 0 && (
                          <Text style={{fontSize:10,color:C.textTer}}>
                            Saldo ant: {formatMoneda(r.saldoAnterior)}
                          </Text>
                        )}
                      </View>
                      <Button mode="outlined" compact onPress={()=>regenerarPDF(r)}
                        disabled={!!loading} textColor="#e65100"
                        style={{borderColor:'#e65100',borderRadius:8}}>
                        PDF
                      </Button>
                    </View>
                    {i < historial.length - 1 && <Divider/>}
                  </View>
                ))}
              </>
            )}
          </Card.Content>
        </Card>
      )}

      <ReporteCard icon="bank" color="#2e7d32"
        titulo="Estado de Cartera"
        desc="Todos los préstamos con saldo pendiente, cuotas, mora y estado."
        btnLabel="PDF Cartera" loading={loading==='cartera'} onPress={reporteCartera}/>

      <ReporteCard icon="alert-circle" color="#c62828"
        titulo="Resumen de Mora"
        desc="Cantidad de préstamos con cuotas atrasadas y mora total acumulada."
        btnLabel="Ver mora" loading={loading==='mora'} onPress={resumenMora}/>

      <Card style={s.card} elevation={1}>
        <Card.Content style={s.cardContent}>
          <View style={[s.iconBox,{backgroundColor:'#c8a95118'}]}>
            <MaterialCommunityIcons name="card-account-details-outline" size={26} color="#c8a951"/>
          </View>
          <View style={s.cardInfo}>
            <Text style={s.cardTit}>Fichas de Pago en Lote</Text>
            <Text style={s.cardDesc}>
              Genera las fichas de todos los clientes diarios activos — 2 fichas por hoja para ahorrar papel.
            </Text>
            <Button mode="outlined" compact onPress={reporteFichas} loading={loading==='fichas'}
              disabled={!!loading} style={{marginTop:8,alignSelf:'flex-start',borderColor:'#c8a951'}}
              textColor="#c8a951">
              Generar Fichas (auto 22/30 días)
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* ── Tiras / Fajas para Billetes ─────────────────────── */}
      <Card style={s.card} elevation={1}>
        <Card.Content>
          <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:8}}>
            <View style={[s.iconBox,{backgroundColor:'#0a246318'}]}>
              <MaterialCommunityIcons name="cash-multiple" size={26} color="#0a2463"/>
            </View>
            <View style={{flex:1}}>
              <Text style={s.cardTit}>Tiras para Billetes</Text>
              <Text style={s.cardDesc}>
                Ingresa cuántos billetes hay de cada denominación — se genera una faja con el logo
                de la empresa, la cantidad y el total, lista para imprimir y amarrar el fajo.
              </Text>
            </View>
          </View>

          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10}}>
            {DENOMINACIONES.map(d => (
              <TextInput
                key={d}
                label={`$${d}`}
                value={tirasQty[d] || ''}
                onChangeText={v => setTirasQty(prev => ({...prev, [d]: v.replace(/[^0-9]/g,'')}))}
                mode="outlined" dense keyboardType="number-pad"
                style={{width:78}}
              />
            ))}
          </View>

          {(() => {
            const total = DENOMINACIONES.reduce((s,d) => s + d * (parseInt(tirasQty[d]||'0',10)||0), 0);
            return total > 0 ? (
              <Text style={{fontSize:12,color:C.textSec,marginBottom:8}}>
                Total: <Text style={{fontWeight:'800',color:C.primaryText}}>{formatMoneda(total)}</Text>
              </Text>
            ) : null;
          })()}

          <Button mode="outlined" compact onPress={generarTiras}
            disabled={DENOMINACIONES.every(d => !(parseInt(tirasQty[d]||'0',10) > 0))}
            style={{alignSelf:'flex-start',borderColor:'#0a2463'}} textColor="#0a2463">
            Generar Tiras
          </Button>
        </Card.Content>
      </Card>

      {stats && (
        <Card style={[s.card,{borderLeftWidth:4,borderLeftColor:C.danger}]}>
          <Card.Content>
            <Text style={{fontWeight:'800',color:C.danger,fontSize:14,marginBottom:8}}>📊 Resumen de Mora</Text>
            <View style={s.statRow}>
              <StatItem label="En mora" valor={String(stats.count)} color={C.danger}/>
              <StatItem label="Mora total" valor={formatMoneda(stats.totalMora)} color={C.warning}/>
              <StatItem label="Saldo pend." valor={formatMoneda(stats.totalSaldo)} color={C.danger}/>
            </View>
            <Button compact mode="text" onPress={()=>setStats(null)} style={{alignSelf:'flex-end'}}>Cerrar</Button>
          </Card.Content>
        </Card>
      )}

      <Card style={s.card}>
        <Card.Content>
          <Text style={{fontWeight:'700',color:C.primaryText,fontSize:13,marginBottom:6}}>💡 Tip</Text>
          <Text style={{fontSize:12,color:C.textSec,lineHeight:20}}>
            En web: los PDFs abren el diálogo de impresión del navegador → "Guardar como PDF".{'\n'}
            En móvil: se comparten directamente por WhatsApp u otra app.
          </Text>
        </Card.Content>
      </Card>

      {/* Modal: Cobrador para Colecta del Día */}
      <ModalPersonaEntrega
        visible={pe.visible}
        usuarios={pe.usuarios}
        value={pe.valor}
        onChange={pe.setValor}
        onConfirm={pe.confirmar}
        onCancel={pe.cancelar}
        loading={pe.loading}
        primaryColor={C.primaryText}
        titulo="¿A nombre de quién va la colecta?"
        subtitulo='Este nombre aparecerá como "Cobrador" en el documento.'
      />

      {/* Modal: Persona para Tiras de Billetes */}
      <ModalPersonaEntrega
        visible={peTiras.visible}
        usuarios={peTiras.usuarios}
        value={peTiras.valor}
        onChange={peTiras.setValor}
        onConfirm={peTiras.confirmar}
        onCancel={peTiras.cancelar}
        loading={peTiras.loading}
        primaryColor="#0a2463"
        titulo="¿Quién armó el conteo?"
        subtitulo='Este nombre aparecerá en las tiras de billetes generadas.'
      />

      {/* Modal Reporte Diario */}
      <Modal visible={modalReporte} transparent animationType="fade" onRequestClose={()=>setModalReporte(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>📊 Reporte Diario por Ruta</Text>
            <Text style={{color:C.textSec,fontSize:12,marginBottom:14}}>
              Fecha: <Text style={{fontWeight:'700',color:C.primaryText}}>{fechaRep}</Text>
              {fechaRep === hoyStr ? '  (Hoy)' : ''}{'\n'}
              El cobro del día se calcula automáticamente.{'\n'}
              Se genera PDF + copia Excel guardada en tu computadora.
            </Text>
            <TextInput label="Saldo anterior ($)" value={saldoAnt} onChangeText={setSaldoAnt}
              mode="outlined" keyboardType="decimal-pad" style={{marginBottom:10}}/>
            <TextInput label="Zona" value={zona} onChangeText={setZona}
              mode="outlined" style={{marginBottom:10}}/>
            <TextInput
              label="REFILes del día (una por línea)"
              placeholder={"REFIL PEDRO GARCIA 500\nREFIL MARIA LOPEZ 300"}
              value={renovTxt} onChangeText={setRenovTxt}
              mode="outlined" multiline numberOfLines={3}
              style={{marginBottom:6}}/>
            <Text style={{color:'#888',fontSize:10,marginBottom:14}}>
              Formato: REFIL NOMBRE MONTO_NUEVO_CREDITO{'\n'}
              ⚠️ Los pagos ya están en el Cobro del Día — esto es solo referencia.
            </Text>
            <View style={{flexDirection:'row',gap:10}}>
              <Button mode="outlined" onPress={()=>setModalReporte(false)} style={{flex:1}}>Cancelar</Button>
              <Button mode="contained" onPress={reporteDiario} loading={loading==='diario'}
                style={{flex:1,backgroundColor:C.primary}}>Generar y Guardar</Button>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </FadeIn>
  );
}

// Versiones claras de cada color acento para usar en dark mode
// (los colores originales son demasiado oscuros sobre fondo #1e1e1e)
const DARK_ACCENT: Record<string, string> = {
  '#0a2463': '#7aadff',   // navy    → azul claro
  '#6a1b9a': '#ba68c8',   // purple  → lila claro
  '#1b5e20': '#66bb6a',   // verde oscuro → verde claro
  '#2e7d32': '#66bb6a',   // verde oscuro → verde claro
  '#e65100': '#ff9800',   // naranja → naranja claro
  '#c62828': '#ef5350',   // rojo    → rojo claro
};

function ReporteCard({ icon, color, titulo, desc, btnLabel, loading, onPress,
                       btnLabel2, loading2, onPress2, disabled }: any) {
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);
  // En dark mode usar el acento claro; en light el original
  const acento = C.isDark ? (DARK_ACCENT[color] ?? color) : color;
  return (
    <Card style={s.card} elevation={1}>
      <Card.Content style={s.cardContent}>
        <View style={[s.iconBox,{backgroundColor:acento+'22'}]}>
          <MaterialCommunityIcons name={icon} size={26} color={acento}/>
        </View>
        <View style={s.cardInfo}>
          <Text style={s.cardTit}>{titulo}</Text>
          <Text style={s.cardDesc}>{desc}</Text>
          <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8}}>
            <Button mode="outlined" compact onPress={onPress} loading={loading}
              disabled={disabled ?? !!loading}
              style={{alignSelf:'flex-start',borderColor:acento}} textColor={acento}>
              {btnLabel}
            </Button>
            {btnLabel2 && (
              // El segundo botón siempre es naranja → adaptar igual
              <Button mode="outlined" compact onPress={onPress2} loading={loading2}
                disabled={disabled ?? !!loading2}
                style={{alignSelf:'flex-start',borderColor:C.warning}} textColor={C.warning}>
                {btnLabel2}
              </Button>
            )}
          </View>
        </View>
      </Card.Content>
    </Card>
  );
}

function StatItem({ label, valor, color }: { label:string; valor:string; color:string }) {
  const C = useColors();
  return (
    <View style={{flex:1,alignItems:'center'}}>
      <Text style={{fontSize:16,fontWeight:'800',color}}>{valor}</Text>
      <Text style={{fontSize:11,color:C.textTer}}>{label}</Text>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:   {flex:1, backgroundColor:C.bg, ...w(glassBgStyle(C))},
  titulo:      {color:C.primaryText,fontWeight:'800',marginBottom:16},
  card:        {marginBottom:12,borderRadius:12, ...glassStyle(C)},
  cardContent: {flexDirection:'row',gap:12,alignItems:'flex-start'},
  iconBox:     {width:50,height:50,borderRadius:12,justifyContent:'center',alignItems:'center'},
  cardInfo:    {flex:1},
  cardTit:     {fontSize:14,fontWeight:'700',color:C.text},
  cardDesc:    {fontSize:11,color:C.textTer,marginTop:2},
  statRow:     {flexDirection:'row',justifyContent:'space-around',marginBottom:8},
  overlay:     {flex:1,backgroundColor:'#00000066',justifyContent:'center',padding:24},
  modalBox:    {backgroundColor:C.surface,borderRadius:16,padding:20},
  modalTit:    {fontSize:16,fontWeight:'800',color:C.primaryText,marginBottom:8},
  modalBtns:   {flexDirection:'row',gap:10},
});
