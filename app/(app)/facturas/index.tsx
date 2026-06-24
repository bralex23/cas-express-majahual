import React, { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Image, Platform } from 'react-native';
import * as ImagePicker from '../../../src/lib/imagePicker.web';
import { Text, Button, TextInput, Divider, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, addDoc, updateDoc, getDocs, deleteDoc, doc, orderBy, query } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { formatMoneda, formatFecha, hoy } from '../../../src/utils/calculos';
import { StaggerItem } from '../../../src/components/FadeIn';

const CATEGORIAS = [
  { label: 'Suscripción', icon: 'refresh-circle',    color: '#7c4dff' },
  { label: 'Servicio',    icon: 'wifi',               color: '#00838f' },
  { label: 'Equipamiento',icon: 'printer',            color: '#1565c0' },
  { label: 'Papelería',   icon: 'file-document',      color: '#2e7d32' },
  { label: 'Honorarios',  icon: 'account-tie',        color: '#c8a951' },
  { label: 'Otro',        icon: 'tag',                color: '#6d6d6d' },
];

interface Factura {
  id: string;
  descripcion: string;
  monto: number;
  fecha: string;
  categoria: string;
  notas?: string;
  imagen_url?: string;
  created_by: string;
  created_at: string;
}

export default function Facturas() {
  const { perfil, isSupervisor } = useAuth();
  const C = useColors();
  const { col } = useEmpresa();
  const s = useMemo(() => makeStyles(C), [C]);

  const [facturas, setFacturas]   = useState<Factura[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  // Form
  const [desc, setDesc]       = useState('');
  const [monto, setMonto]     = useState('');
  const [fecha, setFecha]     = useState(hoy());
  const [cat, setCat]         = useState('Suscripción');
  const [notas, setNotas]         = useState('');
  const [imagenUri, setImagenUri] = useState<string | null>(null);
  const [formErr, setFormErr]     = useState('');
  const [modalImagen, setModalImagen] = useState(false);

  // Filtro mes
  const mesActual = hoy().slice(0, 7); // YYYY-MM
  const [mesFiltro, setMesFiltro] = useState(mesActual);

  useFocusEffect(useCallback(() => { cargar(); }, []));

  async function cargar() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, col('facturas')), orderBy('fecha', 'desc')));
      setFacturas(snap.docs.map(d => ({ id: d.id, ...d.data() } as Factura)));
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function seleccionarImagen() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { window.alert('Necesitamos acceso a tus fotos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (!result.canceled) setImagenUri(result.assets[0].uri);
  }

  async function tomarFoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { window.alert('Necesitamos acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) setImagenUri(result.assets[0].uri);
  }

  async function comprimirABase64(uri: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new (window as any).Image() as HTMLImageElement;
      img.onload = () => {
        const maxW = 700;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.45));
      };
      img.onerror = reject;
      img.src = uri;
    });
  }

  async function guardar() {
    if (!desc.trim())        { setFormErr('La descripción es obligatoria.'); return; }
    if (!monto || parseFloat(monto) <= 0) { setFormErr('Ingresa un monto válido.'); return; }
    if (!fecha)              { setFormErr('La fecha es obligatoria.'); return; }
    setGuardando(true); setFormErr('');
    try {
      let imagen_url: string | null = null;
      if (imagenUri && !imagenUri.startsWith('data:') && !imagenUri.startsWith('http')) {
        imagen_url = await comprimirABase64(imagenUri);
      } else {
        imagen_url = imagenUri;
      }

      const datos = {
        descripcion: desc.trim(),
        monto: parseFloat(monto),
        fecha, categoria: cat,
        notas: notas.trim() || null,
        imagen_url: imagen_url || null,
      };

      if (editandoId) {
        await updateDoc(doc(db, col('facturas'), editandoId), datos);
      } else {
        await addDoc(collection(db, col('facturas')), {
          ...datos,
          created_by: perfil?.id || '',
          created_at: new Date().toISOString(),
        });
      }
      setModal(false);
      resetForm();
      await cargar();
    } catch(e: any) {
      setFormErr(e?.message || 'Error al guardar.');
    }
    setGuardando(false);
  }

  async function borrar(f: Factura) {
    const ok = window.confirm(`¿Eliminar factura "${f.descripcion}" (${formatMoneda(f.monto)})?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, col('facturas'), f.id));
      await cargar();
    } catch(e: any) {
      window.alert('Error: ' + (e?.message || ''));
    }
  }

  function resetForm() {
    setDesc(''); setMonto(''); setFecha(hoy()); setCat('Suscripción');
    setNotas(''); setImagenUri(null); setFormErr(''); setEditandoId(null);
  }

  function abrirModal() { resetForm(); setModal(true); }

  function abrirEditar(f: Factura) {
    setEditandoId(f.id);
    setDesc(f.descripcion);
    setMonto(String(f.monto));
    setFecha(f.fecha);
    setCat(f.categoria);
    setNotas(f.notas || '');
    setImagenUri(f.imagen_url || null);
    setFormErr('');
    setModal(true);
  }

  // Navegar mes
  function cambiarMes(delta: number) {
    const [y, m] = mesFiltro.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMesFiltro(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const facturasFiltradas = facturas.filter(f => f.fecha.startsWith(mesFiltro));
  const totalMes = facturasFiltradas.reduce((s, f) => s + f.monto, 0);

  const [yyyy, mm] = mesFiltro.split('-');
  const nombreMes = new Date(Number(yyyy), Number(mm) - 1, 1)
    .toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });

  function catInfo(nombre: string) {
    return CATEGORIAS.find(c => c.label === nombre) || CATEGORIAS[CATEGORIAS.length - 1];
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={s.titulo}>🧾 Facturas y Gastos</Text>
        <Button mode="contained" icon="plus" onPress={abrirModal}
          buttonColor={C.primary} textColor="#fff" style={{ borderRadius: 8 }}>
          Nueva
        </Button>
      </View>

      {/* Navegador de mes */}
      <View style={s.mesNav}>
        <TouchableOpacity onPress={() => cambiarMes(-1)} style={s.mesBtn}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={C.primaryText}/>
        </TouchableOpacity>
        <Text style={s.mesTxt}>{nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</Text>
        <TouchableOpacity
          onPress={() => cambiarMes(1)}
          disabled={mesFiltro >= mesActual}
          style={[s.mesBtn, mesFiltro >= mesActual && { opacity: 0.3 }]}>
          <MaterialCommunityIcons name="chevron-right" size={22} color={C.primaryText}/>
        </TouchableOpacity>
      </View>

      {/* Resumen del mes */}
      <View style={s.resumen}>
        <View style={{ flex: 1 }}>
          <Text style={s.resumenLbl}>Total del mes</Text>
          <Text style={s.resumenVal}>{formatMoneda(totalMes)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.resumenLbl}>Facturas</Text>
          <Text style={s.resumenVal}>{facturasFiltradas.length}</Text>
        </View>
      </View>

      {/* Lista */}
      {loading
        ? <ActivityIndicator style={{ marginTop: 32 }} color={C.primary}/>
        : facturasFiltradas.length === 0
          ? <View style={s.empty}>
              <MaterialCommunityIcons name="receipt" size={40} color={C.textTer}/>
              <Text style={s.emptyTxt}>Sin facturas en este mes</Text>
            </View>
          : facturasFiltradas.map((f, i) => {
              const ci = catInfo(f.categoria);
              return (
                <StaggerItem key={f.id} index={Math.min(i,8)} step={50}>
                  <View style={s.item}>
                    <View style={[s.catIcon, { backgroundColor: ci.color + '22' }]}>
                      <MaterialCommunityIcons name={ci.icon as any} size={20} color={ci.color}/>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemDesc}>{f.descripcion}</Text>
                      <Text style={s.itemSub}>
                        {formatFecha(f.fecha)} · {f.categoria}
                      </Text>
                      {f.notas ? <Text style={s.itemNotas}>{f.notas}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={s.itemMonto}>{formatMoneda(f.monto)}</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {f.imagen_url && (
                          <TouchableOpacity onPress={() => { setModalImagen(true); setImagenUri(f.imagen_url!); }}>
                            <MaterialCommunityIcons name="image-outline" size={18} color={C.primaryText}/>
                          </TouchableOpacity>
                        )}
                        {isSupervisor && (
                          <TouchableOpacity onPress={() => abrirEditar(f)}>
                            <MaterialCommunityIcons name="pencil-outline" size={18} color="#42a5f5"/>
                          </TouchableOpacity>
                        )}
                        {isSupervisor && (
                          <TouchableOpacity onPress={() => borrar(f)}>
                            <MaterialCommunityIcons name="delete-outline" size={18} color={C.danger}/>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                  {i < facturasFiltradas.length - 1 && <Divider/>}
                </StaggerItem>
              );
            })
      }

      {/* ── Modal ver imagen ─────────────────────────────────────────── */}
      <Modal visible={modalImagen} transparent animationType="fade" onRequestClose={() => setModalImagen(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1} onPress={() => setModalImagen(false)}>
          {imagenUri && (
            <Image source={{ uri: imagenUri }}
              style={{ width: '90%', height: '80%', borderRadius: 10 }}
              resizeMode="contain"/>
          )}
          <Text style={{ color: '#ffffff88', marginTop: 12, fontSize: 13 }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal nueva factura ─────────────────────────────────────── */}
      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <ScrollView style={s.modalScroll} contentContainerStyle={s.modalContent}
            keyboardShouldPersistTaps="always">
            <Text style={s.modalTit}>{editandoId ? '✏️ Editar Factura' : '🧾 Nueva Factura'}</Text>

            {/* HTML nativo en web/Electron para evitar bugs de controlled input dentro del modal */}
            {Platform.OS === 'web' ? (
              <>
                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Descripción *</Text>
                <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                    paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input type="text" value={desc}
                    onChange={e => setDesc((e.target as any).value)}
                    placeholder="Ej: Claude Pro Plan"
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>

                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Monto ($) *</Text>
                <View style={{ flexDirection:'row', alignItems:'center', borderWidth:1.5, borderColor:C.primary,
                    borderRadius:8, paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <Text style={{ fontSize:16, color:C.textSec, marginRight:6 }}>$</Text>
                  <input type="text" value={monto}
                    onChange={e => setMonto((e.target as any).value.replace(/[^0-9.]/g,''))}
                    style={{ flex:1, fontSize:18, fontWeight:'700', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>

                <Text style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Fecha (AAAA-MM-DD) *</Text>
                <View style={{ borderWidth:1.5, borderColor:C.primary, borderRadius:8,
                    paddingHorizontal:10, paddingVertical:6, marginBottom:10, backgroundColor:C.surface }}>
                  <input type="text" value={fecha}
                    onChange={e => setFecha((e.target as any).value)}
                    placeholder="2025-01-15"
                    style={{ fontSize:16, fontWeight:'600', color:C.text,
                      border:'none', outline:'none', background:'transparent', width:'100%' } as any}
                  />
                </View>
              </>
            ) : (
              <>
                <TextInput label="Descripción *" value={desc} onChangeText={setDesc}
                  mode="outlined" style={s.input} placeholder="Ej: Claude Pro Plan"/>
                <TextInput label="Monto ($) *" value={monto} onChangeText={setMonto}
                  mode="outlined" style={s.input} keyboardType="decimal-pad"
                  left={<TextInput.Affix text="$"/>}/>
                <TextInput label="Fecha (AAAA-MM-DD) *" value={fecha} onChangeText={setFecha}
                  mode="outlined" style={s.input}/>
              </>
            )}

            <Text style={s.catLbl}>Categoría</Text>
            <View style={s.catRow}>
              {CATEGORIAS.map(c => (
                <TouchableOpacity key={c.label}
                  style={[s.catBtn, cat === c.label && { backgroundColor: c.color, borderColor: c.color }]}
                  onPress={() => setCat(c.label)}>
                  <MaterialCommunityIcons name={c.icon as any} size={14}
                    color={cat === c.label ? '#fff' : C.textSec}/>
                  <Text style={[s.catBtnTxt, cat === c.label && { color: '#fff' }]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput label="Notas (opcional)" value={notas} onChangeText={setNotas}
              mode="outlined" style={s.input} multiline numberOfLines={2}/>

            {/* Imagen de la factura */}
            <Text style={s.catLbl}>Imagen de la factura (opcional)</Text>
            {imagenUri
              ? <View style={{ marginBottom: 12 }}>
                  <Image source={{ uri: imagenUri }} style={s.imgPreview} resizeMode="contain"/>
                  <Button mode="text" compact icon="delete" textColor={C.danger}
                    onPress={() => setImagenUri(null)} style={{ alignSelf: 'flex-start' }}>
                    Quitar imagen
                  </Button>
                </View>
              : <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  <Button mode="outlined" icon="camera" onPress={tomarFoto} style={{ flex: 1 }}>
                    Cámara
                  </Button>
                  <Button mode="outlined" icon="image" onPress={seleccionarImagen} style={{ flex: 1 }}>
                    Galería
                  </Button>
                </View>
            }

            {formErr ? <Text style={s.err}>{formErr}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Button mode="outlined" onPress={() => setModal(false)} style={{ flex: 1 }} disabled={guardando}>
                Cancelar
              </Button>
              <Button mode="contained" onPress={guardar} loading={guardando}
                style={{ flex: 1, backgroundColor: C.primary }}>
                {editandoId ? 'Actualizar' : 'Guardar'}
              </Button>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:   { flex: 1, ...w(glassBgStyle(C)) },
  titulo:      { fontSize: 18, fontWeight: '800', color: C.primaryText },
  mesNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 borderRadius: 12, padding: 12, marginBottom: 12, ...glassStyle(C) },
  mesBtn:      { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
                 backgroundColor: C.surfaceCard },
  mesTxt:      { fontSize: 15, fontWeight: '700', color: C.primaryText },
  resumen:     { flexDirection: 'row', borderRadius: 12, padding: 16, marginBottom: 12,
                 ...glassStyle(C) },
  resumenLbl:  { fontSize: 11, color: C.textTer, textTransform: 'uppercase', marginBottom: 4 },
  resumenVal:  { fontSize: 22, fontWeight: '800', color: C.primaryText },
  empty:       { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyTxt:    { color: C.textTer, fontSize: 14 },
  item:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  catIcon:     { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  itemDesc:    { fontSize: 14, fontWeight: '700', color: C.text },
  itemSub:     { fontSize: 11, color: C.textTer, marginTop: 2 },
  itemNotas:   { fontSize: 11, color: C.textSec, fontStyle: 'italic', marginTop: 2 },
  itemMonto:   { fontSize: 15, fontWeight: '800', color: C.primaryText },
  // Modal
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalScroll: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
                 borderTopWidth: 1, borderTopColor: C.border, maxHeight: '95%' },
  modalContent:{ padding: 20, paddingBottom: 40 },
  modalTit:    { fontSize: 16, fontWeight: '800', color: C.primaryText, marginBottom: 16 },
  input:       { marginBottom: 12 },
  catLbl:      { fontSize: 13, color: C.textSec, fontWeight: '600', marginBottom: 8 },
  catRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  catBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1,
                 borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  catBtnTxt:   { fontSize: 12, color: C.textSec },
  err:         { color: C.danger, fontSize: 13, marginTop: 8 },
  imgPreview:  { width: '100%', height: 180, borderRadius: 8, backgroundColor: C.surfaceAlt, marginBottom: 4 },
});
