import React, { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, FAB, Searchbar, Avatar, IconButton, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { cache } from '../../../src/utils/cache';
import * as ImagePicker from '../../../src/lib/imagePicker.web';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Cliente } from '../../../src/types';
import { StaggerItem } from '../../../src/components/FadeIn';

/* Comprime imagen a base64 pequeño (igual que en nuevo.tsx) */
async function comprimirABase64(uri: string): Promise<string> {
  try {
    const r = await fetch(uri);
    const blob = await r.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch { return uri; }
}

export default function Clientes() {
  const { perfil, isSupervisor } = useAuth();
  const { col }  = useEmpresa();   // ← debe estar ANTES de useFocusEffect
  const C        = useColors();
  const s        = useMemo(() => makeStyles(C), [C]);

  const [clientes, setClientes]   = useState<Cliente[]>([]);
  const [filtrado, setFiltrado]   = useState<Cliente[]>([]);
  const [busqueda, setBusqueda]   = useState('');
  const [soloExp, setSoloExp]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [subiendo, setSubiendo]   = useState<string | null>(null);

  async function load(forzar = false) {
    const cacheKey = `clientes_${perfil?.id}_${isSupervisor}`;
    if (!forzar) {
      const cached = cache.get<Cliente[]>(cacheKey);
      if (cached) { setClientes(cached); setFiltrado(cached); setLoading(false); return; }
    }
    const constraints: any[] = [where('activo','==',true)];
    if (!isSupervisor && perfil?.ruta_id) constraints.push(where('ruta_id','==',perfil.ruta_id));
    const snap = await getDocs(query(collection(db, col('clientes')), ...constraints));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Cliente))
                          .sort((a, b) => {
                            const numA = parseInt(a.numero_expediente?.replace(/\D/g,'') || '99999');
                            const numB = parseInt(b.numero_expediente?.replace(/\D/g,'') || '99999');
                            return numA - numB;
                          });
    cache.set(cacheKey, data);
    setClientes(data);
    setFiltrado(data);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(true); }, [col]));

  function buscar(texto: string) {
    setBusqueda(texto);
    filtrar(texto, soloExp);
  }

  function filtrar(texto: string, expOnly: boolean) {
    const t = texto.toLowerCase();
    setFiltrado(clientes.filter(c => {
      if (!t) return true;
      if (expOnly) {
        const numBusq = t.replace(/\D/g, '');
        const numExp  = (c.numero_expediente||'').replace(/\D/g, '');
        return numBusq ? numExp.startsWith(numBusq) : numExp.includes(t);
      }
      return c.nombre.toLowerCase().includes(t) || (c.dui||'').includes(t) ||
        (c.telefono||'').includes(t) ||
        (c.numero_expediente||'').toLowerCase().includes(t) ||
        ('exp-'+(c.numero_expediente||'')).toLowerCase().includes(t);
    }));
  }

  async function subirFoto(cliente: Cliente, cara: 'frente' | 'reverso') {
    const key = `${cliente.id}_${cara}`;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { alert('Necesitamos acceso a tus fotos.'); return; }
      const aspect: [number, number] = cara === 'frente' ? [3, 4] : [85, 54];
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7, allowsEditing: true, aspect,
      });
      if (result.canceled) return;
      setSubiendo(key);
      const uri = result.assets[0].uri;
      const url = uri.startsWith('http') ? uri : await comprimirABase64(uri);
      const campo = cara === 'frente' ? 'foto_url' : 'dui_reverso_url';
      await updateDoc(doc(db, col('clientes'), cliente.id), { [campo]: url });
      setClientes(prev => prev.map(c => c.id === cliente.id ? {...c, [campo]: url} : c));
      setFiltrado(prev => prev.map(c => c.id === cliente.id ? {...c, [campo]: url} : c));
    } catch(e) { console.error(e); alert('Error al subir la foto.'); }
    finally { setSubiendo(null); }
  }

  return (
    <View style={s.container}>
      <View style={{flexDirection:'row', alignItems:'center', paddingRight:4}}>
        <Searchbar placeholder="Nombre, DUI, teléfono o expediente..." value={busqueda}
          onChangeText={buscar} style={[s.search,{flex:1}]} />
        <IconButton icon="refresh" size={24} iconColor={C.primary} onPress={() => load(true)}
          style={{margin:0}} />
      </View>

      {/* Filtro por expediente */}
      <View style={{flexDirection:'row', paddingHorizontal:12, paddingBottom:6, gap:8}}>
        <Chip selected={!soloExp} onPress={() => { setSoloExp(false); filtrar(busqueda, false); }}
          style={{backgroundColor: !soloExp ? C.primary+'33' : C.surfaceCard}}
          textStyle={{color: !soloExp ? C.primaryText : C.textSec, fontSize:12}}>
          Todos
        </Chip>
        <Chip selected={soloExp} onPress={() => { setSoloExp(true); filtrar(busqueda, true); }}
          icon="file-document-outline"
          style={{backgroundColor: soloExp ? C.primary+'33' : C.surfaceCard}}
          textStyle={{color: soloExp ? C.primaryText : C.textSec, fontSize:12}}>
          Solo Expediente
        </Chip>
        <Text style={{color:C.textTer, fontSize:12, alignSelf:'center', marginLeft:'auto'}}>
          {filtrado.length} cliente{filtrado.length!==1?'s':''}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12 }}>
        {loading
          ? <View style={s.empty}><Text style={s.emptyTxt}>Cargando...</Text></View>
          : filtrado.length === 0
            ? <View style={s.empty}><Text style={s.emptyTxt}>No hay clientes</Text></View>
            : filtrado.map((item, i) => (
          <StaggerItem key={item.id} index={Math.min(i, 8)} step={55}>
            <TouchableOpacity style={s.card} onPress={() => router.push(`/(app)/clientes/${item.id}`)}>
            <View style={s.cardAccent}/>
            <Avatar.Text size={46} label={item.nombre.slice(0,2).toUpperCase()}
              style={{ backgroundColor: C.primary }} />
            <View style={s.info}>
              <Text style={s.nombre}>{item.nombre.toUpperCase()}</Text>
              <View style={s.detalleRow}>
                <Text style={s.detalle}>🪪 {item.dui || 'Sin DUI'}</Text>
                <Text style={s.detalleSep}>·</Text>
                <Text style={s.detalle}>📞 {item.telefono || '-'}</Text>
              </View>
              {item.ruta_id && <Text style={s.ruta}>📍 {item.ruta_id}</Text>}
            </View>
            {item.numero_expediente ? (
              <View style={s.expCol}>
                <Text style={s.expLabel}>EXP</Text>
                <Text style={s.expNum}>{item.numero_expediente.replace(/\D/g,'')}</Text>
              </View>
            ) : null}
            <View style={{ gap: 4, marginHorizontal: 4 }}>
              <TouchableOpacity
                style={[s.camBtn, item.foto_url ? s.camBtnOk : s.camBtnPend]}
                onPress={(e) => { e.stopPropagation?.(); subirFoto(item, 'frente'); }}
                disabled={!!subiendo}>
                <MaterialCommunityIcons
                  name={subiendo===`${item.id}_frente`?'loading':item.foto_url?'card-account-details':'card-account-details-outline'}
                  size={15} color={item.foto_url?'#2e7d32':'#e65100'}/>
                <Text style={{fontSize:7,color:item.foto_url?'#2e7d32':'#e65100',fontWeight:'700'}}>FRENTE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.camBtn,(item as any).dui_reverso_url?s.camBtnOk:s.camBtnPend]}
                onPress={(e) => { e.stopPropagation?.(); subirFoto(item,'reverso'); }}
                disabled={!!subiendo}>
                <MaterialCommunityIcons
                  name={subiendo===`${item.id}_reverso`?'loading':(item as any).dui_reverso_url?'card-account-details':'card-account-details-outline'}
                  size={15} color={(item as any).dui_reverso_url?'#2e7d32':'#e65100'}/>
                <Text style={{fontSize:7,color:(item as any).dui_reverso_url?'#2e7d32':'#e65100',fontWeight:'700'}}>REVERSO</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.arrow}>›</Text>
          </TouchableOpacity>
          </StaggerItem>
        ))}
      </ScrollView>

      <FAB icon="plus" style={s.fab} onPress={() => router.push('/(app)/clientes/nuevo')}
        label="Nuevo" color="#ffffff" />
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:  {flex:1, backgroundColor:C.bg, ...w(glassBgStyle(C))},
  search:     {margin:12, borderRadius:10, backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)'},

  card:{
    borderRadius:    14,
    marginBottom:    10,
    flexDirection:   'row',
    alignItems:      'center',
    overflow:        'hidden',
    paddingVertical: 12,
    paddingRight:    8,
    ...glassStyle(C),
  },

  cardAccent:{
    width:           4,
    alignSelf:       'stretch',
    backgroundColor: C.primary,
    marginRight:     12,
    borderRadius:    2,
  },

  info:        {flex:1, marginLeft:14},
  nombre:      {fontSize:15,fontWeight:'800',color:C.text,marginBottom:3},
  detalleRow:  {flexDirection:'row',alignItems:'center',gap:4,flexWrap:'wrap'},
  detalle:     {fontSize:12,color:C.textTer},
  detalleSep:  {fontSize:12,color:C.border},
  ruta:        {fontSize:11,color:C.primaryText,marginTop:3,fontWeight:'600'},

  expCol:{
    alignItems:      'center',
    justifyContent:  'center',
    marginHorizontal:8,
    paddingHorizontal:8,
    paddingVertical: 6,
    borderRadius:    8,
    backgroundColor: C.surfaceCard,
    borderWidth:     1,
    borderColor:     C.border,
    minWidth:        44,
  },
  expLabel:{fontSize:9,fontWeight:'700',color:C.primaryText,letterSpacing:1,textTransform:'uppercase'},
  expNum:  {fontSize:16,fontWeight:'900',color:C.primaryText,lineHeight:20},

  /* Botón DUI */
  camBtn:{
    width:42, height:30, borderRadius:8,
    alignItems:'center', justifyContent:'center',
    borderWidth:1.5,
    paddingVertical:2,
  },
  camBtnPend:{ backgroundColor:'rgba(230,81,0,0.10)', borderColor:'rgba(230,81,0,0.35)' },
  camBtnOk:  { backgroundColor:'rgba(46,125,50,0.10)', borderColor:'rgba(46,125,50,0.35)' },

  arrow:  {fontSize:20,color:C.border,marginLeft:2},
  empty:  {alignItems:'center',padding:40},
  emptyTxt:{color:C.textMuted,fontSize:15},
  fab:    {position:'absolute',right:16,bottom:16,backgroundColor:C.primary},
});
