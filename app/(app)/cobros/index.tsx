import React, { useState, useMemo, useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform } from 'react-native';
import { Text, Card, Button, ActivityIndicator, Switch, TextInput } from 'react-native-paper';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc, orderBy, writeBatch, increment } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassNavyStyle, glassBgStyle } from '../../../src/theme';
import { StaggerItem } from '../../../src/components/FadeIn';
const w = (s: any) => s;
import { Prestamo, Pago } from '../../../src/types';
import { calcularVencimiento, calcularMora, formatMoneda, formatFecha, hoy, tablaAmortizacion } from '../../../src/utils/calculos';
import { generarPDFColecta, compartir, ItemColecta } from '../../../src/utils/pdf';
import { useFocusEffect } from 'expo-router';
import { usePersonaEntrega } from '../../../src/hooks/usePersonaEntrega';
import ModalPersonaEntrega from '../../../src/components/ModalPersonaEntrega';

interface CobrosItem {
  prestamo: Prestamo;
  numeroCuota: number;
  fechaVencimiento: string;
  mora: number;
  clienteNombre: string;
  clienteTel: string;
  clienteDui:    string;
  clienteCorreo: string;
  expediente: string;
  geoCodigo: string;
  diasAtraso: number;
  abonadoPrevio: number;   // total ya abonado a esta cuota
  saldoPendiente: number;  // lo que falta por pagar
}

