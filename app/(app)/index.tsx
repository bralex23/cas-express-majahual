import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView, RefreshControl, TouchableOpacity, Animated } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '../../src/lib/firebase';
import { useEmpresa } from '../../src/context/empresa';
import { useAuth } from '../../src/hooks/useAuth';
import { useColors, useTheme, hexToRgba } from '../../src/theme';
import { isAndroidApp } from '../../src/lib/biometric';
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

  // WebDashboard solo en Electron/navegador desktop — Android usa MobileDashboard
  if (Platform.OS === 'web' && !isAndroidApp()) return (
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
  const C  = useColors();
  const { dark } = useTheme();

  // ── Paleta reactiva al tema ──
  const BG      = dark ? '#0b1320' : '#f8fafc';
  const CARD    = dark ? '#161f30' : '#ffffff';
  const CARD2   = dark ? '#1e293b' : '#f8fafc';
  const BORDER  = dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';
  const DIVIDER = dark ? 'rgba(255,255,255,0.05)' : '#f1f5f9';
  const TEXT    = dark ? '#f1f5f9' : '#0f172a';
  const TEXT_S  = dark ? '#94a3b8' : '#64748b';
  const TEXT_M  = dark ? '#475569' : '#94a3b8';
  const SHADOW  = dark
    ? '0 4px 16px rgba(0,0,0,0.40)'
    : '0 2px 8px rgba(15,23,42,0.05)';

  return (
    <ScrollView
      style={{ flex:1, backgroundColor: BG }}
      contentContainerStyle={{ padding:28, gap:20 }}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh}/>}
    >
      {/* ── Saludo ── */}
      <View style={{ marginBottom:4 }}>
        <Text style={{ fontSize:22, fontWeight:'800', color:TEXT }}>
          Buenos días, {perfil?.nombre?.split(' ')[0] || 'Administrador'} 👋
        </Text>
        <Text style={{ fontSize:13, color:TEXT_S, marginTop:3 }}>
          {HOY_LABEL.charAt(0).toUpperCase() + HOY_LABEL.slice(1)}
        </Text>
      </View>

      {/* ── Fila superior: Hero + 4 stats ── */}
      <View style={{ flexDirection:'row', gap:16, alignItems:'stretch' }}>

        {/* ── Hero cartera con sparkline SVG ── */}
        <FadeIn delay={60} style={{
          flex:2, borderRadius:24, padding:0, overflow:'hidden',
          backgroundColor: C.primary,
          ...(({ boxShadow:`0 10px 32px ${hexToRgba(C.primary,0.32)}, 0 2px 6px ${hexToRgba(C.primary,0.18)}` } as any)),
        }}>
          {/* Contenido superior */}
          <View style={{ padding:24, paddingBottom:0 }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
              <View style={{ backgroundColor:'rgba(255,255,255,0.18)', borderRadius:12,
                             paddingHorizontal:12, paddingVertical:5 }}>
                <Text style={{ color:'rgba(255,255,255,0.95)', fontSize:10, fontWeight:'800', letterSpacing:0.6 }}>
                  CARTERA ACTIVA TOTAL
                </Text>
              </View>
              <View style={{ width:36, height:36, borderRadius:18, backgroundColor:'rgba(255,255,255,0.20)',
                             justifyContent:'center', alignItems:'center' }}>
                <MaterialCommunityIcons name="arrow-top-right" size={18} color="#fff"/>
              </View>
            </View>

            <AnimatedNumber
              value={carteraTotal ?? 0}
              formatter={(n) => formatMoneda(n)}
              style={{ fontSize:38, fontWeight:'900', color:'#ffffff' }}
            />

            <View style={{ flexDirection:'row', gap:10, marginTop:14, marginBottom:16 }}>
              <View style={{ flexDirection:'row', alignItems:'center', gap:5,
                             backgroundColor:'rgba(255,255,255,0.18)', borderRadius:20,
                             paddingHorizontal:12, paddingVertical:5 }}>
                <MaterialCommunityIcons name="cash" size={13} color="rgba(255,255,255,0.9)"/>
                <Text style={{ color:'rgba(255,255,255,0.95)', fontSize:12, fontWeight:'700' }}>
                  Hoy: {formatMoneda(cobradoHoy)}
                </Text>
              </View>
              <View style={{ flexDirection:'row', alignItems:'center', gap:5,
                             backgroundColor:'rgba(255,255,255,0.18)', borderRadius:20,
                             paddingHorizontal:12, paddingVertical:5 }}>
                <MaterialCommunityIcons name="clock-check-outline" size={13} color="rgba(255,255,255,0.9)"/>
                <Text style={{ color:'rgba(255,255,255,0.95)', fontSize:12, fontWeight:'700' }}>
                  {cobrosHoy} cobros pendientes
                </Text>
              </View>
            </View>
          </View>

          {/* Sparkline SVG */}
          {Platform.OS === 'web' && (
            <View style={{ height:72 }}>
              {((() => {
                const SparkSVG: any = 'svg';
                const SparkPath: any = 'path';
                const SparkDefs: any = 'defs';
                const SparkLinGrad: any = 'linearGradient';
                const SparkStop: any = 'stop';
                return (
                  <SparkSVG
                    width="100%" height="72" viewBox="0 0 400 72"
                    preserveAspectRatio="none"
                    style={{ display:'block' }}
                  >
                    <SparkDefs>
                      <SparkLinGrad id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                        <SparkStop offset="0%" stopColor="white" stopOpacity="0.25"/>
                        <SparkStop offset="100%" stopColor="white" stopOpacity="0"/>
                      </SparkLinGrad>
                    </SparkDefs>
                    <SparkPath
                      d="M0,52 C40,48 70,58 110,40 C150,24 180,50 220,32 C260,16 300,44 340,22 C370,8 390,14 400,10 L400,72 L0,72 Z"
                      fill="url(#sparkFill)"
                    />
                    <SparkPath
                      d="M0,52 C40,48 70,58 110,40 C150,24 180,50 220,32 C260,16 300,44 340,22 C370,8 390,14 400,10"
                      fill="none" stroke="white" strokeWidth="2.5" strokeOpacity="0.55"
                      strokeLinecap="round"
                    />
                  </SparkSVG>
                );
              })())}
            </View>
          )}
        </FadeIn>

        {/* Grid 2×2 stats */}
        <View style={{ flex:3, flexDirection:'row', flexWrap:'wrap', gap:12 }}>
          {[
            { icon:'account-group-outline', color:'#2563eb', bg: dark?'#1e3a5f':'#eff6ff', value:stats.clientes, label:'Clientes Activos',  money:false },
            { icon:'bank-outline',          color:'#16a34a', bg: dark?'#14412a':'#f0fdf4', value:stats.activos,  label:'Préstamos Activos', money:false },
            { icon:'cash-multiple',         color:'#ea580c', bg: dark?'#431407':'#fff7ed', value:cobradoHoy,     label:'Cobrado Hoy',       money:true, progress: true },
            { icon:'alert-circle-outline',  color:'#dc2626', bg: dark?'#450a0a':'#fef2f2', value:stats.mora,     label:'En Mora',           money:false },
          ].map((s: any, i: number) => {
            const pct = s.progress && carteraTotal > 0
              ? Math.min(100, Math.round((cobradoHoy / (carteraTotal * 0.05)) * 100))
              : 0;
            return (
              <FadeIn key={s.label} delay={120 + i * 60} style={{
                flex:1, minWidth:'45%', backgroundColor: CARD, borderRadius:18,
                padding:18, borderWidth:1, borderColor: BORDER,
                ...(({ boxShadow: SHADOW } as any)),
              }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                  <View style={{ width:40, height:40, borderRadius:12, backgroundColor:s.bg,
                                 justifyContent:'center', alignItems:'center' }}>
                    <MaterialCommunityIcons name={s.icon as any} size={20} color={s.color}/>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={TEXT_M}/>
                </View>
                <AnimatedNumber
                  value={s.value ?? 0}
                  formatter={s.money ? (n: number) => formatMoneda(n) : (n: number) => String(Math.round(n))}
                  style={{ fontSize:s.money ? 18 : 26, fontWeight:'800', color: TEXT }}
                />
                <Text style={{ fontSize:11, color:TEXT_S, marginTop:3 }}>{s.label}</Text>
                {s.progress && (
                  <View style={{ marginTop:10 }}>
                    <View style={{ height:4, backgroundColor: dark?'rgba(255,255,255,0.08)':'#f1f5f9',
                                   borderRadius:2, overflow:'hidden' }}>
                      <View style={{ height:4, width:`${pct}%` as any, backgroundColor:s.color,
                                     borderRadius:2 }}/>
                    </View>
                    <Text style={{ fontSize:10, color:TEXT_M, marginTop:4 }}>
                      {pct}% de meta diaria
                    </Text>
                  </View>
                )}
              </FadeIn>
            );
          })}
        </View>
      </View>

      {/* ── Paneles: Cobros + Mora ── */}
      <View style={{ flexDirection:'row', gap:16 }}>

        {/* Cobros pendientes */}
        <FadeIn delay={380} style={{
          flex:1, backgroundColor: CARD, borderRadius:24,
          borderWidth:1, borderColor: BORDER, overflow:'hidden',
          ...(({ boxShadow: SHADOW } as any)),
        }}>
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                         paddingHorizontal:20, paddingVertical:16,
                         borderBottomWidth:1, borderBottomColor: DIVIDER }}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
              <View style={{ width:32, height:32, borderRadius:10,
                             backgroundColor: dark?'#431407':'#fff7ed',
                             justifyContent:'center', alignItems:'center' }}>
                <MaterialCommunityIcons name="clock-alert-outline" size={16} color="#ea580c"/>
              </View>
              <Text style={{ fontSize:14, fontWeight:'700', color:TEXT }}>
                Cobros Pendientes Hoy
              </Text>
            </View>
            {cobrosPendientes.length > 0 &&
              <View style={{ backgroundColor:'#ea580c', borderRadius:20, paddingHorizontal:9, paddingVertical:3 }}>
                <Text style={{ color:'#fff', fontSize:11, fontWeight:'800' }}>{cobrosPendientes.length}</Text>
              </View>
            }
          </View>

          {cobrosPendientes.length === 0
            ? <View style={{ padding:32, alignItems:'center', gap:10 }}>
                <MaterialCommunityIcons name="check-circle-outline" size={40} color="#86efac"/>
                <Text style={{ color:TEXT_M, fontSize:13 }}>No hay cobros pendientes hoy</Text>
              </View>
            : <ScrollView style={{ maxHeight:280 }} showsVerticalScrollIndicator={false}>
                {cobrosPendientes.map((c: CobroPendiente, i: number) => (
                  <TouchableOpacity key={i}
                    style={{ flexDirection:'row', alignItems:'center',
                             paddingHorizontal:20, paddingVertical:13,
                             borderBottomWidth:1, borderBottomColor: DIVIDER }}
                    onPress={() => router.push(`/(app)/prestamos/${c.prestamo_id}` as any)}>
                    <View style={{ width:38, height:38, borderRadius:19,
                                   backgroundColor: C.primary + '20',
                                   justifyContent:'center', alignItems:'center', marginRight:12 }}>
                      <Text style={{ fontSize:14, fontWeight:'800', color: C.primary }}>
                        {c.cliente_nombre.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={{ fontSize:13, fontWeight:'700', color:TEXT }} numberOfLines={1}>
                        {c.cliente_nombre}
                      </Text>
                      <Text style={{ fontSize:11, color:TEXT_M, marginTop:1 }}>
                        Cuota #{c.numero_cuota} · {c.frecuencia}
                      </Text>
                    </View>
                    <Text style={{ fontSize:14, fontWeight:'800', color: C.primary }}>
                      {formatMoneda(c.monto)}
                    </Text>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={TEXT_M} style={{ marginLeft:6 }}/>
                  </TouchableOpacity>
                ))}
              </ScrollView>
          }
        </FadeIn>

        {/* Clientes en mora */}
        <FadeIn delay={440} style={{
          flex:1, backgroundColor: CARD, borderRadius:24,
          borderWidth:1, borderColor: BORDER, overflow:'hidden',
          ...(({ boxShadow: SHADOW } as any)),
        }}>
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                         paddingHorizontal:20, paddingVertical:16,
                         borderBottomWidth:1, borderBottomColor: DIVIDER }}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
              <View style={{ width:32, height:32, borderRadius:10,
                             backgroundColor: dark?'#450a0a':'#fef2f2',
                             justifyContent:'center', alignItems:'center' }}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#dc2626"/>
              </View>
              <Text style={{ fontSize:14, fontWeight:'700', color:TEXT }}>
                Clientes en Mora
              </Text>
            </View>
            {prestamosEnMora.length > 0 &&
              <View style={{ backgroundColor:'#dc2626', borderRadius:20, paddingHorizontal:9, paddingVertical:3 }}>
                <Text style={{ color:'#fff', fontSize:11, fontWeight:'800' }}>{prestamosEnMora.length}</Text>
              </View>
            }
          </View>

          {prestamosEnMora.length === 0
            ? <View style={{ padding:32, alignItems:'center', gap:10 }}>
                <MaterialCommunityIcons name="emoticon-happy-outline" size={40} color="#86efac"/>
                <Text style={{ color:TEXT_M, fontSize:13 }}>Sin clientes en mora</Text>
              </View>
            : <ScrollView style={{ maxHeight:280 }} showsVerticalScrollIndicator={false}>
                {prestamosEnMora.map((p: PrestamoMoraItem, i: number) => (
                  <TouchableOpacity key={i}
                    style={{ flexDirection:'row', alignItems:'center',
                             paddingHorizontal:20, paddingVertical:13,
                             borderBottomWidth:1, borderBottomColor: DIVIDER }}
                    onPress={() => router.push(`/(app)/prestamos/${p.id}` as any)}>
                    <View style={{ width:38, height:38, borderRadius:19,
                                   backgroundColor: dark?'#450a0a':'#fef2f2',
                                   justifyContent:'center', alignItems:'center', marginRight:12 }}>
                      <Text style={{ fontSize:14, fontWeight:'800', color:'#dc2626' }}>
                        {p.cliente_nombre.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={{ fontSize:13, fontWeight:'700', color:TEXT }} numberOfLines={1}>
                        {p.cliente_nombre}
                      </Text>
                      <Text style={{ fontSize:11, color:TEXT_M, marginTop:1 }}>
                        Cuota: {formatMoneda(p.cuota)} · Venció: {formatFecha(p.fecha_fin)}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: dark?'#450a0a':'#fef2f2', borderRadius:20,
                                   borderWidth:1, borderColor: dark?'#7f1d1d':'#fecaca',
                                   paddingHorizontal:10, paddingVertical:4 }}>
                      <Text style={{ color:'#dc2626', fontSize:10, fontWeight:'800' }}>MORA</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
          }
        </FadeIn>
      </View>

      {/* ── Accesos rápidos ── */}
      <View>
        <Text style={{ fontSize:11, fontWeight:'700', color:TEXT_M,
                       textTransform:'uppercase', letterSpacing:0.8, marginBottom:14 }}>
          Accesos Rápidos
        </Text>
        <View style={{ flexDirection:'row', gap:12 }}>
          {[
            { icon:'cash-multiple',  label:'Cobros del Día',  color:'#2563eb', bg: dark?'#1e3a5f':'#eff6ff', path:'/cobros'          },
            { icon:'account-plus',   label:'Nuevo Cliente',   color:'#16a34a', bg: dark?'#14412a':'#f0fdf4', path:'/clientes/nuevo'  },
            { icon:'plus-circle',    label:'Nuevo Préstamo',  color:'#7c3aed', bg: dark?'#2e1065':'#f5f3ff', path:'/prestamos/nuevo' },
            { icon:'file-chart',     label:'Generar Reporte', color:'#ea580c', bg: dark?'#431407':'#fff7ed', path:'/reportes'        },
            { icon:'receipt',        label:'Facturas',        color:'#0891b2', bg: dark?'#0c3d4a':'#ecfeff', path:'/facturas'        },
          ].map((a, i) => (
            <QuickCard key={a.path} icon={a.icon} label={a.label} color={a.color} bg={a.bg}
              cardBg={CARD} border={BORDER} textColor={TEXT}
              index={i} onPress={() => router.push(a.path as any)}/>
          ))}
        </View>
      </View>

    </ScrollView>
  );
}

