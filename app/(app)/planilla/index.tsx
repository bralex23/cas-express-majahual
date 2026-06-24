import React, { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button, TextInput, ActivityIndicator, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc,
} from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
import { formatMoneda, hoy } from '../../../src/utils/calculos';

/* ════════════════════════════════════════════════════════════════
   TIPOS
════════════════════════════════════════════════════════════════ */
interface Empleado {
  id: string; nombre: string; cargo: string; sueldoBase: number; activo: boolean;
}
interface RegistroPlanilla {
  id: string; mes: string; empleadoId: string;
  nombre: string; cargo: string; sueldoBase: number;
  bonificacion: number; otrosDescuentos: number; renta: number;
}
interface Config {
  isssPct: number; isssTope: number; afpPct: number; afpTope: number;
}
const CONFIG_DEFAULT: Config = { isssPct: 0.03, isssTope: 1000, afpPct: 0.0725, afpTope: 1000 };

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const r2  = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

function calcular(r: RegistroPlanilla, cfg: Config) {
  const isss = r2(Math.min(r.sueldoBase, cfg.isssTope) * cfg.isssPct);
  const afp  = r2(Math.min(r.sueldoBase, cfg.afpTope) * cfg.afpPct);
  const devengado  = r2(r.sueldoBase + r.bonificacion);
  const descuentos = r2(isss + afp + r.renta + r.otrosDescuentos);
  const neto = r2(devengado - descuentos);
  return { isss, afp, devengado, descuentos, neto };
}

