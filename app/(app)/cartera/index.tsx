import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, Card, Button, Chip, Searchbar, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle } from '../../../src/theme';
const w = (s: any) => s;
import { calcularMora, formatMoneda, formatFecha, hoy } from '../../../src/utils/calculos';
import { generarPDFCartera, compartir } from '../../../src/utils/pdf';
import { StaggerItem } from '../../../src/components/FadeIn';
import type { Frecuencia } from '../../../src/types';

interface FilaCartera {
  prestamoId:  string;
  clienteId:   string;
  cliente:     string;
  expediente:  string;
  telefono:    string;
  monto:       number;   // monto original prestado
  cuota:       number;
  frecuencia:  string;
  plazo:       number;
  pagadas:     number;
  pendientes:  number;
  montoTotal:  number;
  totalPagado: number;
  saldo:       number;
  mora:        number;
  estado:      string;
  fechaInicio: string;
  fechaFin:    string;
}

const ESTADO_COLOR: Record<string, string> = {
  activo: '#1565c0', mora: '#c62828', completado: '#2e7d32', cancelado: '#666',
};

const FILTROS = [
  { label: 'Todos',    value: 'todos'  },
  { label: 'Activos',  value: 'activo' },
  { label: 'En mora',  value: 'mora'   },
];

export default function BalanceCartera() {
  const { isSupervisor } = useAuth();
  const { col, empresa }  = useEmpresa();
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);
  const hoyStr = hoy();

  const [filas, setFilas]        = useState<FilaCartera[]>([]);
  const [loading, setLoading]    = useState(true);
  const [exportandoXls, setXls]  = useState(false);
  const [exportandoPdf, setPdf]  = useState(false);
  const [filtro, setFiltro]      = useState('todos');
  const [busqueda, setBusqueda]  = useState('');
  const [orden, setOrden]        = useState<'saldo'|'cliente'|'estado'>('saldo');

  /* ── Cargar datos ─────────────────────────────────────────── */
  useFocusEffect(useCallback(() => { cargar(); }, [isSupervisor]));

  async function cargar() {
    setLoading(true);
    try {
      const prestSnap = await getDocs(
        query(collection(db, col('prestamos')), where('estado', 'in', ['activo', 'mora']))
      );
      const prestamos = prestSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const [clienteSnap, pagosArr] = await Promise.all([
        getDocs(collection(db, col('clientes'))),
        Promise.all(prestamos.map(p =>
          getDocs(collection(db, col('prestamos'), p.id, 'pagos'))
        )),
      ]);

      const cMap: Record<string, any> = {};
      clienteSnap.docs.forEach(d => { cMap[d.id] = d.data(); });

      const resultado: FilaCartera[] = prestamos.map((p, i) => {
        const c = cMap[p.cliente_id] || {};
        const pagasSnap  = pagosArr[i];
        const pagadas    = pagasSnap.size;
        let totalPagado  = 0;
        pagasSnap.docs.forEach(d => { totalPagado += (d.data().monto_pagado || 0); });
        const montoTotal = p.monto_total || 0;
        const saldo      = Math.max(0, montoTotal - totalPagado);
        const pendientes = Math.max(0, (p.plazo || 0) - pagadas);
        const mora       = calcularMora(p.fecha_fin, p.cuota, p.frecuencia as Frecuencia, p.plazo);

        return {
          prestamoId: p.id,
          clienteId:  p.cliente_id,
          cliente:    c.nombre   || '—',
          expediente: c.numero_expediente || '',
          telefono:   c.telefono || '',
          monto:      p.monto    || 0,
          cuota:      p.cuota    || 0,
          frecuencia: p.frecuencia || '',
          plazo:      p.plazo    || 0,
          pagadas,
          pendientes,
          montoTotal,
          totalPagado,
          saldo,
          mora,
          estado:     p.estado   || 'activo',
          fechaInicio: p.fecha_inicio || '',
          fechaFin:    p.fecha_fin    || '',
        };
      });

      setFilas(resultado);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la cartera');
    }
    setLoading(false);
  }

  /* ── Filtrar + ordenar ────────────────────────────────────── */
  const visibles = useMemo(() => {
    let res = [...filas];
    if (filtro !== 'todos') res = res.filter(f => f.estado === filtro);
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase();
      res = res.filter(f =>
        f.cliente.toLowerCase().includes(q) ||
        f.expediente.toLowerCase().includes(q) ||
        f.telefono.includes(q)
      );
    }
    res.sort((a, b) => {
      if (orden === 'saldo')   return b.saldo - a.saldo;
      if (orden === 'cliente') return a.cliente.localeCompare(b.cliente);
      return a.estado.localeCompare(b.estado);
    });
    return res;
  }, [filas, filtro, busqueda, orden]);

  /* ── Resumen ──────────────────────────────────────────────── */
  const resumen = useMemo(() => {
    const activos = filas.filter(f => f.estado === 'activo');
    const mora    = filas.filter(f => f.estado === 'mora');
    return {
      totalCartera: filas.reduce((s, f) => s + f.saldo, 0),
      cantActivos:  activos.length,
      saldoActivos: activos.reduce((s, f) => s + f.saldo, 0),
      cantMora:     mora.length,
      saldoMora:    mora.reduce((s, f) => s + f.saldo, 0),
      totalClientes: new Set(filas.map(f => f.clienteId)).size,
    };
  }, [filas]);

  /* ── Exportar PDF ─────────────────────────────────────────── */
  async function exportarPDF() {
    if (visibles.length === 0) return;
    setPdf(true);
    try {
      const items = visibles.map(f => ({
        cliente:    f.cliente,
        expediente: f.expediente,
        monto:      f.monto,
        cuota:      f.cuota,
        frecuencia: f.frecuencia,
        plazo:      f.plazo,
        pagadas:    f.pagadas,
        saldo:      f.saldo,
        mora:       f.mora,
        estado:     f.estado,
        fechaInicio: f.fechaInicio,
      }));
      const uri = await generarPDFCartera(items as any, hoyStr);
      await compartir(uri);
    } catch (e: any) {
      Alert.alert('Error PDF', e?.message || String(e));
    }
    setPdf(false);
  }

  /* ── Exportar Excel ───────────────────────────────────────── */
  async function exportarExcel() {
    if (visibles.length === 0) return;
    const api = (window as any).electronAPI;
    if (!api || typeof api.generateCartera !== 'function') {
      Alert.alert(
        'Reiniciar requerido',
        'Cierra y vuelve a abrir CAS Express para habilitar la exportación a Excel.'
      );
      return;
    }
    setXls(true);
    try {
      const fecha = new Date().toLocaleDateString('es-SV');
      const datos = {
        fecha,
        empresaNombre: empresa.nombre || empresa.nombreCorto,
        filas: visibles.map((f, i) => ({
          num:         i + 1,
          cliente:     f.cliente,
          expediente:  f.expediente,
          telefono:    f.telefono,
          montoTotal:  f.montoTotal,
          cuota:       f.cuota,
          frecuencia:  f.frecuencia,
          plazo:       f.plazo,
          pagadas:     f.pagadas,
          pendientes:  f.pendientes,
          totalPagado: f.totalPagado,
          saldo:       f.saldo,
          mora:        f.mora,
          estado:      f.estado,
          fechaFin:    f.fechaFin,
        })),
        resumen,
      };
      const result = await api.generateCartera(datos);
      if (result && !result.saved && result.error) {
        Alert.alert('Error Excel', result.error);
      }
    } catch (e: any) {
      Alert.alert('Error Excel', e?.message || String(e));
    }
    setXls(false);
  }

  /* ── UI ───────────────────────────────────────────────────── */
  if (loading) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={{ color: C.text, marginTop: 12 }}>Cargando cartera...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* ── Tarjetas resumen ─────────────────────────────────── */}
      <View style={s.row3}>
        <SummaryCard icon="bank-outline"          color="#0a2463"
          label="TOTAL CARTERA"   value={formatMoneda(resumen.totalCartera)}
          sub={`${filas.length} préstamos · ${resumen.totalClientes} clientes`} C={C} />
        <SummaryCard icon="check-circle-outline"  color="#1565c0"
          label="ACTIVOS"         value={formatMoneda(resumen.saldoActivos)}
          sub={`${resumen.cantActivos} préstamo${resumen.cantActivos !== 1 ? 's' : ''}`} C={C} />
        <SummaryCard icon="alert-circle-outline"  color="#c62828"
          label="EN MORA"         value={formatMoneda(resumen.saldoMora)}
          sub={`${resumen.cantMora} préstamo${resumen.cantMora !== 1 ? 's' : ''}`} C={C} />
      </View>

      {/* ── Filtros y búsqueda ───────────────────────────────── */}
      <Card style={[s.toolbar, glassStyle(C.isDark)]}>
        <Card.Content style={{ gap: 10 }}>
          <Searchbar
            placeholder="Buscar cliente, expediente, teléfono..."
            value={busqueda} onChangeText={setBusqueda}
            style={{ backgroundColor: C.surface, height: 42 }}
            inputStyle={{ color: C.text, fontSize: 13 }}
            iconColor={C.text}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {FILTROS.map(f => (
              <Chip key={f.value} selected={filtro === f.value}
                onPress={() => setFiltro(f.value)}
                style={{ backgroundColor: filtro === f.value ? C.primary + '22' : C.surface }}
                textStyle={{ color: C.text, fontSize: 11 }}>
                {f.label}
              </Chip>
            ))}
            <View style={{ flex: 1 }} />
            {(['saldo','cliente','estado'] as const).map(o => (
              <Chip key={o} selected={orden === o} onPress={() => setOrden(o)}
                style={{ backgroundColor: orden === o ? C.primary + '33' : C.surface }}
                textStyle={{ color: C.text, fontSize: 10 }}>
                {o === 'saldo' ? 'Saldo ↓' : o === 'cliente' ? 'A-Z' : 'Estado'}
              </Chip>
            ))}
          </View>

          {/* Botones de exportación */}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button mode="outlined" compact icon="refresh" onPress={cargar}
              style={{ borderColor: C.primary + '66', borderRadius: 8 }} textColor={C.primary}>
              Actualizar
            </Button>
            <Button mode="contained" compact icon="file-pdf-box" onPress={exportarPDF}
              loading={exportandoPdf} disabled={exportandoPdf || visibles.length === 0}
              style={{ backgroundColor: '#c62828', borderRadius: 8 }}>
              PDF
            </Button>
            <Button mode="contained" compact icon="microsoft-excel" onPress={exportarExcel}
              loading={exportandoXls} disabled={exportandoXls || visibles.length === 0}
              style={{ backgroundColor: '#1b7c3a', borderRadius: 8 }}>
              Excel
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* ── Tabla ────────────────────────────────────────────── */}
      <Card style={[s.tableCard, glassStyle(C.isDark)]}>
        <View style={s.thead}>
          <Text style={[s.th, { flex: 3 }]}>CLIENTE</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: 'right' }]}>CUOTA</Text>
          <Text style={[s.th, { flex: 1, textAlign: 'center' }]}>CUOTAS</Text>
          <Text style={[s.th, { flex: 1.5, textAlign: 'right' }]}>SALDO</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: 'center' }]}>ESTADO</Text>
        </View>

        {visibles.length === 0 ? (
          <View style={s.empty}>
            <MaterialCommunityIcons name="bank-off" size={36} color={C.textSub} />
            <Text style={{ color: C.textSub, marginTop: 8 }}>Sin resultados</Text>
          </View>
        ) : (
          visibles.map((f, idx) => (
            <StaggerItem key={f.prestamoId} index={idx}>
              <View style={[s.trow, idx % 2 === 0 ? s.trowEven : s.trowOdd]}>
                {/* Cliente */}
                <View style={{ flex: 3 }}>
                  <Text style={[s.clienteNombre, { color: C.text }]} numberOfLines={1}>
                    {f.cliente}
                  </Text>
                  {(f.expediente || f.telefono) ? (
                    <Text style={[s.clienteSub, { color: C.textSub }]}>
                      {[f.expediente, f.telefono].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  <Text style={[s.clienteSub, { color: C.textSub }]}>
                    Vence: {formatFecha(f.fechaFin)}
                    {f.mora > 0 ? ` · Mora: ${formatMoneda(f.mora)}` : ''}
                  </Text>
                </View>

                {/* Cuota */}
                <Text style={[s.tdR, { flex: 1.2, color: C.text }]}>
                  {formatMoneda(f.cuota)}
                </Text>

                {/* Pagadas / Pendientes */}
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[s.tdC, { color: C.text }]}>{f.pagadas}/{f.plazo}</Text>
                  <Text style={[s.tdCSub, { color: f.pendientes > 0 ? '#c62828' : '#2e7d32' }]}>
                    {f.pendientes > 0 ? `−${f.pendientes}` : '✓'}
                  </Text>
                </View>

                {/* Saldo */}
                <Text style={[s.tdR, {
                  flex: 1.5,
                  color: f.saldo > 0 ? '#c62828' : '#2e7d32',
                  fontWeight: '700',
                }]}>
                  {formatMoneda(f.saldo)}
                </Text>

                {/* Estado */}
                <View style={{ flex: 1.2, alignItems: 'center' }}>
                  <View style={[s.badge, { backgroundColor: ESTADO_COLOR[f.estado] + '22' }]}>
                    <Text style={[s.badgeTxt, { color: ESTADO_COLOR[f.estado] }]}>
                      {f.estado.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>
            </StaggerItem>
          ))
        )}

        {/* Fila de totales */}
        {visibles.length > 0 && (
          <View style={[s.trow, s.totalRow]}>
            <Text style={[s.totalLabel, { flex: 3, color: C.text }]}>
              TOTAL ({visibles.length} préstamos)
            </Text>
            <View style={{ flex: 1.2 }} />
            <View style={{ flex: 1 }} />
            <Text style={[s.tdR, { flex: 1.5, color: '#c62828', fontWeight: '800', fontSize: 13 }]}>
              {formatMoneda(visibles.reduce((s, f) => s + f.saldo, 0))}
            </Text>
            <View style={{ flex: 1.2 }} />
          </View>
        )}
      </Card>

    </ScrollView>
  );
}

/* ── Card de resumen ─────────────────────────────────────────── */
function SummaryCard({ icon, color, label, value, sub, C }: any) {
  return (
    <Card style={[{ flex: 1, minWidth: 150 }, glassStyle(C.isDark)]}>
      <Card.Content style={{ alignItems: 'center', paddingVertical: 12 }}>
        <MaterialCommunityIcons name={icon} size={28} color={color} />
        <Text style={{ fontSize: 9, color: C.textSub, fontWeight: '700', marginTop: 4, letterSpacing: 0.5 }}>
          {label}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color, marginTop: 2 }}>
          {value}
        </Text>
        <Text style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{sub}</Text>
      </Card.Content>
    </Card>
  );
}

