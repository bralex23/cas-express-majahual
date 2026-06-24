import React, { useState, useMemo, useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform } from 'react-native';
import { Text, Card, Button, ActivityIndicator, Switch, TextInput } from 'react-native-paper';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc, orderBy } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassNavyStyle, glassBgStyle } from '../../../src/theme';
import { StaggerItem } from '../../../src/components/FadeIn';
const w = (s: any) => s;
import { Prestamo, Pago } from '../../../src/types';
import { calcularVencimiento, calcularMora, formatMoneda, formatFecha, hoy } from '../../../src/utils/calculos';
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
            };
          } else {
            clienteCache[cid] = { nombre:'Cliente', telefono:'', expediente:'', geoCodigo:'' };
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
  function abrirModal(item: CobrosItem) {
    setModalItem(item);
    setFechaPago(hoyStr);
    setConMora(false);
    setMultaInput('');
    // Dejar vacío para que el cobrador ingrese el monto REAL recibido
    // (la cuota se muestra como referencia abajo)
    setMontoInput('');
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
      await registrarPagoDistribuido(modalItem, monto, mora, fechaPago, multa);
      setModalItem(null);
      load();
    } catch(e) { console.error(e); }
    setGuardando(false);
  }

  async function registrarPagoDistribuido(item: CobrosItem, montoTotal: number, mora: number, fechaPagoVal: string, multa: number = 0) {
    const { prestamo } = item;

    // Obtener todas las cuotas pendientes del préstamo en orden
    const pagosSnap = await getDocs(collection(db, col('prestamos'), prestamo.id, 'pagos'));
    const pagosExistentes = pagosSnap.docs.map(d => d.data());
    const pagadoXCuota = new Map<number,number>();
    pagosExistentes.forEach(pg => {
      pagadoXCuota.set(pg.numero_cuota, (pagadoXCuota.get(pg.numero_cuota)||0) + (pg.monto_pagado||0));
    });

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

    for (let i = 0; i < pendientes.length; i++) {
      const cuota = pendientes[i];
      if (remaining <= 0) break;
      // Si es la última cuota que vamos a cubrir, guardar el monto real recibido
      // (incluyendo centavos de más que el cliente redondea, ej: paga $10 en vez de $9.80)
      const esUltima = remaining <= cuota.saldo || i === pendientes.length - 1;
      const pagoEsta = esUltima ? remaining : cuota.saldo;
      remaining     -= pagoEsta;
      const esCompleto = pagoEsta >= cuota.saldo;

      ops.push(addDoc(collection(db, col('prestamos'), prestamo.id, 'pagos'), {
        prestamo_id:       prestamo.id,
        numero_cuota:      cuota.numero,
        monto_cuota:       prestamo.cuota,
        monto_pagado:      pagoEsta,
        mora:              esPrimera ? mora : 0,
        tipo:              esCompleto ? 'completo' : 'abono',
        fecha_vencimiento: cuota.fv,
        fecha_pago:        fechaPagoVal,
        cobrador_id:       perfil?.id,
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
        cobrador_id:  perfil?.id,
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

  const lista    = tab === 'hoy' ? hoyLista : pendLista;
  const moraModal = modalItem && conMora ? modalItem.mora : 0;
  const montoNum  = parseFloat(montoInput.replace(',','.')) || 0;
  const multaNum  = parseFloat(multaInput.replace(',','.')) || 0;
  // ¿El monto ingresado cubre el saldo?
  const cubreSaldo = modalItem ? (montoNum >= modalItem.saldoPendiente) : false;

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
});
