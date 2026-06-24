import React, { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Image, Linking, TouchableOpacity, Modal, Alert, TextInput as RNInput } from 'react-native';
import { Text, Button, Card, ActivityIndicator, Divider, TextInput } from 'react-native-paper';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { doc, getDoc, collection, query, where, getDocs, deleteDoc, updateDoc, addDoc } from 'firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Cliente, Prestamo } from '../../../src/types';
import { formatMoneda, formatFecha, hoy } from '../../../src/utils/calculos';
import { StaggerItem } from '../../../src/components/FadeIn';
import { generarPDFCopiaDUI, generarPDFReciboLuz } from '../../../src/utils/pdf';

/* ── Tipos ── */
interface Garantia {
  id: string; descripcion: string; foto: string; fecha: string;
}

/* ── Comprimir imagen a base64 (vía canvas — Electron/web renderer) ── */
async function comprimirImagen(uri: string, maxW = 1200, calidad = 0.65): Promise<string> {
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

/* ── Imprimir garantías como PDF ── */
async function imprimirGarantias(cliente: Cliente, garantias: Garantia[]) {
  const items = garantias.map((g, i) => `
    <div style="margin-bottom:20px;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:bold;font-size:13px">${i + 1}. ${g.descripcion || 'Sin descripción'}</span>
        <span style="font-size:11px;color:#666">${g.fecha || ''}</span>
      </div>
      ${g.foto ? `<img src="${g.foto}" style="width:100%;max-height:480px;object-fit:contain;border:1px solid #ddd;border-radius:4px"/>` : '<div style="height:60px;background:#f5f5f5;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px">Sin imagen</div>'}
      <hr style="border:none;border-top:1px solid #eee;margin-top:12px"/>
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      body{font-family:Arial,sans-serif;padding:20px 24px;font-size:12px;color:#111;max-width:740px;margin:0 auto}
      @page{size:letter;margin:14mm}
    </style></head><body>
    <div style="text-align:center;font-size:16px;font-weight:900;color:#1b5e20;margin-bottom:4px">CAS EXPRESS RUTA MAJAHUAL TAMANIQUE</div>
    <div style="text-align:center;font-size:14px;font-weight:bold;border:2px solid #1b5e20;padding:5px;margin-bottom:12px">REGISTRO DE GARANTÍAS</div>
    <div style="margin-bottom:14px;font-size:13px">
      <b>Cliente:</b> ${cliente.nombre}&nbsp;&nbsp;
      ${cliente.dui ? `<b>DUI:</b> ${cliente.dui}&nbsp;&nbsp;` : ''}
      <b>Fecha:</b> ${hoy()}
    </div>
    <hr style="border:none;border-top:2px solid #1b5e20;margin-bottom:16px"/>
    ${items}
  </body></html>`;

  const elAPI = (window as any).electronAPI;
  if (elAPI?.printPreview) {
    elAPI.printPreview(html);
  } else {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.contains(iframe) && document.body.removeChild(iframe), 500);
    };
    (iframe as any).srcdoc = html;
    document.body.appendChild(iframe);
  }
}

