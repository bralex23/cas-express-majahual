import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Pressable, Platform,
  ActivityIndicator, Image, useWindowDimensions, ScrollView, PanResponder, Animated,
} from 'react-native';
import { Text } from 'react-native-paper';
import { Tabs, Redirect, router, usePathname } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme, useColors, glassBgStyle, PALETTES, PaletteId, hexToRgba } from '../../src/theme';
import { useEmpresa } from '../../src/context/empresa';

/* ══════════════════════════════════════════════════════════════
   ESTRUCTURA DE NAVEGACIÓN
   ══════════════════════════════════════════════════════════════ */
type NavItem   = { icon: string; label: string; path: string };
type NavGroup  = { label: string; icon: string; single?: boolean; path?: string; items?: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Dashboard', icon: 'view-dashboard-outline',
    single: true, path: '/',
  },
  {
    label: 'Operaciones', icon: 'briefcase-outline',
    items: [
      { icon: 'account-group-outline', label: 'Clientes',        path: '/clientes'       },
      { icon: 'bank-outline',          label: 'Préstamos',       path: '/prestamos'      },
      { icon: 'cash-multiple',         label: 'Cobros del Día',  path: '/cobros'         },
      { icon: 'table-account',         label: 'Cuadro Cobrador', path: '/cuadrocobrador' },
    ],
  },
  {
    label: 'Reportes', icon: 'file-chart-outline',
    items: [
      { icon: 'file-chart-outline', label: 'Reportes PDF',    path: '/reportes'     },
      { icon: 'chart-bar',          label: 'Reporte Diario',  path: '/reportediario'},
      { icon: 'wallet-outline',     label: 'Balance Cartera', path: '/cartera'      },
      { icon: 'trending-up',        label: 'Ganancias',       path: '/ganancias'    },
    ],
  },
  {
    label: 'Fiscal / DTE', icon: 'receipt',
    items: [
      { icon: 'receipt',                label: 'Facturas',         path: '/facturas' },
      { icon: 'file-send-outline',      label: 'Cola DTE',         path: '/dte'      },
      { icon: 'file-percent-outline',   label: 'Libros de IVA',    path: '/libroiva' },
      { icon: 'account-cash-outline',   label: 'Planilla Sueldos', path: '/planilla' },
    ],
  },
];
const NAV_AJUSTES: NavGroup = {
  label: 'Ajustes', icon: 'cog-outline',
  items: [
    { icon: 'briefcase-outline',   label: 'Administración', path: '/administracion' },
    { icon: 'account-cog-outline', label: 'Usuarios',       path: '/usuarios'       },
  ],
};

// Lista plana para el drawer móvil y helper useCurrentLabel
const NAV_FLAT: NavItem[] = [
  { icon: 'view-dashboard-outline', label: 'Dashboard',        path: '/'              },
  { icon: 'account-group-outline',  label: 'Clientes',         path: '/clientes'      },
  { icon: 'bank-outline',           label: 'Préstamos',        path: '/prestamos'     },
  { icon: 'cash-multiple',          label: 'Cobros del Día',   path: '/cobros'        },
  { icon: 'file-chart-outline',     label: 'Reportes',         path: '/reportes'      },
  { icon: 'chart-bar',              label: 'Reporte Diario',   path: '/reportediario' },
  { icon: 'receipt',                label: 'Facturas',         path: '/facturas'      },
  { icon: 'file-send-outline',      label: 'Cola DTE',         path: '/dte'           },
  { icon: 'file-percent-outline',   label: 'Libros de IVA',    path: '/libroiva'      },
  { icon: 'account-cash-outline',   label: 'Planilla Sueldos', path: '/planilla'      },
  { icon: 'wallet-outline',         label: 'Balance Cartera',  path: '/cartera'       },
  { icon: 'table-account',          label: 'Cuadro Cobrador',  path: '/cuadrocobrador'},
  { icon: 'trending-up',            label: 'Ganancias',        path: '/ganancias'     },
  { icon: 'briefcase-outline',      label: 'Administración',   path: '/administracion'},
  { icon: 'account-cog-outline',    label: 'Usuarios',         path: '/usuarios'      },
];