// WStat conservado pero ya no usado en WebDashboard (se usa FadeIn inline)
function WStat({ icon, color, rawValue, isMoney, label, index = 0 }: any) {
  return null;
}

/* ─── MOBILE ─── UXDA-inspired ──────────────────────────────────── */
function MobileDashboard({ stats, cobradoHoy, carteraTotal, perfil, refresh, onRefresh, cobrosPendientes, prestamosEnMora }: any) {
  const C   = useColors();
  const { dark } = useTheme();
  const PRI = C.primary;

  // Paleta dinámica light/dark
  const BG      = dark ? '#070d1b'                   : '#f0f4ff';
  const CARD    = dark ? 'rgba(22,34,64,0.95)'       : '#ffffff';
  const CARD2   = dark ? 'rgba(255,255,255,0.04)'    : '#f8faff';
  const BORDER  = dark ? 'rgba(255,255,255,0.07)'    : 'rgba(37,99,235,0.10)';
  const TEXT    = dark ? '#f1f5f9'                   : '#0f172a';
  const TEXT_S  = dark ? '#94a3b8'                   : '#64748b';
  const TEAL    = dark ? '#00d4b0'                   : '#0891b2';
  const HERO_A  = dark ? PRI                         : PRI;
  const HERO_B  = dark ? '#5b21b6'                   : '#7c3aed';

  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const handleReload = () => {
    if (refresh) return;
    spinAnim.setValue(0);
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 700, useNativeDriver: true })
    );
    spinLoop.current.start();
    onRefresh();
  };

  React.useEffect(() => {
    if (!refresh && spinLoop.current) {
      spinLoop.current.stop();
      spinLoop.current = null;
      spinAnim.setValue(0);
    }
  }, [refresh]);

  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <ScrollView
      style={{ flex:1, backgroundColor: BG }}
      contentContainerStyle={{ paddingBottom:40 }}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} colors={[PRI]}/>}
    >
      {/* ── Header ── */}
      <View style={{ paddingHorizontal:20, paddingTop:22, paddingBottom:10,
                     flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
        <View>
          <Text style={{ fontSize:24, fontWeight:'800', color:TEXT, letterSpacing:-0.3 }}>
            Hola, {perfil?.nombre?.split(' ')[0]} 👋
          </Text>
          <Text style={{ fontSize:12, color:TEXT_S, marginTop:2 }}>
            {(perfil?.rol||'admin').toUpperCase()} · CAS Tamanique
          </Text>
        </View>
        <TouchableOpacity onPress={handleReload} activeOpacity={0.7}
          style={{ width:42, height:42, borderRadius:21, backgroundColor:CARD,
                   borderWidth:1, borderColor:BORDER,
                   justifyContent:'center', alignItems:'center' }}>
          <Animated.View style={{ transform:[{ rotate: spinDeg }] }}>
            <MaterialCommunityIcons name="refresh" size={20} color={PRI}/>
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* ── Hero cartera — gradiente azul→morado ── */}
      <View style={{ marginHorizontal:16, marginBottom:16, borderRadius:24, overflow:'hidden',
                     ...(Platform.OS === 'web'
                       ? ({ background:`linear-gradient(135deg, ${HERO_A} 0%, ${HERO_B} 100%)`,
                            boxShadow:`0 12px 36px ${HERO_A}55` } as any)
                       : { backgroundColor: HERO_A }) }}>
        {/* Capa de gradiente para Android (simulado) */}
        {Platform.OS !== 'web' && (
          <View style={{ position:'absolute', right:0, top:0, bottom:0, width:'55%',
                         backgroundColor: HERO_B, opacity:0.5, borderRadius:24 }}/>
        )}
        {/* Círculo decorativo */}
        <View style={{ position:'absolute', right:-24, top:-24, width:120, height:120,
                       borderRadius:60, backgroundColor:'rgba(255,255,255,0.06)' }}/>
        <View style={{ position:'absolute', right:32, bottom:-30, width:80, height:80,
                       borderRadius:40, backgroundColor:'rgba(255,255,255,0.04)' }}/>

        <View style={{ padding:22 }}>
          {/* Etiqueta + ojo */}
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <Text style={{ color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:'600', letterSpacing:0.4 }}>
              Cartera Activa Total
            </Text>
            <MaterialCommunityIcons name="eye-outline" size={20} color="rgba(255,255,255,0.5)"/>
          </View>

          {/* Monto principal */}
          <Text style={{ color:'#ffffff', fontSize:34, fontWeight:'900', letterSpacing:-0.5, marginBottom:4 }}>
            {formatMoneda(carteraTotal)}
          </Text>

          {/* Cobrado hoy con acento verde */}
          <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:18 }}>
            <MaterialCommunityIcons name="trending-up" size={14} color={TEAL}/>
            <Text style={{ color:TEAL, fontSize:13, fontWeight:'700' }}>
              +{formatMoneda(cobradoHoy)} cobrado hoy
            </Text>
            <View style={{ width:4, height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.3)' }}/>
            <Text style={{ color:'rgba(255,255,255,0.55)', fontSize:12 }}>
              {cobrosPendientes.length} pendientes
            </Text>
          </View>

          {/* Dots de paginación estilo UXDA */}
          <View style={{ flexDirection:'row', gap:5 }}>
            <View style={{ width:20, height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.9)' }}/>
            <View style={{ width:4, height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.3)' }}/>
            <View style={{ width:4, height:4, borderRadius:2, backgroundColor:'rgba(255,255,255,0.3)' }}/>
          </View>
        </View>
      </View>

      {/* ── 3 stat cards ── */}
      <View style={{ flexDirection:'row', gap:10, marginHorizontal:16, marginBottom:22 }}>
        {[
          { icon:'account-group-outline', color:'#3b82f6', bg: dark?'rgba(59,130,246,0.15)':'#eff6ff',
            border: dark?'rgba(59,130,246,0.25)':'#bfdbfe', value:stats.clientes, label:'Clientes' },
          { icon:'bank-outline',          color:'#10b981', bg: dark?'rgba(16,185,129,0.15)':'#ecfdf5',
            border: dark?'rgba(16,185,129,0.25)':'#a7f3d0', value:stats.activos,  label:'Préstamos' },
          { icon:'alert-circle-outline',  color:'#ef4444', bg: dark?'rgba(239,68,68,0.15)':'#fef2f2',
            border: dark?'rgba(239,68,68,0.25)':'#fecaca', value:stats.mora,      label:'En Mora' },
        ].map(s => (
          <View key={s.label} style={{ flex:1, backgroundColor:s.bg, borderRadius:18,
                                       padding:14, alignItems:'center',
                                       borderWidth:1, borderColor:s.border }}>
            <View style={{ width:40, height:40, borderRadius:12,
                           backgroundColor: dark?'rgba(255,255,255,0.08)':s.color+'20',
                           justifyContent:'center', alignItems:'center', marginBottom:8 }}>
              <MaterialCommunityIcons name={s.icon as any} size={20} color={s.color}/>
            </View>
            <Text style={{ color:TEXT, fontSize:22, fontWeight:'900' }}>{s.value}</Text>
            <Text style={{ color:TEXT_S, fontSize:10, marginTop:2, fontWeight:'600' }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Sección: Cobros pendientes ── */}
      <View style={{ marginHorizontal:16, marginBottom:20 }}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <Text style={{ fontSize:14, fontWeight:'800', color:TEXT }}>
            Cobros Pendientes
          </Text>
          <View style={{ backgroundColor: dark?'rgba(37,99,235,0.18)':'#eff6ff',
                         borderRadius:20, paddingHorizontal:10, paddingVertical:3 }}>
            <Text style={{ color:PRI, fontSize:11, fontWeight:'800' }}>
              {cobrosPendientes.length} HOY
            </Text>
          </View>
        </View>

        {cobrosPendientes.length === 0
          ? <View style={{ backgroundColor:CARD, borderRadius:16, padding:16,
                           flexDirection:'row', alignItems:'center', gap:12,
                           borderWidth:1, borderColor:BORDER }}>
              <MaterialCommunityIcons name="check-circle-outline" size={28} color="#10b981"/>
              <Text style={{ color:TEXT_S, fontSize:13 }}>Sin cobros pendientes hoy 🎉</Text>
            </View>
          : cobrosPendientes.slice(0,10).map((c: CobroPendiente, i: number) => (
              <TouchableOpacity key={i} activeOpacity={0.75}
                style={{ backgroundColor:CARD, borderRadius:16, padding:14,
                         marginBottom:8, flexDirection:'row', alignItems:'center',
                         borderWidth:1, borderColor:BORDER }}
                onPress={() => router.push(`/(app)/prestamos/${c.prestamo_id}` as any)}>
                {/* Avatar inicial */}
                <View style={{ width:42, height:42, borderRadius:21,
                               backgroundColor: dark?'rgba(37,99,235,0.20)':'#eff6ff',
                               justifyContent:'center', alignItems:'center', marginRight:12 }}>
                  <Text style={{ color:PRI, fontSize:16, fontWeight:'800' }}>
                    {c.cliente_nombre.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex:1 }}>
                  <Text style={{ color:TEXT, fontSize:13, fontWeight:'800' }} numberOfLines={1}>
                    {c.cliente_nombre}
                  </Text>
                  <Text style={{ color:TEXT_S, fontSize:11, marginTop:2 }}>
                    Cuota #{c.numero_cuota} · {c.frecuencia}
                  </Text>
                </View>
                <View style={{ alignItems:'flex-end' }}>
                  <Text style={{ color:TEAL, fontSize:16, fontWeight:'900' }}>
                    {formatMoneda(c.monto)}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={TEXT_S}/>
                </View>
              </TouchableOpacity>
            ))
        }
        {cobrosPendientes.length > 10 &&
          <Text style={{ color:TEXT_S, fontSize:12, textAlign:'center', marginTop:4 }}>
            +{cobrosPendientes.length - 10} más pendientes
          </Text>
        }
      </View>

      {/* ── Sección: En mora ── */}
      {prestamosEnMora.length > 0 && (
        <View style={{ marginHorizontal:16, marginBottom:22 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <Text style={{ fontSize:14, fontWeight:'800', color:TEXT }}>En Mora</Text>
            <View style={{ backgroundColor: dark?'rgba(239,68,68,0.18)':'#fef2f2',
                           borderRadius:20, paddingHorizontal:10, paddingVertical:3 }}>
              <Text style={{ color:'#ef4444', fontSize:11, fontWeight:'800' }}>
                {prestamosEnMora.length} CLIENTES
              </Text>
            </View>
          </View>
          {prestamosEnMora.map((p: PrestamoMoraItem, i: number) => (
            <TouchableOpacity key={i} activeOpacity={0.75}
              style={{ backgroundColor:CARD, borderRadius:16, padding:14,
                       marginBottom:8, flexDirection:'row', alignItems:'center',
                       borderWidth:1, borderColor: dark?'rgba(239,68,68,0.20)':'#fecaca',
                       borderLeftWidth:3, borderLeftColor:'#ef4444' }}
              onPress={() => router.push(`/(app)/prestamos/${p.id}` as any)}>
              <View style={{ width:42, height:42, borderRadius:21,
                             backgroundColor: dark?'rgba(239,68,68,0.15)':'#fef2f2',
                             justifyContent:'center', alignItems:'center', marginRight:12 }}>
                <MaterialCommunityIcons name="alert" size={20} color="#ef4444"/>
              </View>
              <View style={{ flex:1 }}>
                <Text style={{ color:TEXT, fontSize:13, fontWeight:'800' }} numberOfLines={1}>
                  {p.cliente_nombre}
                </Text>
                <Text style={{ color:TEXT_S, fontSize:11, marginTop:2 }}>
                  {formatMoneda(p.monto)} · cuota {formatMoneda(p.cuota)}
                </Text>
              </View>
              <View style={{ backgroundColor: dark?'rgba(239,68,68,0.20)':'#fef2f2',
                             borderRadius:8, paddingHorizontal:8, paddingVertical:4,
                             borderWidth:1, borderColor: dark?'rgba(239,68,68,0.35)':'#fecaca' }}>
                <Text style={{ color:'#ef4444', fontSize:10, fontWeight:'800' }}>MORA</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Accesos rápidos ── */}
      <View style={{ marginHorizontal:16, marginBottom:10 }}>
        <Text style={{ fontSize:11, fontWeight:'700', color:TEXT_S, letterSpacing:0.8,
                       textTransform:'uppercase', marginBottom:12 }}>
          Accesos Rápidos
        </Text>
        <View style={{ flexDirection:'row', flexWrap:'wrap', gap:10 }}>
          {[
            { icon:'cash-multiple',  label:'Cobros del día',   color:'#3b82f6', path:'/cobros'          },
            { icon:'account-plus',   label:'Nuevo cliente',    color:'#10b981', path:'/clientes/nuevo'  },
            { icon:'plus-circle',    label:'Nuevo préstamo',   color:PRI,       path:'/prestamos/nuevo' },
            { icon:'file-chart',     label:'Reportes',         color:'#8b5cf6', path:'/reportes'        },
          ].map(a => (
            <TouchableOpacity key={a.path} activeOpacity={0.75}
              style={{ width:'47%', backgroundColor:CARD, borderRadius:18,
                       padding:16, alignItems:'center',
                       borderWidth:1, borderColor:BORDER }}
              onPress={() => router.push(a.path as any)}>
              <View style={{ width:48, height:48, borderRadius:14,
                             backgroundColor: dark?`${a.color}22`:`${a.color}15`,
                             justifyContent:'center', alignItems:'center', marginBottom:10 }}>
                <MaterialCommunityIcons name={a.icon as any} size={24} color={a.color}/>
              </View>
              <Text style={{ color:TEXT, fontSize:12, fontWeight:'700', textAlign:'center' }}>
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/* ─── Quick Card con hover ──────────────────────────────────────── */
function QuickCard({ icon, label, color, bg, cardBg, border, textColor, index, onPress }: any) {
  const [hov, setHov] = useState(false);
  return (
    <StaggerItem index={index} step={60} delay={600} style={{ flex:1 }}>
      <TouchableOpacity
        onPress={onPress}
        style={{
          flex:1, borderRadius:20, padding:20, alignItems:'center',
          backgroundColor: hov ? color : (cardBg || '#ffffff'),
          borderWidth:1, borderColor: hov ? color : (border || '#e2e8f0'),
          // @ts-ignore
          transition: 'all 160ms ease',
          boxShadow: hov ? `0 8px 24px ${color}44` : '0 2px 8px rgba(15,23,42,0.04)',
        }}
        // @ts-ignore
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
      >
        <View style={{ width:48, height:48, borderRadius:14,
                       backgroundColor: hov ? 'rgba(255,255,255,0.22)' : bg,
                       justifyContent:'center', alignItems:'center', marginBottom:12 }}>
          <MaterialCommunityIcons name={icon} size={24} color={hov ? '#fff' : color}/>
        </View>
        <Text style={{ fontSize:12, fontWeight:'700', textAlign:'center',
                       color: hov ? '#ffffff' : (textColor || '#0f172a') }}>
          {label}
        </Text>
      </TouchableOpacity>
    </StaggerItem>
  );
}

// makeStylesM eliminado — MobileDashboard usa inline styles
