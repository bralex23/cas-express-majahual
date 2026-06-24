import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView, RefreshControl, TouchableOpacity, Animated } from 'react-native';
import { Text, Card, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '../../src/lib/firebase';
import { useEmpresa } from '../../src/context/empresa';
import { useAuth } from '../../src/hooks/useAuth';
import { useColors, hexToRgba } from '../../src/theme';
import { Prestamo } from '../../src/types';
import { hoy, calcularVencimiento, formatMoneda, formatFecha, diasGracia } from '../../src/utils/calculos';
import { cache } from '../../src/utils/cache';
import { FadeIn, StaggerItem } from '../../src/components/FadeIn';
import { AnimatedNumber } from '../../src/components/AnimatedNumber';

const HOY_LABEL = new Date().toLocaleDateString('es-SV', {
  weekday:'long', year:'numeric', month:'long', day:'numeric'
});

type CobroPendiente = {
  prestamo_id: string;
  cliente_nombre: string;
  numero_cuota: number;
  monto: number;
  frecuencia: string;
};

type PrestamoMoraItem = {
  id: string;
  cliente_nombre: string;
  monto: number;
  cuota: number;
  frecuencia: string;
  fecha_fin: string;
};

/** Calcula qué número de cuota (si alguna) vence exactamente hoy */
function numeroCuotaDeHoy(loan: Prestamo): number | null {
  const HOY_STR = hoy();
  const inicio  = new Date(loan.fecha_inicio + 'T00:00:00');
  const hoyDate = new Date(HOY_STR + 'T00:00:00');
  const diffDays = Math.round((hoyDate.getTime() - inicio.getTime()) / 86400000);
  if (diffDays <= 0) return null;

  let candidateN: number | null = null;
  if (loan.frecuencia === 'diario') {
    candidateN = diffDays;
  } else if (loan.frecuencia === 'semanal') {
    if (diffDays % 7 === 0) candidateN = diffDays / 7;
  } else {
    if (hoyDate.getDate() === inicio.getDate()) {
      candidateN = (hoyDate.getFullYear() - inicio.getFullYear()) * 12
                 + (hoyDate.getMonth() - inicio.getMonth());
    }
  }
  if (candidateN === null || candidateN <= 0 || candidateN > loan.plazo) return null;
  const fv = calcularVencimiento(loan.fecha_inicio, candidateN, loan.frecuencia);
  return fv === HOY_STR ? candidateN : null;
}

export default function Dashboard() {
  const { perfil, isSupervisor } = useAuth();

  const [stats, setStats] = useState({ clientes:0, activos:0, mora:0 });
  const [cobradoHoy, setCobradoHoy]     = useState(0);
  const [carteraTotal, setCarteraTotal] = useState(0);
  const { col } = useEmpresa();
  const [cobrosHoy, setCobrosHoy]       = useState(0);
  const [cobrosPendientes, setCobrosPend] = useState<CobroPendiente[]>([]);
  const [prestamosEnMora, setEnMora]      = useState<PrestamoMoraItem[]>([]);
  const [loading, setLoading]             = useState(true);
  const [refresh, setRefresh]             = useState(false);

  async function load(forzar = false) {
    const HOY_STR = hoy();
    const CACHE_KEY = `dashboard_${HOY_STR}`;

    // Intentar usar caché (30 segundos) para el bloque pesado
    type DashCache = { loans: Prestamo[]; clienteMap: Record<string,string>; pagosResults: {docs: any[]}[] };
    let cached: DashCache | null = forzar ? null : cache.get<DashCache>(CACHE_KEY);

    try {
      const base = isSupervisor ? [] : [where('ruta_id','==', perfil?.ruta_id ?? '')];
      const [c, a, m] = await Promise.all([
        getCountFromServer(query(collection(db, col('clientes')), where('activo','==',true), ...base)),
        getCountFromServer(query(collection(db, col('prestamos')), where('estado','==','activo'))),
        getCountFromServer(query(collection(db, col('prestamos')), where('estado','==','mora'))),
      ]);
      setStats({ clientes: c.data().count, activos: a.data().count, mora: m.data().count });
    } catch(e) { console.error('Error stats básicos:', e); }

    try {
      let loans: Prestamo[];
      let clienteMap: Record<string,string>;
      let pagosResults: {docs: any[]}[];

      if (cached) {
        loans = cached.loans; clienteMap = cached.clienteMap; pagosResults = cached.pagosResults;
      } else {
        const loansSnap = await getDocs(
          query(collection(db, col('prestamos')), where('estado','in',['activo','mora','completado']))
        );
        loans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() } as Prestamo));

        const clientesSnap = await getDocs(query(collection(db, col('clientes')), where('activo','==',true)));
        clienteMap = {};
        clientesSnap.docs.forEach(d => { clienteMap[d.id] = d.data().nombre || '—'; });

        pagosResults = await Promise.all(
          loans.map(loan => getDocs(collection(db, col('prestamos'), loan.id, 'pagos')))
        );
        cache.set(CACHE_KEY, { loans, clienteMap, pagosResults }, 30_000);
      }

      const cartera = loans.filter(p => p.estado === 'activo' || p.estado === 'mora')
                           .reduce((s, p) => s + (p.monto || 0), 0);
      setCarteraTotal(cartera);

      const pendientes: CobroPendiente[] = [];
      const moraLoans: PrestamoMoraItem[] = [];

      loans.forEach((loan, i) => {
        const pagadas = new Set(pagosResults[i].docs.map(d => d.data().numero_cuota as number));

        const n = numeroCuotaDeHoy(loan);
        if (n !== null && !pagadas.has(n)) {
          pendientes.push({
            prestamo_id:    loan.id,
            cliente_nombre: clienteMap[loan.cliente_id] || '—',
            numero_cuota:   n,
            monto:          loan.cuota,
            frecuencia:     loan.frecuencia,
          });
        }

        if (!loan.fecha_fin) return;
        const gracia = diasGracia(loan.frecuencia, loan.plazo);
        const finMs  = new Date(loan.fecha_fin + 'T00:00:00').getTime();
        const hoyMs  = new Date(HOY_STR       + 'T00:00:00').getTime();
        const diasAtraso = Math.floor((hoyMs - finMs) / 86400000);
        if (diasAtraso <= gracia) return;
        if (pagadas.size < loan.plazo) {
          moraLoans.push({
            id:             loan.id,
            cliente_nombre: clienteMap[loan.cliente_id] || '—',
            monto:          loan.monto,
            cuota:          loan.cuota,
            frecuencia:     loan.frecuencia,
            fecha_fin:      loan.fecha_fin,
          });
        }
      });

      setCobrosHoy(pendientes.length);
      setCobrosPend(pendientes);
      setEnMora(moraLoans);
      setStats(prev => ({ ...prev, mora: moraLoans.length }));

      let totalCobradoHoy = 0;
      pagosResults.forEach(snap => {
        snap.docs.forEach(d => {
          const pg = d.data();
          if (pg.fecha_pago === HOY_STR) totalCobradoHoy += (pg.monto_pagado || 0);
        });
      });
      try {
        const multasSnap = await getDocs(
          query(collection(db, col('multas')), where('fecha','==', HOY_STR))
        );
        multasSnap.docs.forEach(d => { totalCobradoHoy += (d.data().monto || 0); });
      } catch(_) {}
      setCobradoHoy(totalCobradoHoy);

    } catch(e) { console.error('Error paneles:', e); }

    setLoading(false);
    setRefresh(false);
  }

  // Forzar recarga siempre al volver al dashboard (bypass caché de 30s)
  useFocusEffect(useCallback(() => { load(true); }, [col]));

  const onRefresh = () => { setRefresh(true); load(true); };

  const C = useColors();

  if (loading) return (
    <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor: C.bg }}>
      <ActivityIndicator size="large" color={C.primary}/>
    </View>
  );

  if (Platform.OS === 'web') return (
    <WebDashboard
      stats={stats} cobradoHoy={cobradoHoy} carteraTotal={carteraTotal} cobrosHoy={cobrosHoy}
      perfil={perfil} refresh={refresh} onRefresh={onRefresh}
      cobrosPendientes={cobrosPendientes} prestamosEnMora={prestamosEnMora}
    />
  );
  return (
    <MobileDashboard
      stats={stats} cobradoHoy={cobradoHoy} carteraTotal={carteraTotal}
      perfil={perfil} refresh={refresh} onRefresh={onRefresh}
      cobrosPendientes={cobrosPendientes} prestamosEnMora={prestamosEnMora}
    />
  );
}

