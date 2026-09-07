/**
 * Cola DTE — Documentos Tributarios Electrónicos en espera
 * ⚠️ IMPORTANTE: Hacienda permite modo contingencia hasta 24 horas.
 * Los DTEs pendientes DEBEN enviarse antes de que cumplan 24 horas.
 * Después de ese plazo el DTE vence y NO tiene validez fiscal.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform } from 'react-native';
import { Text, Button, ActivityIndicator, Card } from 'react-native-paper';
import { collection, query, getDocs, updateDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useColors, glassStyle, glassNavyStyle, glassBgStyle } from '../../../src/theme';
import { useFocusEffect, router } from 'expo-router';
import { formatMoneda } from '../../../src/utils/calculos';

const elAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null;

/** Horas transcurridas desde created_at */
function horasDesde(isoStr: string): number {
  return (Date.now() - new Date(isoStr).getTime()) / 3_600_000;
}

/** Urgencia basada en las 24 horas límite de contingencia Hacienda */
function urgencia(item: DTEItem): 'critico' | 'advertencia' | 'ok' {
  if (item.estado !== 'pendiente') return 'ok';
  const h = horasDesde(item.created_at);
  if (h >= 22) return 'critico';   // <2h para vencer — CRÍTICO
  if (h >= 16) return 'advertencia'; // entre 16-22h — ADVERTENCIA
  return 'ok';
}

interface DTEItem {
  id: string;
  created_at: string;
  fecha_emision: string;
  cliente_nombre: string;
  cliente_dui: string;
  cliente_correo: string;
  monto: number;
  numeroCuota: number;
  prestamo_id: string;
  estado: 'pendiente' | 'enviado' | 'error';
  dteJson: any;
  codigoGeneracion: string;
  numeroControl: string;
  selloRecibido?: string;
  error?: string;
  enviado_at?: string;
}

type Filtro = 'todos' | 'pendiente' | 'enviado' | 'error';

