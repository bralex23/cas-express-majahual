import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Pressable, Platform,
  ActivityIndicator, Image, useWindowDimensions, ScrollView,
} from 'react-native';
import { Text } from 'react-native-paper';
import { Tabs, Redirect, router, usePathname } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme, useColors, glassBgStyle, PALETTES, PaletteId } from '../../src/theme';
import { useEmpresa } from '../../src/context/empresa';

const NAV = [
  { icon:'view-dashboard-outline', label:'Dashboard',        path:'/'            },
  { icon:'account-group-outline',  label:'Clientes',         path:'/clientes'    },
  { icon:'bank-outline',           label:'Préstamos',        path:'/prestamos'   },
  { icon:'cash-multiple',          label:'Cobros del Día',   path:'/cobros'      },
  { icon:'file-chart-outline',     label:'Reportes',         path:'/reportes'    },
  { icon:'chart-bar',              label:'Reporte Diario',   path:'/reportediario'},
  { icon:'receipt',                label:'Facturas',         path:'/facturas'    },
  { icon:'file-percent-outline',   label:'Libros de IVA',    path:'/libroiva'     },
  { icon:'account-cash-outline',   label:'Planilla Sueldos', path:'/planilla'     },
  { icon:'wallet-outline',         label:'Balance Cartera',  path:'/cartera'      },
  { icon:'table-account',          label:'Cuadro Cobrador',  path:'/cuadrocobrador' },
  { icon:'trending-up',            label:'Ganancias',        path:'/ganancias'    },
];
const NAV_ADMIN = [
  { icon:'account-cog-outline',    label:'Usuarios',       path:'/usuarios'   },
];
const NAV_MOBILE = [
  { icon:'cog-outline',            label:'Configuración',  path:'/configuracion' },
];