export default function DetalleCliente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isSupervisor, isAdmin } = useAuth();
  const [cliente, setCliente]     = useState<Cliente | null>(null);
  const [prestamos, setPrestamos] = useState<Prestamo[]>([]);
  const [garantias, setGarantias] = useState<Garantia[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalBorrar, setModalBorrar]       = useState(false);
  const [borrando, setBorrando]             = useState(false);
  const [verArchivados, setVerArchivados]   = useState(false);
  const [duiSoloImg, setDuiSoloImg]         = useState(false);
  const [modalFoto, setModalFoto]           = useState(false);
  const [modalRecibo, setModalRecibo]       = useState(false);
  /* Garantías */
  const [modalGarantia, setModalGarantia]   = useState(false);
  const [gDesc, setGDesc]                   = useState('');
  const [gFoto, setGFoto]                   = useState('');
  const [gGuardando, setGGuardando]         = useState(false);
  const [gViewer, setGViewer]               = useState<Garantia|null>(null);

  const { col } = useEmpresa();

  useFocusEffect(useCallback(() => {
    async function load() {
      setLoading(true);
      const snap = await getDoc(doc(db, col('clientes'),id));
      if (!snap.exists()) { router.back(); return; }
      const c = { id: snap.id, ...snap.data() } as Cliente;
      setCliente(c);
      const [pSnap, gSnap] = await Promise.all([
        getDocs(query(collection(db, col('prestamos')), where('cliente_id','==',id))),
        getDocs(collection(db, col('clientes'), id, 'garantias')),
      ]);
      setPrestamos(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo)));
      setGarantias(gSnap.docs.map(d => ({ id: d.id, ...d.data() } as Garantia))
        .sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'')));
      setLoading(false);
    }
    load();
  }, [id]));

  /* ── Elegir foto para garantía ── */
  async function elegirFotoGarantia(desdeCamara: boolean) {
    try {
      const ImagePicker = await import('../../../src/lib/imagePicker.web');
      const res = desdeCamara
        ? await ImagePicker.launchCameraAsync({ base64: false, quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: false, quality: 0.7 });
      if (!res.canceled && res.assets[0]) {
        const b64 = await comprimirImagen(res.assets[0].uri);
        setGFoto(b64);
      }
    } catch(e) { console.error(e); }
  }

  /* ── Guardar garantía ── */
  async function guardarGarantia() {
    if (!gDesc.trim() && !gFoto) return;
    setGGuardando(true);
    try {
      await addDoc(collection(db, col('clientes'), id, 'garantias'), {
        descripcion: gDesc.trim(), foto: gFoto, fecha: hoy(),
      });
      const gSnap = await getDocs(collection(db, col('clientes'), id, 'garantias'));
      setGarantias(gSnap.docs.map(d => ({ id: d.id, ...d.data() } as Garantia))
        .sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'')));
      setGDesc(''); setGFoto(''); setModalGarantia(false);
    } catch(e:any) { window.alert('Error al guardar garantía: ' + (e?.message||e)); }
    setGGuardando(false);
  }

  /* ── Borrar garantía ── */
  async function borrarGarantia(gId: string) {
    if (!window.confirm('¿Eliminar esta garantía?')) return;
    await deleteDoc(doc(db, col('clientes'), id, 'garantias', gId));
    setGarantias(prev => prev.filter(g => g.id !== gId));
  }

  async function confirmarBorrar() {
    setBorrando(true);
    try {
      if (prestamos.length > 0) {
        await updateDoc(doc(db, col('clientes'),id), { activo: false });
      } else {
        await deleteDoc(doc(db, col('clientes'),id));
      }
      setModalBorrar(false);
      setTimeout(() => router.back(), 150);
    } catch(e: any) {
      setModalBorrar(false);
      setBorrando(false);
      Alert.alert('Error', e?.message || 'No se pudo eliminar.');
    }
    setBorrando(false);
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary}/></View>;
  if (!cliente) return null;

  const estadoColor: Record<string,string> = {
    activo:'#1565c0', completado:'#2e7d32', mora:'#c62828', cancelado:'#666'
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      {/* Foto y datos básicos */}
      <Card style={s.card} elevation={2}>
        <Card.Content style={s.perfil}>
          {cliente.foto_url
            ? <TouchableOpacity onPress={() => setModalFoto(true)} activeOpacity={0.8}>
                <Image source={{ uri: cliente.foto_url }} style={s.foto}/>
                <Text style={{ fontSize:9, color:'#2e7d32', textAlign:'center', marginTop:2 }}>
                  🔍 Ver
                </Text>
              </TouchableOpacity>
            : <View style={s.fotoPlaceholder}>
                <Text style={{ fontSize:40 }}>👤</Text>
              </View>
          }
          <View style={s.perfilInfo}>
            <Text style={s.nombre}>{cliente.nombre}</Text>
            {cliente.numero_expediente && <Text style={s.sub}>📋 Exp: {cliente.numero_expediente}</Text>}
            {cliente.dui && <Text style={s.sub}>🪪 {cliente.dui}</Text>}
            {cliente.telefono && (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${cliente.telefono}`)}>
                <Text style={s.link}>📞 {cliente.telefono}</Text>
              </TouchableOpacity>
            )}
            {cliente.maps_url && (
              <TouchableOpacity onPress={() => Linking.openURL(cliente.maps_url!)}>
                <Text style={s.link}>📍 Ver en Google Maps</Text>
              </TouchableOpacity>
            )}
          </View>
        </Card.Content>
      </Card>

      {cliente.direccion && (
        <Card style={[s.card,{marginTop:10}]}>
          <Card.Content>
            <Text style={s.secLabel}>Dirección</Text>
            <Text>{cliente.direccion}</Text>
          </Card.Content>
        </Card>
      )}

      {cliente.notas && (
        <Card style={[s.card,{marginTop:10}]}>
          <Card.Content>
            <Text style={s.secLabel}>Notas</Text>
            <Text>{cliente.notas}</Text>
          </Card.Content>
        </Card>
      )}

      {/* ══ GARANTÍAS ══ */}
      <Card style={[s.card, { marginTop: 10 }]}>
        <Card.Content>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom: 10 }}>
            <Text style={s.secTitulo}>🛡️ Garantías ({garantias.length})</Text>
            <View style={{ flexDirection:'row', gap: 8 }}>
              {garantias.length > 0 && (
                <TouchableOpacity
                  style={{ flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:5,
                    borderRadius:8, borderWidth:1, borderColor:C.primary }}
                  onPress={() => cliente && imprimirGarantias(cliente, garantias)}>
                  <MaterialCommunityIcons name="printer-outline" size={14} color={C.primary}/>
                  <Text style={{ fontSize:12, fontWeight:'700', color:C.primary }}>Imprimir</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={{ flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:5,
                  borderRadius:8, backgroundColor: C.primary }}
                onPress={() => { setGDesc(''); setGFoto(''); setModalGarantia(true); }}>
                <MaterialCommunityIcons name="plus" size={14} color="#fff"/>
                <Text style={{ fontSize:12, fontWeight:'700', color:'#fff' }}>Agregar</Text>
              </TouchableOpacity>
            </View>
          </View>

          {garantias.length === 0 && (
            <Text style={{ fontSize:12, color:C.textTer, textAlign:'center', paddingVertical:6 }}>
              Sin garantías registradas. Usa "Agregar" para subir fotos de garantía.
            </Text>
          )}

          {/* Grid de garantías */}
          <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
            {garantias.map(g => (
              <View key={g.id} style={{ width: 130 }}>
                <TouchableOpacity onPress={() => setGViewer(g)} activeOpacity={0.85}>
                  {g.foto
                    ? <Image source={{ uri: g.foto }}
                        style={{ width:130, height:90, borderRadius:8, backgroundColor: C.border }}
                        resizeMode="cover"/>
                    : <View style={{ width:130, height:90, borderRadius:8, backgroundColor:C.border,
                        justifyContent:'center', alignItems:'center' }}>
                        <MaterialCommunityIcons name="image-off-outline" size={32} color={C.textTer}/>
                      </View>
                  }
                </TouchableOpacity>
                <Text style={{ fontSize:11, fontWeight:'600', color:C.text, marginTop:4, numberOfLines:2 } as any}
                  numberOfLines={2}>
                  {g.descripcion || 'Sin descripción'}
                </Text>
                <Text style={{ fontSize:10, color:C.textTer }}>{g.fecha}</Text>
                {isSupervisor && (
                  <TouchableOpacity onPress={() => borrarGarantia(g.id)} style={{ marginTop:2 }}>
                    <Text style={{ fontSize:10, color:'#c62828' }}>🗑️ Eliminar</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </Card.Content>
      </Card>

      {/* Resumen combinado si hay múltiples créditos activos (cancelados no cuentan) */}
      {(() => {
        const activos = prestamos.filter(p => p.estado==='activo' || p.estado==='mora');
        if (activos.length < 2) return null;
        const totalDeuda = activos.reduce((s,p) => s + (p.monto_total||0), 0);
        const totalCuota = activos.reduce((s,p) => s + (p.cuota||0), 0);
        return (
          <Card style={[s.card,{marginTop:10,backgroundColor:C.isDark?'#2e2414':' #fff3e0',borderLeftWidth:4,borderLeftColor:C.warning}]} elevation={1}>
            <Card.Content>
              <Text style={{fontSize:12,fontWeight:'700',color:'#e65100',marginBottom:6}}>
                📊 RESUMEN — {activos.length} CRÉDITOS ACTIVOS
              </Text>
              <View style={s.prestRow}>
                <View>
                  <Text style={s.prestSub}>Deuda total combinada:</Text>
                  <Text style={[s.monto,{color:'#e65100'}]}>{formatMoneda(totalDeuda)}</Text>
                </View>
                <View>
                  <Text style={s.prestSub}>Cuota combinada:</Text>
                  <Text style={[s.monto,{fontSize:16}]}>{formatMoneda(totalCuota)}</Text>
                </View>
              </View>
            </Card.Content>
          </Card>
        );
      })()}

      {/* Préstamos — excluir cancelados de la lista principal */}
      {(() => {
        const visibles   = prestamos.filter(p => p.estado !== 'cancelado');
        const archivados = prestamos.filter(p => p.estado === 'cancelado');

        const renderTarjeta = (p: Prestamo, idx: number, opaco = false) => (<StaggerItem key={p.id} index={Math.min(idx,8)} step={55}>
          <TouchableOpacity key={p.id} onPress={() => router.push(`/(app)/prestamos/${p.id}`)}>
            <Card style={[s.card,{marginBottom:8, opacity: opaco ? 0.6 : 1}]} elevation={1}>
              <Card.Content>
                <View style={s.prestRow}>
                  <View style={{flex:1}}>
                    <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:2}}>
                      <Text style={s.monto}>{formatMoneda(p.monto)}</Text>
                      <View style={s.numBadge}>
                        <Text style={s.numBadgeTxt}>Crédito #{p.numero_credito||idx+1}</Text>
                      </View>
                    </View>
                    <Text style={s.prestSub}>{p.frecuencia} · {p.plazo} cuotas de {formatMoneda(p.cuota)}</Text>
                    <Text style={s.prestSub}>{formatFecha(p.fecha_inicio)} → {formatFecha(p.fecha_fin)}</Text>
                  </View>
                  <View style={[s.badge,{backgroundColor: (estadoColor[p.estado]||'#666')+'22'}]}>
                    <Text style={[s.badgeTxt,{color: estadoColor[p.estado]||'#666'}]}>
                      {p.estado.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </Card.Content>
            </Card>
          </TouchableOpacity>
        </StaggerItem>);

        return (
          <>
            <View style={s.secHeader}>
              <Text style={s.secTitulo}>Préstamos ({visibles.length})</Text>
              <Button icon="plus" mode="contained" compact
                buttonColor={C.primary} textColor="#ffffff"
                onPress={() => router.push({ pathname:'/(app)/prestamos/nuevo', params:{ cliente_id: id } })}>
                Nuevo
              </Button>
            </View>

            {visibles.map((p, idx) => renderTarjeta(p, idx))}

            {/* Historial archivado (cancelados) */}
            {archivados.length > 0 && (
              <>
                <Divider style={{ marginVertical: 10 }}/>
                <TouchableOpacity
                  style={{ flexDirection:'row', alignItems:'center', gap:6, paddingVertical:6 }}
                  onPress={() => setVerArchivados(v => !v)}
                >
                  <Text style={{ fontSize:13, color:'#888', fontWeight:'600' }}>
                    🗄️ Historial archivado ({archivados.length} cancelado{archivados.length>1?'s':''})
                  </Text>
                  <Text style={{ color:'#aaa', fontSize:13 }}>{verArchivados ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {verArchivados && archivados.map((p, idx) => renderTarjeta(p, visibles.length + idx, true))}
              </>
            )}
          </>
        );
      })()}

      {/* Botones */}
      <View style={s.btns}>
        <View style={{ alignItems:'center', gap:4 }}>
          <Button mode="outlined" icon="card-account-details" textColor={C.primary}
            style={{ borderColor:C.primary }}
            onPress={() => generarPDFCopiaDUI(cliente, duiSoloImg)}>
            Copia DUI
          </Button>
          <TouchableOpacity onPress={() => setDuiSoloImg(v => !v)}
            style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
            <View style={{ width:14, height:14, borderRadius:3, borderWidth:1.5,
              borderColor:C.primary, backgroundColor: duiSoloImg ? C.primary : 'transparent',
              alignItems:'center', justifyContent:'center' }}>
              {duiSoloImg && <Text style={{ color:'#fff', fontSize:9, lineHeight:11 }}>✓</Text>}
            </View>
            <Text style={{ fontSize:11, color:C.primary }}>Solo imágenes</Text>
          </TouchableOpacity>
        </View>
        {cliente.recibo_luz_url && (
          <Button mode="outlined" icon="lightning-bolt" textColor="#f57f17"
            style={{ borderColor:'#f57f17' }}
            onPress={() => generarPDFReciboLuz(cliente)}>
            Recibo Luz
          </Button>
        )}
        {isSupervisor && (
          <Button mode="outlined" icon="pencil" onPress={() => router.push({ pathname:'/(app)/clientes/nuevo', params:{ id } })}>
            Editar
          </Button>
        )}
        {isAdmin && (
          <Button mode="outlined" icon="delete" textColor="#c62828"
            style={{borderColor:'#c62828'}} onPress={()=>setModalBorrar(true)}>
            Borrar
          </Button>
        )}
        <Button mode="text" onPress={() => router.back()}>Volver</Button>
      </View>

      {/* Modal ver recibo de luz */}
      <Modal visible={modalRecibo} transparent animationType="fade" onRequestClose={() => setModalRecibo(false)}>
        <TouchableOpacity
          style={{ flex:1, backgroundColor:'rgba(0,0,0,0.92)', justifyContent:'center', alignItems:'center' }}
          activeOpacity={1}
          onPress={() => setModalRecibo(false)}>
          {cliente?.recibo_luz_url && (
            <Image
              source={{ uri: cliente.recibo_luz_url }}
              style={{ width:'90%', height:'80%', borderRadius:10 }}
              resizeMode="contain"/>
          )}
          <Text style={{ color:'#ffffff88', marginTop:12, fontSize:13 }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>

      {/* Modal ver foto DUI en grande */}
      <Modal visible={modalFoto} transparent animationType="fade" onRequestClose={() => setModalFoto(false)}>
        <TouchableOpacity
          style={{ flex:1, backgroundColor:'rgba(0,0,0,0.92)', justifyContent:'center', alignItems:'center' }}
          activeOpacity={1}
          onPress={() => setModalFoto(false)}
        >
          {cliente?.foto_url && (
            <Image
              source={{ uri: cliente.foto_url }}
              style={{ width:'90%', height:'80%', borderRadius:10 }}
              resizeMode="contain"
            />
          )}
          <Text style={{ color:'#ffffff88', marginTop:12, fontSize:13 }}>
            Toca para cerrar
          </Text>
        </TouchableOpacity>
      </Modal>

      {/* Modal agregar garantía */}
      <Modal visible={modalGarantia} transparent animationType="slide" onRequestClose={() => setModalGarantia(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={[s.modalTit, { color: C.primaryText }]}>🛡️ Nueva Garantía</Text>

            <TextInput
              label="Descripción (ej: Toyota Corolla 2019, placa ABC-123)"
              value={gDesc}
              onChangeText={setGDesc}
              mode="outlined"
              style={{ marginBottom:12 }}
              multiline
            />

            {/* Foto */}
            {gFoto
              ? <View style={{ marginBottom:12, alignItems:'center' }}>
                  <Image source={{ uri: gFoto }} style={{ width:'100%', height:200, borderRadius:10 }} resizeMode="contain"/>
                  <TouchableOpacity onPress={() => setGFoto('')} style={{ marginTop:6 }}>
                    <Text style={{ color:'#c62828', fontSize:12 }}>✕ Quitar foto</Text>
                  </TouchableOpacity>
                </View>
              : <View style={{ flexDirection:'row', gap:8, marginBottom:12 }}>
                  <TouchableOpacity onPress={() => elegirFotoGarantia(true)}
                    style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center',
                      gap:6, padding:10, borderRadius:10, borderWidth:1.5, borderColor:C.primary, borderStyle:'dashed' }}>
                    <MaterialCommunityIcons name="camera-outline" size={20} color={C.primary}/>
                    <Text style={{ color:C.primary, fontWeight:'700', fontSize:13 }}>Cámara</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => elegirFotoGarantia(false)}
                    style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center',
                      gap:6, padding:10, borderRadius:10, borderWidth:1.5, borderColor:C.primary, borderStyle:'dashed' }}>
                    <MaterialCommunityIcons name="image-outline" size={20} color={C.primary}/>
                    <Text style={{ color:C.primary, fontWeight:'700', fontSize:13 }}>Galería</Text>
                  </TouchableOpacity>
                </View>
            }

            <View style={s.modalBtns}>
              <Button mode="outlined" onPress={() => setModalGarantia(false)} style={{ flex:1 }}>Cancelar</Button>
              <Button mode="contained" onPress={guardarGarantia} loading={gGuardando}
                disabled={!gDesc.trim() && !gFoto}
                style={{ flex:1 }} buttonColor={C.primary} textColor="#fff">
                Guardar
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal visor garantía */}
      <Modal visible={!!gViewer} transparent animationType="fade" onRequestClose={() => setGViewer(null)}>
        <TouchableOpacity
          style={{ flex:1, backgroundColor:'rgba(0,0,0,0.94)', justifyContent:'center', alignItems:'center', padding:16 }}
          activeOpacity={1}
          onPress={() => setGViewer(null)}>
          {gViewer?.foto && (
            <Image source={{ uri: gViewer.foto }}
              style={{ width:'100%', height:'70%', borderRadius:10 }}
              resizeMode="contain"/>
          )}
          {gViewer?.descripcion ? (
            <Text style={{ color:'#fff', fontWeight:'700', fontSize:14, marginTop:12, textAlign:'center' }}>
              {gViewer.descripcion}
            </Text>
          ) : null}
          <Text style={{ color:'#ffffff55', marginTop:8, fontSize:12 }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>

      {/* Modal confirmar borrado */}
      <Modal visible={modalBorrar} transparent animationType="fade" onRequestClose={()=>setModalBorrar(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>⚠️ Eliminar Cliente</Text>
            <Text style={{color:'#555',marginBottom:6}}>
              {prestamos.length > 0
                ? `Este cliente tiene ${prestamos.length} préstamo(s). Se desactivará en vez de borrarse.`
                : '¿Seguro que deseas eliminar este cliente?'
              }
            </Text>
            <View style={s.modalBtns}>
              <Button mode="outlined" onPress={()=>setModalBorrar(false)} style={{flex:1}}>Cancelar</Button>
              <Button mode="contained" onPress={confirmarBorrar} loading={borrando}
                style={{flex:1,backgroundColor:'#c62828'}}>
                {prestamos.length > 0 ? 'Desactivar' : 'Eliminar'}
              </Button>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:{flex:1, ...w(glassBgStyle(C))},
  center:{flex:1,justifyContent:'center',alignItems:'center'},
  card:{borderRadius:12, ...glassStyle(C)},
  perfil:{flexDirection:'row',gap:14,alignItems:'flex-start'},
  foto:{width:160,height:100,borderRadius:8,resizeMode:'contain'} as any,
  fotoPlaceholder:{width:100,height:70,borderRadius:8,backgroundColor:C.border,justifyContent:'center',alignItems:'center'},
  perfilInfo:{flex:1},
  nombre:{fontSize:18,fontWeight:'800',color:C.text,marginBottom:4},
  sub:{fontSize:13,color:C.textSec,marginBottom:2},
  link:{fontSize:13,color:C.primaryText,textDecorationLine:'underline',marginBottom:2},
  secLabel:{fontSize:12,color:C.textTer,fontWeight:'700',marginBottom:4,textTransform:'uppercase'},
  secHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:16,marginBottom:8},
  secTitulo:{fontSize:16,fontWeight:'700',color:C.text},
  monto:{fontSize:18,fontWeight:'800',color:C.primaryText},
  prestSub:{fontSize:12,color:C.textTer,marginTop:2},
  prestRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  badge:{paddingHorizontal:10,paddingVertical:4,borderRadius:12},
  badgeTxt:{fontSize:11,fontWeight:'700'},
  numBadge:   {backgroundColor:C.surfaceCard,borderRadius:6,paddingHorizontal:8,paddingVertical:2},
  numBadgeTxt:{fontSize:11,fontWeight:'700',color:C.primaryText},
  btns:       {flexDirection:'row',gap:10,marginTop:16,justifyContent:'flex-end'},
  overlay:    {flex:1,backgroundColor:'#00000066',justifyContent:'center',padding:24},
  modalBox:   {backgroundColor:C.surface,borderRadius:16,padding:20},
  modalTit:   {fontSize:16,fontWeight:'800',color:'#c62828',marginBottom:12},
  modalBtns:  {flexDirection:'row',gap:10,marginTop:8},
});
