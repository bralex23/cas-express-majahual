/**
 * Cuadratura Digital Diaria
 * 50 celdas numeradas — guarda por fecha en Firestore
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, ScrollView, StyleSheet, TextInput as RNInput,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { useAuth } from '../../../src/hooks/useAuth';
import { hoy, formatMoneda } from '../../../src/utils/calculos';
import { FadeIn } from '../../../src/components/FadeIn';
import { generarPDFCuadraturaDiaria, compartir, SlotCuadratura } from '../../../src/utils/pdf';

const TOTAL_SLOTS = 50;
const COLS        = 2;
const FILAS       = TOTAL_SLOTS / COLS;

interface DiaData {
  slots:       string[];
  refinanciar: string;
  deposito:    string;
  semanal:     string;
  nota:        string;
}

function dataNueva(): DiaData {
  return { slots: Array(TOTAL_SLOTS).fill(''), refinanciar:'', deposito:'', semanal:'', nota:'' };
}

// ID único por usuario+fecha
const docId = (uid: string, fecha: string) => `${uid}_${fecha}`;

// migración se hace dentro del componente con db ya importado

export default function CuadraturaDigital() {
  const C = useColors();
  const { perfil } = useAuth();
  const s = useMemo(() => makeStyles(C), [C]);

  const hoyStr = hoy();
  const [fecha,      setFecha]      = useState(hoyStr);
  const [data,       setData]       = useState<DiaData>(dataNueva());
  const [cargando,        setCargando]        = useState(true);
  const [guardando,       setGuardando]       = useState(false);
  const [guardadoOk,      setGuardadoOk]      = useState(false);
  const [pdfLoad,         setPdfLoad]         = useState(false);
  const [migracionLista,  setMigracionLista]  = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Migración localStorage → Firestore (fondo, no bloquea) ──
  useEffect(() => {
    if (!perfil?.id || typeof window === 'undefined') return;
    const uid = perfil.id;
    const DONE_KEY = `cuadratura-migrado-fs-${uid}`;
    if (localStorage.getItem(DONE_KEY)) return;
    // Corre en el fondo sin bloquear la UI
    setTimeout(async () => {
      try {
        const prefijos = ['cuadratura-v2-', 'cuadratura-v3-'];
        for (const prefijo of prefijos) {
          const claves = Object.keys(localStorage).filter(k => k.startsWith(prefijo));
          for (const clave of claves) {
            const fecha = clave.replace(prefijo, '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
            try {
              const raw = localStorage.getItem(clave);
              if (!raw) continue;
              const parsed = JSON.parse(raw) as DiaData;
              parsed.slots = Array(TOTAL_SLOTS).fill('').map((_, i) => parsed.slots?.[i] ?? '');
              const tieneData = parsed.slots.some(v => v !== '') ||
                parsed.refinanciar || parsed.deposito || parsed.semanal || parsed.nota;
              if (!tieneData) continue;
              await setDoc(doc(db, 'cuadratura', docId(uid, fecha)), parsed);
            } catch (_) {}
          }
        }
        localStorage.setItem(DONE_KEY, '1');
        console.log('✅ Migración cuadratura completa');
      } catch (_) {}
    }, 2000); // espera 2s para que cargue primero la UI
  }, [perfil?.id]);

  // ── Cargar desde Firestore (espera migración) ────────────
  useEffect(() => {
    if (!perfil?.id || !migracionLista) return;
    setCargando(true);
    setGuardadoOk(false);
    getDoc(doc(db, 'cuadratura', docId(perfil.id, fecha))).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as DiaData;
        d.slots = Array(TOTAL_SLOTS).fill('').map((_, i) => d.slots?.[i] ?? '');
        setData(d);
      } else {
        setData(dataNueva());
      }
      setCargando(false);
    }).catch(e => {
      console.error('Error cargando cuadratura:', e);
      setData(dataNueva());
      setCargando(false);
    });
  }, [fecha, perfil?.id]);

  // ── Auto-guardar (debounce 1s) ───────────────────────────
  const autoGuardar = useCallback((d: DiaData) => {
    if (!perfil?.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, 'cuadratura', docId(perfil.id!, fecha)), d);
      } catch (e) { console.error('Auto-save error:', e); }
    }, 1000);
  }, [fecha, perfil?.id]);

  // ── Guardar manual ───────────────────────────────────────
  async function guardarAhora() {
    if (!perfil?.id) return;
    setGuardando(true);
    try {
      await setDoc(doc(db, 'cuadratura', docId(perfil.id, fecha)), data);
      setGuardadoOk(true);
      setTimeout(() => setGuardadoOk(false), 2500);
    } catch (e) { console.error('Guardar error:', e); }
    setGuardando(false);
  }

  // ── Setters ──────────────────────────────────────────────
  function setSlot(idx: number, val: string) {
    const v = val.replace(/[^0-9.]/g, '');
    setData(prev => {
      const slots = [...prev.slots];
      slots[idx] = v;
      const next = { ...prev, slots };
      autoGuardar(next);
      return next;
    });
  }
  function setField(campo: keyof Omit<DiaData,'slots'>, val: string) {
    setData(prev => {
      const next = { ...prev, [campo]: campo === 'nota' ? val : val.replace(/[^0-9.]/g,'') };
      autoGuardar(next);
      return next;
    });
  }

  // ── Navegación de fecha ──────────────────────────────────
  async function cambiarDia(delta: number) {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (perfil?.id) {
      try { await setDoc(doc(db, 'cuadratura', docId(perfil.id, fecha)), data); } catch (_) {}
    }
    const [y, m, d] = fecha.split('-').map(Number);
    const date = new Date(y, m - 1, d + delta);
    const n = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    if (n <= hoyStr) setFecha(n);
  }

  // ── Totales ──────────────────────────────────────────────
  const totalSlots   = useMemo(() => data.slots.reduce((a,v) => a + (parseFloat(v)||0), 0), [data.slots]);
  const refinanciar  = parseFloat(data.refinanciar) || 0;
  const deposito     = parseFloat(data.deposito)    || 0;
  const semanal      = parseFloat(data.semanal)     || 0;
  const totalCobro   = totalSlots + refinanciar;
  const celdasUsadas = data.slots.filter(v => v !== '').length;

  // ── PDF ──────────────────────────────────────────────────
  async function generarPDF() {
    setPdfLoad(true);
    try {
      const slots: SlotCuadratura[] = data.slots.map((m, i) => ({
        numero: i + 1, cliente: '', monto: m ? parseFloat(m) : null,
      }));
      const uri = await generarPDFCuadraturaDiaria(
        fecha, slots, perfil?.nombre||'', perfil?.ruta?.nombre||'', ''
      );
      await compartir(uri);
    } catch(e) { console.error(e); }
    setPdfLoad(false);
  }

  async function limpiarDia() {
    const vacio = dataNueva();
    setData(vacio);
    if (perfil?.id) {
      try { await setDoc(doc(db, 'cuadratura', docId(perfil.id, fecha)), vacio); } catch (_) {}
    }
  }

  if (cargando) return (
    <View style={[s.center, {backgroundColor: C.bg}]}>
      <ActivityIndicator color={C.primaryText} size="large"/>
      <Text style={{color:C.textSec,marginTop:8}}>Cargando...</Text>
    </View>
  );

  return (
    <FadeIn delay={0} duration={250} dy={6} style={{flex:1}}>
    <ScrollView style={{flex:1, backgroundColor: C.bg, ...w(glassBgStyle(C))}} contentContainerStyle={{padding:14}}>

      {/* ── ENCABEZADO ──────────────────────────────────── */}
      <Card style={s.card} elevation={0}>
        <Card.Content>
          <View style={s.tituloRow}>
            <MaterialCommunityIcons name="grid" size={22} color={C.primaryText}/>
            <Text style={[s.titulo,{color:C.primaryText}]}>Cuadratura Diaria</Text>
            {guardadoOk && (
              <View style={[s.okBadge,{backgroundColor:C.success+'22'}]}>
                <MaterialCommunityIcons name="check-circle" size={14} color={C.success}/>
                <Text style={{color:C.success,fontSize:11,fontWeight:'700'}}>Guardado</Text>
              </View>
            )}
          </View>

          <View style={s.fechaRow}>
            <TouchableOpacity style={[s.flechaBtn,{borderColor:C.border,backgroundColor:C.surfaceAlt}]}
              onPress={()=>cambiarDia(-1)}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={C.primaryText}/>
            </TouchableOpacity>
            <View style={[s.fechaBox,{backgroundColor:C.surfaceCard,borderColor:C.border}]}>
              <MaterialCommunityIcons name="calendar-month" size={17} color={C.primaryText}/>
              <Text style={[s.fechaTxt,{color:C.primaryText}]}>{fecha}</Text>
              {fecha === hoyStr && (
                <View style={[s.hoyBadge,{backgroundColor:C.primaryText+'22'}]}>
                  <Text style={{color:C.primaryText,fontSize:10,fontWeight:'800'}}>HOY</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[s.flechaBtn,{borderColor:C.border,backgroundColor:C.surfaceAlt,opacity:fecha>=hoyStr?0.3:1}]}
              onPress={()=>cambiarDia(1)} disabled={fecha>=hoyStr}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={C.primaryText}/>
            </TouchableOpacity>
          </View>

          <View style={s.chipRow}>
            <InfoChip icon="account" label={perfil?.nombre||'—'} C={C}/>
            <InfoChip icon="map-marker-radius" label={perfil?.ruta?.nombre||'Sin ruta'} C={C}/>
            <InfoChip icon="checkbox-marked-outline"
              label={`${celdasUsadas} / ${TOTAL_SLOTS}`} C={C}
              color={celdasUsadas > 0 ? C.success : C.textTer}/>
          </View>
        </Card.Content>
      </Card>

      {/* ── GRID 2 COLUMNAS ─────────────────────────────── */}
      <Card style={s.card} elevation={0}>
        <Card.Content style={{padding:8}}>
          <View style={s.grid}>
            {[0, FILAS].map(offset => (
              <View key={offset} style={s.col}>
                <View style={[s.colHeader,{backgroundColor:C.primary}]}>
                  <Text style={s.colHeaderTxt}>{offset + 1} — {offset + FILAS}</Text>
                </View>
                {Array.from({length: FILAS}, (_, i) => {
                  const idx   = offset + i;
                  const val   = data.slots[idx];
                  const llena = val !== '';
                  return (
                    <View key={idx} style={[
                      s.celda,
                      {borderColor: llena ? C.success+'66' : C.borderLight},
                      llena && {backgroundColor: C.isDark ? '#0d2a12' : '#f0fdf4'},
                    ]}>
                      <View style={[s.numBadge,{backgroundColor: llena ? C.success : C.surfaceCard}]}>
                        <Text style={[s.numTxt,{color: llena ? '#fff' : C.textTer}]}>{idx + 1}</Text>
                      </View>
                      <RNInput
                        value={val}
                        onChangeText={v => setSlot(idx, v)}
                        keyboardType="decimal-pad"
                        style={[s.slotInput,{color: llena ? C.text : C.textMuted}]}
                        placeholder="—"
                        placeholderTextColor={C.textMuted}
                        selectTextOnFocus
                      />
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </Card.Content>
      </Card>

      {/* ── TOTALES ─────────────────────────────────────── */}
      <Card style={s.card} elevation={0}>
        <Card.Content>
          <View style={[s.totalBig,{
            backgroundColor: C.isDark ? '#0d2a12' : '#f0fdf4',
            borderColor: C.success+'44', borderWidth:1,
          }]}>
            <Text style={[s.totalBigLabel,{color:C.textSec}]}>Total Efectivo</Text>
            <Text style={[s.totalBigValor,{color:C.success}]}>{formatMoneda(totalSlots)}</Text>
          </View>

          <View style={s.camposRow}>
            <CampoInput label="Refinanciar $" value={data.refinanciar}
              onChange={v=>setField('refinanciar',v)} C={C} s={s}/>
            <CampoInput label="Depósito $" value={data.deposito}
              onChange={v=>setField('deposito',v)} C={C} s={s}/>
            <CampoInput label="Semanal $" value={data.semanal}
              onChange={v=>setField('semanal',v)} C={C} s={s}/>
          </View>

          <View style={[s.totalBig,{
            backgroundColor: C.isDark ? '#071a2e' : '#eff6ff',
            borderColor: C.primaryText+'44', borderWidth:1, marginTop:10,
          }]}>
            <Text style={[s.totalBigLabel,{color:C.primaryText,fontWeight:'900'}]}>TOTAL COBRO</Text>
            <Text style={[s.totalBigValor,{color:C.primaryText,fontSize:30}]}>{formatMoneda(totalCobro)}</Text>
          </View>

          {(deposito > 0 || semanal > 0) && (
            <View style={{flexDirection:'row',gap:16,marginTop:8,justifyContent:'flex-end'}}>
              {deposito > 0 && <Text style={{color:C.textTer,fontSize:12}}>Depósito: {formatMoneda(deposito)}</Text>}
              {semanal  > 0 && <Text style={{color:C.textTer,fontSize:12}}>Semanal: {formatMoneda(semanal)}</Text>}
            </View>
          )}

          <Text style={[s.campoLabel,{color:C.textSec,marginTop:14}]}>Nota</Text>
          <RNInput
            value={data.nota} onChangeText={v=>setField('nota',v)}
            style={[s.campoInput,{color:C.text,borderColor:C.border,backgroundColor:C.surfaceAlt,height:58}]}
            placeholder="Observaciones del día..." placeholderTextColor={C.textMuted} multiline/>
        </Card.Content>
      </Card>

      {/* ── BOTONES ─────────────────────────────────────── */}
      <View style={s.botonesRow}>
        <Button mode="outlined" icon="delete-outline" onPress={limpiarDia}
          textColor={C.danger} style={{borderColor:C.danger,flex:1}}>
          Limpiar
        </Button>
        <Button mode="contained" icon="content-save" onPress={guardarAhora}
          loading={guardando} disabled={guardando}
          style={{backgroundColor:C.success,flex:2}}>
          Guardar
        </Button>
        <Button mode="contained" icon="file-pdf-box" onPress={generarPDF}
          loading={pdfLoad} disabled={pdfLoad}
          style={{backgroundColor:C.primary,flex:2}}>
          PDF
        </Button>
      </View>
      <View style={{height:28}}/>
    </ScrollView>
    </FadeIn>
  );
}

function InfoChip({ icon, label, C, color }: any) {
  return (
    <View style={{flexDirection:'row',alignItems:'center',gap:4,
      backgroundColor:C.surfaceCard,borderRadius:20,paddingHorizontal:10,paddingVertical:4}}>
      <MaterialCommunityIcons name={icon} size={13} color={color||C.textSec}/>
      <Text style={{fontSize:12,color:color||C.textSec,fontWeight:'600'}}>{label}</Text>
    </View>
  );
}

function CampoInput({ label, value, onChange, C, s }: any) {
  return (
    <View style={s.campoBox}>
      <Text style={[s.campoLabel,{color:C.textSec}]}>{label}</Text>
      <RNInput value={value} onChangeText={onChange} keyboardType="decimal-pad"
        style={[s.campoInput,{color:C.text,borderColor:C.border,backgroundColor:C.surfaceAlt}]}
        placeholder="0.00" placeholderTextColor={C.textMuted}/>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  center:       {flex:1,justifyContent:'center',alignItems:'center'},
  card:         {marginBottom:12, borderRadius:14, ...glassStyle(C)},
  tituloRow:    {flexDirection:'row',alignItems:'center',gap:8,marginBottom:12},
  titulo:       {fontSize:18,fontWeight:'900',flex:1},
  okBadge:      {flexDirection:'row',alignItems:'center',gap:4,borderRadius:20,paddingHorizontal:8,paddingVertical:3},
  fechaRow:     {flexDirection:'row',alignItems:'center',gap:8,marginBottom:12},
  flechaBtn:    {width:42,height:42,borderRadius:10,borderWidth:1,justifyContent:'center',alignItems:'center'},
  fechaBox:     {flex:1,flexDirection:'row',alignItems:'center',gap:8,borderWidth:1,borderRadius:10,paddingHorizontal:12,paddingVertical:9},
  fechaTxt:     {fontSize:15,fontWeight:'800',flex:1},
  hoyBadge:     {borderRadius:12,paddingHorizontal:8,paddingVertical:2},
  chipRow:      {flexDirection:'row',flexWrap:'wrap',gap:8},
  grid:         {flexDirection:'row',gap:10},
  col:          {flex:1,gap:0},
  colHeader:    {borderRadius:8,paddingVertical:7,alignItems:'center',marginBottom:6},
  colHeaderTxt: {color:'#fff',fontWeight:'900',fontSize:13,letterSpacing:0.5},
  celda:        {flexDirection:'row',alignItems:'center',borderWidth:1,borderRadius:8,marginBottom:5,paddingRight:10,paddingVertical:0,overflow:'hidden',height:46},
  numBadge:     {width:36,height:46,justifyContent:'center',alignItems:'center',borderTopLeftRadius:7,borderBottomLeftRadius:7,marginRight:8},
  numTxt:       {fontSize:14,fontWeight:'900'},
  slotInput:    {flex:1,fontSize:16,fontWeight:'700',textAlign:'center',height:46},
  totalBig:     {borderRadius:12,padding:14,marginBottom:6,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  totalBigLabel:{fontSize:13,fontWeight:'700'},
  totalBigValor:{fontSize:26,fontWeight:'900'},
  camposRow:    {flexDirection:'row',gap:8,marginTop:10},
  campoBox:     {flex:1},
  campoLabel:   {fontSize:11,fontWeight:'700',marginBottom:5},
  campoInput:   {borderWidth:1,borderRadius:8,paddingHorizontal:10,paddingVertical:7,fontSize:14},
  botonesRow:   {flexDirection:'row',gap:8},
});