/* ─── WEB ─────────────────────────────────────────────────────── */
function WebDashboard({ stats, cobradoHoy, carteraTotal, cobrosHoy, perfil, refresh, onRefresh, cobrosPendientes, prestamosEnMora }: any) {
  const C = useColors();
  const w = useMemo(() => makeStylesW(C), [C]);
  return (
    <View style={w.root}>
      <View style={w.topBar}>
        <View>
          <Text style={w.pageTitle}>Dashboard</Text>
          <Text style={w.pageDate}>{HOY_LABEL.charAt(0).toUpperCase() + HOY_LABEL.slice(1)}</Text>
        </View>
        <Text style={w.topUser}>{perfil?.nombre || 'Administrador'}</Text>
      </View>

      <ScrollView contentContainerStyle={w.body} refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh}/>}>

        {/* Stats row */}
        <View style={w.statsRow}>
          <WStat icon="account-group" color="#1565c0" rawValue={stats.clientes}  label="Clientes Activos"  index={0}/>
          <WStat icon="bank"          color="#2e7d32" rawValue={stats.activos}   label="Préstamos Activos" index={1}/>
          <WStat icon="cash"          color="#e65100" rawValue={cobradoHoy}      label="Cobrado Hoy"       index={2} isMoney/>
          <WStat icon="alert-circle"  color="#c62828" rawValue={stats.mora}      label="En Mora"           index={3}/>
          <WStat icon="briefcase"     color="#6a1b9a" rawValue={carteraTotal}    label="Cartera Total"     index={4} isMoney/>
          <WStat icon="clock-check"   color="#00838f" rawValue={cobrosHoy}       label="Cobros Hoy"        index={5}/>
        </View>

        {/* Panels */}
        <View style={w.panels}>

          <FadeIn delay={520} style={w.panel}>
            <View style={w.panelHeader}>
              <MaterialCommunityIcons name="clock-alert-outline" size={18} color="#e65100"/>
              <Text style={[w.panelTitle, {color:'#e65100'}]}>
                Cobros Pendientes Hoy
                {cobrosPendientes.length > 0 && <Text style={w.panelBadge}> ({cobrosPendientes.length})</Text>}
              </Text>
            </View>
            {cobrosPendientes.length === 0
              ? <View style={w.panelBody}>
                  <MaterialCommunityIcons name="check-circle-outline" size={36} color="#4caf50"/>
                  <Text style={w.panelEmpty}>No hay cobros pendientes hoy</Text>
                </View>
              : <ScrollView style={{ maxHeight: 240 }}>
                  {cobrosPendientes.map((c: CobroPendiente, i: number) => (
                    <TouchableOpacity key={i} style={w.panelItem}
                      onPress={() => router.push(`/(app)/prestamos/${c.prestamo_id}` as any)}>
                      <View style={{ flex:1 }}>
                        <Text style={w.panelItemNombre}>{c.cliente_nombre.toUpperCase()}</Text>
                        <Text style={w.panelItemSub}>Cuota #{c.numero_cuota} · {c.frecuencia}</Text>
                      </View>
                      <Text style={w.panelItemMonto}>{formatMoneda(c.monto)}</Text>
                      <MaterialCommunityIcons name="chevron-right" size={16} color="#ccc" style={{marginLeft:4}}/>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
            }
          </FadeIn>

          <FadeIn delay={580} style={w.panel}>
            <View style={w.panelHeader}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#c62828"/>
              <Text style={[w.panelTitle, {color:'#c62828'}]}>
                Clientes en Mora
                {prestamosEnMora.length > 0 && <Text style={w.panelBadge}> ({prestamosEnMora.length})</Text>}
              </Text>
            </View>
            {prestamosEnMora.length === 0
              ? <View style={w.panelBody}>
                  <MaterialCommunityIcons name="emoticon-happy-outline" size={36} color="#4caf50"/>
                  <Text style={w.panelEmpty}>Sin clientes en mora</Text>
                </View>
              : <ScrollView style={{ maxHeight: 240 }}>
                  {prestamosEnMora.map((p: PrestamoMoraItem, i: number) => (
                    <TouchableOpacity key={i} style={w.panelItem}
                      onPress={() => router.push(`/(app)/prestamos/${p.id}` as any)}>
                      <View style={{ flex:1 }}>
                        <Text style={w.panelItemNombre}>{p.cliente_nombre}</Text>
                        <Text style={w.panelItemSub}>Cuota {p.frecuencia}: {formatMoneda(p.cuota)} · Venció: {formatFecha(p.fecha_fin)}</Text>
                      </View>
                      <Text style={[w.panelItemMonto,{color:'#c62828'}]}>{formatMoneda(p.monto)}</Text>
                      <MaterialCommunityIcons name="chevron-right" size={16} color="#ccc" style={{marginLeft:4}}/>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
            }
          </FadeIn>

        </View>

        {/* Accesos rápidos */}
        <Text style={w.sectionTitle}>Accesos Rápidos</Text>
        <View style={w.quickRow}>
          {[
            { icon:'cash-multiple',    label:'Cobros del Día',  color:'#42a5f5', path:'/cobros'          },
            { icon:'account-plus',     label:'Nuevo Cliente',   color:'#2e7d32', path:'/clientes/nuevo'  },
            { icon:'plus-circle',      label:'Nuevo Préstamo',  color:'#1565c0', path:'/prestamos/nuevo' },
            { icon:'file-chart',       label:'Generar Reporte', color:'#6a1b9a', path:'/reportes'        },
            { icon:'receipt',          label:'Facturas',        color:'#7c4dff', path:'/facturas'        },
          ].map((a, i) => (
            <QuickCard key={a.path} icon={a.icon} label={a.label} color={a.color}
              index={i} onPress={() => router.push(a.path as any)} styles={w}/>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

function WStat({ icon, color, rawValue, isMoney, label, index = 0 }: any) {
  const C = useColors();
  const w = useMemo(() => makeStylesW(C), [C]);
  return (
    <FadeIn delay={80 + index * 65} style={w.statCard}>
      <View style={[w.statIcon, {backgroundColor: color+'15'}]}>
        <MaterialCommunityIcons name={icon} size={22} color={color}/>
      </View>
      <AnimatedNumber
        value={rawValue ?? 0}
        formatter={isMoney ? (n) => formatMoneda(n) : (n) => String(Math.round(n))}
        style={[w.statValue, {color}]}
      />
      <Text style={w.statLabel}>{label}</Text>
    </FadeIn>
  );
}

/* ─── MOBILE ───────────────────────────────────────────────────── */
function MobileDashboard({ stats, cobradoHoy, carteraTotal, perfil, refresh, onRefresh, cobrosPendientes, prestamosEnMora }: any) {
  const C = useColors();
  const m = useMemo(() => makeStylesM(C), [C]);

  // Animación de giro para el botón de recarga
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const handleReload = () => {
    if (refresh) return;
    // Iniciar giro continuo
    spinAnim.setValue(0);
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 700, useNativeDriver: true })
    );
    spinLoop.current.start();
    onRefresh();
  };

  // Detener giro cuando termina la carga
  React.useEffect(() => {
    if (!refresh && spinLoop.current) {
      spinLoop.current.stop();
      spinLoop.current = null;
      spinAnim.setValue(0);
    }
  }, [refresh]);

  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <ScrollView style={m.container}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} colors={[C.primary]}/>}>
      <View style={m.header}>
        <View>
          <Text style={m.hola}>Hola, {perfil?.nombre?.split(' ')[0]} 👋</Text>
          <Text style={m.sub}>{(perfil?.rol||'').toUpperCase()}</Text>
        </View>
        <TouchableOpacity onPress={handleReload} style={m.reloadBtn} activeOpacity={0.7}>
          <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
            <MaterialCommunityIcons name="refresh" size={22} color="#fff"/>
          </Animated.View>
        </TouchableOpacity>
      </View>
      <View style={m.body}>
        <Text style={m.sec}>Resumen</Text>
        <View style={m.grid}>
          <MStat icon="account-group" color="#1565c0" value={stats.clientes}                  label="Clientes"/>
          <MStat icon="bank"          color="#2e7d32" value={stats.activos}                   label="Activos"/>
          <MStat icon="alert-circle"  color="#c62828" value={stats.mora}                      label="En Mora"/>
          <MStat icon="cash"          color="#e65100" value={formatMoneda(cobradoHoy)}         label="Cobrado hoy"/>
        </View>

        <Text style={[m.sec,{marginTop:20}]}>Cobros Pendientes Hoy ({cobrosPendientes.length})</Text>
        {cobrosPendientes.length === 0
          ? <View style={m.emptyPanel}>
              <MaterialCommunityIcons name="check-circle-outline" size={28} color="#4caf50"/>
              <Text style={m.emptyTxt}>No hay cobros pendientes</Text>
            </View>
          : cobrosPendientes.slice(0,5).map((c: CobroPendiente, i: number) => (
              <TouchableOpacity key={i} style={m.listItem}
                onPress={() => router.push(`/(app)/prestamos/${c.prestamo_id}` as any)}>
                <View style={{flex:1}}>
                  <Text style={m.listNombre}>{c.cliente_nombre}</Text>
                  <Text style={m.listSub}>Cuota #{c.numero_cuota} · {c.frecuencia}</Text>
                </View>
                <Text style={m.listMonto}>{formatMoneda(c.monto)}</Text>
              </TouchableOpacity>
            ))
        }
        {cobrosPendientes.length > 5 && <Text style={m.verMas}>+{cobrosPendientes.length - 5} más · Ver cobros del día</Text>}

        <Text style={[m.sec,{marginTop:20}]}>Clientes en Mora ({prestamosEnMora.length})</Text>
        {prestamosEnMora.length === 0
          ? <View style={m.emptyPanel}>
              <MaterialCommunityIcons name="emoticon-happy-outline" size={28} color="#4caf50"/>
              <Text style={m.emptyTxt}>Sin clientes en mora</Text>
            </View>
          : prestamosEnMora.slice(0,5).map((p: PrestamoMoraItem, i: number) => (
              <TouchableOpacity key={i} style={m.listItem}
                onPress={() => router.push(`/(app)/prestamos/${p.id}` as any)}>
                <View style={{flex:1}}>
                  <Text style={m.listNombre}>{p.cliente_nombre}</Text>
                  <Text style={m.listSub}>{formatMoneda(p.monto)} · cuota {formatMoneda(p.cuota)}</Text>
                </View>
                <View style={m.moraTag}><Text style={m.moraTxt}>MORA</Text></View>
              </TouchableOpacity>
            ))
        }

        <Text style={[m.sec,{marginTop:20}]}>Accesos rápidos</Text>
        <View style={m.grid}>
          {[
            { icon:'cash',         label:'Cobros del día', color:C.primary, path:'/cobros'          },
            { icon:'account-plus', label:'Nuevo cliente',  color:'#2e7d32', path:'/clientes/nuevo'  },
            { icon:'plus-circle',  label:'Nuevo préstamo', color:'#1565c0', path:'/prestamos/nuevo' },
            { icon:'file-chart',   label:'Reportes PDF',   color:'#6a1b9a', path:'/reportes'        },
            { icon:'receipt',      label:'Facturas',       color:'#7c4dff', path:'/facturas'        },
          ].map(a => (
            <Card key={a.path} style={m.card} onPress={() => router.push(a.path as any)} elevation={1}>
              <Card.Content style={m.cardContent}>
                <View style={[m.iconBox,{backgroundColor:a.color+'18'}]}>
                  <MaterialCommunityIcons name={a.icon as any} size={26} color={a.color}/>
                </View>
                <Text style={m.accesoLabel}>{a.label}</Text>
              </Card.Content>
            </Card>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function MStat({ icon, color, value, label }: any) {
  const C = useColors();
  const m = useMemo(() => makeStylesM(C), [C]);
  return (
    <Card style={m.card} elevation={2}>
      <Card.Content style={m.cardContent}>
        <MaterialCommunityIcons name={icon} size={28} color={color}/>
        <Text style={[m.valor,{color}]}>{typeof value==='number'?String(value):value}</Text>
        <Text style={m.label}>{label}</Text>
      </Card.Content>
    </Card>
  );
}

/* ─── Quick Card con hover ──────────────────────────────────────── */
function QuickCard({ icon, label, color, index, onPress, styles: w }: any) {
  const [hov, setHov] = useState(false);
  return (
    <StaggerItem index={index} step={60} delay={650} style={{ flex: 1 }}>
      <TouchableOpacity
        onPress={onPress}
        style={[w.quickCard, {
          transform: [{ scale: hov ? 1.03 : 1 }],
          // @ts-ignore
          transition: 'transform 150ms ease, box-shadow 150ms ease',
          boxShadow: hov
            ? '0 8px 28px rgba(0,0,0,0.22)'
            : '0 4px 14px rgba(0,0,0,0.10)',
        }]}
        // @ts-ignore — eventos de mouse en web
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
      >
        <View style={[w.quickIcon, {backgroundColor: color+'18'}]}>
          <MaterialCommunityIcons name={icon} size={24} color={color}/>
        </View>
        <Text style={w.quickLabel}>{label}</Text>
      </TouchableOpacity>
    </StaggerItem>
  );
}

/* ─── STYLES – Liquid Glass ─────────────────────────────────────── */
// Helper para estilos web-only sin romper TypeScript en native
const webOnly = (s: object) => s as any;

const makeStylesW = (C: any) => {
  const isDark = C.isDark;
  const tint    = isDark && C.glassTint ? C.glassTint : null;
  const glassBg     = isDark ? (tint ? hexToRgba(tint, 0.20) : 'rgba(80,110,200,0.18)') : 'rgba(255,255,255,0.70)';
  const glassBorder = isDark ? (tint ? hexToRgba(tint, 0.38) : 'rgba(255,255,255,0.18)') : 'rgba(255,255,255,0.72)';
  const glassShadow = isDark
    ? '0 4px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.22)'
    : '0 4px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)';
  const rootBg = isDark && tint
    ? `linear-gradient(145deg,${C.bg} 0%,${hexToRgba(tint,0.12)} 55%,${C.bg} 100%)`
    : isDark
      ? 'linear-gradient(145deg,#060b1c 0%,#0a1438 55%,#060b1c 100%)'
      : `linear-gradient(145deg,${C.bg} 0%,${C.bgAlt || C.bg} 45%,${C.bg}ee 100%)`;

  return StyleSheet.create({
    root:          {
      flex:1,
      backgroundColor: C.bg,
      ...webOnly({ backgroundImage: rootBg }),
    },
    topBar:        {
      flexDirection:'row', justifyContent:'space-between', alignItems:'center',
      paddingHorizontal:28, paddingVertical:16,
      borderBottomWidth:1, borderBottomColor: glassBorder,
      backgroundColor: isDark ? (tint ? hexToRgba(tint,0.25) : 'rgba(15,25,65,0.80)') : 'rgba(255,255,255,0.72)',
      ...webOnly({
        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
        boxShadow:'0 1px 0 ' + glassBorder,
      }),
    },
    pageTitle:     {fontSize:22, fontWeight:'800', color:C.primaryText},
    pageDate:      {fontSize:12, color:C.textTer, marginTop:2},
    topUser:       {fontSize:13, fontWeight:'700', color:C.textSec},
    body:          {padding:24, gap:20},
    statsRow:      {flexDirection:'row', gap:12},
    statCard:      {
      flex:1, borderRadius:14, padding:16, alignItems:'center',
      backgroundColor: glassBg,
      borderWidth:1, borderColor: glassBorder,
      ...webOnly({
        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
        boxShadow: glassShadow,
      }),
    },
    statIcon:      {width:44, height:44, borderRadius:12, justifyContent:'center', alignItems:'center', marginBottom:10},
    statValue:     {fontSize:22, fontWeight:'800'},
    statLabel:     {fontSize:11, color:C.textTer, marginTop:4, textAlign:'center'},
    panels:        {flexDirection:'row', gap:16},
    panel:         {
      flex:1, borderRadius:14, padding:16, minHeight:160,
      backgroundColor: glassBg,
      borderWidth:1, borderColor: glassBorder,
      ...webOnly({
        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
        boxShadow: glassShadow,
      }),
    },
    panelHeader:   {
      flexDirection:'row', alignItems:'center', gap:8, marginBottom:12,
      paddingBottom:10, borderBottomWidth:1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
    },
    panelTitle:    {fontSize:14, fontWeight:'700', color:C.text},
    panelBadge:    {fontSize:13, fontWeight:'600', color:C.text},
    panelBody:     {flex:1, justifyContent:'center', alignItems:'center', gap:8, paddingTop:16},
    panelEmpty:    {fontSize:13, color:C.textMuted},
    panelItem:     {
      flexDirection:'row', alignItems:'center', paddingVertical:10,
      borderBottomWidth:1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    },
    panelItemNombre:{fontSize:13, fontWeight:'700', color:C.text},
    panelItemSub:  {fontSize:11, color:C.textTer, marginTop:1},
    panelItemMonto:{fontSize:14, fontWeight:'800', color:C.primaryText},
    sectionTitle:  {fontSize:13, fontWeight:'700', color:C.textSec, textTransform:'uppercase', letterSpacing:0.5},
    quickRow:      {flexDirection:'row', gap:12},
    quickCard:     {
      flex:1, borderRadius:14, padding:18, alignItems:'center',
      backgroundColor: glassBg,
      borderWidth:1, borderColor: glassBorder,
      ...webOnly({
        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
        boxShadow: glassShadow,
      }),
    },
    quickIcon:     {width:52, height:52, borderRadius:14, justifyContent:'center', alignItems:'center', marginBottom:10},
    quickLabel:    {fontSize:12, fontWeight:'700', color:C.text, textAlign:'center'},
  });
};

const makeStylesM = (C: any) => StyleSheet.create({
  container:   {flex:1, backgroundColor:C.bg},
  header:      {backgroundColor:C.primary, padding:20, paddingTop:50, flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'},
  hola:        {color:'#fff', fontSize:20, fontWeight:'700'},
  sub:         {color:'#ffffff88', fontSize:12},
  reloadBtn:   {width:40, height:40, borderRadius:20, backgroundColor:'rgba(255,255,255,0.18)', justifyContent:'center', alignItems:'center', marginTop:2},
  body:        {padding:16},
  sec:         {fontSize:12, color:C.textTer, fontWeight:'700', marginBottom:10, textTransform:'uppercase', letterSpacing:0.5},
  grid:        {flexDirection:'row', flexWrap:'wrap', gap:10},
  card:        {width:'47%', borderRadius:12},
  cardContent: {alignItems:'center', paddingVertical:14},
  valor:       {fontSize:22, fontWeight:'800', marginTop:4},
  label:       {fontSize:11, color:C.textTer, marginTop:2},
  iconBox:     {width:50, height:50, borderRadius:25, justifyContent:'center', alignItems:'center', marginBottom:8},
  accesoLabel: {fontSize:12, fontWeight:'600', color:C.text, textAlign:'center'},
  emptyPanel:  {flexDirection:'row', alignItems:'center', gap:8, backgroundColor:C.surfaceAlt,
                borderRadius:8, padding:14, marginBottom:8},
  emptyTxt:    {fontSize:13, color:C.textMuted},
  listItem:    {flexDirection:'row', alignItems:'center', backgroundColor:C.surface,
                borderRadius:10, padding:12, marginBottom:6, elevation:1},
  listNombre:  {fontSize:13, fontWeight:'700', color:C.text},
  listSub:     {fontSize:11, color:C.textTer, marginTop:1},
  listMonto:   {fontSize:15, fontWeight:'800', color:C.primaryText, marginLeft:8},
  moraTag:     {backgroundColor:C.isDark?'#3d1a1a':'#c6282822', borderRadius:6, paddingHorizontal:8, paddingVertical:3},
  moraTxt:     {fontSize:10, fontWeight:'700', color:C.danger},
  verMas:      {fontSize:12, color:C.textTer, textAlign:'center', marginBottom:6},
});