function Icon({ name, color, size }: { name:any; color:string; size:number }) {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

interface SidebarProps {
  onClose?: () => void;
}

function Sidebar({ onClose }: SidebarProps) {
  const { perfil, signOut, isSupervisor } = useAuth();
  const { dark, toggle, palette, setPalette } = useTheme();
  const { empresa } = useEmpresa();
  const pathname = usePathname();
  const isMobileApp = typeof window !== 'undefined' && !!(window as any).Capacitor;
  const items = [...NAV, ...(isSupervisor ? NAV_ADMIN : []), ...(isMobileApp ? NAV_MOBILE : [])];

  const active = (path: string) =>
    path === '/' ? pathname === '/' : pathname.includes(path.replace('/index',''));

  const pal = PALETTES[palette];
  const sidebarColor = dark
    ? `${pal.bgDark}f2`
    : `${pal.primary}bb`;

  const navigate = (path: string) => {
    router.push(path as any);
    onClose?.();
  };

  return (
    <View style={[s.sidebar, { backgroundColor: sidebarColor, borderRightColor: `${pal.primary}44` } as any]}>
      {/* Logo + botón cerrar (solo en móvil) */}
      <View style={s.logoBox}>
        <Image
          source={require('../../assets/icon-liquid-glass.svg')}
          style={s.logoIcon}
          resizeMode="contain"
        />
        <View style={{flex:1}}>
          <Text style={s.logoTitle} numberOfLines={1}>{empresa.nombreCorto}</Text>
          <Text style={s.logoSub} numberOfLines={1}>{empresa.slogan}</Text>
        </View>
        <View style={{ flexDirection:'row', gap:6 }}>
          <TouchableOpacity onPress={toggle} style={s.toggleBtn}>
            <MaterialCommunityIcons name={dark ? 'weather-sunny' : 'weather-night'} size={18} color="#69f0ae"/>
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={s.toggleBtn}>
              <MaterialCommunityIcons name="close" size={18} color="#d0e4ff"/>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Selector de paleta */}
      <View style={{ flexDirection:'row', gap:7, marginBottom:16, justifyContent:'center' }}>
        {(Object.keys(PALETTES) as PaletteId[]).map(pid => (
          <TouchableOpacity
            key={pid}
            onPress={() => setPalette(pid)}
            style={{
              width: palette === pid ? 22 : 16,
              height: palette === pid ? 22 : 16,
              borderRadius: palette === pid ? 11 : 8,
              backgroundColor: PALETTES[pid].primary,
              borderWidth: palette === pid ? 2.5 : 1,
              borderColor: palette === pid ? '#69f0ae' : 'rgba(255,255,255,0.3)',
              ...({ boxShadow: palette === pid ? `0 0 8px ${PALETTES[pid].primary}` : 'none' } as any),
            }}
          />
        ))}
      </View>

      {/* Usuario */}
      <View style={s.userBox}>
        <View style={s.avatar}>
          <Text style={s.avatarTxt}>{(perfil?.nombre?.[0]||'A').toUpperCase()}</Text>
        </View>
        <View style={{flex:1}}>
          <Text style={s.userName} numberOfLines={1}>{perfil?.nombre||'Usuario'}</Text>
          <Text style={s.userRole}>{(perfil?.rol||'').toUpperCase()}</Text>
        </View>
      </View>

      <View style={s.divider}/>

      {/* Nav */}
      <ScrollView style={{flex:1}} showsVerticalScrollIndicator={false}>
        {items.map(item => {
          const on = active(item.path);
          return (
            <Pressable
              key={item.path}
              style={({ pressed }) => [
                s.navItem,
                on && s.navActive,
                on && { borderColor: `${pal.primary}44` } as any,
                { transform: [{ scale: pressed ? 0.96 : 1 }] } as any,
                // @ts-ignore
                { transition: 'transform 120ms ease, opacity 120ms ease' },
              ]}
              onPress={() => navigate(item.path)}
            >
              <MaterialCommunityIcons name={item.icon as any} size={20} color={on ? '#69f0ae' : '#d0e4ff'}/>
              <Text style={[s.navLabel, on && s.navLabelOn]}>{item.label}</Text>
              {on && <View style={s.navAccent}/>}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Sin botón "Cambiar empresa" — sistema standalone */}

      <TouchableOpacity style={s.logout} onPress={signOut}>
        <MaterialCommunityIcons name="logout" size={17} color="#fff"/>
        <Text style={s.logoutTxt}>Cerrar Sesión</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function AppLayout() {
  const { user, loading, isSupervisor } = useAuth();
  const { palette } = useTheme();
  const C = useColors();
  const pathname   = usePathname();
  const prevPath   = useRef(pathname);
  const [pageVis, setPageVis]     = useState(true);
  const [drawerOpen, setDrawer]   = useState(false);
  const { width } = useWindowDimensions();
  const isMobile = width < 700;

  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      setPageVis(false);
      const t = setTimeout(() => setPageVis(true), 40);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isMobile) setDrawer(false);
  }, [isMobile]);

  if (loading) return (
    <View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:C.bg}}>
      <ActivityIndicator color={C.primary} size="large"/>
    </View>
  );
  if (!user) return <Redirect href="/(auth)/login"/>;

  const screenOpts = {
    tabBarActiveTintColor: C.primary, tabBarInactiveTintColor:'#aaa',
    tabBarStyle: Platform.OS==='web' ? {display:'none'} : {borderTopColor:C.border, backgroundColor:C.surface},
    headerShown: Platform.OS!=='web',
    headerStyle:{backgroundColor: C.primary},
    headerTintColor:'#fff',
    headerTitleStyle:{fontWeight:'700' as const},
  };

  const tabs = (
    <Tabs screenOptions={screenOpts}>
      <Tabs.Screen name="index"           options={{title:'Inicio',    tabBarIcon:({color,size})=><Icon name="home"          color={color} size={size}/>}}/>
      <Tabs.Screen name="cobros/index"    options={{title:'Cobros',    tabBarIcon:({color,size})=><Icon name="cash"          color={color} size={size}/>}}/>
      <Tabs.Screen name="clientes/index"  options={{title:'Clientes',  tabBarIcon:({color,size})=><Icon name="account-group" color={color} size={size}/>}}/>
      <Tabs.Screen name="prestamos/index" options={{title:'Préstamos', tabBarIcon:({color,size})=><Icon name="bank"          color={color} size={size}/>}}/>
      <Tabs.Screen name="cuadratura/index" options={{href:null}}/>
      <Tabs.Screen name="reportes/index"  options={{title:'Reportes',  tabBarIcon:({color,size})=><Icon name="file-chart"   color={color} size={size}/>}}/>
      <Tabs.Screen name="reportediario/index" options={{href:null}}/>
      <Tabs.Screen name="facturas/index"      options={{href:null}}/>
      <Tabs.Screen name="imprimir/index" options={{href:null}}/>
      {isSupervisor
        ? <Tabs.Screen name="usuarios/index" options={{title:'Admin',  tabBarIcon:({color,size})=><Icon name="account-cog" color={color} size={size}/>}}/>
        : <Tabs.Screen name="usuarios/index" options={{href:null}}/>
      }
      <Tabs.Screen name="clientes/nuevo"  options={{href:null, headerTitle:'Nuevo Cliente'}}/>
      <Tabs.Screen name="clientes/[id]"   options={{href:null, headerTitle:'Detalle Cliente'}}/>
      <Tabs.Screen name="prestamos/nuevo" options={{href:null, headerTitle:'Nuevo Préstamo'}}/>
      <Tabs.Screen name="prestamos/[id]"  options={{href:null, headerTitle:'Detalle Préstamo'}}/>
      <Tabs.Screen name="calculadora/index"  options={{href:null}}/>
      <Tabs.Screen name="contabilidad/index" options={{href:null}}/>
      <Tabs.Screen name="libroiva/index" options={{href:null, headerTitle:'Libros de IVA'}}/>
      <Tabs.Screen name="planilla/index" options={{href:null, headerTitle:'Planilla de Sueldos'}}/>
      <Tabs.Screen name="cartera/index"        options={{href:null, headerTitle:'Balance de Cartera'}}/>
      <Tabs.Screen name="cuadrocobrador/index" options={{href:null, headerTitle:'Cuadro Cobrador'}}/>
      <Tabs.Screen name="ganancias/index"    options={{title:'Ganancias',    tabBarIcon:({color,size})=><Icon name="trending-up"           color={color} size={size}/>}}/>
      <Tabs.Screen name="configuracion/index" options={{href:null, headerTitle:'Configuración'}}/>
    </Tabs>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={s.root}>
        {!isMobile && <Sidebar />}
        <View style={[s.main, {
          backgroundColor: C.bg,
          ...glassBgStyle(C.isDark, palette),
          opacity: pageVis ? 1 : 0,
          // @ts-ignore
          transition: pageVis ? 'opacity 190ms ease-out' : 'none',
        } as any]}>
          {isMobile && (
            <View style={[s.topBar, { backgroundColor: PALETTES[palette].primary + 'ee' } as any]}>
              <TouchableOpacity onPress={() => setDrawer(true)} style={s.hamburger}>
                <MaterialCommunityIcons name="menu" size={26} color="#fff"/>
              </TouchableOpacity>
              <Text style={s.topBarTitle} numberOfLines={1}>
                {useCurrentLabel(pathname)}
              </Text>
              <View style={{ width: 44 }}/>
            </View>
          )}
          {tabs}
        </View>
        {isMobile && drawerOpen && (
          <>
            <TouchableOpacity
              style={s.drawerOverlay}
              activeOpacity={1}
              onPress={() => setDrawer(false)}
            />
            <View style={[s.drawer, { backgroundColor: PALETTES[palette].primary + 'f8' } as any]}>
              <Sidebar onClose={() => setDrawer(false)} />
            </View>
          </>
        )}
      </View>
    );
  }
  return tabs;
}

