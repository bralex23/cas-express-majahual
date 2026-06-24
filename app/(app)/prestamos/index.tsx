import React, { useState, useMemo, useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text, FAB, Searchbar, Chip, IconButton } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Prestamo, EstadoPrestamo } from '../../../src/types';
import { StaggerItem } from '../../../src/components/FadeIn';
import { formatMoneda, formatFecha } from '../../../src/utils/calculos';
import { cache } from '../../../src/utils/cache';

const ESTADOS: { label: string; value: EstadoPrestamo | 'todos' }[] = [
  { label:'Todos', value:'todos' },
  { label:'Activo', value:'activo' },
  { label:'Mora', value:'mora' },
  { label:'Completado', value:'completado' },
  { label:'Cancelado', value:'cancelado' },
];

const BADGE_COLOR: Record<string,string> = {
  activo:'#1565c0', mora:'#c62828', completado:'#2e7d32', cancelado:'#666'
};

export default function Prestamos() {
  const { perfil, isSupervisor } = useAuth();
  const [todos, setTodos]       = useState<Prestamo[]>([]);
  const [filtrado, setFiltrado] = useState<Prestamo[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado]     = useState<string>('todos');
  const [loading, setLoading]   = useState(true);

  // Mapa enriquecido: cliente_id → { nombre, expediente }
  const [clienteMap, setClienteMap] = useState<Record<string,{nombre:string;expediente:string}>>({});

  const { col } = useEmpresa();

  async function load(forzar = false) {
    const cacheKey = `prestamos_${perfil?.id}`;
    if (!forzar) {
      const cached = cache.get<{data: Prestamo[]; cMap: Record<string,{nombre:string;expediente:string}>}>(cacheKey);
      if (cached) {
        setClienteMap(cached.cMap); setTodos(cached.data); setFiltrado(cached.data); setLoading(false); return;
      }
    }
    const constraints: any[] = [];
    if (!isSupervisor && perfil?.id) constraints.push(where('asesor_id','==',perfil.id));
    const [prestSnap, clienteSnap] = await Promise.all([
      getDocs(query(collection(db, col('prestamos')), ...constraints)),
      getDocs(collection(db, col('clientes'))),
    ]);

    // Mapa nombre + expediente por cliente_id
    const cMap: Record<string,{nombre:string;expediente:string}> = {};
    clienteSnap.docs.forEach(d => {
      const c = d.data();
      cMap[d.id] = { nombre: c.nombre || '—', expediente: c.numero_expediente || '' };
    });
    setClienteMap(cMap);

    const data = prestSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Prestamo))
      .sort((a, b) => {
        const numA = parseInt(cMap[a.cliente_id]?.expediente?.replace(/\D/g,'') || '99999');
        const numB = parseInt(cMap[b.cliente_id]?.expediente?.replace(/\D/g,'') || '99999');
        return numA - numB;
      });

    cache.set(cacheKey, { data, cMap });
    setTodos(data); setFiltrado(data); setLoading(false);
  }

  useFocusEffect(useCallback(() => { load(true); }, [col]));

  function aplicarFiltro(b: string, e: string) {
    let f = todos;
    if (e !== 'todos') f = f.filter(p => p.estado === e);
    if (b) {
      const t = b.toLowerCase();
      f = f.filter(p =>
        (clienteMap[p.cliente_id]?.nombre || '').toLowerCase().includes(t) ||
        (clienteMap[p.cliente_id]?.expediente || '').toLowerCase().includes(t) ||
        formatMoneda(p.monto).includes(t)
      );
    }
    setFiltrado(f);
  }

  function setBusq(t: string) { setBusqueda(t); aplicarFiltro(t, estado); }
  function setEst(e: string)  { setEstado(e);   aplicarFiltro(busqueda, e); }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <View style={s.container}>
      <View style={{flexDirection:'row', alignItems:'center', paddingRight:4}}>
        <Searchbar placeholder="Buscar..." value={busqueda} onChangeText={setBusq} style={[s.search,{flex:1}]}/>
        <IconButton icon="refresh" size={24} iconColor={C.primary} onPress={() => load(true)}
          style={{margin:0}} />
      </View>

      <View style={s.chips}>
        {ESTADOS.map(e => (
          <Chip key={e.value} selected={estado===e.value} onPress={()=>setEst(e.value)}
            style={s.chip} compact>{e.label}</Chip>
        ))}
      </View>

      <FlatList
        data={filtrado}
        keyExtractor={i => i.id}
        refreshing={loading}
        onRefresh={() => load(true)}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item, index }) => {
          const cli = clienteMap[item.cliente_id];
          return (
            <StaggerItem index={Math.min(index, 8)} step={55}>
            <TouchableOpacity style={s.card} onPress={() => router.push(`/(app)/prestamos/${item.id}`)}>
              <View style={s.cardTop}>
                <View style={{flex:1,marginRight:8}}>
                  <Text style={s.clienteNom}>{(cli?.nombre || '—').toUpperCase()}</Text>
                  {cli?.expediente ? <Text style={s.expTxt}>Exp: {cli.expediente}</Text> : null}
                </View>
                <View style={[s.badge,{ backgroundColor:(BADGE_COLOR[item.estado]||'#666')+'22' }]}>
                  <Text style={[s.badgeTxt,{color:BADGE_COLOR[item.estado]||'#666'}]}>{item.estado.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={s.monto}>{formatMoneda(item.monto)}</Text>
              <Text style={s.sub}>Cuota: {formatMoneda(item.cuota)} {item.frecuencia} · {item.plazo} cuotas</Text>
              <Text style={s.sub}>Total: {formatMoneda(item.monto_total)} · Interés: {item.interes}%</Text>
              <Text style={s.fecha}>{formatFecha(item.fecha_inicio)} → {formatFecha(item.fecha_fin)}</Text>
            </TouchableOpacity>
            </StaggerItem>
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}><Text style={s.emptyTxt}>{loading?'Cargando...':'No hay préstamos'}</Text></View>
        }
      />

      <FAB icon="plus" style={s.fab} label="Nuevo" color="#ffffff" onPress={() => router.push('/(app)/prestamos/nuevo')}/>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:{flex:1, backgroundColor:C.bg, ...w(glassBgStyle(C))},
  search:{margin:12, borderRadius:10, backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)'},
  chips:{flexDirection:'row',flexWrap:'wrap',paddingHorizontal:12,gap:6,marginBottom:8},
  chip:{},
  card:{borderRadius:14, padding:14, marginBottom:10, ...glassStyle(C)},
  cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4},
  clienteNom:{fontSize:15,fontWeight:'800',color:C.text},
  expTxt:{fontSize:11,color:C.textMuted,marginTop:1},
  monto:{fontSize:20,fontWeight:'800',color:C.primaryText,marginBottom:2},
  badge:{paddingHorizontal:10,paddingVertical:4,borderRadius:12},
  badgeTxt:{fontSize:11,fontWeight:'700'},
  sub:{fontSize:12,color:C.textTer,marginTop:2},
  fecha:{fontSize:11,color:C.textMuted,marginTop:4},
  empty:{alignItems:'center',padding:40},
  emptyTxt:{color:C.textMuted,fontSize:15},
  fab:{position:'absolute',right:16,bottom:16,backgroundColor:C.primary},
});
