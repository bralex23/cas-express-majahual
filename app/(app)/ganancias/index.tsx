import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import {
  collection, collectionGroup, getDocs, getDoc, doc,
  query, where,
} from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
import { formatMoneda, hoy } from '../../../src/utils/calculos';
import { AnimatedNumber } from '../../../src/components/AnimatedNumber';
import { FadeIn, StaggerItem } from '../../../src/components/FadeIn';
import { useFocusEffect } from 'expo-router';

const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun',
                     'Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

interface MesData {
  key:       string;
  label:     string;
  corto:     string;
  intereses: number;
  cobros:    number;
  capital:   number;
  gastos:    number;
  ganancia:  number;
}

function ultimosMeses(n: number): string[] {
  const hoyStr = hoy();
  const resultado: string[] = [];
  let [y, m] = hoyStr.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < n; i++) {
    resultado.unshift(`${y}-${String(m).padStart(2,'0')}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return resultado;
}

export default function Ganancias() {
  const C  = useColors();
  const s  = useMemo(() => makeStyles(C), [C]);
  const { col, empresa } = useEmpresa();

  const [meses,   setMeses]   = useState<MesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const cargar = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const claves      = ultimosMeses(12);
      const fechaInicio = claves[0] + '-01';
      const fechaFin    = claves[claves.length - 1] + '-31';

      // ADAPTACIÓN standalone: col('prestamos') devuelve siempre 'prestamos'
      // porque este proyecto tiene su propia base de datos Firebase.
      const colPrestamos = col('prestamos');
      const prefijo      = colPrestamos + '/';

      /* ── 1. Cargar todos los pagos de la empresa ── */
      const pSnap = await getDocs(collectionGroup(db, 'pagos'));

      const pagosFiltrados = pSnap.docs.filter(d => {
        if (!d.ref.path.startsWith(prefijo)) return false;
        const fecha = d.data().fecha_pago as string;
        return fecha && fecha >= fechaInicio && fecha <= fechaFin;
      });

      /* ── 2. Cargar los prestamos únicos referenciados ── */
      const prestamoIds = new Set<string>();
      pagosFiltrados.forEach(d => {
        const prestamoRef = d.ref.parent.parent;
        if (prestamoRef) prestamoIds.add(prestamoRef.id);
      });

      const prestamosMap: Record<string, any> = {};
      await Promise.all(
        Array.from(prestamoIds).map(async pid => {
          const snap = await getDoc(doc(db, colPrestamos, pid));
          if (snap.exists()) prestamosMap[pid] = snap.data();
        })
      );

      /* ── 3. Calcular interés real por pago ── */
      const interesPorMes: Record<string, number> = {};
      const cobrosXMes:    Record<string, number> = {};
      const capitalXMes:   Record<string, number> = {};

      pagosFiltrados.forEach(d => {
        const data       = d.data();
        const prestamo   = prestamosMap[d.ref.parent.parent?.id ?? ''];
        const mes        = (data.fecha_pago as string).slice(0, 7);
        const montoPagado = data.monto_pagado || 0;
        const mora        = data.mora   || 0;
        const multa       = data.multa  || 0;
        const totalCobrado = montoPagado + mora + multa;

        cobrosXMes[mes] = (cobrosXMes[mes] || 0) + totalCobrado;

        if (!prestamo || !prestamo.monto || !prestamo.plazo) {
          interesPorMes[mes] = (interesPorMes[mes] || 0) + totalCobrado;
          return;
        }

        const capitalPorCuota = prestamo.monto / prestamo.plazo;
        const interesCuota    = Math.max(0, montoPagado - capitalPorCuota);
        const gananciaDelPago = interesCuota + mora + multa;

        interesPorMes[mes] = (interesPorMes[mes] || 0) + gananciaDelPago;
        capitalXMes[mes]   = (capitalXMes[mes]   || 0) + capitalPorCuota;
      });

      /* ── 4. Gastos del mes ── */
      const gSnap = await getDocs(
        query(collection(db, col('gastos')),
          where('fecha', '>=', fechaInicio),
          where('fecha', '<=', fechaFin))
      );
      const gastosPorMes: Record<string, number> = {};
      gSnap.docs.forEach(d => {
        const mes = (d.data().fecha as string).slice(0, 7);
        gastosPorMes[mes] = (gastosPorMes[mes] || 0) + (d.data().monto || 0);
      });

      /* ── 5. Armar tabla ── */
      const resultado: MesData[] = claves.map(key => {
        const [y, m] = key.split('-').map(Number);
        const intereses = interesPorMes[key] || 0;
        const cobros    = cobrosXMes[key]    || 0;
        const capital   = capitalXMes[key]   || 0;
        const gastos    = gastosPorMes[key]  || 0;
        return {
          key,
          label:  `${MESES_LARGO[m - 1]} ${y}`,
          corto:  `${MESES_CORTO[m - 1]} ${String(y).slice(2)}`,
          intereses, cobros, capital, gastos,
          ganancia: intereses - gastos,
        };
      });

      setMeses(resultado);
    } catch (e: any) {
      setError('Error cargando datos: ' + String(e?.message || e));
    }
    setLoading(false);
  }, [col]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const totalIntereses = meses.reduce((s, m) => s + m.intereses, 0);
  const totalGastos    = meses.reduce((s, m) => s + m.gastos,    0);
  const totalGanancia  = totalIntereses - totalGastos;
  const totalCobros    = meses.reduce((s, m) => s + m.cobros,    0);
  const totalCapital   = meses.reduce((s, m) => s + m.capital,   0);

  const maxAbs = Math.max(...meses.map(m => Math.abs(m.ganancia)), 1);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

      <View style={s.header}>
        <View>
          <Text variant="titleLarge" style={s.titulo}>Ganancias Reales</Text>
          <Text style={s.subtitulo}>Últimos 12 meses · {empresa.nombreCorto}</Text>
        </View>
        <Button mode="outlined" icon="refresh" onPress={cargar} disabled={loading} style={{ borderRadius: 8 }}>
          Actualizar
        </Button>
      </View>

      {loading
        ? <ActivityIndicator color={C.primary} style={{ marginTop: 60 }} size="large" />
        : error
          ? <Text style={{ color: C.danger, marginTop: 20 }}>{error}</Text>
          : <>
              <View style={s.resumenRow}>
                <_Card label="Interés cobrado" valor={totalIntereses} color={C.success} C={C} />
                <_Card label="Gastos"          valor={totalGastos}   color={C.danger}  C={C} />
                <_Card
                  label="Ganancia neta"
                  valor={totalGanancia}
                  color={totalGanancia >= 0 ? C.success : C.danger}
                  grande
                  C={C}
                />
              </View>

              <View style={s.refRow}>
                <View style={s.refItem}>
                  <Text style={s.refLbl}>Total cobrado (cuotas + mora + multas)</Text>
                  <Text style={[s.refVal, { color: C.primaryText }]}>{formatMoneda(totalCobros)}</Text>
                </View>
                <View style={s.refSep}/>
                <View style={s.refItem}>
                  <Text style={s.refLbl}>Capital recuperado (no es ganancia)</Text>
                  <Text style={[s.refVal, { color: C.textSec }]}>{formatMoneda(totalCapital)}</Text>
                </View>
              </View>

              <View style={s.panel}>
                <Text style={s.panelTit}>Ganancia neta por mes (interés − gastos)</Text>
                <View style={s.barras}>
                  {meses.map(m => {
                    const pct  = Math.abs(m.ganancia) / maxAbs;
                    const pos  = m.ganancia >= 0;
                    const alto = Math.max(pct * 80, m.ganancia === 0 ? 2 : 4);
                    return (
                      <View key={m.key} style={s.barraCol}>
                        {m.ganancia !== 0 && (
                          <Text style={[s.barraVal, { color: pos ? C.success : C.danger }]} numberOfLines={1}>
                            {m.ganancia > 0 ? '+' : ''}{m.ganancia >= 1000 || m.ganancia <= -1000
                              ? `$${(m.ganancia/1000).toFixed(1)}k`
                              : `$${Math.abs(m.ganancia).toFixed(0)}`}
                          </Text>
                        )}
                        <View style={[s.barra, {
                          height: alto,
                          backgroundColor: pos ? C.success : C.danger,
                          opacity: 0.85,
                        }]} />
                        <Text style={s.barraMes}>{m.corto}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={s.panel}>
                <Text style={s.panelTit}>Detalle mensual</Text>
                <View style={[s.fila, s.filaHead]}>
                  <Text style={[s.cel, s.hdTxt, { flex: 1.4 }]}>Mes</Text>
                  <Text style={[s.cel, s.hdTxt, { textAlign: 'right' }]}>Interés</Text>
                  <Text style={[s.cel, s.hdTxt, { textAlign: 'right' }]}>Gastos</Text>
                  <Text style={[s.cel, s.hdTxt, { textAlign: 'right' }]}>Ganancia</Text>
                </View>
                {[...meses].reverse().map((m, i) => (
                  <StaggerItem key={m.key} index={Math.min(i,10)} step={35} style={[s.fila, i % 2 === 0 && s.filaPar]}>
                    <Text style={[s.cel, { flex: 1.4, color: C.text, fontWeight: '600', fontSize: 13 }]}>
                      {m.label}
                    </Text>
                    <Text style={[s.cel, { textAlign: 'right', color: C.success, fontSize: 13 }]}>
                      {formatMoneda(m.intereses)}
                    </Text>
                    <Text style={[s.cel, { textAlign: 'right', color: C.danger, fontSize: 13 }]}>
                      {formatMoneda(m.gastos)}
                    </Text>
                    <Text style={[s.cel, {
                      textAlign: 'right', fontSize: 13, fontWeight: '800',
                      color: m.ganancia >= 0 ? C.success : C.danger,
                    }]}>
                      {m.ganancia >= 0 ? '+' : ''}{formatMoneda(m.ganancia)}
                    </Text>
                  </StaggerItem>
                ))}
                <View style={[s.fila, s.filaTotal]}>
                  <Text style={[s.cel, { flex: 1.4, color: C.primaryText, fontWeight: '800', fontSize: 13 }]}>
                    TOTAL 12 MESES
                  </Text>
                  <Text style={[s.cel, { textAlign: 'right', color: C.success, fontWeight: '800', fontSize: 13 }]}>
                    {formatMoneda(totalIntereses)}
                  </Text>
                  <Text style={[s.cel, { textAlign: 'right', color: C.danger, fontWeight: '800', fontSize: 13 }]}>
                    {formatMoneda(totalGastos)}
                  </Text>
                  <Text style={[s.cel, {
                    textAlign: 'right', fontWeight: '900', fontSize: 14,
                    color: totalGanancia >= 0 ? C.success : C.danger,
                  }]}>
                    {totalGanancia >= 0 ? '+' : ''}{formatMoneda(totalGanancia)}
                  </Text>
                </View>
              </View>

              <Text style={s.nota}>
                * Interés = porción de interés de cada cuota cobrada + mora + multas.{'\n'}
                * Capital recuperado no se cuenta como ganancia.{'\n'}
                * Ganancia neta = Interés cobrado − Gastos operativos.
              </Text>
            </>
      }
    </ScrollView>
  );
}

function _Card({ label, valor, color, grande, C }: any) {
  return (
    <FadeIn style={{
      flex: 1, borderRadius: 12, padding: 12, alignItems: 'center',
      backgroundColor: color + '18', borderWidth: 1, borderColor: color + '44',
    }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
        {label}
      </Text>
      <AnimatedNumber
        value={valor}
        formatter={(n) => formatMoneda(n)}
        style={{ fontSize: grande ? 20 : 14, fontWeight: '900', color }}
      />
    </FadeIn>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  root:     { flex: 1, ...glassBgStyle(C) },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  titulo:   { color: C.primaryText, fontWeight: '800' },
  subtitulo:{ fontSize: 11, color: C.textSec, marginTop: 2 },
  resumenRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  refRow: {
    flexDirection: 'row', borderRadius: 12, marginBottom: 14,
    backgroundColor: C.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  refItem:  { flex: 1, padding: 10, alignItems: 'center' },
  refSep:   { width: 1, backgroundColor: C.border },
  refLbl:   { fontSize: 10, color: C.textTer, textAlign: 'center', marginBottom: 4, lineHeight: 14 },
  refVal:   { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  panel:    { borderRadius: 14, padding: 14, marginBottom: 14, ...glassStyle(C) },
  panelTit: { fontSize: 11, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  barras:   { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110, paddingBottom: 20 },
  barraCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barra:    { width: '80%', borderRadius: 3, minHeight: 2 },
  barraVal: { fontSize: 8, fontWeight: '700', marginBottom: 2, textAlign: 'center' },
  barraMes: { fontSize: 8, color: C.textTer, marginTop: 3, textAlign: 'center' },
  fila:     { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 4 },
  filaHead: { borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 2 },
  filaPar:  { backgroundColor: C.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderRadius: 4 },
  filaTotal:{ borderTopWidth: 1, borderTopColor: C.border, marginTop: 4, paddingTop: 8,
              backgroundColor: C.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6 },
  cel:      { flex: 1 },
  hdTxt:    { fontSize: 10, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.4 },
  nota:     { fontSize: 11, color: C.textTer, lineHeight: 18, marginBottom: 8 },
});
