import React, { useState, useMemo, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, FlatList, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Text, Card, Button, TextInput, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, getDocs, updateDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, firebaseConfig } from '../../../src/lib/firebase';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Perfil, Ruta, Rol } from '../../../src/types';

const ROLES: { label: string; value: Rol }[] = [
  { label:'Admin',      value:'admin'      },
  { label:'Supervisor', value:'supervisor' },
  { label:'Asesor',     value:'asesor'     },
  { label:'Cobrador',   value:'cobrador'   },
];
const ROL_COLOR: Record<Rol,string> = {
  admin:'#6a1b9a', supervisor:'#1565c0', asesor:'#2e7d32', cobrador:'#e65100'
};

export default function Usuarios() {
  const { isAdmin } = useAuth();
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [rutas, setRutas]       = useState<Ruta[]>([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Modal crear nuevo usuario ──────────────────────────────────────────
  const [modal, setModal]       = useState(false);
  const [nombre,   setNombre]   = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPass]     = useState('');
  const [rol,      setRol]      = useState<Rol>('asesor');
  const [rutaId,   setRutaId]   = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [exito,    setExito]    = useState('');

  // ── Modal reparar perfil existente (para usuarios con Auth pero sin perfil) ──
  const [modalReparar, setModalReparar] = useState(false);
  const [repUID,    setRepUID]   = useState('');
  const [repNombre, setRepNombre] = useState('');
  const [repRol,    setRepRol]   = useState<Rol>('asesor');
  const [repRutaId, setRepRutaId] = useState('');
  const [repSaving, setRepSaving] = useState(false);
  const [repError,  setRepError] = useState('');
  const [repExito,  setRepExito] = useState('');

  // ── Modal editar nombre de usuario existente ──
  const [modalEditar, setModalEditar]       = useState(false);
  const [editUsuario, setEditUsuario]       = useState<Perfil | null>(null);
  const [editNombre,  setEditNombre]        = useState('');
  const [editSaving,  setEditSaving]        = useState(false);
  const [editError,   setEditError]         = useState('');

  function abrirEditar(u: Perfil) {
    setEditUsuario(u);
    setEditNombre(u.nombre);
    setEditError('');
    setModalEditar(true);
  }

  async function guardarEdicion() {
    if (!editNombre.trim() || !editUsuario) { setEditError('El nombre no puede estar vacío.'); return; }
    setEditSaving(true); setEditError('');
    try {
      await updateDoc(doc(db, 'perfiles', editUsuario.id), { nombre: editNombre.trim() });
      setModalEditar(false);
      load();
    } catch(e: any) {
      setEditError(e.message || 'No se pudo actualizar.');
    }
    setEditSaving(false);
  }

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const [uSnap, rSnap] = await Promise.all([
        getDocs(collection(db,'perfiles')),
        getDocs(collection(db,'rutas')),
      ]);
      setUsuarios(uSnap.docs.map(d => ({ id: d.id, ...d.data() } as Perfil))
                            .sort((a,b) => a.nombre.localeCompare(b.nombre)));
      setRutas(rSnap.docs.map(d => ({ id: d.id, ...d.data() } as Ruta)));
    } catch(e: any) {
      setLoadError(e.message || 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  function abrirModal() {
    setNombre(''); setEmail(''); setPass('');
    setRol('asesor'); setRutaId('');
    setError(''); setExito('');
    setModal(true);
  }

  function abrirModalReparar() {
    setRepUID(''); setRepNombre(''); setRepRol('asesor'); setRepRutaId('');
    setRepError(''); setRepExito('');
    setModalReparar(true);
  }

  // ── Crear usuario nuevo (usando app secundaria para no cerrar sesión admin) ──
  async function crearUsuario() {
    if (!nombre.trim() || !email.trim() || !password.trim()) {
      setError('Completa nombre, correo y contraseña.'); return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.'); return;
    }
    setSaving(true); setError('');

    const TEMP_APP = 'cas-temp-create';
    let tempApp: any = null;
    try {
      const existing = getApps().find(a => a.name === TEMP_APP);
      if (existing) await deleteApp(existing);

      tempApp = initializeApp(firebaseConfig, TEMP_APP);
      const tempAuth = getAuth(tempApp);
      const cred = await createUserWithEmailAndPassword(tempAuth, email.trim(), password.trim());
      const uid = cred.user.uid;

      await tempAuth.signOut();
      await deleteApp(tempApp);
      tempApp = null;

      await setDoc(doc(db, 'perfiles', uid), {
        nombre:     nombre.trim(),
        rol,
        ruta_id:    rutaId || null,
        activo:     true,
        created_at: new Date().toISOString(),
      });

      setExito(`✅ Usuario "${nombre.trim()}" creado. Ya puede ingresar con ${email.trim()}`);
      setNombre(''); setEmail(''); setPass(''); setRutaId('');
      load();
    } catch(e: any) {
      if (tempApp) { try { await deleteApp(tempApp); } catch {} }
      const msg: Record<string,string> = {
        'auth/email-already-in-use': 'Ese correo ya tiene cuenta registrada.',
        'auth/invalid-email':        'El correo no es válido.',
        'auth/weak-password':        'Contraseña muy débil (mín. 6 caracteres).',
        'auth/network-request-failed': 'Sin conexión a internet.',
      };
      setError(msg[e.code] || e.message || 'No se pudo crear el usuario.');
    }
    setSaving(false);
  }

  // ── Crear perfil en Firestore para usuario que ya tiene cuenta en Auth ──
  async function repararPerfil() {
    const uid = repUID.trim();
    if (!uid || !repNombre.trim()) {
      setRepError('Ingresa el UID y el nombre del usuario.'); return;
    }
    setRepSaving(true); setRepError('');
    try {
      // Verificar que no exista ya un perfil para ese UID
      const snap = await getDoc(doc(db, 'perfiles', uid));
      if (snap.exists()) {
        setRepError('Ya existe un perfil para ese UID. Si necesitas editarlo, hazlo desde la lista.');
        setRepSaving(false); return;
      }
      await setDoc(doc(db, 'perfiles', uid), {
        nombre:     repNombre.trim(),
        rol:        repRol,
        ruta_id:    repRutaId || null,
        activo:     true,
        created_at: new Date().toISOString(),
      });
      setRepExito(`✅ Perfil de "${repNombre.trim()}" creado correctamente. Ya puede acceder al sistema.`);
      setRepUID(''); setRepNombre(''); setRepRutaId('');
      load();
    } catch(e: any) {
      setRepError(e.message || 'No se pudo crear el perfil.');
    }
    setRepSaving(false);
  }

  async function toggleActivo(u: Perfil) {
    const accion = u.activo ? 'desactivar' : 'activar';
    const ok = typeof window !== 'undefined'
      ? window.confirm(`¿Seguro que deseas ${accion} a ${u.nombre}?`)
      : true;
    if (!ok) return;
    await updateDoc(doc(db,'perfiles',u.id), { activo: !u.activo });
    load();
  }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={C.primary}/></View>;
  if (loadError) return <View style={s.center}><Text style={{color:C.danger,textAlign:'center',padding:24}}>⚠️ {loadError}</Text></View>;

  return (
    <View style={s.container}>
      <FlatList
        data={usuarios}
        keyExtractor={u => u.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ padding:12 }}
        ListHeaderComponent={
          <View>
            <View style={s.listHeader}>
              <Text style={s.secTit}>{usuarios.length} usuarios registrados</Text>
              {isAdmin && (
                <TouchableOpacity style={s.addBtn} onPress={abrirModal}>
                  <MaterialCommunityIcons name="account-plus" size={16} color="#fff"/>
                  <Text style={s.addBtnTxt}>Nuevo usuario</Text>
                </TouchableOpacity>
              )}
            </View>
            {isAdmin && (
              <TouchableOpacity style={s.repararBtn} onPress={abrirModalReparar}>
                <MaterialCommunityIcons name="account-key" size={15} color="#1565c0"/>
                <Text style={s.repararBtnTxt}>Crear perfil para cuenta existente</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={[s.card, !item.activo && {opacity:0.5}]} elevation={1}>
            <Card.Content style={s.row}>
              <View style={[s.rolIcon,{backgroundColor:ROL_COLOR[item.rol]+'22'}]}>
                <MaterialCommunityIcons name="account" size={22} color={ROL_COLOR[item.rol]}/>
              </View>
              <View style={s.info}>
                <Text style={s.nombre}>{item.nombre.toUpperCase()}</Text>
                <View style={s.tagsRow}>
                  <View style={[s.badge,{backgroundColor:ROL_COLOR[item.rol]+'22'}]}>
                    <Text style={[s.badgeTxt,{color:ROL_COLOR[item.rol]}]}>{item.rol.toUpperCase()}</Text>
                  </View>
                  {!item.activo && <Text style={s.inactivo}>INACTIVO</Text>}
                </View>
              </View>
              {isAdmin && (
                <View style={{flexDirection:'row',gap:6}}>
                  <TouchableOpacity onPress={() => abrirEditar(item)} style={s.togBtn}>
                    <Text style={[s.togTxt,{color:'#1565c0'}]}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => toggleActivo(item)} style={s.togBtn}>
                    <Text style={[s.togTxt,{color:item.activo?'#c62828':'#2e7d32'}]}>
                      {item.activo ? 'Desactivar' : 'Activar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card.Content>
          </Card>
        )}
      />

      {/* ── Modal: crear usuario nuevo ── */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={()=>setModal(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>Crear Usuario</Text>

            <TextInput label="Nombre completo" value={nombre} onChangeText={setNombre}
              mode="outlined" style={s.input} autoCapitalize="words"/>
            <TextInput label="Correo" value={email} onChangeText={setEmail}
              mode="outlined" style={s.input} keyboardType="email-address" autoCapitalize="none"/>
            <TextInput label="Contraseña" value={password} onChangeText={setPass}
              mode="outlined" style={s.input} secureTextEntry/>

            <Text style={s.label}>Rol</Text>
            <View style={s.optsRow}>
              {ROLES.map(r => (
                <TouchableOpacity key={r.value}
                  style={[s.optBtn, rol===r.value && {backgroundColor: ROL_COLOR[r.value], borderColor: ROL_COLOR[r.value]}]}
                  onPress={() => setRol(r.value)}>
                  <Text style={[s.optTxt, rol===r.value && {color:'#fff'}]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>Ruta</Text>
            <View style={s.optsRow}>
              <TouchableOpacity style={[s.optBtn, !rutaId && {backgroundColor:'#e0e0e0'}]}
                onPress={() => setRutaId('')}>
                <Text style={s.optTxt}>Sin ruta</Text>
              </TouchableOpacity>
              {rutas.map(r => (
                <TouchableOpacity key={r.id}
                  style={[s.optBtn, rutaId===r.id && {backgroundColor:C.primary,borderColor:C.primary}]}
                  onPress={() => setRutaId(r.id)}>
                  <Text style={[s.optTxt, rutaId===r.id && {color:'#fff'}]}>{r.nombre}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {error ? <View style={s.errorBox}><Text style={s.errorTxt}>⚠️ {error}</Text></View> : null}
            {exito ? <View style={s.exitoBox}><Text style={s.exitoTxt}>{exito}</Text></View> : null}

            <Button mode="contained" onPress={crearUsuario} loading={saving} disabled={saving}
              style={{marginTop:14,backgroundColor:C.primary}}>
              Crear Usuario
            </Button>
            <Button onPress={()=>setModal(false)} style={{marginTop:6}}>Cancelar</Button>
          </View>
        </View>
      </Modal>

      {/* ── Modal: editar nombre de usuario ── */}
      <Modal visible={modalEditar} transparent animationType="slide" onRequestClose={()=>setModalEditar(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>Editar Nombre</Text>
            <TextInput label="Nombre completo" value={editNombre} onChangeText={setEditNombre}
              mode="outlined" style={s.input} autoCapitalize="words" autoFocus/>
            {editError ? <View style={s.errorBox}><Text style={s.errorTxt}>⚠️ {editError}</Text></View> : null}
            <Button mode="contained" onPress={guardarEdicion} loading={editSaving} disabled={editSaving}
              style={{marginTop:14,backgroundColor:C.primary}}>
              Guardar
            </Button>
            <Button onPress={()=>setModalEditar(false)} style={{marginTop:6}}>Cancelar</Button>
          </View>
        </View>
      </Modal>

      {/* ── Modal: crear perfil para cuenta Auth existente ── */}
      <Modal visible={modalReparar} transparent animationType="slide" onRequestClose={()=>setModalReparar(false)}>
        <View style={s.overlay} pointerEvents="box-none">
          <View style={s.modalBox}>
            <Text style={s.modalTit}>Crear Perfil para Cuenta Existente</Text>
            <Text style={s.hint}>
              Usa esto cuando alguien ya tiene cuenta de correo/contraseña pero no aparece en la lista de usuarios.
              Necesitas el UID de Firebase de esa persona.
            </Text>

            <TextInput
              label="UID de Firebase"
              value={repUID}
              onChangeText={setRepUID}
              mode="outlined"
              style={s.input}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Ej: abc123XYZ..."
            />
            <Text style={s.hintSmall}>
              Encuéntralo en Firebase Console → Authentication → Users → clic en el usuario → copiar User UID
            </Text>

            <TextInput label="Nombre completo" value={repNombre} onChangeText={setRepNombre}
              mode="outlined" style={s.input} autoCapitalize="words"/>

            <Text style={s.label}>Rol</Text>
            <View style={s.optsRow}>
              {ROLES.map(r => (
                <TouchableOpacity key={r.value}
                  style={[s.optBtn, repRol===r.value && {backgroundColor: ROL_COLOR[r.value], borderColor: ROL_COLOR[r.value]}]}
                  onPress={() => setRepRol(r.value)}>
                  <Text style={[s.optTxt, repRol===r.value && {color:'#fff'}]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>Ruta</Text>
            <View style={s.optsRow}>
              <TouchableOpacity style={[s.optBtn, !repRutaId && {backgroundColor:'#e0e0e0'}]}
                onPress={() => setRepRutaId('')}>
                <Text style={s.optTxt}>Sin ruta</Text>
              </TouchableOpacity>
              {rutas.map(r => (
                <TouchableOpacity key={r.id}
                  style={[s.optBtn, repRutaId===r.id && {backgroundColor:C.primary,borderColor:C.primary}]}
                  onPress={() => setRepRutaId(r.id)}>
                  <Text style={[s.optTxt, repRutaId===r.id && {color:'#fff'}]}>{r.nombre}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {repError ? <View style={s.errorBox}><Text style={s.errorTxt}>⚠️ {repError}</Text></View> : null}
            {repExito ? <View style={s.exitoBox}><Text style={s.exitoTxt}>{repExito}</Text></View> : null}

            <Button mode="contained" onPress={repararPerfil} loading={repSaving} disabled={repSaving}
              style={{marginTop:14,backgroundColor:'#1565c0'}}>
              Crear Perfil
            </Button>
            <Button onPress={()=>setModalReparar(false)} style={{marginTop:6}}>Cancelar</Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:    {flex:1, backgroundColor:C.bg, ...w(glassBgStyle(C))},
  center:       {flex:1,justifyContent:'center',alignItems:'center'},
  listHeader:   {flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8},
  secTit:       {fontSize:12,color:C.textTer,fontWeight:'700',textTransform:'uppercase'},
  addBtn:       {flexDirection:'row',alignItems:'center',gap:6,backgroundColor:C.primary,borderRadius:8,paddingHorizontal:12,paddingVertical:8},
  addBtnTxt:    {color:'#fff',fontWeight:'700',fontSize:13},
  repararBtn:   {flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderColor:'#1565c0',borderRadius:8,paddingHorizontal:12,paddingVertical:7,marginBottom:12,alignSelf:'flex-start'},
  repararBtnTxt:{color:'#1565c0',fontWeight:'600',fontSize:13},
  card:         {marginBottom:10,borderRadius:12, ...glassStyle(C)},
  row:          {flexDirection:'row',alignItems:'center',gap:12},
  rolIcon:      {width:42,height:42,borderRadius:21,justifyContent:'center',alignItems:'center'},
  info:         {flex:1},
  nombre:       {fontSize:15,fontWeight:'700',color:C.text},
  tagsRow:      {flexDirection:'row',gap:8,marginTop:4},
  badge:        {paddingHorizontal:8,paddingVertical:2,borderRadius:10},
  badgeTxt:     {fontSize:11,fontWeight:'700'},
  inactivo:     {fontSize:11,color:'#c62828',fontWeight:'700'},
  togBtn:       {paddingHorizontal:8,paddingVertical:4},
  togTxt:       {fontSize:13,fontWeight:'600'},
  // Modal
  overlay:      {flex:1,backgroundColor:'#00000066',justifyContent:'flex-end'},
  modalBox:     {backgroundColor:C.surface,borderTopLeftRadius:20,borderTopRightRadius:20,padding:20,maxHeight:'92%'},
  modalTit:     {fontSize:18,fontWeight:'800',color:C.primaryText,marginBottom:10},
  hint:         {fontSize:13,color:C.textSec,marginBottom:12,lineHeight:18},
  hintSmall:    {fontSize:11,color:C.textTer,marginBottom:10,marginTop:-4},
  input:        {marginBottom:10},
  label:        {fontSize:13,color:C.textSec,fontWeight:'600',marginBottom:8},
  optsRow:      {flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:14},
  optBtn:       {borderWidth:1,borderColor:C.border,borderRadius:20,paddingHorizontal:14,paddingVertical:6},
  optTxt:       {fontSize:13,color:C.textSec},
  errorBox:     {backgroundColor:'#ffebee',borderRadius:8,padding:10,marginTop:6},
  errorTxt:     {color:'#c62828',fontSize:13},
  exitoBox:     {backgroundColor:'#e8f5e9',borderRadius:8,padding:10,marginTop:6},
  exitoTxt:     {color:'#2e7d32',fontSize:13,fontWeight:'600'},
});