function Icon({ name, color, size }: { name: any; color: string; size: number }) {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

/* ══════════════════════════════════════════════════════════════
   TOP NAV — barra horizontal de escritorio
   ══════════════════════════════════════════════════════════════ */
function TopNav() {
  const { perfil, signOut, isSupervisor, updateNombre } = useAuth();
  const { dark, toggle, palette, setPalette } = useTheme();
  const C = useColors();
  const { empresa } = useEmpresa();
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState(false);
  const [nombreEdit, setNombreEdit] = useState('');
  const [guardando, setGuardando] = useState(false);
  const closeRef = useRef<any>(null);

  // Grupos de nav + Ajustes (solo para supervisor)
  const groups = isSupervisor ? [...NAV_GROUPS, NAV_AJUSTES] : NAV_GROUPS;

  const isActive = (path?: string, items?: NavItem[]) => {
    if (path) return path === '/' ? pathname === '/' : pathname.startsWith(path);
    return items?.some(it => pathname.startsWith(it.path)) ?? false;
  };

  // Cierra dropdown al hacer clic fuera
  useEffect(() => {
    if (!openGroup) return;
    const handler = () => setOpenGroup(null);
    // pequeño delay para que el propio clic no lo cierre
    closeRef.current = setTimeout(() => {
      window.addEventListener('click', handler, { once: true });
    }, 10);
    return () => {
      clearTimeout(closeRef.current);
      window.removeEventListener('click', handler);
    };
  }, [openGroup]);

  async function guardarNombre() {
    if (!nombreEdit.trim() || guardando) return;
    setGuardando(true);
    try { await updateNombre(nombreEdit.trim()); } catch {}
    setGuardando(false);
    setEditNombre(false);
  }

  const PRI = C.primary;

  return (
    <View style={[n.bar, {
      backgroundColor: C.isDark ? '#0f172a' : '#ffffff',
      borderBottomColor: C.isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0',
      ...({ boxShadow: C.isDark ? '0 1px 0 rgba(255,255,255,0.06), 0 2px 12px rgba(0,0,0,0.3)' : '0 1px 0 #e2e8f0, 0 2px 8px rgba(15,23,42,0.04)' } as any),
    }]}>
      {/* ── Logo ── */}
      <View style={n.logoArea}>
        <View style={[n.logoMark, { backgroundColor: PRI }]}>
          <MaterialCommunityIcons name="briefcase-check" size={16} color="#fff"/>
        </View>
        <View>
          <Text style={[n.logoName, { color: C.text }]} numberOfLines={1}>
            {empresa.nombreCorto || 'CAS Tamanique'}
          </Text>
          <View style={[n.badge, { backgroundColor: hexToRgba(PRI, 0.10), borderColor: hexToRgba(PRI, 0.20) }]}>
            <Text style={[n.badgeTxt, { color: PRI }]}>
              {(perfil?.rol || 'admin').toUpperCase()}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Grupos de navegación (píldoras) ── */}
      <View style={n.navGroups}>
        {groups.map(g => {
          const active = isActive(g.path, g.items);
          const isOpen = openGroup === g.label;

          if (g.single) {
            return (
              <TouchableOpacity
                key={g.label}
                onPress={() => { router.push(g.path as any); setOpenGroup(null); }}
                style={[
                  n.pill,
                  active && { backgroundColor: PRI, borderColor: PRI },
                ]}
              >
                <MaterialCommunityIcons
                  name={g.icon as any} size={14}
                  color={active ? '#fff' : C.isDark ? '#94a3b8' : '#475569'}
                />
                <Text style={[n.pillTxt, { color: active ? '#fff' : C.isDark ? '#94a3b8' : '#475569', fontWeight: active ? '700' : '500' }]}>
                  {g.label}
                </Text>
              </TouchableOpacity>
            );
          }

          return (
            <View key={g.label} style={{ position: 'relative' }}>
              <TouchableOpacity
                onPress={(e) => {
                  (e as any).stopPropagation?.();
                  setOpenGroup(isOpen ? null : g.label);
                }}
                style={[
                  n.pill,
                  (active || isOpen) && { backgroundColor: hexToRgba(PRI, 0.10), borderColor: hexToRgba(PRI, 0.25) },
                ]}
              >
                <MaterialCommunityIcons
                  name={g.icon as any} size={14}
                  color={(active || isOpen) ? PRI : C.isDark ? '#94a3b8' : '#475569'}
                />
                <Text style={[n.pillTxt, { color: (active || isOpen) ? PRI : C.isDark ? '#94a3b8' : '#475569', fontWeight: active ? '700' : '500' }]}>
                  {g.label}
                </Text>
                <MaterialCommunityIcons
                  name={isOpen ? 'chevron-up' : 'chevron-down'} size={12}
                  color={(active || isOpen) ? PRI : C.isDark ? '#64748b' : '#94a3b8'}
                />
              </TouchableOpacity>

              {/* Dropdown */}
              {isOpen && (
                <View style={[n.dropdown, {
                  backgroundColor: C.isDark ? '#1e293b' : '#ffffff',
                  borderColor: C.isDark ? 'rgba(255,255,255,0.10)' : '#e2e8f0',
                  ...({ boxShadow: C.isDark ? '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)' : '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' } as any),
                }]} {...{ onClick: (e: any) => e.stopPropagation?.() } as any}>
                  {g.items!.map(it => {
                    const on = pathname.startsWith(it.path);
                    return (
                      <TouchableOpacity
                        key={it.path}
                        onPress={() => { router.push(it.path as any); setOpenGroup(null); }}
                        style={[n.dropItem, on && { backgroundColor: hexToRgba(PRI, 0.10) }]}
                      >
                        <View style={[n.dropIcon, { backgroundColor: on ? hexToRgba(PRI, 0.14) : C.isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9' }]}>
                          <MaterialCommunityIcons name={it.icon as any} size={14} color={on ? PRI : C.isDark ? '#94a3b8' : '#64748b'}/>
                        </View>
                        <Text style={[n.dropLabel, { color: on ? PRI : C.isDark ? '#cbd5e1' : '#334155', fontWeight: on ? '700' : '500' }]}>
                          {it.label}
                        </Text>
                        {on && <View style={[n.dropDot, { backgroundColor: PRI }]}/>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* ── Derecha: selector paleta + tema + usuario + logout ── */}
      <View style={n.right}>
        {/* Selector de paleta */}
        <View style={n.paletteRow}>
          {(Object.keys(PALETTES) as PaletteId[]).map(pid => (
            <TouchableOpacity
              key={pid}
              onPress={() => setPalette(pid)}
              style={{
                width: palette === pid ? 18 : 12,
                height: palette === pid ? 18 : 12,
                borderRadius: palette === pid ? 9 : 6,
                backgroundColor: PALETTES[pid].primary,
                borderWidth: palette === pid ? 2 : 0,
                borderColor: '#fff',
                ...({ boxShadow: palette === pid ? `0 0 6px ${PALETTES[pid].primary}88` : 'none' } as any),
              }}
            />
          ))}
        </View>

        {/* Modo oscuro/claro */}
        <TouchableOpacity onPress={toggle} style={[n.iconBtn, { backgroundColor: C.isDark ? 'rgba(255,255,255,0.07)' : '#f1f5f9' }]}>
          <MaterialCommunityIcons name={dark ? 'weather-sunny' : 'weather-night'} size={17} color={C.isDark ? '#94a3b8' : '#64748b'}/>
        </TouchableOpacity>

        {/* Avatar + nombre */}
        <TouchableOpacity
          onPress={() => setEditNombre(!editNombre)}
          style={[n.userChip, {
            backgroundColor: C.isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc',
            borderColor: C.isDark ? 'rgba(255,255,255,0.10)' : '#e2e8f0',
          }]}
        >
          <View style={[n.avatar, { backgroundColor: PRI }]}>
            <Text style={n.avatarTxt}>{(perfil?.nombre?.[0] || 'A').toUpperCase()}</Text>
          </View>
          {!editNombre && (
            <Text style={[n.userName, { color: C.isDark ? '#cbd5e1' : '#334155' }]} numberOfLines={1}>
              {perfil?.nombre?.split(' ')[0] || 'Usuario'}
            </Text>
          )}
          {editNombre && Platform.OS === 'web' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <input
                autoFocus
                value={nombreEdit || perfil?.nombre || ''}
                onChange={e => setNombreEdit((e.target as any).value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') guardarNombre();
                  if (e.key === 'Escape') setEditNombre(false);
                }}
                style={{
                  fontSize: 12, fontWeight: '600',
                  color: C.isDark ? '#f1f5f9' : '#0f172a',
                  backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : '#fff',
                  border: `1px solid ${C.isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1'}`,
                  borderRadius: 6,
                  padding: '3px 8px', outline: 'none', width: 90,
                } as any}
              />
              <TouchableOpacity onPress={guardarNombre}
                style={{ backgroundColor: PRI, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                  {guardando ? '...' : '✓'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>

        {/* Cerrar sesión */}
        <TouchableOpacity onPress={signOut} style={n.logoutBtn}>
          <MaterialCommunityIcons name="logout" size={14} color="#fff"/>
          <Text style={n.logoutTxt}>Salir</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════════
   DRAWER MÓVIL — sidebar deslizante
   ══════════════════════════════════════════════════════════════ */
function MobileDrawer({ onClose }: { onClose: () => void }) {
  const { perfil, signOut, isSupervisor } = useAuth();
  const { dark, toggle, palette, setPalette } = useTheme();
  const C = useColors();
  const { empresa } = useEmpresa();
  const pathname = usePathname();
  const isMobileApp = typeof window !== 'undefined' && !!(window as any).Capacitor;

  const allItems = [
    ...NAV_FLAT,
    ...(isSupervisor ? [] : NAV_FLAT.filter(i => !['/administracion','/usuarios'].includes(i.path))),
    ...(isMobileApp ? [{ icon: 'cog-outline', label: 'Configuración', path: '/configuracion' }] : []),
  ].filter((v, i, a) => a.findIndex(x => x.path === v.path) === i);

  const isOn = (path: string) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path);

  const DBG  = dark ? '#0d1526' : '#ffffff';
  const DBRDR = dark ? 'rgba(255,255,255,0.07)' : '#e2e8f0';

  return (
    <View style={[d.drawer, { backgroundColor: DBG,
      borderRightWidth:1, borderRightColor: DBRDR }]}>

      {/* Header del drawer con gradiente */}
      <View style={[d.header, {
        backgroundColor: dark ? '#111c35' : C.primary,
        paddingTop: 48, paddingBottom: 20,
        ...(Platform.OS === 'web'
          ? ({ background: dark
              ? `linear-gradient(135deg, #111c35 0%, #1e1060 100%)`
              : `linear-gradient(135deg, ${C.primary} 0%, #7c3aed 100%)` } as any)
          : {}),
      }]}>
        <View style={{ flex:1 }}>
          <Text style={[d.dTitle, { fontSize:17 }]}>{empresa.nombreCorto || 'CAS Tamanique'}</Text>
          <Text style={d.dSub}>{perfil?.nombre || 'Usuario'}</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={d.closeBtn}>
          <MaterialCommunityIcons name="close" size={20} color="#fff"/>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex:1, backgroundColor: DBG }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingVertical:8 }}>
          {allItems.map(item => {
            const on = isOn(item.path);
            return (
              <Pressable
                key={item.path}
                onPress={() => { router.push(item.path as any); onClose(); }}
                style={[d.item,
                  on
                    ? { backgroundColor: hexToRgba(C.primary, dark ? 0.15 : 0.08) }
                    : null,
                ]}
              >
                <View style={{ width:36, height:36, borderRadius:10,
                  backgroundColor: on
                    ? hexToRgba(C.primary, dark ? 0.25 : 0.12)
                    : dark ? 'rgba(255,255,255,0.05)' : '#f1f5f9',
                  justifyContent:'center', alignItems:'center' }}>
                  <MaterialCommunityIcons name={item.icon as any} size={18}
                    color={on ? C.primary : dark ? '#94a3b8' : '#64748b'}/>
                </View>
                <Text style={[d.itemTxt, {
                  color: on ? C.primary : dark ? '#e2e8f0' : '#334155',
                  fontWeight: on ? '700' : '500',
                }]}>
                  {item.label}
                </Text>
                {on && <View style={{ marginLeft:'auto' as any, width:4, height:4,
                  borderRadius:2, backgroundColor: C.primary }}/>}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[d.footer, { borderTopColor: DBRDR, backgroundColor: DBG }]}>
        {/* Paleta de colores */}
        <View style={{ flexDirection:'row', gap:8, marginBottom:14, alignItems:'center' }}>
          {(Object.keys(PALETTES) as PaletteId[]).map(pid => (
            <TouchableOpacity key={pid} onPress={() => setPalette(pid)}
              style={{
                width: palette === pid ? 22 : 16, height: palette === pid ? 22 : 16,
                borderRadius: 11, backgroundColor: PALETTES[pid].primary,
                borderWidth: palette === pid ? 2.5 : 0,
                borderColor: dark ? '#fff' : '#0f172a',
              }}/>
          ))}
          <TouchableOpacity onPress={toggle}
            style={[d.toggleBtn, { backgroundColor: dark?'rgba(255,255,255,0.08)':'#f1f5f9',
              marginLeft: 'auto' as any }]}>
            <MaterialCommunityIcons
              name={dark ? 'weather-sunny' : 'weather-night'}
              size={16} color={dark ? '#f1c40f' : '#64748b'}/>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={signOut}
          style={[d.logout, { backgroundColor: dark?'rgba(220,38,38,0.15)':'#fef2f2',
            borderWidth:1, borderColor: dark?'rgba(220,38,38,0.30)':'#fecaca' }]}>
          <MaterialCommunityIcons name="logout" size={16} color="#dc2626"/>
          <Text style={{ color:'#dc2626', fontWeight:'700', fontSize:13 }}>Cerrar Sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ══════════════════════════════════════════════════════════════
   APP LAYOUT
   ══════════════════════════════════════════════════════════════ */
export default function AppLayout() {
  const { user, loading, isSupervisor } = useAuth();
  const { palette } = useTheme();
  const C = useColors();
  const pathname   = usePathname();
  const prevPath   = useRef(pathname);
  const [pageVis, setPageVis]   = useState(true);
  const [drawerOpen, setDrawer] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const drawerIsOpen = useRef(false);
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const openDrawer = useCallback(() => {
    if (drawerIsOpen.current) return;
    drawerIsOpen.current = true;
    setDrawer(true);
    setDrawerMounted(true);
    Animated.spring(drawerAnim, {
      toValue: 1, useNativeDriver: true,
      tension: 80, friction: 11,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    if (!drawerIsOpen.current) return;
    drawerIsOpen.current = false;
    setDrawer(false);
    Animated.timing(drawerAnim, {
      toValue: 0, duration: 210, useNativeDriver: true,
    }).start(() => setDrawerMounted(false));
  }, [drawerAnim]);

  // Refs estables para PanResponder (evita stale closure)
  const openDrawerRef  = useRef(openDrawer);
  openDrawerRef.current  = openDrawer;
  const closeDrawerRef = useRef(closeDrawer);
  closeDrawerRef.current = closeDrawer;

  // Swipe derecho para abrir el drawer (desde el borde izquierdo)
  const swipePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !drawerIsOpen.current && g.dx > 15 && Math.abs(g.dy) < Math.abs(g.dx) * 1.5 && g.x0 < 50,
      onPanResponderRelease: (_, g) => { if (g.dx > 40) openDrawerRef.current(); },
      onStartShouldSetPanResponder: () => false,
    })
  ).current;

  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      setPageVis(false);
      const t = setTimeout(() => setPageVis(true), 40);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isMobile && drawerIsOpen.current) closeDrawerRef.current();
  }, [isMobile]);

  if (loading) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
      <ActivityIndicator color={C.primary} size="large"/>
    </View>
  );
  if (!user) return <Redirect href="/(auth)/login"/>;

  const screenOpts = {
    tabBarActiveTintColor:   C.primary,
    tabBarInactiveTintColor: '#94a3b8',
    tabBarStyle: Platform.OS === 'web'
      ? { display: 'none' }
      : { borderTopColor: C.border, backgroundColor: C.surface },
    headerShown:      Platform.OS !== 'web',
    headerStyle:      { backgroundColor: C.primary },
    headerTintColor:  '#fff',
    headerTitleStyle: { fontWeight: '700' as const },
  };

  const tabs = (
    <Tabs screenOptions={screenOpts}>
      <Tabs.Screen name="index"                options={{ title: 'Inicio',    tabBarIcon: ({ color, size }) => <Icon name="home"          color={color} size={size}/> }}/>
      <Tabs.Screen name="cobros/index"         options={{ title: 'Cobros',    tabBarIcon: ({ color, size }) => <Icon name="cash"          color={color} size={size}/> }}/>
      <Tabs.Screen name="clientes/index"       options={{ title: 'Clientes',  tabBarIcon: ({ color, size }) => <Icon name="account-group" color={color} size={size}/> }}/>
      <Tabs.Screen name="prestamos/index"      options={{ title: 'Préstamos', tabBarIcon: ({ color, size }) => <Icon name="bank"          color={color} size={size}/> }}/>
      <Tabs.Screen name="cuadratura/index"     options={{ href: null }}/>
      <Tabs.Screen name="reportes/index"       options={{ title: 'Reportes',  tabBarIcon: ({ color, size }) => <Icon name="file-chart"   color={color} size={size}/> }}/>
      <Tabs.Screen name="reportediario/index"  options={{ href: null }}/>
      <Tabs.Screen name="facturas/index"       options={{ href: null }}/>
      <Tabs.Screen name="dte/index"            options={{ href: null, headerTitle: 'Cola DTE — Hacienda' }}/>
      <Tabs.Screen name="configuracion/dte"    options={{ href: null, headerTitle: 'Configuración DTE' }}/>
      <Tabs.Screen name="imprimir/index"       options={{ href: null }}/>
      {isSupervisor
        ? <Tabs.Screen name="usuarios/index" options={{ title: 'Admin', tabBarIcon: ({ color, size }) => <Icon name="account-cog" color={color} size={size}/> }}/>
        : <Tabs.Screen name="usuarios/index" options={{ href: null }}/>
      }
      <Tabs.Screen name="clientes/nuevo"            options={{ href: null, headerTitle: 'Nuevo Cliente' }}/>
      <Tabs.Screen name="clientes/[id]"             options={{ href: null, headerTitle: 'Detalle Cliente' }}/>
      <Tabs.Screen name="prestamos/nuevo"           options={{ href: null, headerTitle: 'Nuevo Préstamo' }}/>
      <Tabs.Screen name="prestamos/[id]"            options={{ href: null, headerTitle: 'Detalle Préstamo' }}/>
      <Tabs.Screen name="calculadora/index"         options={{ href: null }}/>
      <Tabs.Screen name="contabilidad/index"        options={{ href: null }}/>
      <Tabs.Screen name="libroiva/index"            options={{ href: null, headerTitle: 'Libros de IVA' }}/>
      <Tabs.Screen name="planilla/index"            options={{ href: null, headerTitle: 'Planilla de Sueldos' }}/>
      <Tabs.Screen name="cartera/index"             options={{ href: null, headerTitle: 'Balance de Cartera' }}/>
      <Tabs.Screen name="cuadrocobrador/index"      options={{ href: null, headerTitle: 'Cuadro Cobrador' }}/>
      <Tabs.Screen name="ganancias/index"           options={{ title: 'Ganancias', tabBarIcon: ({ color, size }) => <Icon name="trending-up" color={color} size={size}/> }}/>
      <Tabs.Screen name="administracion/index"      options={{ href: null, headerTitle: 'Administración' }}/>
      <Tabs.Screen name="configuracion/index"       options={{ href: null, headerTitle: 'Configuración' }}/>
    </Tabs>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[l.root, { backgroundColor: C.bg }]}
        {...(isMobile ? swipePan.panHandlers : {})}>
        {/* ── Barra nav desktop ── */}
        {!isMobile && <TopNav/>}

        {/* ── Contenido principal ── */}
        <View style={[l.main, {
          backgroundColor: C.bg,
          opacity: pageVis ? 1 : 0,
          // @ts-ignore
          transition: pageVis ? 'opacity 190ms ease-out' : 'none',
        } as any]}>
          {tabs}
        </View>

        {/* ── Indicador de swipe (borde izquierdo) — solo móvil ── */}
        {isMobile && !drawerOpen && (
          <TouchableOpacity
            onPress={openDrawer}
            style={{
              position: 'absolute' as any, left: 0, top: '40%' as any,
              width: 4, height: 48, borderRadius: 2,
              backgroundColor: hexToRgba(C.primary, 0.45),
              zIndex: 50,
            }}
          />
        )}

        {/* ── Drawer móvil con animación ── */}
        {isMobile && drawerMounted && (() => {
          const drawerTx  = drawerAnim.interpolate({ inputRange: [0,1], outputRange: [-280, 0] });
          const overlayOp = drawerAnim.interpolate({ inputRange: [0,1], outputRange: [0, 0.45] });
          return (
            <>
              <Animated.View
                style={[l.overlay, { opacity: overlayOp }]}
                pointerEvents={drawerOpen ? 'box-none' : 'none'}>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeDrawer}/>
              </Animated.View>
              <Animated.View style={{
                position: 'absolute' as any, top: 0, bottom: 0, left: 0,
                zIndex: 101, transform: [{ translateX: drawerTx }],
              }}>
                <MobileDrawer onClose={closeDrawer}/>
              </Animated.View>
            </>
          );
        })()}
      </View>
    );
  }

  return tabs;
}

function useCurrentLabel(pathname: string) {
  const match = NAV_FLAT.find(n =>
    n.path === '/' ? pathname === '/' : pathname.startsWith(n.path)
  );
  return match?.label ?? 'CAS Tamanique';
}

/* ══════════════════════════════════════════════════════════════
   ESTILOS
   ══════════════════════════════════════════════════════════════ */

/* ── TopNav ── */
const n = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, height: 56,
    borderBottomWidth: 1,
    gap: 8,
    zIndex: 200,
    ...({
      boxShadow: '0 1px 0 #e2e8f0, 0 2px 8px rgba(15,23,42,0.04)',
    } as any),
  },
  // Logo
  logoArea: { flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 12, minWidth: 0 },
  logoMark: {
    width: 34, height: 34, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  logoName:  { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  badge: {
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, alignSelf: 'flex-start', marginTop: 2,
  },
  badgeTxt: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },

  // Grupos nav
  navGroups: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'transparent',
  },
  pillTxt: { fontSize: 13 },

  // Dropdown
  dropdown: {
    position: 'absolute', top: 40, left: 0,
    backgroundColor: '#ffffff',
    borderRadius: 14, padding: 6,
    minWidth: 200, zIndex: 300,
    borderWidth: 1, borderColor: '#e2e8f0',
    ...({
      boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)',
    } as any),
  } as any,
  dropItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: 10,
  },
  dropIcon: {
    width: 28, height: 28, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  dropLabel: { fontSize: 13, flex: 1 },
  dropDot: {
    width: 6, height: 6, borderRadius: 3,
  },

  // Derecha
  right: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' as any },
  paletteRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center', alignItems: 'center',
  },
  userChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#f8fafc', borderRadius: 20, paddingRight: 10,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  userName:  { fontSize: 13, fontWeight: '600', color: '#334155' },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#dc2626', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  logoutTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

/* ── Drawer móvil ── */
const d = StyleSheet.create({
  drawer: {
    position: 'absolute', top: 0, left: 0, bottom: 0,
    width: 280, zIndex: 101, flexDirection: 'column',
    ...({ boxShadow: '4px 0 32px rgba(15,23,42,0.18)' } as any),
  } as any,
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, paddingTop: 24,
  },
  dTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  dSub:   { color: 'rgba(255,255,255,0.70)', fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    marginHorizontal: 8, borderRadius: 10, marginBottom: 2,
  },
  itemTxt: { fontSize: 14 },
  footer: {
    padding: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9',
  },
  toggleBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center', alignItems: 'center',
  },
  logout: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, justifyContent: 'center',
  },
});

/* ── Layout principal ── */
const l = StyleSheet.create({
  root:         { flex: 1, flexDirection: 'column' },
  main:         { flex: 1 },
  mobileTopBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, height: 52,
    ...({ boxShadow: '0 2px 8px rgba(15,23,42,0.12)' } as any),
  },
  mobileTitle: {
    flex: 1, color: '#fff', fontSize: 16, fontWeight: '700',
    textAlign: 'center',
  },
  hamburger: {
    width: 40, height: 40, justifyContent: 'center', alignItems: 'center',
    borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)',
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.45)', zIndex: 100,
  } as any,
});