export default function Cobros() {
  const { perfil, isSupervisor } = useAuth();
  const { col } = useEmpresa();
  const [tab, setTab]         = useState<'hoy'|'pendientes'>('hoy');
  const [hoyLista, setHoy]    = useState<CobrosItem[]>([]);
  const [pendLista, setPend]  = useState<CobrosItem[]>([]);
  const [loading, setLoading] = useState(true);
  const hoyStr = hoy();

  // Modal unificado (hoy y pendientes)
  const [modalItem, setModalItem]       = useState<CobrosItem | null>(null);
  const [fechaPago, setFechaPago]       = useState(hoyStr);
  const [conMora, setConMora]           = useState(false);
  const [montoInput, setMontoInput]     = useState('');
  const [multaInput, setMultaInput]     = useState('');
  const [guardando, setGuardando]       = useState(false);

  // Modal multa suelta (sin cuota pendiente)
  const [modalMulta, setModalMulta]             = useState(false);
  const [multaSueltaMonto, setMultaSueltaMonto] = useState('');
  const [multaSueltaFecha, setMultaSueltaFecha] = useState(hoyStr);
  const [multaSueltaNota, setMultaSueltaNota]   = useState('');
  const [guardandoMulta, setGuardandoMulta]     = useState(false);
  // Selector de cliente para multa
  const [clientesLista, setClientesLista]           = useState<{id:string;nombre:string}[]>([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<{id:string;nombre:string}|null>(null);
  const [busquedaCliente, setBusquedaCliente]         = useState('');
  const [cargandoClientes, setCargandoClientes]       = useState(false);

  // ── Cargos de Administración distribuidos (vinculados al préstamo) ──
  const [cargosAdmin, setCargosAdmin] = useState<{
    id: string;
    concepto: string;
    monto_por_cuota: number;
    cuotas_cobradas: number;
    cuotas_plan: number;
    cliente_nombre: string;
    cliente_dui: string;
  }[]>([]);
  const [cobrandoAdmin, setCobrandoAdmin] = useState(false);

  // ── Factura / DTE ──
  const elAPI2 = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const [ultimoPago, setUltimoPago]         = useState<any>(null);
  // Modal factura interna editable
  const [modalFactura, setModalFactura]     = useState(false);
  const [itemsFactura, setItemsFactura]     = useState<{concepto:string;monto:number}[]>([]);
  const [nuevoConcepto, setNuevoConcepto]   = useState('');
  const [nuevoMonto, setNuevoMonto]         = useState('');
  const [dteGuardado, setDteGuardado]       = useState<string|null>(null);

  // Selector "Persona/Cobrador que aparece en la colecta"
  const pe = usePersonaEntrega(perfil?.nombre);

  async function load() {
    setLoading(true);
    try {
      // Incluir 'mora' además de 'activo' para que los préstamos atrasados también aparezcan
      const constraints: any[] = [where('estado','in',['activo','mora'])];
      if (!isSupervisor && perfil?.id) constraints.push(where('asesor_id','==',perfil.id));
      const pSnap = await getDocs(query(collection(db, col('prestamos')), ...constraints));
      const prestamos = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo));

      const clienteCache: Record<string,any> = {};
      const getCliente = async (cid: string) => {
        if (!clienteCache[cid]) {
          const cs = await getDoc(doc(db, col('clientes'),cid));
          if (cs.exists()) {
            const d = cs.data();
            clienteCache[cid] = {
              nombre:    d.nombre||'Sin nombre',
              telefono:  d.telefono||'',
              expediente: d.numero_expediente||'',
              geoCodigo: d.geo_codigo||'',
              dui:       d.dui||'',
              correo:    d.email||'',
            };
          } else {
            clienteCache[cid] = { nombre:'Cliente', telefono:'', expediente:'', geoCodigo:'', dui:'', correo:'' };
          }
        }
        return clienteCache[cid];
      };

      const listaHoy:  CobrosItem[] = [];
      const listaPend: CobrosItem[] = [];

      // Traer pagos y clientes de todos los préstamos EN PARALELO
      const [pagosResults, clientesResults] = await Promise.all([
        Promise.all(prestamos.map(p => getDocs(collection(db, col('prestamos'), p.id, 'pagos')))),
        Promise.all(prestamos.map(p => getCliente(p.cliente_id))),
      ]);

      for (let idx = 0; idx < prestamos.length; idx++) {
        const p      = prestamos[idx];
        const pagos  = pagosResults[idx].docs.map(d => ({ id: d.id, ...d.data() } as Pago));
        const cliente = clientesResults[idx];

        // Acumular lo pagado por número de cuota
        const pagadoXCuota = new Map<number, number>();
        pagos.forEach(pg => {
          const n = pg.numero_cuota;
          pagadoXCuota.set(n, (pagadoXCuota.get(n) || 0) + (pg.monto_pagado || 0));
        });

        for (let n = 1; n <= p.plazo; n++) {
          const abonado = pagadoXCuota.get(n) || 0;
          // Cuota completamente pagada → saltar
          if (abonado >= p.cuota) continue;

          const saldo = p.cuota - abonado;
          const fv    = calcularVencimiento(p.fecha_inicio, n, p.frecuencia);
          const mora  = calcularMora(fv, p.cuota, p.frecuencia, p.plazo);
          const dias  = fv < hoyStr
            ? Math.floor((new Date().setHours(0,0,0,0) - new Date(fv+'T00:00:00').getTime()) / 86400000)
            : 0;

          const item: CobrosItem = {
            prestamo: p, numeroCuota: n, fechaVencimiento: fv, mora,
            clienteNombre:  cliente.nombre,
            clienteTel:     cliente.telefono,
            clienteDui:     cliente.dui,
            clienteCorreo:  cliente.correo,
            expediente:     cliente.expediente,
            geoCodigo:      cliente.geoCodigo,
            diasAtraso:     dias,
            abonadoPrevio:  abonado,
            saldoPendiente: saldo,
          };

          if (fv === hoyStr)    { listaHoy.push(item); break; }
          else if (fv < hoyStr) { listaPend.push(item); }
          else                  { break; }
        }
      }

      listaPend.sort((a,b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
      setHoy(listaHoy);
      setPend(listaPend);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(); }, [col]));

  // Abrir modal (unificado para hoy y pendientes)
  async function abrirModal(item: CobrosItem) {
    setModalItem(item);
    setFechaPago(hoyStr);
    setConMora(false);
    setMultaInput('');
    setMontoInput('');
    setCargosAdmin([]);
    // Restaurar foco en Electron para que los inputs del modal funcionen
    if (typeof document !== 'undefined') {
      setTimeout(() => { document.body.focus(); }, 80);
    }
    // Cargar cargos de administración distribuidos activos para este préstamo
    try {
      const snap = await getDocs(
        query(
          collection(db, col('gastos_admin')),
          where('prestamo_id', '==', item.prestamo.id),
          where('tipo_cobro',  '==', 'distribuido'),
          where('estado',      '==', 'activo'),
        )
      );
      const pendientes = snap.docs
        .map(d => ({
          id:               d.id,
          concepto:         (d.data().concepto as string) || '—',
          monto_por_cuota:  (d.data().monto_por_cuota as number) || 0,
          cuotas_cobradas:  (d.data().cuotas_cobradas as number) || 0,
          cuotas_plan:      (d.data().cuotas_plan as number) || 1,
          cliente_nombre:   (d.data().cliente_nombre as string) || item.clienteNombre,
          cliente_dui:      (d.data().cliente_dui as string) || item.clienteDui,
        }))
        // Solo mostrar los que aún tienen cuotas pendientes
        .filter(c => c.cuotas_cobradas < c.cuotas_plan);
      setCargosAdmin(pendientes);
    } catch (e) { console.warn('cargos admin:', e); }
  }

  async function confirmarPago() {
    if (!modalItem) return;
    const monto = parseFloat(montoInput.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      alert('Ingresa un monto válido mayor a $0');
      return;
    }
    const multa = parseFloat(multaInput.replace(',', '.')) || 0;
    setGuardando(true);
    try {
      const mora = conMora ? modalItem.mora : 0;
      const distribucion = await registrarPagoDistribuido(modalItem, monto, mora, fechaPago, multa);

      const datosPago = {
        cliente: {
          nombre:   modalItem.clienteNombre,
          dui:      modalItem.clienteDui,
          correo:   modalItem.clienteCorreo,
          telefono: modalItem.clienteTel,
        },
        numeroCuota:    modalItem.numeroCuota,
        monto,
        mora,
        distribuciones: distribucion,
        prestamo: {
          id:         modalItem.prestamo.id,
          frecuencia: modalItem.prestamo.frecuencia,
          plazo:      modalItem.prestamo.plazo,
        },
      };

      // ── Auto-guardar DTE en cola (sin enviar a Hacienda) ──
      let numControl: string | null = null;
      if (elAPI2?.construirDTE) {
        try {
          const dteBuild = await elAPI2.construirDTE(datosPago);
          if (dteBuild?.ok) {
            numControl = dteBuild.numeroControl;
            await addDoc(collection(db, col('dte_cola')), {
              created_at:       new Date().toISOString(),
              fecha_emision:    dteBuild.dteJson.identificacion.fecEmi,
              cliente_nombre:   modalItem.clienteNombre,
              cliente_dui:      modalItem.clienteDui,
              cliente_correo:   modalItem.clienteCorreo,
              monto:            monto + mora,
              numeroCuota:      modalItem.numeroCuota,
              prestamo_id:      modalItem.prestamo.id,
              estado:           'pendiente',
              dteJson:          dteBuild.dteJson,
              codigoGeneracion: dteBuild.codigoGeneracion,
              numeroControl:    dteBuild.numeroControl,
            });
          }
        } catch(e) { console.warn('DTE cola error:', e); }
      }

      // ── Preparar factura interna ──
      setUltimoPago(datosPago);
      setDteGuardado(numControl);
      const itemsBase: {concepto:string;monto:number}[] = distribucion.map(d => ({
        concepto: d.numero > 1
          ? `Cuotas #${distribucion[0].numero}–#${d.numero} (${distribucion.length} cuotas)`
          : `Abono cuota #${d.numero} · Préstamo ${modalItem.prestamo.id.slice(-6).toUpperCase()}`,
        monto: d.monto,
      }));
      // Solo 1 ítem si se cubren varias cuotas (consolidar)
      const itemsConsolidados = distribucion.length > 1
        ? [{
            concepto: `Cuotas #${distribucion[0].numero}–#${distribucion[distribucion.length-1].numero} (${distribucion.length}) · ${modalItem.prestamo.id.slice(-6).toUpperCase()}`,
            monto: distribucion.reduce((a,d)=>a+d.monto, 0),
          }]
        : itemsBase;
      if (mora > 0) itemsConsolidados.push({ concepto: 'Mora por atraso', monto: mora });
      if (multa > 0) itemsConsolidados.push({ concepto: 'Multa', monto: multa });
      setItemsFactura(itemsConsolidados);
      setNuevoConcepto('');
      setNuevoMonto('');
      setModalItem(null);
      setModalFactura(true);
      load();
    } catch(e) { console.error(e); }
    setGuardando(false);
  }

  async function registrarPagoDistribuido(item: CobrosItem, montoTotal: number, mora: number, fechaPagoVal: string, multa: number = 0): Promise<{numero:number;monto:number}[]> {
    const { prestamo } = item;

    // Obtener todas las cuotas pendientes del préstamo en orden
    const pagosSnap = await getDocs(collection(db, col('prestamos'), prestamo.id, 'pagos'));
    const pagosExistentes = pagosSnap.docs.map(d => d.data());
    const pagadoXCuota = new Map<number,number>();
    pagosExistentes.forEach(pg => {
      pagadoXCuota.set(pg.numero_cuota, (pagadoXCuota.get(pg.numero_cuota)||0) + (pg.monto_pagado||0));
    });

    // Tabla de amortización completa para desglose capital/interés
    const tablaAmort = tablaAmortizacion(prestamo.monto, prestamo.plazo, prestamo.frecuencia);

    // Construir lista de cuotas pendientes en orden
    const pendientes: { numero: number; fv: string; saldo: number }[] = [];
    for (let n = 1; n <= prestamo.plazo; n++) {
      const abonado = pagadoXCuota.get(n) || 0;
      if (abonado >= prestamo.cuota) continue; // ya pagada
      const fv    = calcularVencimiento(prestamo.fecha_inicio, n, prestamo.frecuencia);
      const saldo = prestamo.cuota - abonado;
      pendientes.push({ numero: n, fv, saldo });
    }

    // Distribuir el monto entre cuotas de más antigua a más nueva
    let remaining = montoTotal;
    const ops: Promise<any>[] = [];
    let esPrimera = true;
    const distribucionResult: {numero:number;monto:number}[] = [];

    for (let i = 0; i < pendientes.length; i++) {
      const cuota = pendientes[i];
      if (remaining <= 0) break;
      // Si es la última cuota que vamos a cubrir, guardar el monto real recibido
      // (incluyendo centavos de más que el cliente redondea, ej: paga $10 en vez de $9.80)
      const esUltima = remaining <= cuota.saldo || i === pendientes.length - 1;
      const pagoEsta = esUltima ? remaining : cuota.saldo;
      remaining     -= pagoEsta;
      const esCompleto = pagoEsta >= cuota.saldo;
      distribucionResult.push({ numero: cuota.numero, monto: pagoEsta });

      const filaAmort = tablaAmort[cuota.numero - 1];
      ops.push(addDoc(collection(db, col('prestamos'), prestamo.id, 'pagos'), {
        prestamo_id:       prestamo.id,
        numero_cuota:      cuota.numero,
        monto_cuota:       prestamo.cuota,
        monto_pagado:      pagoEsta,
        abono_capital:     filaAmort?.abono  ?? null,
        interes_ordinario: filaAmort?.interes ?? null,
        mora:              esPrimera ? mora : 0,
        tipo:              esCompleto ? 'completo' : 'abono',
        fecha_vencimiento: cuota.fv,
        fecha_pago:        fechaPagoVal,
        cobrador_id:       perfil?.id ?? null,
        created_at:        new Date().toISOString(),
      }));
      esPrimera = false;
    }

    // Registrar multa como pago separado (numero_cuota: 0, no afecta el conteo de cuotas)
    if (multa > 0) {
      ops.push(addDoc(collection(db, col('prestamos'), prestamo.id, 'pagos'), {
        prestamo_id:  prestamo.id,
        numero_cuota: 0,
        monto_cuota:  0,
        monto_pagado: multa,
        mora:         0,
        tipo:         'multa',
        fecha_pago:   fechaPagoVal,
        cobrador_id:  perfil?.id ?? null,
        created_at:   new Date().toISOString(),
      }));
    }

    await Promise.all(ops);

    // Verificar si el préstamo se completó
    // (excluir numero_cuota === 0 que son multas, no cuotas)
    const pgSnap2 = await getDocs(collection(db, col('prestamos'), prestamo.id, 'pagos'));
    const mapaFinal = new Map<number,number>();
    pgSnap2.docs.forEach(d => {
      const pg = d.data();
      if (pg.numero_cuota > 0)  // ignorar multas
        mapaFinal.set(pg.numero_cuota, (mapaFinal.get(pg.numero_cuota)||0) + (pg.monto_pagado||0));
    });
    const cuotasCompletas = [...mapaFinal.entries()].filter(([_,t]) => t >= prestamo.cuota).length;
    if (cuotasCompletas >= prestamo.plazo) {
      await updateDoc(doc(db, col('prestamos'),prestamo.id), { estado:'completado' });
    }
    return distribucionResult;
  }

  function generarReportePDF() {
    const items: ItemColecta[] = hoyLista.map(c => ({
      cliente:          c.clienteNombre,
      expediente:       c.expediente,
      telefono:         c.clienteTel,
      geoLocal:         c.geoCodigo,
      fechaVencimiento: c.prestamo.fecha_fin,
      plazo:            c.prestamo.plazo,
      monto:            c.prestamo.monto,
      cuota:            c.prestamo.cuota,
      frecuencia:       c.prestamo.frecuencia,
      numeroCuota:      c.numeroCuota,
      mora:             c.mora,
      deudaTotal:       (c.prestamo.plazo - c.numeroCuota + 1) * c.prestamo.cuota,
    }));
    pe.pedir(async (nombre) => {
      const uri = await generarPDFColecta(hoyStr, items, perfil?.ruta?.nombre || 'General', nombre);
      await compartir(uri);
    });
  }

  async function abrirModalMulta() {
    setMultaSueltaMonto('');
    setMultaSueltaFecha(hoyStr);
    setMultaSueltaNota('');
    setClienteSeleccionado(null);
    setBusquedaCliente('');
    setModalMulta(true);
    // Cargar clientes activos
    setCargandoClientes(true);
    try {
      const snap = await getDocs(
        query(collection(db, col('clientes')), where('activo','==',true))
      );
      const lista = snap.docs
        .map(d => ({ id: d.id, nombre: (d.data().nombre as string) || '—' }))
        .sort((a,b) => a.nombre.localeCompare(b.nombre));
      setClientesLista(lista);
    } catch(e) { console.error(e); }
    setCargandoClientes(false);
  }

  async function registrarMultaSuelta() {
    const monto = parseFloat(multaSueltaMonto.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) { alert('Ingresa un monto válido mayor a $0'); return; }
    if (!clienteSeleccionado) { alert('Selecciona el cliente al que se le aplica la multa'); return; }
    setGuardandoMulta(true);
    try {
      await addDoc(collection(db, col('multas')), {
        monto,
        fecha:           multaSueltaFecha || hoyStr,
        cobrador_id:     perfil?.id || '',
        cobrador_nombre: perfil?.nombre || '',
        cliente_id:      clienteSeleccionado.id,
        cliente_nombre:  clienteSeleccionado.nombre,
        nota:            multaSueltaNota.trim(),
        created_at:      new Date().toISOString(),
      });
      setModalMulta(false);
      alert(`Multa de ${formatMoneda(monto)} registrada para ${clienteSeleccionado.nombre}`);
    } catch(e) { console.error(e); alert('Error al registrar multa'); }
    setGuardandoMulta(false);
  }

  /* ── Cobrar cargos admin distribuidos (una cuota de cada cargo activo) ── */
  async function cobrarAdmin() {
    if (!modalItem || cargosAdmin.length === 0) return;
    setCobrandoAdmin(true);
    try {
      const ahora = new Date().toISOString();
      await Promise.all(cargosAdmin.map(async c => {
        const nuevasCobradas = c.cuotas_cobradas + 1;
        const completo = nuevasCobradas >= c.cuotas_plan;
        await updateDoc(doc(db, col('gastos_admin'), c.id), {
          cuotas_cobradas: increment(1),
          cobrador_id:     perfil?.id || '',
          ...(completo ? { estado: 'cobrado', cobrado_at: ahora } : {}),
        });
      }));

      // Factura admin separada — muestra el monto POR CUOTA de cada cargo
      const itemsFactura = cargosAdmin.map(c => ({
        concepto: `${c.concepto} (cuota ${c.cuotas_cobradas + 1}/${c.cuotas_plan})`,
        monto:    c.monto_por_cuota,
      }));
      imprimirFacturaAdmin(
        { nombre: modalItem.clienteNombre, dui: modalItem.clienteDui },
        itemsFactura,
        fechaPago,
      );

      // Actualizar estado local (incrementar cuotas_cobradas)
      setCargosAdmin(prev =>
        prev
          .map(c => ({ ...c, cuotas_cobradas: c.cuotas_cobradas + 1 }))
          .filter(c => c.cuotas_cobradas < c.cuotas_plan)
      );
    } catch (e) { console.error(e); alert('Error al cobrar cargos admin'); }
    setCobrandoAdmin(false);
  }

  function imprimirFacturaAdmin(
    cliente: { nombre: string; dui?: string },
    items: { concepto: string; monto: number }[],
    fecha: string,
  ) {
    const total = items.reduce((a, b) => a + b.monto, 0);
    const fechaStr = new Date((fecha||hoyStr) + 'T12:00:00').toLocaleDateString('es-SV', {
      weekday:'long', year:'numeric', month:'long', day:'numeric',
    });
    const numRec = Date.now().toString().slice(-6);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Cargo Admin CAS Express</title>
<style>
  @page{size:80mm auto;margin:4mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:11px;color:#000}
  .hdr{text-align:center;border-bottom:2px solid #0a2463;padding-bottom:8px;margin-bottom:8px}
  .emp{font-size:15px;font-weight:900;color:#0a2463;letter-spacing:1px}
  .sub{font-size:9px;color:#555}
  .badge{display:inline-block;background:#0a2463;color:#fff;font-size:9px;
    padding:2px 8px;border-radius:10px;margin:4px 0;font-weight:700}
  .meta{font-size:10px;color:#333;margin-bottom:6px}
  .cli{background:#f5f7ff;border-left:3px solid #0a2463;padding:6px 8px;margin-bottom:10px}
  .clinm{font-size:13px;font-weight:700;color:#0a2463}
  table{width:100%;border-collapse:collapse;margin-bottom:10px}
  th{background:#0a2463;color:#fff;font-size:9px;padding:5px 6px;text-align:left}
  td{padding:5px 6px;border-bottom:1px solid #e0e0e0;font-size:11px}
  .r{text-align:right;font-weight:600}
  .tot td{font-size:13px;font-weight:800;color:#0a2463;padding:8px 6px;
    border-top:2px solid #0a2463;border-bottom:none;background:#f0f4ff}
  .firmas{display:flex;gap:20px;margin-top:20px}
  .fbox{flex:1;text-align:center}
  .fline{border-top:1px solid #333;margin:28px 0 4px}
  .flbl{font-size:9px;color:#666}
  .ftr{text-align:center;margin-top:12px;font-size:9px;color:#999;
    border-top:1px dashed #ccc;padding-top:8px}
</style></head><body>
<div class="hdr">
  <div class="emp">CAS EXPRESS</div>
  <div class="sub">Soluciones Financieras · Majahual, La Libertad</div>
  <div class="badge">CARGOS DE ADMINISTRACIÓN</div>
</div>
<div class="meta"><b>Recibo N°</b> ADM-${numRec} &nbsp;|&nbsp; <b>Fecha:</b> ${fechaStr}</div>
<div class="cli">
  <div class="clinm">${cliente.nombre.toUpperCase()}</div>
  ${cliente.dui ? `<div class="sub">DUI: ${cliente.dui}</div>` : ''}
</div>
<table>
  <thead><tr><th style="width:65%">CONCEPTO</th><th style="width:35%;text-align:right">MONTO</th></tr></thead>
  <tbody>
    ${items.map(it => `<tr><td>${it.concepto}</td><td class="r">$${it.monto.toFixed(2)}</td></tr>`).join('')}
    <tr class="tot"><td>TOTAL</td><td class="r">$${total.toFixed(2)}</td></tr>
  </tbody>
</table>
<div class="firmas">
  <div class="fbox"><div class="fline"></div><div class="flbl">Cobrador / Asesor</div></div>
  <div class="fbox"><div class="fline"></div><div class="flbl">Recibido por</div></div>
</div>
<div class="ftr"><div>GRACIAS POR USAR NUESTROS SERVICIOS</div></div>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  function imprimirFactura() {
    if (!ultimoPago) return;
    const total = itemsFactura.reduce((a, b) => a + b.monto, 0);
    const fecha = new Date().toLocaleDateString('es-SV', {
      weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/El_Salvador',
    });
    const numRec = Date.now().toString().slice(-6);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Recibo CAS Express</title>
<style>
  @page{size:80mm auto;margin:4mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:11px;color:#000}
  .hdr{text-align:center;border-bottom:2px solid #0a2463;padding-bottom:8px;margin-bottom:8px}
  .emp{font-size:15px;font-weight:900;color:#0a2463;letter-spacing:1px}
  .sub{font-size:9px;color:#555}
  .meta{font-size:10px;color:#333;margin-bottom:6px}
  .cli{background:#f5f7ff;border-left:3px solid #0a2463;padding:6px 8px;margin-bottom:10px}
  .clinm{font-size:13px;font-weight:700;color:#0a2463}
  table{width:100%;border-collapse:collapse;margin-bottom:10px}
  th{background:#0a2463;color:#fff;font-size:9px;padding:5px 6px;text-align:left}
  td{padding:5px 6px;border-bottom:1px solid #e0e0e0;font-size:11px}
  .r{text-align:right;font-weight:600}
  .tot td{font-size:13px;font-weight:800;color:#0a2463;padding:8px 6px;border-top:2px solid #0a2463;border-bottom:none;background:#f0f4ff}
  .firmas{display:flex;gap:20px;margin-top:20px}
  .fbox{flex:1;text-align:center}
  .fline{border-top:1px solid #333;margin:28px 0 4px}
  .flbl{font-size:9px;color:#666}
  .ftr{text-align:center;margin-top:12px;font-size:9px;color:#999;border-top:1px dashed #ccc;padding-top:8px}
  .dte-badge{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;padding:4px 6px;font-size:9px;color:#2e7d32;margin-bottom:8px}
</style></head><body>
<div class="hdr">
  <div class="emp">CAS EXPRESS</div>
  <div class="sub">Soluciones Financieras · Majahual, La Libertad</div>
</div>
<div class="meta"><b>Recibo N°</b> ${numRec} &nbsp;|&nbsp; <b>Fecha:</b> ${fecha}</div>
<div class="cli">
  <div class="clinm">${ultimoPago.cliente.nombre.toUpperCase()}</div>
  ${ultimoPago.cliente.dui ? `<div class="sub">DUI: ${ultimoPago.cliente.dui}</div>` : ''}
</div>
${dteGuardado ? `<div class="dte-badge">🏛️ DTE en cola: ${dteGuardado}</div>` : ''}
<table>
  <thead><tr><th style="width:65%">CONCEPTO</th><th style="width:35%;text-align:right">MONTO</th></tr></thead>
  <tbody>
    ${itemsFactura.map(it => `<tr><td>${it.concepto}</td><td class="r">$${it.monto.toFixed(2)}</td></tr>`).join('')}
    <tr class="tot"><td>TOTAL</td><td class="r">$${total.toFixed(2)}</td></tr>
  </tbody>
</table>
<div class="firmas">
  <div class="fbox"><div class="fline"></div><div class="flbl">Cobrador</div></div>
  <div class="fbox"><div class="fline"></div><div class="flbl">Cliente / Recibido por</div></div>
</div>
<div class="ftr"><div>¡GRACIAS POR SU PAGO PUNTUAL!</div>
<div style="margin-top:3px;font-style:italic">Comprobante interno · Guarde este recibo como referencia</div>
</div></body></html>`;

    if (elAPI2?.printColor) {
      elAPI2.printColor(html);
    } else {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.print(); }
    }
  }

  const lista    = tab === 'hoy' ? hoyLista : pendLista;
  const moraModal = modalItem && conMora ? modalItem.mora : 0;
  const montoNum  = parseFloat(montoInput.replace(',','.')) || 0;
  const multaNum  = parseFloat(multaInput.replace(',','.')) || 0;
  // ¿El monto ingresado cubre el saldo?
  const cubreSaldo = modalItem ? (montoNum >= modalItem.saldoPendiente) : false;

  // Desglose capital/interés de la cuota actual (amortización)
  const desgloseAmort = useMemo(() => {
    if (!modalItem) return null;
    const p = modalItem.prestamo;
    const tabla = tablaAmortizacion(p.monto, p.plazo, p.frecuencia);
    const fila  = tabla[modalItem.numeroCuota - 1];
    return fila ?? null;
  }, [modalItem]);

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary}/></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.fecha}>{formatFecha(hoyStr)}</Text>
          <Text style={s.totalTxt}>
            {tab==='hoy'
              ? `${hoyLista.length} cobros hoy · ${formatMoneda(hoyLista.reduce((a,c)=>a+c.saldoPendiente,0))}`
              : `${pendLista.length} atrasadas · ${formatMoneda(pendLista.reduce((a,c)=>a+c.saldoPendiente,0))}`
            }
          </Text>
        </View>
        <View style={{flexDirection:'row', gap:6, alignItems:'center'}}>
          <Button icon="refresh" mode="outlined" compact onPress={load}
            textColor="#fff" style={{borderColor:'rgba(255,255,255,0.5)'}}>Recargar</Button>
          <Button icon="alert-octagon" mode="outlined" compact
            onPress={abrirModalMulta}
            textColor="#ff9800" style={{borderColor:'#ff9800'}}>Multa</Button>
          {tab==='hoy' && hoyLista.length > 0 && (
            <Button icon="file-pdf-box" mode="outlined" compact onPress={generarReportePDF}
              textColor="#c8a951" style={{borderColor:'#c8a951'}}>Colecta PDF</Button>
          )}
        </View>
      </View>

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, tab==='hoy'&&s.tabActive]} onPress={()=>setTab('hoy')}>
          <Text style={[s.tabTxt, tab==='hoy'&&s.tabTxtActive]}>
            Hoy {hoyLista.length>0?`(${hoyLista.length})`:''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab==='pendientes'&&s.tabActive]} onPress={()=>setTab('pendientes')}>
          <Text style={[s.tabTxt, tab==='pendientes'&&s.tabTxtActive]}>
            ⚠️ Pendientes {pendLista.length>0?`(${pendLista.length})`:''}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={lista}
        keyExtractor={(item)=>`${item.prestamo.id}-${item.numeroCuota}`}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ padding:12 }}
        renderItem={({ item, index }) => (
          <StaggerItem index={Math.min(index, 8)} step={55}>
          <Card style={[s.card, item.diasAtraso>0&&{borderLeftColor:'#c62828',borderLeftWidth:4}]} elevation={1}>
            <Card.Content style={s.cardContent}>
              <View style={s.cardInfo}>
                <Text style={s.clienteNom} numberOfLines={2}>{item.clienteNombre.toUpperCase()}</Text>
                {item.expediente ? <Text style={s.expTxt}>Exp: {item.expediente}</Text> : null}
                <Text style={s.sub}>
                  Cuota #{item.numeroCuota}/{item.prestamo.plazo} · {item.prestamo.frecuencia}
                </Text>
                <Text style={s.sub}>Vencía: {formatFecha(item.fechaVencimiento)}</Text>
                {item.diasAtraso > 0 &&
                  <Text style={s.moraT}>⚠️ {item.diasAtraso} días de atraso</Text>}
                {/* Mostrar abono previo si existe */}
                {item.abonadoPrevio > 0 && (
                  <Text style={s.abonoTxt}>
                    💰 Abonado: {formatMoneda(item.abonadoPrevio)} de {formatMoneda(item.prestamo.cuota)}
                  </Text>
                )}
              </View>
              <View style={s.cardRight}>
                {item.abonadoPrevio > 0 ? (
                  <>
                    <Text style={s.saldoLbl}>Saldo:</Text>
                    <Text style={s.monto}>{formatMoneda(item.saldoPendiente)}</Text>
                  </>
                ) : (
                  <Text style={s.monto}>{formatMoneda(item.prestamo.cuota)}</Text>
                )}
                {item.mora > 0 && <Text style={s.moraSmall}>+{formatMoneda(item.mora)} mora</Text>}
                <TouchableOpacity
                  style={[s.btn, item.diasAtraso>0 && s.btnRojo]}
                  onPress={() => abrirModal(item)}>
                  <Text style={s.btnTxt}>{item.diasAtraso>0 ? '⚠️ Cobrar' : 'Cobrar'}</Text>
                </TouchableOpacity>
              </View>
            </Card.Content>
          </Card>
          </StaggerItem>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{fontSize:40}}>{tab==='hoy'?'🎉':'✅'}</Text>
            <Text style={s.emptyTxt}>
              {tab==='hoy'?'No hay cobros programados para hoy':'Sin cuotas atrasadas'}
            </Text>
            {tab==='hoy' && pendLista.length>0 && (
              <Button mode="outlined" onPress={()=>setTab('pendientes')} style={{marginTop:12}}>
                Ver {pendLista.length} cuotas atrasadas
              </Button>
            )}
          </View>
        }
      />

      {/* ── MODAL: PERSONA/COBRADOR QUE APARECE EN LA COLECTA ── */}
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

      {/* ── MODAL COBRO ── */}
      <Modal visible={!!modalItem} transparent animationType="fade" onRequestClose={()=>setModalItem(null)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>Registrar Cobro</Text>

            {modalItem && (
              <>
                <Text style={s.modalCliente}>{modalItem.clienteNombre.toUpperCase()}</Text>
                <Text style={s.modalSub}>
                  Cuota #{modalItem.numeroCuota}/{modalItem.prestamo.plazo} · {formatFecha(modalItem.fechaVencimiento)}
                  {modalItem.diasAtraso > 0 && ` · ${modalItem.diasAtraso} días atraso`}
                </Text>

                {/* Desglose capital / interés */}
                {desgloseAmort && (
                  <View style={s.desgloseBox}>
                    <Text style={s.desgloseTitle}>DISTRIBUCIÓN DE ESTA CUOTA</Text>
                    <View style={s.desgloseRow}>
                      <Text style={s.desgloseLabel}>💰 Abono a Capital</Text>
                      <Text style={[s.desgloseVal, {color:'#2e7d32'}]}>{formatMoneda(desgloseAmort.abono)}</Text>
                    </View>
                    <View style={s.desgloseRow}>
                      <Text style={s.desgloseLabel}>📈 Interés del período</Text>
                      <Text style={[s.desgloseVal, {color:'#c62828'}]}>{formatMoneda(desgloseAmort.interes)}</Text>
                    </View>
                    <View style={[s.desgloseRow, {borderTopWidth:1, borderTopColor:'rgba(0,0,0,0.1)', paddingTop:6, marginTop:2}]}>
                      <Text style={[s.desgloseLabel, {fontWeight:'800'}]}>Total cuota</Text>
                      <Text style={[s.desgloseVal, {fontWeight:'800', color:C.primaryText}]}>{formatMoneda(desgloseAmort.cuota)}</Text>
                    </View>
                    <Text style={s.desgloseNote}>Saldo pendiente tras este pago: {formatMoneda(Math.max(0, desgloseAmort.saldo - desgloseAmort.abono))}</Text>
                  </View>
                )}

                {/* Info de cuota y abono previo */}
                <View style={s.modalRow}>
                  <Text style={s.modalLbl}>Cuota:</Text>
                  <Text style={s.modalVal}>{formatMoneda(modalItem.prestamo.cuota)}</Text>
                </View>
                {modalItem.abonadoPrevio > 0 && (
                  <>
                    <View style={s.modalRow}>
                      <Text style={s.modalLbl}>Ya abonado:</Text>
                      <Text style={[s.modalVal, {color:'#388e3c'}]}>
                        {formatMoneda(modalItem.abonadoPrevio)}
                      </Text>
                    </View>
                    <View style={[s.modalRow,{backgroundColor:'#fff8e1',padding:8,borderRadius:8,marginBottom:8}]}>
                      <Text style={{color:'#f57f17',fontWeight:'600'}}>Saldo pendiente:</Text>
                      <Text style={{color:'#f57f17',fontWeight:'800'}}>{formatMoneda(modalItem.saldoPendiente)}</Text>
                    </View>
                  </>
                )}

                {/* INPUT: monto recibido — HTML nativo en web/Electron para evitar bugs de controlled input */}
                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Monto recibido del cliente</Text>
                {Platform.OS === 'web'
                  ? <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:C.primary,
                      borderRadius:8, paddingHorizontal:10, paddingVertical:6, marginBottom:4, backgroundColor:C.surface }}>
                      <Text style={{ fontSize:16, color:C.textSec, marginRight:6 }}>$</Text>
                      <input
                        type="text"
                        value={montoInput}
                        onChange={e => setMontoInput((e.target as any).value.replace(/[^0-9.]/g,''))}
                        style={{ flex:1, fontSize:18, fontWeight:'700', color:C.text,
                          border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                      />
                    </View>
                  : <TextInput
                      label="Monto recibido del cliente"
                      value={montoInput}
                      onChangeText={v => setMontoInput(v.replace(/[^0-9.]/g,''))}
                      mode="outlined"
                      keyboardType="decimal-pad"
                      left={<TextInput.Affix text="$"/>}
                      style={{ marginBottom: 4 }}
                    />
                }

                {/* Indicador si es abono o pago completo */}
                {montoInput.length > 0 && montoNum > 0 && (
                  <Text style={[s.estadoPago, cubreSaldo ? s.estadoCompleto : s.estadoAbono]}>
                    {cubreSaldo
                      ? '✅ Cuota completada'
                      : `⚡ Abono parcial · Quedará pendiente ${formatMoneda(modalItem.saldoPendiente - montoNum)}`
                    }
                  </Text>
                )}

                {/* Input fecha — HTML nativo en web/Electron para evitar bugs de controlled input */}
                <Text style={{ fontSize: 12, color: C.textSec, marginTop: 10, marginBottom: 4 }}>Fecha de pago (AAAA-MM-DD)</Text>
                {Platform.OS === 'web'
                  ? <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                      paddingHorizontal:10, paddingVertical:6, marginBottom:12, backgroundColor:C.surface }}>
                      <input
                        type="text"
                        value={fechaPago}
                        onChange={e => setFechaPago((e.target as any).value)}
                        placeholder="2025-01-15"
                        style={{ fontSize:16, fontWeight:'600', color:C.text,
                          border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                      />
                    </View>
                  : <TextInput
                      label="Fecha de pago (AAAA-MM-DD)"
                      value={fechaPago}
                      onChangeText={setFechaPago}
                      mode="outlined"
                      style={{ marginBottom: 12 }}
                    />
                }

                {/* Toggle mora (solo si hay días de atraso) */}
                {modalItem.diasAtraso > 0 && (
                  <View style={s.switchRow}>
                    <View style={{flex:1}}>
                      <Text style={s.modalLbl}>¿Cobrar mora?</Text>
                      <Text style={{fontSize:11,color:'#999'}}>
                        {conMora ? 'Mora por días de atraso' : 'Sin mora (problema del asesor)'}
                      </Text>
                    </View>
                    <Switch value={conMora} onValueChange={setConMora} color="#c62828"/>
                  </View>
                )}

                {conMora && modalItem.mora > 0 && (
                  <View style={[s.modalRow,{backgroundColor:C.isDark?'#2e1b1b':'#ffebee',padding:8,borderRadius:8,marginBottom:8}]}>
                    <Text style={{color:C.danger,fontWeight:'600'}}>Mora ({modalItem.diasAtraso} días):</Text>
                    <Text style={{color:C.danger,fontWeight:'700'}}>{formatMoneda(modalItem.mora)}</Text>
                  </View>
                )}

                {/* Campo multa — HTML nativo en web/Electron para evitar bugs de controlled input */}
                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Multa cobrada (opcional)</Text>
                {Platform.OS === 'web'
                  ? <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:C.primary,
                      borderRadius:8, paddingHorizontal:10, paddingVertical:6, marginBottom:4, backgroundColor:C.surface }}>
                      <Text style={{ fontSize:16, color:C.textSec, marginRight:6 }}>$</Text>
                      <input
                        type="text"
                        value={multaInput}
                        onChange={e => setMultaInput((e.target as any).value.replace(/[^0-9.]/g,''))}
                        placeholder="0.00"
                        style={{ flex:1, fontSize:18, fontWeight:'700', color:C.text,
                          border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                      />
                    </View>
                  : <TextInput
                      label="Multa cobrada (opcional)"
                      value={multaInput}
                      onChangeText={v => setMultaInput(v.replace(/[^0-9.]/g,''))}
                      mode="outlined"
                      keyboardType="decimal-pad"
                      left={<TextInput.Affix text="$"/>}
                      style={{ marginBottom: 4 }}
                      placeholder="0.00"
                    />
                }
                {multaNum > 0 && (
                  <View style={[s.modalRow,{backgroundColor:C.isDark?'#2a1a00':'#fff8e1',padding:8,borderRadius:8,marginBottom:8}]}>
                    <Text style={{color:'#e65100',fontWeight:'600'}}>⚠️ Multa:</Text>
                    <Text style={{color:'#e65100',fontWeight:'700'}}>{formatMoneda(multaNum)}</Text>
                  </View>
                )}

                {/* Total a registrar */}
                <View style={[s.modalRow,{backgroundColor:C.surfaceCard,padding:10,borderRadius:8,marginBottom:16}]}>
                  <Text style={s.modalTotLbl}>TOTAL A REGISTRAR:</Text>
                  <Text style={s.modalTotVal}>{formatMoneda(montoNum + moraModal + multaNum)}</Text>
                </View>

                {/* ── CARGOS ADMIN DISTRIBUIDOS (por cuota) ── */}
                {cargosAdmin.length > 0 && (
                  <View style={{ borderWidth:1.5, borderColor:'#1565c0', borderRadius:10,
                    padding:12, marginBottom:14, backgroundColor:C.isDark?'rgba(21,101,192,0.08)':'#e8f0fe' }}>
                    <Text style={{ fontSize:11, fontWeight:'800', color:'#1565c0', letterSpacing:0.5,
                      textTransform:'uppercase', marginBottom:6 }}>
                      📊 Cargo Admin — Cuota de hoy
                    </Text>
                    {cargosAdmin.map((c, i) => (
                      <View key={i} style={{ marginBottom:6 }}>
                        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                          <Text style={{ fontSize:12, color:C.text, flex:1 }} numberOfLines={1}>
                            {c.concepto}
                          </Text>
                          <Text style={{ fontSize:15, fontWeight:'800', color:'#1565c0' }}>
                            {formatMoneda(c.monto_por_cuota)}
                          </Text>
                        </View>
                        <Text style={{ fontSize:10, color:C.textSec, marginTop:2 }}>
                          Cuota {c.cuotas_cobradas + 1} de {c.cuotas_plan}
                          {' · '}Cobrado: {formatMoneda(c.monto_por_cuota * c.cuotas_cobradas)}
                          {' · '}Pendiente: {formatMoneda(c.monto_por_cuota * (c.cuotas_plan - c.cuotas_cobradas))}
                        </Text>
                      </View>
                    ))}
                    <View style={{ flexDirection:'row', justifyContent:'space-between',
                      borderTopWidth:1, borderTopColor:'#1565c0', marginTop:4, paddingTop:8 }}>
                      <Text style={{ fontSize:13, fontWeight:'800', color:'#0d47a1' }}>
                        COBRAR HOY (admin)
                      </Text>
                      <Text style={{ fontSize:16, fontWeight:'900', color:'#0d47a1' }}>
                        {formatMoneda(cargosAdmin.reduce((a,c)=>a+c.monto_por_cuota,0))}
                      </Text>
                    </View>
                    <Button mode="contained" icon="receipt" loading={cobrandoAdmin}
                      disabled={cobrandoAdmin}
                      onPress={cobrarAdmin}
                      style={{ marginTop:10, backgroundColor:'#1565c0' }}
                      labelStyle={{ fontSize:12 }}>
                      Cobrar + Factura Admin Separada
                    </Button>
                    <Text style={{ fontSize:10, color:'#888', marginTop:4, textAlign:'center', fontStyle:'italic' }}>
                      Factura de administración independiente de la cuota del préstamo
                    </Text>
                  </View>
                )}

                <View style={s.modalBtns}>
                  <Button mode="outlined" onPress={()=>setModalItem(null)} style={{flex:1}} disabled={guardando}>
                    Cancelar
                  </Button>
                  <Button mode="contained" onPress={confirmarPago} loading={guardando}
                    disabled={guardando || montoNum <= 0}
                    style={{flex:1,backgroundColor:C.primary}}>
                    Confirmar
                  </Button>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── MODAL FACTURA INTERNA EDITABLE ── */}
      <Modal visible={modalFactura} transparent animationType="fade" onRequestClose={()=>setModalFactura(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:0}}
            keyboardShouldPersistTaps="always">
            <View style={[s.modalBox,{maxHeight:'92%'}]}>
              <Text style={[s.modalTit,{fontSize:17,marginBottom:2}]}>🧾 Factura para el Cliente</Text>
              <Text style={{fontSize:11,color:C.textSec,marginBottom:10}}>
                {ultimoPago?.cliente?.nombre?.toUpperCase()}
              </Text>

              {/* DTE guardado en cola */}
              {dteGuardado ? (
                <View style={{backgroundColor:C.isDark?'#0d1f0d':'#e8f5e9',borderRadius:8,
                  padding:10,marginBottom:12,flexDirection:'row',alignItems:'center',gap:8}}>
                  <Text style={{fontSize:14}}>✅</Text>
                  <View style={{flex:1}}>
                    <Text style={{color:'#2e7d32',fontSize:12,fontWeight:'700'}}>DTE guardado en cola</Text>
                    <Text style={{color:'#388e3c',fontSize:10,marginTop:2}} numberOfLines={1}>{dteGuardado}</Text>
                  </View>
                </View>
              ) : elAPI2 ? (
                <View style={{backgroundColor:C.isDark?'#1a1000':'#fff8e1',borderRadius:8,
                  padding:10,marginBottom:12}}>
                  <Text style={{color:'#e65100',fontSize:11}}>⚠️ No se pudo generar DTE (verifique configuración)</Text>
                </View>
              ) : null}

              {/* ── Líneas de la factura ── */}
              <Text style={{fontSize:10,fontWeight:'700',color:C.textSec,letterSpacing:0.6,marginBottom:6}}>
                CONCEPTOS
              </Text>

              {itemsFactura.map((item, i) => (
                <View key={i} style={{flexDirection:'row',alignItems:'center',marginBottom:6,gap:4}}>
                  {/* Concepto */}
                  {Platform.OS === 'web'
                    ? <input
                        type="text"
                        value={item.concepto}
                        onChange={e => {
                          const arr = [...itemsFactura];
                          arr[i] = {...arr[i], concepto:(e.target as any).value};
                          setItemsFactura(arr);
                        }}
                        style={{flex:1,fontSize:12,padding:'5px 8px',border:'1px solid #ccc',
                          borderRadius:6,background:'transparent',color:C.text,minWidth:0} as any}
                      />
                    : <TextInput value={item.concepto}
                        onChangeText={v=>{const a=[...itemsFactura];a[i]={...a[i],concepto:v};setItemsFactura(a);}}
                        mode="flat" dense style={{flex:1,backgroundColor:'transparent',height:36}}/>
                  }
                  {/* Monto */}
                  {Platform.OS === 'web'
                    ? <View style={{flexDirection:'row',alignItems:'center',borderWidth:1,
                        borderColor:C.border,borderRadius:6,paddingHorizontal:6,paddingVertical:4}}>
                        <Text style={{color:C.textSec,fontSize:11}}>$</Text>
                        <input
                          type="text"
                          value={String(item.monto)}
                          onChange={e=>{
                            const arr=[...itemsFactura];
                            arr[i]={...arr[i],monto:parseFloat((e.target as any).value)||0};
                            setItemsFactura(arr);
                          }}
                          style={{width:54,fontSize:12,fontWeight:'700',border:'none',outline:'none',
                            background:'transparent',color:C.text,textAlign:'right'} as any}
                        />
                      </View>
                    : <TextInput value={String(item.monto)}
                        onChangeText={v=>{const a=[...itemsFactura];a[i]={...a[i],monto:parseFloat(v)||0};setItemsFactura(a);}}
                        mode="flat" dense keyboardType="decimal-pad"
                        style={{width:70,backgroundColor:'transparent'}}/>
                  }
                  {/* Eliminar */}
                  <TouchableOpacity onPress={()=>setItemsFactura(prev=>prev.filter((_,j)=>j!==i))}
                    style={{padding:4}}>
                    <Text style={{color:C.danger,fontSize:16,fontWeight:'700'}}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {/* Agregar concepto nuevo */}
              <View style={{flexDirection:'row',gap:4,marginTop:4,marginBottom:10,alignItems:'center'}}>
                {Platform.OS === 'web'
                  ? <input
                      type="text"
                      value={nuevoConcepto}
                      onChange={e=>setNuevoConcepto((e.target as any).value)}
                      placeholder="Ej: Gasto de visita, Papelería..."
                      style={{flex:1,fontSize:12,padding:'6px 8px',border:'1px dashed #ccc',
                        borderRadius:6,background:'transparent',color:C.text} as any}
                    />
                  : <TextInput value={nuevoConcepto} onChangeText={setNuevoConcepto}
                      mode="outlined" dense placeholder="Nuevo concepto..." style={{flex:1,height:36}}/>
                }
                {Platform.OS === 'web'
                  ? <input
                      type="text"
                      value={nuevoMonto}
                      onChange={e=>setNuevoMonto((e.target as any).value.replace(/[^0-9.]/g,''))}
                      placeholder="0.00"
                      style={{width:62,fontSize:12,padding:'6px 6px',border:'1px dashed #ccc',
                        borderRadius:6,background:'transparent',color:C.text,textAlign:'right'} as any}
                    />
                  : <TextInput value={nuevoMonto}
                      onChangeText={v=>setNuevoMonto(v.replace(/[^0-9.]/g,''))}
                      mode="outlined" dense keyboardType="decimal-pad"
                      style={{width:66,height:36}} placeholder="0.00"/>
                }
                <TouchableOpacity
                  onPress={()=>{
                    if (!nuevoConcepto.trim()) return;
                    setItemsFactura(prev=>[...prev,{concepto:nuevoConcepto,monto:parseFloat(nuevoMonto)||0}]);
                    setNuevoConcepto('');setNuevoMonto('');
                  }}
                  style={{backgroundColor:C.primary,borderRadius:6,paddingHorizontal:10,paddingVertical:8}}>
                  <Text style={{color:'#fff',fontWeight:'700',fontSize:15}}>+</Text>
                </TouchableOpacity>
              </View>

              {/* Total */}
              <View style={[s.modalRow,{backgroundColor:C.surfaceCard,padding:10,borderRadius:8,marginBottom:14}]}>
                <Text style={s.modalTotLbl}>TOTAL FACTURA:</Text>
                <Text style={[s.modalTotVal,{color:'#2e7d32'}]}>
                  {formatMoneda(itemsFactura.reduce((a,b)=>a+b.monto,0))}
                </Text>
              </View>

              {/* Botones */}
              <Button mode="contained" icon="printer" style={{marginBottom:8,backgroundColor:'#0a2463'}}
                onPress={imprimirFactura}>
                Imprimir / Guardar PDF
              </Button>
              <Button mode="text" textColor={C.textTer} onPress={()=>setModalFactura(false)}>
                Cerrar sin imprimir
              </Button>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── MODAL MULTA SUELTA ── */}
      <Modal visible={modalMulta} transparent animationType="fade" onRequestClose={()=>setModalMulta(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={[s.modalBox,{maxHeight:'90%'}]}>
            <Text style={s.modalTit}>⚠️ Registrar Multa</Text>

            {/* Monto — HTML nativo en web/Electron para evitar bugs de controlled input */}
            <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Monto de la multa</Text>
            {Platform.OS === 'web'
              ? <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:C.primary,
                  borderRadius:8, paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <Text style={{ fontSize:16, color:C.textSec, marginRight:6 }}>$</Text>
                  <input
                    type="text"
                    value={multaSueltaMonto}
                    onChange={e => setMultaSueltaMonto((e.target as any).value.replace(/[^0-9.]/g,''))}
                    style={{ flex:1, fontSize:18, fontWeight:'700', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              : <TextInput
                  label="Monto de la multa"
                  value={multaSueltaMonto}
                  onChangeText={v => setMultaSueltaMonto(v.replace(/[^0-9.]/g,''))}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  left={<TextInput.Affix text="$"/>}
                  style={{marginBottom:10}}
                  autoFocus
                />
            }

            {/* Fecha — HTML nativo en web/Electron para evitar bugs de controlled input */}
            <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Fecha (AAAA-MM-DD)</Text>
            {Platform.OS === 'web'
              ? <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                  paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input
                    type="text"
                    value={multaSueltaFecha}
                    onChange={e => setMultaSueltaFecha((e.target as any).value)}
                    placeholder="2025-01-15"
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              : <TextInput
                  label="Fecha (AAAA-MM-DD)"
                  value={multaSueltaFecha}
                  onChangeText={setMultaSueltaFecha}
                  mode="outlined"
                  style={{marginBottom:10}}
                />
            }

            {/* Selector cliente */}
            <Text style={{fontSize:12,fontWeight:'700',color:C.textSec,marginBottom:4}}>
              CLIENTE *
            </Text>
            {clienteSeleccionado ? (
              <TouchableOpacity
                onPress={() => { setClienteSeleccionado(null); setBusquedaCliente(''); }}
                style={{flexDirection:'row',alignItems:'center',backgroundColor:'#e65100',
                  borderRadius:8,padding:10,marginBottom:10,gap:8}}>
                <Text style={{flex:1,color:'#fff',fontWeight:'700'}}>{clienteSeleccionado.nombre}</Text>
                <Text style={{color:'#ffccaa',fontSize:12}}>✕ cambiar</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  label="Buscar cliente..."
                  value={busquedaCliente}
                  onChangeText={setBusquedaCliente}
                  mode="outlined"
                  style={{marginBottom:4}}
                  left={<TextInput.Icon icon="magnify"/>}
                />
                {cargandoClientes
                  ? <ActivityIndicator style={{marginVertical:8}}/>
                  : (
                    <View style={{maxHeight:160,borderWidth:1,borderColor:C.border,
                      borderRadius:8,marginBottom:10,overflow:'hidden'}}>
                      <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled>
                        {clientesLista
                          .filter(c => !busquedaCliente ||
                            c.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()))
                          .map(c => (
                            <TouchableOpacity key={c.id}
                              onPress={() => setClienteSeleccionado(c)}
                              style={{padding:10,borderBottomWidth:1,borderBottomColor:C.border}}>
                              <Text style={{fontSize:13,color:C.text}}>{c.nombre.toUpperCase()}</Text>
                            </TouchableOpacity>
                          ))
                        }
                      </ScrollView>
                    </View>
                  )
                }
              </>
            )}

            {/* Nota */}
            <TextInput
              label="Nota (opcional)"
              value={multaSueltaNota}
              onChangeText={setMultaSueltaNota}
              mode="outlined"
              style={{marginBottom:16}}
              placeholder="Ej: multa por atraso"
            />

            <View style={s.modalBtns}>
              <Button mode="outlined" onPress={()=>setModalMulta(false)} style={{flex:1}} disabled={guardandoMulta}>
                Cancelar
              </Button>
              <Button mode="contained" onPress={registrarMultaSuelta} loading={guardandoMulta}
                disabled={guardandoMulta || !clienteSeleccionado}
                style={{flex:1,backgroundColor:'#e65100'}}>
                Registrar
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:    {flex:1, backgroundColor:C.bg, ...w(glassBgStyle(C))},
  center:       {flex:1, justifyContent:'center', alignItems:'center'},
  header:       {padding:16, flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                 ...glassNavyStyle()},
  fecha:        {color:'#fff', fontSize:18, fontWeight:'700'},
  totalTxt:     {color:'#c8a951', fontSize:13},
  tabRow:       {flexDirection:'row', borderBottomWidth:1,
                 borderBottomColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)',
                 backgroundColor: C.isDark ? 'rgba(20,30,70,0.50)' : 'rgba(255,255,255,0.55)',
                 backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)'} as any,
  tabBtn:       {flex:1, paddingVertical:12, alignItems:'center'},
  tabActive:    {borderBottomWidth:3, borderBottomColor:C.primaryText},
  tabTxt:       {fontSize:13, color:C.textTer, fontWeight:'600'},
  tabTxtActive: {color:C.primaryText},
  card:         {marginBottom:10, borderRadius:14, ...glassStyle(C)},
  cardContent:  {flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:8},
  cardInfo:     {flex:1, minWidth:0},
  clienteNom:   {fontSize:15, fontWeight:'700', color:C.text, flexShrink:1},
  expTxt:       {fontSize:11, color:C.textMuted, marginTop:1},
  sub:          {fontSize:12, color:C.textTer, marginTop:1},
  moraT:        {fontSize:12, color:C.danger, marginTop:2, fontWeight:'600'},
  moraSmall:    {fontSize:11, color:C.danger, marginTop:1},
  abonoTxt:     {fontSize:12, color:C.warning, marginTop:2, fontWeight:'600'},
  saldoLbl:     {fontSize:11, color:C.textMuted},
  cardRight:    {alignItems:'flex-end'},
  monto:        {fontSize:18, fontWeight:'800', color:C.primaryText},
  btn:          {backgroundColor:C.primary, borderRadius:8, paddingHorizontal:14, paddingVertical:8, marginTop:6},
  btnRojo:      {backgroundColor:C.danger},
  btnTxt:       {color:'#fff', fontWeight:'700'},
  empty:        {alignItems:'center', padding:40},
  emptyTxt:     {color:C.textMuted, fontSize:15, marginTop:8},
  estadoPago:   {fontSize:12, fontWeight:'700', marginBottom:4, paddingHorizontal:8, paddingVertical:4, borderRadius:6},
  estadoCompleto:{color:C.success, backgroundColor:C.isDark?'#1b2e1b':'#e8f5e9'},
  estadoAbono:  {color:C.warning, backgroundColor:C.isDark?'#2e2414':'#fff3e0'},
  // Modal
  overlay:      {flex:1, backgroundColor:'rgba(0,0,0,0.55)', justifyContent:'center', padding:24},
  modalBox:     {borderRadius:18, padding:20, ...glassStyle(C),
                 backgroundColor: C.isDark ? 'rgba(15,25,65,0.92)' : 'rgba(255,255,255,0.96)'},
  modalTit:     {fontSize:16, fontWeight:'800', color:C.primaryText, marginBottom:4},
  modalCliente: {fontSize:15, fontWeight:'700', color:C.text, marginBottom:2},
  modalSub:     {fontSize:12, color:C.danger, marginBottom:14},
  modalRow:     {flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10},
  modalLbl:     {fontSize:14, color:C.textSec},
  modalVal:     {fontSize:15, fontWeight:'700', color:C.text},
  switchRow:    {flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12, gap:8},
  modalTotLbl:  {fontSize:14, fontWeight:'700', color:C.primaryText},
  modalTotVal:  {fontSize:18, fontWeight:'800', color:C.primaryText},
  modalBtns:    {flexDirection:'row', gap:10},
  // Desglose amortización
  desgloseBox:  {backgroundColor: C.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                 borderRadius:10, padding:12, marginBottom:12,
                 borderLeftWidth:3, borderLeftColor:C.primaryText},
  desgloseTitle:{fontSize:9, fontWeight:'800', color:C.textTer, letterSpacing:0.8,
                 textTransform:'uppercase', marginBottom:8},
  desgloseRow:  {flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5},
  desgloseLabel:{fontSize:13, color:C.textSec},
  desgloseVal:  {fontSize:14, fontWeight:'700'},
  desgloseNote: {fontSize:10, color:C.textTer, marginTop:6, fontStyle:'italic'},
});
