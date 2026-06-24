import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
import {
  calcularCuota, calcularTotal, calcularFechaFin,
  calcularVencimiento, formatMoneda, hoy, FRECUENCIAS,
} from '../../../src/utils/calculos';
import { Frecuencia } from '../../../src/types';

/* ── Tasa máxima legal según BCR / Ley de Usura (El Salvador) ── */
const TASA_MAX_BCR = 6.8;

export default function Calculadora() {
  const C  = useColors();
  const s  = useMemo(() => makeStyles(C), [C]);

  /* ── Inputs ── */
  const [monto,      setMonto]     = useState('');
  const [interes,    setInteres]   = useState('');
  const [plazo,      setPlazo]     = useState('');
  const [frecuencia, setFrec]      = useState<Frecuencia>('diario');
  const [fechaInicio,setFechaI]    = useState(hoy());
  const [verTabla,   setVerTabla]  = useState(false);

  /* ── Cálculos ── */
  const montoN   = parseFloat(monto)   || 0;
  const interesN = parseFloat(interes) || 0;
  const plazoN   = parseInt(plazo)     || 0;

  const esLegal      = interesN <= TASA_MAX_BCR;
  const tasaValida   = interesN > 0 && interesN <= TASA_MAX_BCR;
  const puedeCalc    = montoN > 0 && interesN > 0 && plazoN > 0;

  const cuota    = puedeCalc ? calcularCuota(montoN, interesN, plazoN) : 0;
  const total    = puedeCalc ? calcularTotal(montoN, interesN)         : 0;
  const interesTotal = total - montoN;
  const fechaFin = puedeCalc && fechaInicio.length === 10
    ? calcularFechaFin(fechaInicio, plazoN, frecuencia) : '';

  /* ── Tabla de amortización (cuotas planas = todos iguales) ── */
  const filas = useMemo(() => {
    if (!puedeCalc || plazoN > 360) return [];
    return Array.from({ length: plazoN }, (_, i) => {
      const num = i + 1;
      const fv  = calcularVencimiento(fechaInicio, num, frecuencia);
      return { num, fv, cuota };
    });
  }, [puedeCalc, plazoN, fechaInicio, frecuencia, cuota]);

  /* ── Color indicador de tasa ── */
  const tasaColor = interesN === 0
    ? C.textTer
    : esLegal ? C.success : C.danger;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

      {/* Encabezado */}
      <Text variant="titleLarge" style={s.titulo}>Calculadora de Préstamos</Text>

      {/* Aviso legal BCR */}
      <View style={s.avisoLegal}>
        <Text style={s.avisoIcon}>⚖️</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.avisoTit}>Ley de Usura · BCR El Salvador</Text>
          <Text style={s.avisoTxt}>
            La tasa máxima legal permitida es <Text style={s.avisoMax}>{TASA_MAX_BCR}%</Text>.
            Cualquier tasa superior es ilegal según el Banco Central de Reserva.
          </Text>
        </View>
      </View>

      {/* Panel de entradas */}
      <View style={s.panel}>
        <TextInput
          label="Monto del préstamo ($) *"
          value={monto}
          onChangeText={setMonto}
          mode="outlined"
          keyboardType="decimal-pad"
          style={s.input}
          left={<TextInput.Icon icon="currency-usd" />}
        />

        {/* Tasa con indicador legal */}
        <TextInput
          label={`Tasa de interés (%) — máx. ${TASA_MAX_BCR}%`}
          value={interes}
          onChangeText={v => {
            setInteres(v);
          }}
          mode="outlined"
          keyboardType="decimal-pad"
          style={s.input}
          left={<TextInput.Icon icon="percent" />}
          right={
            interesN > 0
              ? <TextInput.Icon
                  icon={esLegal ? 'check-circle' : 'alert-circle'}
                  color={tasaColor}
                />
              : undefined
          }
        />

        {/* Alerta si la tasa supera el máximo */}
        {interesN > TASA_MAX_BCR && (
          <View style={s.alertaTasa}>
            <Text style={s.alertaTxt}>
              ⚠️  {interesN.toFixed(1)}% supera el límite legal de {TASA_MAX_BCR}%.
              {'\n'}Esta tasa es ilegal según la Ley de Usura del BCR.
            </Text>
          </View>
        )}

        <TextInput
          label="Número de cuotas *"
          value={plazo}
          onChangeText={setPlazo}
          mode="outlined"
          keyboardType="numeric"
          style={s.input}
          left={<TextInput.Icon icon="counter" />}
        />

        {/* Frecuencia */}
        <Text style={s.lbl}>Frecuencia de pago</Text>
        <View style={s.frecRow}>
          {FRECUENCIAS.map(f => (
            <TouchableOpacity
              key={f.value}
              style={[s.frecBtn, frecuencia === f.value && s.frecBtnOn]}
              onPress={() => setFrec(f.value)}
            >
              <Text style={[s.frecTxt, frecuencia === f.value && { color: '#fff' }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          label="Fecha de inicio"
          value={fechaInicio}
          onChangeText={setFechaI}
          mode="outlined"
          style={[s.input, { marginBottom: 0 }]}
          placeholder="AAAA-MM-DD"
          left={<TextInput.Icon icon="calendar" />}
        />
      </View>

      {/* Resultado */}
      {puedeCalc && (
        <View style={s.resultado}>
          <Text style={s.resultTit}>Resultado del cálculo</Text>

          <View style={s.resultGrid}>
            <_Item label="Cuota" valor={formatMoneda(cuota)} grande C={C} />
            <_Item label="Total a pagar" valor={formatMoneda(total)} C={C} />
            <_Item label="Interés total" valor={formatMoneda(interesTotal)} C={C} />
            <_Item label="Número de cuotas" valor={`${plazoN}`} C={C} />
            <_Item label="Frecuencia" valor={frecuencia.charAt(0).toUpperCase() + frecuencia.slice(1)} C={C} />
            {fechaFin && <_Item label="Fecha de fin" valor={fechaFin.split('-').reverse().join('/')} C={C} />}
          </View>

          {/* Indicador legal del resultado */}
          <View style={[s.badgeLegal, { backgroundColor: esLegal ? C.success + '22' : C.danger + '22' }]}>
            <Text style={[s.badgeTxt, { color: esLegal ? C.success : C.danger }]}>
              {esLegal
                ? `✅  Tasa ${interesN}% — dentro del límite legal BCR (${TASA_MAX_BCR}%)`
                : `❌  Tasa ${interesN}% — ILEGAL · supera el máximo BCR de ${TASA_MAX_BCR}%`}
            </Text>
          </View>

          {/* Botón tabla amortización */}
          {plazoN <= 360 && (
            <Button
              mode="outlined"
              onPress={() => setVerTabla(v => !v)}
              style={{ marginTop: 12 }}
              icon={verTabla ? 'chevron-up' : 'table'}
            >
              {verTabla ? 'Ocultar tabla' : 'Ver tabla de cuotas'}
            </Button>
          )}
        </View>
      )}

      {/* Tabla de amortización */}
      {verTabla && filas.length > 0 && (
        <View style={s.tabla}>
          <Text style={s.tablaTit}>Tabla de cuotas</Text>

          {/* Encabezado tabla */}
          <View style={[s.tablaFila, s.tablaHead]}>
            <Text style={[s.tablaCel, s.tablaHdTxt, { flex: 0.5 }]}>#</Text>
            <Text style={[s.tablaCel, s.tablaHdTxt, { flex: 1.5 }]}>Fecha</Text>
            <Text style={[s.tablaCel, s.tablaHdTxt, { textAlign: 'right' }]}>Cuota</Text>
          </View>

          {filas.map(f => (
            <View key={f.num} style={[s.tablaFila, f.num % 2 === 0 && s.tablaFilaPar]}>
              <Text style={[s.tablaCel, { flex: 0.5, color: C.textTer, fontSize: 11 }]}>{f.num}</Text>
              <Text style={[s.tablaCel, { flex: 1.5, color: C.textSec, fontSize: 12 }]}>
                {f.fv.split('-').reverse().join('/')}
              </Text>
              <Text style={[s.tablaCel, { textAlign: 'right', color: C.text, fontWeight: '700', fontSize: 12 }]}>
                {formatMoneda(f.cuota)}
              </Text>
            </View>
          ))}

          {/* Totales */}
          <View style={[s.tablaFila, s.tablaTotal]}>
            <Text style={[s.tablaCel, { flex: 0.5 }]}/>
            <Text style={[s.tablaCel, { flex: 1.5, color: C.primaryText, fontWeight: '700', fontSize: 12 }]}>
              TOTAL
            </Text>
            <Text style={[s.tablaCel, { textAlign: 'right', color: C.primaryText, fontWeight: '800', fontSize: 13 }]}>
              {formatMoneda(total)}
            </Text>
          </View>
        </View>
      )}

      {/* Nota sobre cuotas muy largas */}
      {puedeCalc && plazoN > 360 && (
        <View style={s.notaTabla}>
          <Text style={{ color: C.textSec, fontSize: 12 }}>
            ℹ️  La tabla de cuotas no se muestra para préstamos de más de 360 cuotas.
          </Text>
        </View>
      )}

    </ScrollView>
  );
}

/* ── Componente item de resultado ── */
function _Item({ label, valor, grande, C }: { label: string; valor: string; grande?: boolean; C: any }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 11, color: C.textTer, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text style={{ fontSize: grande ? 26 : 16, fontWeight: '800', color: grande ? C.primaryText : C.text, marginTop: 2 }}>
        {valor}
      </Text>
    </View>
  );
}

/* ── Estilos ── */
const makeStyles = (C: any) => StyleSheet.create({
  root: { flex: 1, ...glassBgStyle(C) },
  titulo: { color: C.primaryText, fontWeight: '800', marginBottom: 14 },

  /* Aviso legal */
  avisoLegal: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: C.isDark ? 'rgba(76,175,80,0.12)' : 'rgba(46,125,50,0.08)',
    borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: C.isDark ? 'rgba(76,175,80,0.30)' : 'rgba(46,125,50,0.25)',
  },
  avisoIcon: { fontSize: 22 },
  avisoTit:  { fontSize: 13, fontWeight: '800', color: C.success, marginBottom: 3 },
  avisoTxt:  { fontSize: 12, color: C.textSec, lineHeight: 18 },
  avisoMax:  { fontWeight: '800', color: C.success },

  /* Panel inputs */
  panel: { borderRadius: 16, padding: 14, marginBottom: 14, ...glassStyle(C) },
  input: { marginBottom: 12 },
  lbl:   { fontSize: 12, color: C.textSec, fontWeight: '600', marginBottom: 8 },
  frecRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  frecBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, alignItems: 'center' },
  frecBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  frecTxt: { fontSize: 13, color: C.textSec, fontWeight: '600' },

  /* Alerta tasa */
  alertaTasa: {
    backgroundColor: C.danger + '18',
    borderRadius: 8, padding: 10, marginBottom: 12, marginTop: -4,
    borderWidth: 1, borderColor: C.danger + '44',
  },
  alertaTxt: { fontSize: 12, color: C.danger, lineHeight: 18, fontWeight: '600' },

  /* Resultado */
  resultado: { borderRadius: 16, padding: 16, marginBottom: 14, ...glassStyle(C) },
  resultTit: { fontSize: 12, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14 },
  resultGrid: { gap: 0 },

  /* Badge legal */
  badgeLegal: {
    borderRadius: 8, padding: 10, marginTop: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  badgeTxt: { fontSize: 12, fontWeight: '700', lineHeight: 18 },

  /* Tabla */
  tabla: { borderRadius: 14, padding: 14, marginBottom: 14, ...glassStyle(C) },
  tablaTit: { fontSize: 12, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  tablaFila: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4 },
  tablaHead: { borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 2 },
  tablaFilaPar: { backgroundColor: C.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' },
  tablaTotal: {
    borderTopWidth: 1, borderTopColor: C.border, marginTop: 4, paddingTop: 8,
    backgroundColor: C.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    borderRadius: 6,
  },
  tablaCel: { flex: 1 },
  tablaHdTxt: { fontSize: 11, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.4 },

  /* Nota */
  notaTabla: {
    borderRadius: 10, padding: 12, marginBottom: 14,
    backgroundColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
  },
});