function useCurrentLabel(pathname: string) {
  const all = [...NAV, ...NAV_ADMIN];
  const match = all.find(n =>
    n.path === '/' ? pathname === '/' : pathname.includes(n.path.replace('/index',''))
  );
  return match?.label ?? 'CAS Majahual';
}

const s = StyleSheet.create({
  root:       { flex:1, flexDirection:'row' },
  main:       { flex:1 },
  sidebar:    {
    width: 220,
    backgroundColor: 'rgba(5,18,8,0.96)',
    paddingVertical: 20, paddingHorizontal: 14,
    flexDirection: 'column',
    borderRightWidth: 1,
    borderRightColor: 'rgba(105,240,174,0.18)',
    ...({
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      boxShadow: '4px 0 32px rgba(0,0,0,0.28)',
    } as any),
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    ...({ boxShadow: '0 2px 12px rgba(0,0,0,0.25)' } as any),
  },
  topBarTitle: {
    flex: 1, color: '#fff', fontSize: 17, fontWeight: '700',
    textAlign: 'center', letterSpacing: 0.3,
  },
  hamburger: {
    width: 44, height: 44, justifyContent: 'center', alignItems: 'center',
    borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)',
  },
  drawerOverlay: {
    position: 'absolute', top:0, left:0, right:0, bottom:0,
    backgroundColor: 'rgba(0,0,0,0.52)',
    zIndex: 100,
  },
  drawer: {
    position: 'absolute', top:0, left:0, bottom:0,
    width: 260,
    zIndex: 101,
    ...({
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      boxShadow: '6px 0 40px rgba(0,0,0,0.45)',
    } as any),
  },
  logoBox:    { flexDirection:'row', alignItems:'center', gap:10, marginBottom:24 },
  logoIcon:   { width:42, height:42, borderRadius:10, overflow:'hidden' },
  logoTitle:  { color:'#69f0ae', fontSize:15, fontWeight:'800', letterSpacing:0.4 },
  logoSub:    { color:'rgba(180,200,255,0.55)', fontSize:10, letterSpacing:0.3 },
  toggleBtn:  {
    width:30, height:30, borderRadius:15,
    backgroundColor:'rgba(255,255,255,0.07)',
    justifyContent:'center', alignItems:'center',
    borderWidth:1, borderColor:'rgba(255,255,255,0.1)',
  },
  userBox:    { flexDirection:'row', alignItems:'center', gap:10, marginBottom:16 },
  avatar:     {
    width:36, height:36, borderRadius:18,
    backgroundColor:'#2e7d32',
    justifyContent:'center', alignItems:'center',
    ...({ boxShadow:'0 2px 10px rgba(46,125,50,0.45)' } as any),
  },
  avatarTxt:  { color:'#fff', fontSize:14, fontWeight:'800' },
  userName:   { color:'#ffffff', fontSize:13, fontWeight:'700' },
  userRole:   { color:'rgba(210,230,255,0.80)', fontSize:10, letterSpacing:0.5 },
  divider:    { height:1, backgroundColor:'rgba(255,255,255,0.07)', marginBottom:12 },
  navItem:    {
    flexDirection:'row', alignItems:'center', gap:10,
    paddingVertical:9, paddingHorizontal:10, borderRadius:9, marginBottom:2,
    borderWidth:1, borderColor:'transparent',
  },
  navActive:  {
    backgroundColor:'rgba(255,255,255,0.09)',
    borderColor:'rgba(105,240,174,0.22)',
    ...({ backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)' } as any),
  },
  navLabel:   { color:'rgba(220,235,255,0.92)', fontSize:13, fontWeight:'500' },
  navLabelOn: { color:'#69f0ae', fontWeight:'700' },
  navAccent:  {
    position:'absolute', right:0, top:'20%', bottom:'20%',
    width:3, borderRadius:2,
    backgroundColor:'#69f0ae',
    ...({ boxShadow:'0 0 6px #69f0ae' } as any),
  },
  logout:     {
    flexDirection:'row', alignItems:'center', gap:8,
    backgroundColor:'rgba(198,40,40,0.82)',
    paddingVertical:9, paddingHorizontal:12, borderRadius:9,
    borderWidth:1, borderColor:'rgba(255,120,120,0.2)',
  },
  logoutTxt:  { color:'#fff', fontSize:13, fontWeight:'700' },
});