/* ════════════════════════════════════════════════════════════════
   PANTALLA
════════════════════════════════════════════════════════════════ */
export default function Planilla() {
  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);
  const { col, empresa } = useEmpresa();
  const { isSupervisor } = useAuth();

  const hoyStr = hoy();
  const [year,  setYear]  = useState(parseInt(hoyStr.slice(0,4)));
  const [month, setMonth] = useState(parseInt(hoyStr.slice(5,7)));
  const mesStr = `${year}-${String(month).padStart(2,'0')}`;
  const esActual = year === parseInt(hoyStr.slice(0,4)) && month === parseInt(hoyStr.slice(5,7));

  const [tab, setTab] = useState<'planilla'|'empleados'>('planilla');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{tipo:'ok'|'error'|'info'; texto:string}|null>(null);

  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [registros, setRegistros] = useState<RegistroPlanilla[]>([]);
  const [cfg, setCfg] = useState<Config>(CONFIG_DEFAULT);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [snapE, snapR, snapCfg] = await Promise.all([
        getDocs(collection(db, col('planilla_empleados'))),
        getDocs(query(collection(db, col('planilla_registros')), where('mes', '==', mesStr))),
        getDoc(doc(db, col('planilla_config'), 'config')),
      ]);
      setEmpleados(snapE.docs.map(d => ({ id: d.id, ...d.data() } as Empleado))
        .sort((a,b)=>a.nombre.localeCompare(b.nombre)));
      setRegistros(snapR.docs.map(d => ({ id: d.id, ...d.data() } as RegistroPlanilla))
        .sort((a,b)=>a.nombre.localeCompare(b.nombre)));
      if (snapCfg.exists()) setCfg({ ...CONFIG_DEFAULT, ...(snapCfg.data() as any) });
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [mesStr, col]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  function mesAnterior() {
    if (month === 1) { setYear(y=>y-1); setMonth(12); } else setMonth(m=>m-1);
  }
  function mesSiguiente() {
    if (esActual) return;
    if (month === 12) { setYear(y=>y+1); setMonth(1); } else setMonth(m=>m+1);
  }

  /* ── Resumen del mes ── */
  const resumen = useMemo(() => {
    let devengado = 0, descuentos = 0, neto = 0, isss = 0, afp = 0, renta = 0;
    registros.forEach(r => {
      const c = calcular(r, cfg);
      devengado += c.devengado; descuentos += c.descuentos; neto += c.neto;
      isss += c.isss; afp += c.afp; renta += r.renta;
    });
    return { devengado: r2(devengado), descuentos: r2(descuentos), neto: r2(neto),
      isss: r2(isss), afp: r2(afp), renta: r2(renta) };
  }, [registros, cfg]);

  /* ── Generar planilla del mes (a partir de empleados activos) ── */
  async function generarPlanilla() {
    setLoading(true); setMsg(null);
    try {
      const existentes = new Set(registros.map(r => r.empleadoId));
      let agregados = 0;
      for (const e of empleados) {
        if (!e.activo || existentes.has(e.id)) continue;
        await addDoc(collection(db, col('planilla_registros')), {
          mes: mesStr, empleadoId: e.id, nombre: e.nombre, cargo: e.cargo || '',
          sueldoBase: e.sueldoBase || 0, bonificacion: 0, otrosDescuentos: 0, renta: 0,
        });
        agregados++;
      }
      await cargar();
      setMsg({ tipo: agregados > 0 ? 'ok' : 'info',
        texto: agregados > 0
          ? `Se agregaron ${agregados} empleado(s) a la planilla de ${MESES[month-1]} ${year}.`
          : 'La planilla de este mes ya incluye a todos los empleados activos.' });
    } catch(e:any) {
      setMsg({ tipo:'error', texto: 'Error al generar: ' + (e?.message||'') });
    }
    setLoading(false);
  }

  /* ── Guardar config ── */
  async function guardarConfig(nueva: Config) {
    setCfg(nueva);
    try { await setDoc(doc(db, col('planilla_config'), 'config'), nueva); } catch(e) { console.error(e); }
  }

  /* ── Actualizar / quitar registro ── */
  async function actualizarRegistro(id: string, campo: string, valor: number) {
    setRegistros(prev => prev.map(r => r.id === id ? { ...r, [campo]: valor } : r));
    try { await updateDoc(doc(db, col('planilla_registros'), id), { [campo]: valor }); } catch(e) { console.error(e); }
  }
  async function quitarRegistro(id: string) {
    if (!window.confirm('¿Quitar este empleado de la planilla de este mes?')) return;
    await deleteDoc(doc(db, col('planilla_registros'), id));
    await cargar();
  }

  /* ── Exportar a Excel ── */
  async function exportarExcel() {
    setMsg(null);
    const api = (window as any).electronAPI;
    if (!api || typeof api.generatePlanilla !== 'function') {
      setMsg({ tipo:'info', texto: 'Disponible solo en la app de escritorio (cierra y vuelve a abrir CAS Express si ya actualizaste).' });
      return;
    }
    setLoading(true);
    try {
      const result = await api.generatePlanilla({
        year, month, mesLabel: `${MESES[month-1]} ${year}`,
        empresaNombre: empresa?.nombre || '',
        titular: empresa?.titular || empresa?.nombre || '',
        nit: empresa?.nit || '',
        registros: registros.map(r => ({ ...r, ...calcular(r, cfg) })),
        resumen,
      });
      if (result?.saved) setMsg({ tipo:'ok', texto: '✅ Guardado en: ' + result.filePath });
      else if (result?.error) setMsg({ tipo:'error', texto: 'Error: ' + result.error });
    } catch(e:any) {
      setMsg({ tipo:'error', texto: 'Error: ' + (e?.message||'') });
    }
    setLoading(false);
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

        {/* Encabezado */}
        <View style={s.header}>
          <View>
            <Text variant="titleLarge" style={s.titulo}>💵 Planilla de Sueldos</Text>
            <Text style={s.subtitulo}>Empleados · ISSS · AFP · Renta · Neto a pagar</Text>
          </View>
        </View>

        {/* Selector de mes */}
        <View style={s.mesSel}>
          <TouchableOpacity style={s.mesBtn} onPress={mesAnterior}>
            <Text style={s.mesBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={s.mesLabel}>{MESES[month-1]} {year}</Text>
          <TouchableOpacity style={[s.mesBtn, esActual && s.mesBtnDis]} onPress={mesSiguiente} disabled={esActual}>
            <Text style={[s.mesBtnTxt, esActual && { opacity: 0.3 }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Resumen */}
        <View style={s.panel}>
          <Text style={s.panelTit}>Resumen del mes</Text>
          <View style={{ flexDirection:'row', gap: 8, marginBottom: 10, flexWrap:'wrap' }}>
            <_Card label="Total Devengado" valor={resumen.devengado} color={C.success} C={C}/>
            <_Card label="Total Descuentos" valor={resumen.descuentos} color={C.danger} C={C}/>
            <_Card label="Neto a Pagar" valor={resumen.neto} color="#1565c0" C={C}/>
          </View>
          <View style={{ flexDirection:'row', gap: 8, flexWrap:'wrap' }}>
            <_Card label="Total ISSS" valor={resumen.isss} color="#7c4dff" C={C}/>
            <_Card label="Total AFP" valor={resumen.afp} color="#7c4dff" C={C}/>
            <_Card label="Total Renta" valor={resumen.renta} color="#7c4dff" C={C}/>
          </View>
          <Text style={s.nota}>
            ⚠️ ISSS y AFP se calculan con el % y el tope configurados abajo. Verifica esos valores y la
            retención de Renta con tu contador — son los vigentes según la tabla del Ministerio de Hacienda.
          </Text>
        </View>

        {/* Configuración ISSS / AFP */}
        <View style={s.panel}>
          <Text style={s.panelTit}>Configuración de descuentos (ISSS / AFP)</Text>
          <View style={s.fila}>
            <Field s={s} label="ISSS % (ej. 0.03 = 3%)" value={String(cfg.isssPct)} onChange={v=>guardarConfig({...cfg, isssPct:num(v)})} numeric/>
            <Field s={s} label="Tope cotizable ISSS ($)" value={String(cfg.isssTope)} onChange={v=>guardarConfig({...cfg, isssTope:num(v)})} numeric/>
            <Field s={s} label="AFP % (ej. 0.0725 = 7.25%)" value={String(cfg.afpPct)} onChange={v=>guardarConfig({...cfg, afpPct:num(v)})} numeric/>
            <Field s={s} label="Tope cotizable AFP ($)" value={String(cfg.afpTope)} onChange={v=>guardarConfig({...cfg, afpTope:num(v)})} numeric/>
          </View>
        </View>

        {/* Mensaje */}
        {msg && (
          <View style={[s.msgBox, {
            backgroundColor: msg.tipo === 'ok' ? C.success+'20' : msg.tipo === 'info' ? C.warning+'20' : C.danger+'20',
            borderColor:     msg.tipo === 'ok' ? C.success+'55' : msg.tipo === 'info' ? C.warning+'55' : C.danger+'55',
          }]}>
            <Text style={{ fontSize:13, fontWeight:'600', lineHeight:20,
              color: msg.tipo === 'ok' ? C.success : msg.tipo === 'info' ? C.warning : C.danger }}>
              {msg.texto}
            </Text>
          </View>
        )}

        {/* Tabs */}
        <View style={s.tabs}>
          {([
            { key:'planilla',  label:'Planilla del mes', icon:'cash-multiple' },
            { key:'empleados', label:'Empleados',        icon:'account-group-outline' },
          ] as const).map(t => (
            <TouchableOpacity key={t.key} style={[s.tabBtn, tab===t.key && s.tabBtnOn]} onPress={() => setTab(t.key)}>
              <MaterialCommunityIcons name={t.icon as any} size={16} color={tab===t.key ? '#fff' : C.textSec}/>
              <Text style={[s.tabTxt, tab===t.key && { color:'#fff' }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }}/>}

        {tab === 'planilla' && (
          <Button mode="outlined" icon="microsoft-excel" onPress={exportarExcel}
            loading={loading} disabled={loading} style={s.exportBtn} textColor={C.success}>
            Exportar Planilla a Excel
          </Button>
        )}

        {tab === 'planilla' && (
          <SeccionPlanilla C={C} s={s} registros={registros} cfg={cfg}
            onGenerar={generarPlanilla} onActualizar={actualizarRegistro}
            onQuitar={quitarRegistro} isSupervisor={isSupervisor} resumen={resumen}/>
        )}

        {tab === 'empleados' && (
          <SeccionEmpleados C={C} s={s} col={col} empleados={empleados} recargar={cargar} isSupervisor={isSupervisor}/>
        )}

      </ScrollView>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   SECCIÓN: PLANILLA DEL MES
════════════════════════════════════════════════════════════════ */
function SeccionPlanilla({ C, s, registros, cfg, onGenerar, onActualizar, onQuitar, isSupervisor, resumen }: any) {
  const [edits, setEdits] = useState<Record<string, { bonificacion:string; otrosDescuentos:string; renta:string }>>({});

  function valorCampo(r: RegistroPlanilla, campo: 'bonificacion'|'otrosDescuentos'|'renta') {
    const e = edits[r.id];
    if (e && e[campo] !== undefined) return e[campo];
    return String(r[campo] || '');
  }
  function onChangeCampo(r: RegistroPlanilla, campo: 'bonificacion'|'otrosDescuentos'|'renta', valor: string) {
    setEdits(prev => ({ ...prev, [r.id]: { ...(prev[r.id]||{ bonificacion:String(r.bonificacion||''), otrosDescuentos:String(r.otrosDescuentos||''), renta:String(r.renta||'') }), [campo]: valor } }));
  }
  function onBlurCampo(r: RegistroPlanilla, campo: 'bonificacion'|'otrosDescuentos'|'renta') {
    const valor = num(valorCampo(r, campo));
    onActualizar(r.id, campo, valor);
  }

  return (
    <View>
      <Button mode="text" icon="account-plus-outline" onPress={onGenerar} compact style={{ alignSelf:'flex-start', marginBottom: 8 }}>
        Generar / actualizar planilla con empleados activos
      </Button>

      <View style={s.panel}>
        <Text style={s.panelTit}>Registros ({registros.length})</Text>
        {registros.length === 0
          ? <Text style={s.vacio}>Sin empleados en la planilla de este mes. Usa "Generar / actualizar planilla" arriba.</Text>
          : registros.map((r: RegistroPlanilla) => {
              const c = calcular({ ...r,
                bonificacion: num(valorCampo(r,'bonificacion')),
                otrosDescuentos: num(valorCampo(r,'otrosDescuentos')),
                renta: num(valorCampo(r,'renta')),
              }, cfg);
              return (
                <View key={r.id} style={s.empCard}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom: 6 }}>
                    <View>
                      <Text style={s.rowTit}>{r.nombre}</Text>
                      <Text style={s.rowSub}>{r.cargo || '—'} · Sueldo base {formatMoneda(r.sueldoBase)}</Text>
                    </View>
                    {isSupervisor && (
                      <TouchableOpacity onPress={()=>onQuitar(r.id)}>
                        <MaterialCommunityIcons name="delete-outline" size={18} color={C.danger}/>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={s.fila}>
                    <Field s={s} label="Bonificación ($)" value={valorCampo(r,'bonificacion')}
                      onChange={v=>onChangeCampo(r,'bonificacion',v)} onBlur={()=>onBlurCampo(r,'bonificacion')} numeric/>
                    <Field s={s} label="Renta ($)" value={valorCampo(r,'renta')}
                      onChange={v=>onChangeCampo(r,'renta',v)} onBlur={()=>onBlurCampo(r,'renta')} numeric/>
                    <Field s={s} label="Otros descuentos ($)" value={valorCampo(r,'otrosDescuentos')}
                      onChange={v=>onChangeCampo(r,'otrosDescuentos',v)} onBlur={()=>onBlurCampo(r,'otrosDescuentos')} numeric/>
                  </View>
                  <View style={s.fila}>
                    <View style={{ flex:1 }}>
                      <Text style={s.calcLbl}>ISSS (auto)</Text>
                      <Text style={s.calcVal}>{formatMoneda(c.isss)}</Text>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={s.calcLbl}>AFP (auto)</Text>
                      <Text style={s.calcVal}>{formatMoneda(c.afp)}</Text>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={s.calcLbl}>Devengado</Text>
                      <Text style={s.calcVal}>{formatMoneda(c.devengado)}</Text>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={s.calcLbl}>Neto a pagar</Text>
                      <Text style={[s.calcVal, { color: C.success }]}>{formatMoneda(c.neto)}</Text>
                    </View>
                  </View>
                </View>
              );
            })
        }
        {registros.length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalTxt}>Descuentos: {formatMoneda(resumen.descuentos)}   Devengado: {formatMoneda(resumen.devengado)}</Text>
            <Text style={s.totalVal}>NETO A PAGAR: {formatMoneda(resumen.neto)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   SECCIÓN: EMPLEADOS
════════════════════════════════════════════════════════════════ */
function SeccionEmpleados({ C, s, col, empleados, recargar, isSupervisor }: any) {
  const [editId, setEditId] = useState<string|null>(null);
  const [f, setF] = useState({ nombre:'', cargo:'', sueldoBase:'' });
  const [guardando, setGuardando] = useState(false);

  function blank() { return { nombre:'', cargo:'', sueldoBase:'' }; }
  function cargarEdicion(e: Empleado) {
    setEditId(e.id);
    setF({ nombre: e.nombre, cargo: e.cargo||'', sueldoBase: String(e.sueldoBase||'') });
  }

  async function guardar() {
    if (!f.nombre.trim()) return;
    setGuardando(true);
    const datos = { nombre: f.nombre.trim(), cargo: f.cargo.trim(), sueldoBase: num(f.sueldoBase), activo: true };
    try {
      if (editId) await updateDoc(doc(db, col('planilla_empleados'), editId), datos);
      else await addDoc(collection(db, col('planilla_empleados')), datos);
      setEditId(null); setF(blank());
      await recargar();
    } catch(e:any) { console.error(e); window.alert('Error al guardar: ' + (e?.message||e)); }
    setGuardando(false);
  }

  async function cambiarActivo(e: Empleado, activo: boolean) {
    await updateDoc(doc(db, col('planilla_empleados'), e.id), { activo });
    await recargar();
  }

  async function borrar(id: string) {
    if (!window.confirm('¿Eliminar este empleado? (no afecta planillas ya generadas)')) return;
    await deleteDoc(doc(db, col('planilla_empleados'), id));
    await recargar();
  }

  return (
    <View>
      <View style={s.panel}>
        <Text style={s.panelTit}>{editId ? 'Editar empleado' : 'Agregar empleado'}</Text>
        <View style={s.fila}>
          <Field s={s} label="Nombre" value={f.nombre} onChange={v=>setF({...f, nombre:v})} flex={2}/>
          <Field s={s} label="Cargo" value={f.cargo} onChange={v=>setF({...f, cargo:v})} flex={2}/>
          <Field s={s} label="Sueldo base ($)" value={f.sueldoBase} onChange={v=>setF({...f, sueldoBase:v})} numeric/>
        </View>
        <View style={{ flexDirection:'row', gap:10 }}>
          {editId && (
            <Button mode="outlined" onPress={()=>{ setEditId(null); setF(blank()); }} style={{ flex:1 }}>
              Cancelar
            </Button>
          )}
          <Button mode="contained" loading={guardando} onPress={guardar} buttonColor={C.primary} textColor="#fff" style={{ flex:1 }}>
            {editId ? 'Guardar cambios' : 'Agregar empleado'}
          </Button>
        </View>
      </View>

      <View style={s.panel}>
        <Text style={s.panelTit}>Empleados ({empleados.length})</Text>
        {empleados.length === 0
          ? <Text style={s.vacio}>Sin empleados registrados.</Text>
          : empleados.map((e: Empleado) => (
              <View key={e.id} style={s.rowItem}>
                <View style={{ flex:1 }}>
                  <Text style={s.rowTit}>{e.nombre}</Text>
                  <Text style={s.rowSub}>{e.cargo || '—'} · Sueldo base {formatMoneda(e.sueldoBase)}</Text>
                </View>
                <View style={{ alignItems:'flex-end', gap:6 }}>
                  <Switch value={e.activo !== false} onValueChange={(v)=>cambiarActivo(e, v)} color={C.primary}/>
                  <View style={{ flexDirection:'row', gap:10 }}>
                    <TouchableOpacity onPress={()=>cargarEdicion(e)}>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color="#42a5f5"/>
                    </TouchableOpacity>
                    {isSupervisor && (
                      <TouchableOpacity onPress={()=>borrar(e.id)}>
                        <MaterialCommunityIcons name="delete-outline" size={18} color={C.danger}/>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
        }
      </View>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   COMPONENTES AUXILIARES
════════════════════════════════════════════════════════════════ */
function Field({ s, label, value, onChange, onBlur, flex = 1, numeric = false }: any) {
  return (
    <View style={{ flex }}>
      <TextInput
        label={label}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        mode="outlined"
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={s.input}
        dense
      />
    </View>
  );
}

function _Card({ label, valor, color, C }: { label: string; valor: number; color: string; C: any }) {
  return (
    <View style={{
      flex: 1, borderRadius: 12, padding: 10, alignItems: 'center', minWidth: 90,
      backgroundColor: color + '18', borderWidth: 1, borderColor: color + '44',
    }}>
      <Text style={{ fontSize: 9, fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, textAlign:'center' }}>
        {label}
      </Text>
      <Text style={{ fontSize: 14, fontWeight: '800', color }}>{formatMoneda(valor)}</Text>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════
   ESTILOS
════════════════════════════════════════════════════════════════ */
const makeStyles = (C: any) => StyleSheet.create({
  root:     { flex: 1, ...glassBgStyle(C) },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  titulo:   { color: C.primaryText, fontWeight: '800' },
  subtitulo:{ fontSize: 11, color: C.textSec, marginTop: 2 },

  mesSel:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 16 },
  mesBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', justifyContent: 'center', alignItems: 'center' },
  mesBtnDis:{ opacity: 0.3 },
  mesBtnTxt:{ fontSize: 22, color: C.text, fontWeight: '700', lineHeight: 26 },
  mesLabel: { fontSize: 18, fontWeight: '800', color: C.primaryText, minWidth: 160, textAlign: 'center' },

  panel:    { borderRadius: 14, padding: 14, marginBottom: 14, ...glassStyle(C) },
  panelTit: { fontSize: 12, fontWeight: '700', color: C.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  vacio:    { fontSize: 13, color: C.textTer, textAlign: 'center', paddingVertical: 10 },
  nota:     { fontSize: 11, color: C.textTer, marginTop: 8, lineHeight: 16 },

  msgBox:   { borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1 },

  tabs:     { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  tabBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 10, borderWidth: 1, borderColor: C.border },
  tabBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabTxt:   { fontSize: 12, fontWeight: '700', color: C.textSec },

  exportBtn:{ marginBottom: 14, borderColor: C.success },

  fila:     { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  input:    { marginBottom: 8 },
  lbl:      { fontSize: 12, fontWeight: '600', color: C.textSec, marginBottom: 6, marginTop: 2 },

  calcLbl:  { fontSize: 10, color: C.textTer, marginBottom: 2 },
  calcVal:  { fontSize: 15, fontWeight: '800', color: C.primaryText },

  empCard:  { borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border },

  rowItem:  { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1,
              borderBottomColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', alignItems:'flex-start' },
  rowTit:   { fontSize: 13, fontWeight: '700', color: C.text },
  rowSub:   { fontSize: 11, color: C.textTer, marginTop: 2 },
  rowMonto: { fontSize: 14, fontWeight: '800', color: C.primaryText },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems:'center', marginTop: 8, paddingTop: 8,
              borderTopWidth: 1, borderTopColor: C.border, flexWrap:'wrap', gap: 6 },
  totalTxt: { fontSize: 11, color: C.textSec, fontWeight:'600' },
  totalVal: { fontSize: 14, fontWeight: '800', color: C.primaryText },
});