/* ── Estilos ─────────────────────────────────────────────────── */
function makeStyles(C: any) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: C.bg },
    content: { padding: 14, gap: 12, paddingBottom: 32 },
    row3:    { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    toolbar: { borderRadius: 12 },
    tableCard: { borderRadius: 12, overflow: 'hidden' },

    thead: {
      flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: C.primary + '22',
      borderBottomWidth: 1, borderBottomColor: C.border,
    },
    th: { fontSize: 10, fontWeight: '700', color: C.textSub, letterSpacing: 0.4 },

    trow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border + '44' },
    trowEven: { backgroundColor: 'transparent' },
    trowOdd:  { backgroundColor: C.surface + '80' },
    totalRow: { backgroundColor: C.primary + '11', borderTopWidth: 2, borderTopColor: C.primary + '44' },

    clienteNombre: { fontSize: 12, fontWeight: '600' },
    clienteSub:    { fontSize: 10, marginTop: 1 },
    tdR:     { textAlign: 'right',  fontSize: 12 },
    tdC:     { textAlign: 'center', fontSize: 12 },
    tdCSub:  { textAlign: 'center', fontSize: 10 },
    totalLabel: { fontSize: 11, fontWeight: '700' },

    badge:    { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
    badgeTxt: { fontSize: 9, fontWeight: '700' },

    empty: { alignItems: 'center', padding: 40 },
  });
}