/** Descarga el JSON del DTE como archivo .json */
function descargarDTE(item: DTEItem) {
  const blob = new Blob([JSON.stringify(item.dteJson, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `DTE-${item.numeroControl || item.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Copia el JSON al portapapeles */
async function copiarDTE(item: DTEItem) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(item.dteJson, null, 2));
    alert('JSON copiado al portapapeles.');
  } catch {
    alert('No se pudo copiar. Use "Descargar JSON".');
  }
}

export default function ColaDTEScreen() {
  const { col } = useEmpresa();
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  const [lista, setLista]               = useState<DTEItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filtro, setFiltro]             = useState<Filtro>('pendiente');
  const [enviando, setEnviando]         = useState<string | null>(null); // id en proceso
  const [enviandoTodos, setEnviandoTodos] = useState(false);
  const [detalle, setDetalle]           = useState<DTEItem | null>(null);
  const [resultadoEnvio, setResultadoEnvio] = useState<{ ok: boolean; sello?: string; error?: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, col('dte_cola')), orderBy('created_at', 'desc'))
      );
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as DTEItem));
      setLista(items);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(); }, [col]));

  const listaFiltrada = useMemo(() => {
    if (filtro === 'todos') return lista;
    return lista.filter(i => i.estado === filtro);
  }, [lista, filtro]);

  const pendientes = lista.filter(i => i.estado === 'pendiente');
  const enviados   = lista.filter(i => i.estado === 'enviado');
  const errores    = lista.filter(i => i.estado === 'error');

  async function enviarUno(item: DTEItem) {
    if (!elAPI?.enviarDTECola) {
      alert('Esta función solo está disponible en la aplicación de escritorio.');
      return;
    }
    setEnviando(item.id);
    setResultadoEnvio(null);
    try {
      const res = await elAPI.enviarDTECola(item.dteJson);
      if (res?.ok) {
        await updateDoc(doc(db, col('dte_cola'), item.id), {
          estado:        'enviado',
          selloRecibido: res.sello || '',
          enviado_at:    new Date().toISOString(),
          error:         null,
        });
        setResultadoEnvio({ ok: true, sello: res.sello });
      } else {
        await updateDoc(doc(db, col('dte_cola'), item.id), {
          estado: 'error',
          error:  res?.error || 'Error desconocido',
        });
        setResultadoEnvio({ ok: false, error: res?.error });
      }
      await load();
    } catch (e: any) {
      await updateDoc(doc(db, col('dte_cola'), item.id), { estado: 'error', error: String(e) });
      setResultadoEnvio({ ok: false, error: String(e) });
    }
    setEnviando(null);
  }

  async function enviarTodosPendientes() {
    if (!elAPI?.enviarDTECola) {
      alert('Esta función solo está disponible en la aplicación de escritorio.');
      return;
    }
    const pends = lista.filter(i => i.estado === 'pendiente');
    if (pends.length === 0) { alert('No hay DTEs pendientes.'); return; }
    setEnviandoTodos(true);
    let ok = 0, err = 0;
    for (const item of pends) {
      try {
        const res = await elAPI.enviarDTECola(item.dteJson);
        if (res?.ok) {
          await updateDoc(doc(db, col('dte_cola'), item.id), {
            estado:        'enviado',
            selloRecibido: res.sello || '',
            enviado_at:    new Date().toISOString(),
            error:         null,
          });
          ok++;
        } else {
          await updateDoc(doc(db, col('dte_cola'), item.id), {
            estado: 'error',
            error:  res?.error || 'Error',
          });
          err++;
        }
      } catch (e) {
        await updateDoc(doc(db, col('dte_cola'), item.id), { estado: 'error', error: String(e) });
        err++;
      }
    }
    setEnviandoTodos(false);
    await load();
    alert(`Proceso finalizado:\n✅ ${ok} enviados\n❌ ${err} errores`);
  }

  async function reintentarError(item: DTEItem) {
    await updateDoc(doc(db, col('dte_cola'), item.id), { estado: 'pendiente', error: null });
    await load();
  }

  function formatFechaCorta(iso: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
      day:'2-digit', month:'2-digit', year:'2-digit',
      hour:'2-digit', minute:'2-digit', timeZone:'America/El_Salvador',
    });
  }

  const estadoColor = (e: string) =>
    e === 'enviado' ? '#2e7d32' : e === 'error' ? '#c62828' : '#e65100';
  const estadoIcon  = (e: string) =>
    e === 'enviado' ? '✅' : e === 'error' ? '❌' : '🕐';
  const estadoLabel = (e: string) =>
    e === 'enviado' ? 'Enviado' : e === 'error' ? 'Error' : 'Pendiente';

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color={C.primary}/></View>
  );

  // DTEs críticos (≥22h sin enviar) y en advertencia (≥16h)
  const criticos    = pendientes.filter(i => urgencia(i) === 'critico');
  const advertencia = pendientes.filter(i => urgencia(i) === 'advertencia');

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Cola DTE · Hacienda</Text>
          <Text style={s.subtitle}>
            {pendientes.length} pendientes · {enviados.length} enviados · {errores.length} errores
          </Text>
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection:'row', gap:6 }}>
            <Button icon="refresh" mode="outlined" compact onPress={load}
              textColor="#fff" style={{ borderColor: 'rgba(255,255,255,0.4)' }}>
              Recargar
            </Button>
            <Button icon="cog-outline" mode="outlined" compact
              onPress={() => router.push('/configuracion/dte' as any)}
              textColor="#c8a951" style={{ borderColor:'#c8a951' }}>
              Config DTE
            </Button>
          </View>
          {pendientes.length > 0 && (
            <Button
              mode="contained"
              compact
              loading={enviandoTodos}
              disabled={enviandoTodos || !elAPI}
              onPress={enviarTodosPendientes}
              icon="send-check"
              buttonColor="#c8a951"
              textColor="#0a2463"
            >
              Enviar {pendientes.length} a Hacienda
            </Button>
          )}
        </View>
      </View>

      {/* Banner pre-homologación */}
      {!elAPI?.enviarDTECola && (
        <View style={s.bannerPreHomol}>
          <Text style={s.bannerPreHomolTit}>🏛 Modo Pre-Homologación</Text>
          <Text style={s.bannerPreHomolSub}>
            Los DTEs se acumulan en cola. Una vez obtengas la resolución de Hacienda,
            el botón "Enviar" se activará. Para usar el portal gratuito del gobierno
            mientras tanto, descarga el JSON de cada DTE.
          </Text>
          <TouchableOpacity
            style={s.bannerPreHomolLink}
            onPress={() => {
              const w = window.open('https://factura.gob.sv', '_blank');
              w?.focus();
            }}>
            <Text style={s.bannerPreHomolLinkTxt}>🔗 Abrir portal Hacienda (factura.gob.sv)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Filtros */}
      <View style={s.filtrosRow}>
        {(['todos','pendiente','enviado','error'] as Filtro[]).map(f => (
          <TouchableOpacity key={f} style={[s.filtroBtn, filtro===f && s.filtroActive]}
            onPress={() => setFiltro(f)}>
            <Text style={[s.filtroTxt, filtro===f && s.filtroTxtActive]}>
              {f==='todos'?`Todos (${lista.length})`:
               f==='pendiente'?`🕐 Pendiente (${pendientes.length})`:
               f==='enviado'?`✅ Enviado (${enviados.length})`:
               `❌ Error (${errores.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Banners de urgencia 24h */}
      {criticos.length > 0 && (
        <View style={s.bannerCritico}>
          <Text style={s.bannerTxt}>
            🚨 {criticos.length} DTE{criticos.length>1?'s':''} vence{criticos.length===1?'':'n'} en menos de 2 horas.
            ¡Envía a Hacienda AHORA!
          </Text>
          <TouchableOpacity onPress={enviarTodosPendientes}
            style={s.bannerBtn} disabled={enviandoTodos || !elAPI}>
            <Text style={s.bannerBtnTxt}>{enviandoTodos ? '...' : 'Enviar ahora'}</Text>
          </TouchableOpacity>
        </View>
      )}
      {advertencia.length > 0 && criticos.length === 0 && (
        <View style={s.bannerAdvertencia}>
          <Text style={s.bannerTxt}>
            ⚠️ {advertencia.length} DTE{advertencia.length>1?'s':''} lleva{advertencia.length===1?'':'n'} más de 16 horas pendiente{advertencia.length>1?'s':''}. Límite: 24h.
          </Text>
        </View>
      )}
      {pendientes.length > 0 && criticos.length === 0 && advertencia.length === 0 && (
        <View style={s.bannerInfo}>
          <Text style={{fontSize:11,color:'#0a2463'}}>
            ℹ️ Hacienda permite modo contingencia hasta 24 horas. Envía los DTEs pendientes antes de ese plazo.
          </Text>
        </View>
      )}

      {/* Lista */}
      <FlatList
        data={listaFiltrada}
        keyExtractor={i => i.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => {
          const urg = urgencia(item);
          const horas = item.estado === 'pendiente' ? horasDesde(item.created_at) : 0;
          return (
          <Card style={[s.card,
            { borderLeftColor: urg==='critico'?'#b71c1c': urg==='advertencia'?'#e65100': estadoColor(item.estado),
              borderLeftWidth: 4 }]}
            elevation={1}>
            <Card.Content>
              {/* Badge urgencia */}
              {urg === 'critico' && (
                <View style={s.badgeCritico}>
                  <Text style={s.badgeTxt}>🚨 CRÍTICO — vence en {Math.max(0, Math.floor(24-horas))}h</Text>
                </View>
              )}
              {urg === 'advertencia' && (
                <View style={s.badgeAdvertencia}>
                  <Text style={s.badgeTxt}>⚠️ {Math.floor(horas)}h de las 24h límite</Text>
                </View>
              )}
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.clienteNom} numberOfLines={1}>
                    {item.cliente_nombre.toUpperCase()}
                  </Text>
                  <Text style={s.sub}>
                    {estadoIcon(item.estado)} {estadoLabel(item.estado)} · {formatFechaCorta(item.created_at)}
                  </Text>
                  <Text style={s.control} numberOfLines={1}>{item.numeroControl}</Text>
                  {item.error && (
                    <Text style={s.errorTxt} numberOfLines={2}>⚠️ {item.error}</Text>
                  )}
                </View>
                <View style={{ alignItems:'flex-end', gap: 6 }}>
                  <Text style={s.monto}>{formatMoneda(item.monto)}</Text>
                  <TouchableOpacity onPress={() => { setDetalle(item); setResultadoEnvio(null); }}
                    style={s.verBtn}>
                    <Text style={s.verBtnTxt}>Ver DTE</Text>
                  </TouchableOpacity>
                  {/* Botones JSON para pre-homologación */}
                  {Platform.OS === 'web' && item.dteJson && (
                    <View style={{ flexDirection:'row', gap:4 }}>
                      <TouchableOpacity onPress={() => copiarDTE(item)} style={s.jsonBtn}>
                        <Text style={s.jsonBtnTxt}>📋</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => descargarDTE(item)} style={s.jsonBtn}>
                        <Text style={s.jsonBtnTxt}>📥</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {item.estado === 'pendiente' && (
                    <TouchableOpacity
                      onPress={() => enviarUno(item)}
                      disabled={enviando===item.id || enviandoTodos || !elAPI?.enviarDTECola}
                      style={[s.enviarBtn,
                        urg==='critico' && {backgroundColor:'#b71c1c'},
                        (enviando===item.id || !elAPI?.enviarDTECola) && { opacity: 0.45 }]}>
                      {enviando === item.id
                        ? <ActivityIndicator size={14} color="#fff"/>
                        : <Text style={s.enviarBtnTxt}>
                            {elAPI?.enviarDTECola ? 'Enviar ▶' : '🔒 Pendiente'}
                          </Text>
                      }
                    </TouchableOpacity>
                  )}
                  {item.estado === 'error' && (
                    <TouchableOpacity onPress={() => reintentarError(item)} style={s.retryBtn}>
                      <Text style={s.retryBtnTxt}>↺ Reintentar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </Card.Content>
          </Card>
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 40 }}>📬</Text>
            <Text style={s.emptyTxt}>
              {filtro === 'pendiente' ? 'No hay DTEs pendientes' :
               filtro === 'enviado'   ? 'Ningún DTE enviado aún' :
               filtro === 'error'     ? 'Sin errores' : 'Cola vacía'}
            </Text>
            <Text style={s.emptyNote}>
              Los DTEs se generan automáticamente al registrar cobros
            </Text>
          </View>
        }
      />

      {/* ── MODAL DETALLE DTE ── */}
      <Modal visible={!!detalle} transparent animationType="fade" onRequestClose={() => setDetalle(null)}>
        <View style={s.overlay}>
          <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }}>
            <View style={[s.modalBox]}>
              {detalle && (
                <>
                  <Text style={s.modalTit}>Detalle DTE</Text>

                  {/* Resultado del envío (si se acaba de enviar) */}
                  {resultadoEnvio && (
                    <View style={{
                      backgroundColor: resultadoEnvio.ok
                        ? (C.isDark ? '#0d1f0d' : '#e8f5e9')
                        : (C.isDark ? '#2e0d0d' : '#ffebee'),
                      borderRadius: 8, padding: 10, marginBottom: 12,
                    }}>
                      <Text style={{ color: resultadoEnvio.ok ? '#2e7d32' : '#c62828', fontWeight: '700', fontSize: 13 }}>
                        {resultadoEnvio.ok ? '✅ Enviado a Hacienda correctamente' : '❌ Error al enviar'}
                      </Text>
                      {resultadoEnvio.sello && (
                        <Text style={{ fontSize: 10, color: C.textSec, marginTop: 4 }}
                          numberOfLines={2}>Sello: {resultadoEnvio.sello}</Text>
                      )}
                      {resultadoEnvio.error && (
                        <Text style={{ fontSize: 11, color: '#c62828', marginTop: 4 }}>
                          {resultadoEnvio.error}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Info básica */}
                  {[
                    ['Cliente', detalle.cliente_nombre],
                    ['DUI', detalle.cliente_dui || '—'],
                    ['Correo', detalle.cliente_correo || '—'],
                    ['Monto', formatMoneda(detalle.monto)],
                    ['Cuota N°', String(detalle.numeroCuota)],
                    ['Fecha emisión', detalle.fecha_emision],
                    ['Estado', `${estadoIcon(detalle.estado)} ${estadoLabel(detalle.estado)}`],
                  ].map(([lbl, val]) => (
                    <View key={lbl} style={s.detalleRow}>
                      <Text style={s.detalleLbl}>{lbl}:</Text>
                      <Text style={s.detalleVal} numberOfLines={1}>{val}</Text>
                    </View>
                  ))}

                  <Text style={[s.detalleLbl, { marginTop: 8, marginBottom: 4 }]}>N° Control:</Text>
                  <Text style={s.mono} numberOfLines={2}>{detalle.numeroControl}</Text>

                  <Text style={[s.detalleLbl, { marginTop: 6, marginBottom: 4 }]}>Código Generación:</Text>
                  <Text style={s.mono} numberOfLines={2}>{detalle.codigoGeneracion}</Text>

                  {detalle.selloRecibido && (
                    <>
                      <Text style={[s.detalleLbl, { marginTop: 6, marginBottom: 4 }]}>Sello MH:</Text>
                      <Text style={s.mono} numberOfLines={3}>{detalle.selloRecibido}</Text>
                    </>
                  )}
                  {detalle.error && (
                    <>
                      <Text style={[s.detalleLbl, { marginTop: 6, color: '#c62828' }]}>Error:</Text>
                      <Text style={{ fontSize: 11, color: '#c62828', marginTop: 2 }}>{detalle.error}</Text>
                    </>
                  )}

                  {/* Botones JSON */}
                  {Platform.OS === 'web' && detalle.dteJson && (
                    <View style={{ flexDirection:'row', gap:8, marginTop:12 }}>
                      <TouchableOpacity onPress={() => copiarDTE(detalle)}
                        style={[s.verBtn, { flex:1, alignItems:'center', paddingVertical:8 }]}>
                        <Text style={s.verBtnTxt}>📋 Copiar JSON</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => descargarDTE(detalle)}
                        style={[s.verBtn, { flex:1, alignItems:'center', paddingVertical:8,
                          borderColor:'#c8a951' }]}>
                        <Text style={[s.verBtnTxt, { color:'#c8a951' }]}>📥 Descargar JSON</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Botones */}
                  <View style={{ gap: 8, marginTop: 16 }}>
                    {detalle.estado === 'pendiente' && (
                      <Button mode="contained" icon="send" loading={enviando === detalle.id}
                        disabled={enviando === detalle.id || !elAPI?.enviarDTECola}
                        buttonColor="#0a2463"
                        onPress={async () => {
                          await enviarUno(detalle);
                          const upd = lista.find(i => i.id === detalle.id);
                          if (upd) setDetalle(upd);
                        }}>
                        {elAPI?.enviarDTECola ? 'Enviar a Hacienda ahora' : '🔒 Envío bloqueado (pre-homologación)'}
                      </Button>
                    )}
                    {detalle.estado === 'error' && (
                      <Button mode="outlined" icon="refresh" textColor="#e65100"
                        style={{ borderColor: '#e65100' }}
                        onPress={async () => { await reintentarError(detalle); setDetalle(null); }}>
                        Marcar como pendiente (reintentar)
                      </Button>
                    )}
                    <Button mode="text" textColor={C.textTer} onPress={() => setDetalle(null)}>
                      Cerrar
                    </Button>
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg, ...glassBgStyle(C) as any },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:      { padding: 16, flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'center', ...glassNavyStyle() as any },
  title:       { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtitle:    { color: '#c8a951', fontSize: 12, marginTop: 2 },
  filtrosRow:  { flexDirection: 'row', padding: 10, gap: 6, flexWrap: 'wrap',
                 backgroundColor: C.isDark ? 'rgba(20,30,70,0.50)' : 'rgba(255,255,255,0.55)',
                 borderBottomWidth: 1, borderBottomColor: C.border },
  filtroBtn:   { borderRadius: 20, borderWidth: 1, borderColor: C.border,
                 paddingHorizontal: 10, paddingVertical: 5 },
  filtroActive:{ backgroundColor: C.primary, borderColor: C.primary },
  filtroTxt:   { fontSize: 11, color: C.textSec, fontWeight: '600' },
  filtroTxtActive: { color: '#fff' },
  // Banners 24h urgencia
  bannerCritico:   { backgroundColor:'#b71c1c', padding:12, flexDirection:'row',
                     alignItems:'center', justifyContent:'space-between', gap:8 },
  bannerAdvertencia:{ backgroundColor:'#e65100', padding:10 },
  bannerInfo:      { backgroundColor:'#e8f0ff', padding:10,
                     borderBottomWidth:1, borderBottomColor:'#c5cae9' },
  bannerTxt:       { color:'#fff', fontSize:12, fontWeight:'700', flex:1 },
  bannerBtn:       { backgroundColor:'#fff', borderRadius:6, paddingHorizontal:10, paddingVertical:5 },
  bannerBtnTxt:    { color:'#b71c1c', fontSize:12, fontWeight:'800' },
  // Badges en tarjeta
  badgeCritico:    { backgroundColor:'#b71c1c', borderRadius:4, paddingHorizontal:6, paddingVertical:2,
                     marginBottom:6, alignSelf:'flex-start' },
  badgeAdvertencia:{ backgroundColor:'#e65100', borderRadius:4, paddingHorizontal:6, paddingVertical:2,
                     marginBottom:6, alignSelf:'flex-start' },
  badgeTxt:        { color:'#fff', fontSize:9, fontWeight:'700' },
  card:        { marginBottom: 10, borderRadius: 12, ...glassStyle(C) as any },
  clienteNom:  { fontSize: 14, fontWeight: '700', color: C.text },
  sub:         { fontSize: 11, color: C.textSec, marginTop: 2 },
  control:     { fontSize: 9, color: C.textTer, marginTop: 2, fontFamily: Platform.OS==='web'?'monospace':undefined },
  errorTxt:    { fontSize: 10, color: '#c62828', marginTop: 3 },
  monto:       { fontSize: 16, fontWeight: '800', color: C.primaryText },
  verBtn:      { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border,
                 borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  verBtnTxt:   { fontSize: 11, color: C.textSec, fontWeight: '600' },
  enviarBtn:   { backgroundColor: '#0a2463', borderRadius: 6,
                 paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center', minWidth: 70 },
  enviarBtnTxt:{ color: '#fff', fontSize: 11, fontWeight: '700' },
  retryBtn:    { backgroundColor: '#e65100', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  retryBtnTxt: { color: '#fff', fontSize: 11, fontWeight: '600' },
  jsonBtn:     { backgroundColor: 'rgba(200,169,81,0.15)', borderRadius: 6, width: 28, height: 28,
                 justifyContent: 'center', alignItems: 'center',
                 borderWidth: 1, borderColor: 'rgba(200,169,81,0.35)' },
  jsonBtnTxt:  { fontSize: 13 },
  // Banner pre-homologación
  bannerPreHomol: {
    backgroundColor: C.isDark ? 'rgba(10,36,99,0.92)' : '#e8f0ff',
    borderBottomWidth: 1, borderBottomColor: C.isDark ? 'rgba(105,240,174,0.2)' : '#c5cae9',
    padding: 12,
  },
  bannerPreHomolTit: { color: C.isDark ? '#69f0ae' : '#0a2463', fontSize: 12, fontWeight: '800', marginBottom: 4 },
  bannerPreHomolSub: { color: C.isDark ? 'rgba(200,220,255,0.8)' : '#1a237e', fontSize: 11, lineHeight: 16 },
  bannerPreHomolLink: { marginTop: 8, alignSelf: 'flex-start' },
  bannerPreHomolLinkTxt: { color: '#c8a951', fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },
  empty:       { alignItems: 'center', padding: 40 },
  emptyTxt:    { color: C.textSec, fontSize: 15, marginTop: 8, fontWeight: '600' },
  emptyNote:   { color: C.textTer, fontSize: 12, marginTop: 6, textAlign: 'center' },
  // Modal
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalBox:    { borderRadius: 18, padding: 20, ...glassStyle(C) as any,
                 backgroundColor: C.isDark ? 'rgba(15,25,65,0.95)' : 'rgba(255,255,255,0.97)' },
  modalTit:    { fontSize: 16, fontWeight: '800', color: C.primaryText, marginBottom: 12 },
  detalleRow:  { flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'center', paddingVertical: 5,
                 borderBottomWidth: 1, borderBottomColor: C.border },
  detalleLbl:  { fontSize: 12, color: C.textSec, fontWeight: '600' },
  detalleVal:  { fontSize: 12, color: C.text, fontWeight: '700', maxWidth: '65%', textAlign: 'right' },
  mono:        { fontSize: 10, color: C.textSec, fontFamily: Platform.OS==='web'?'monospace':undefined,
                 backgroundColor: C.isDark ? 'rgba(255,255,255,0.05)' : '#f5f5f5',
                 padding: 6, borderRadius: 6 },
});
