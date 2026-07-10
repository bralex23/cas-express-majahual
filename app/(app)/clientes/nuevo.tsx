import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Image, TouchableOpacity, Alert, Linking } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from '../../../src/lib/imagePicker.web';
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../src/lib/firebase';
import { useEmpresa } from '../../../src/context/empresa';
import { useAuth } from '../../../src/hooks/useAuth';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;
import { Ruta } from '../../../src/types';

export default function NuevoCliente() {
  const { perfil } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const editando = !!params.id;

  const [nombre, setNombre]     = useState('');
  const [dui, setDui]           = useState('');
  const [telefono, setTelefono] = useState('');

  function formatearDui(texto: string) {
    // Solo conservar dígitos, máximo 9
    const digits = texto.replace(/\D/g, '').slice(0, 9);
    // Insertar guion automáticamente antes del último dígito (posición 8)
    setDui(digits.length <= 8 ? digits : `${digits.slice(0, 8)}-${digits.slice(8)}`);
  }
  const [direccion, setDir]     = useState('');
  const [mapsUrl, setMaps]      = useState('');
  const [geoCodigo, setGeo]     = useState('');
  const [notas, setNotas]           = useState('');
  const [expediente, setExpediente] = useState('');
  const [rutaId, setRutaId]         = useState(perfil?.ruta_id || '');
  const [rutas, setRutas]       = useState<Ruta[]>([]);
  const [fotoUri, setFoto]           = useState<string | null>(null);
  const [duiReversoUri, setDuiR]     = useState<string | null>(null);
  const [reciboLuzUri, setReciboLuz] = useState<string | null>(null);
  const [loading, setLoading]        = useState(false);
  const [error, setError]       = useState('');
  const [edad, setEdad] = useState('');

  // Referencias personales
  const [ref1Nombre,     setRef1Nombre]     = useState('');
  const [ref1Telefono,   setRef1Telefono]   = useState('');
  const [ref1Parentesco, setRef1Parentesco] = useState('');
  const [ref2Nombre,     setRef2Nombre]     = useState('');
  const [ref2Telefono,   setRef2Telefono]   = useState('');
  const [ref2Parentesco, setRef2Parentesco] = useState('');

  // Cargar rutas una sola vez
  useEffect(() => {
    getDocs(query(collection(db,'rutas'), orderBy('nombre'))).then(snap =>
      setRutas(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ruta)))
    );
  }, []);

  // Resetear / cargar datos cada vez que la pantalla recibe foco
  useFocusEffect(useCallback(() => {
    if (params.id) {
      // Editando: cargar datos existentes
      getDoc(doc(db, col('clientes'),params.id)).then(snap => {
        if (!snap.exists()) return;
        const d = snap.data();
        setNombre(d.nombre||''); setDui(d.dui||''); setTelefono(d.telefono||'');
        setDir(d.direccion||''); setMaps(d.maps_url||''); setGeo(d.geo_codigo||''); setNotas(d.notas||'');
        setExpediente(d.numero_expediente||''); setRutaId(d.ruta_id||''); setEdad(d.edad||'');
        setFoto(d.foto_url || null); setDuiR(d.dui_reverso_url || null);
        setReciboLuz(d.recibo_luz_url || null);
        setRef1Nombre(d.ref1_nombre||''); setRef1Telefono(d.ref1_telefono||''); setRef1Parentesco(d.ref1_parentesco||'');
        setRef2Nombre(d.ref2_nombre||''); setRef2Telefono(d.ref2_telefono||''); setRef2Parentesco(d.ref2_parentesco||'');
      });
    } else {
      // Nuevo cliente: limpiar todos los campos
      setNombre(''); setDui(''); setTelefono(''); setDir('');
      setMaps(''); setGeo(''); setNotas(''); setFoto(null); setDuiR(null); setReciboLuz(null);
      setEdad('');
      setRef1Nombre(''); setRef1Telefono(''); setRef1Parentesco('');
      setRef2Nombre(''); setRef2Telefono(''); setRef2Parentesco('');
      setRutaId(perfil?.ruta_id || ''); setError('');
      // Auto-calcular siguiente expediente
      getDocs(collection(db, col('clientes'))).then(snap => {
        let maxNum = 0;
        snap.docs.forEach(d => {
          const num = parseInt((d.data().numero_expediente || '').replace(/\D/g, '') || '0');
          if (num > maxNum) maxNum = num;
        });
        setExpediente(String(maxNum + 1));
      });
    }
  }, [params.id]));

  async function tomarFoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a tus fotos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8, allowsEditing: false,
    });
    if (!result.canceled) setFoto(result.assets[0].uri);
  }

  async function tomarConCamara() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8, allowsEditing: false,
    });
    if (!result.canceled) setFoto(result.assets[0].uri);
  }

  async function seleccionarDuiReverso() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a tus fotos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true, aspect: [85, 54],
    });
    if (!result.canceled) setDuiR(result.assets[0].uri);
  }

  async function tomarDuiReversoConCamara() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8, allowsEditing: true, aspect: [85, 54],
    });
    if (!result.canceled) setDuiR(result.assets[0].uri);
  }

  async function seleccionarReciboLuz() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a tus fotos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true,
    });
    if (!result.canceled) setReciboLuz(result.assets[0].uri);
  }

  async function tomarReciboLuzConCamara() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado','Necesitamos acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
    if (!result.canceled) setReciboLuz(result.assets[0].uri);
  }

  // Comprime y convierte a base64 para guardar en Firestore (sin Firebase Storage)
  async function comprimirABase64(uri: string, maxW = 700, calidad = 0.45): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new (window as any).Image() as HTMLImageElement;
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = reject;
      img.src = uri;
    });
  }

  function conTimeout<T>(promesa: Promise<T>, ms = 15000): Promise<T> {
    return Promise.race([
      promesa,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado. Verifica tu conexión.')), ms)
      ),
    ]);
  }

  async function guardar() {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    setLoading(true); setError('');
    try {
      let foto_url = fotoUri || '';
      if (fotoUri && !fotoUri.startsWith('http')) foto_url = await comprimirABase64(fotoUri);

      let dui_reverso_url = duiReversoUri || '';
      if (duiReversoUri && !duiReversoUri.startsWith('http')) dui_reverso_url = await comprimirABase64(duiReversoUri);

      let recibo_luz_url = reciboLuzUri || '';
      if (reciboLuzUri && !reciboLuzUri.startsWith('http')) recibo_luz_url = await comprimirABase64(reciboLuzUri, 1600, 0.8);

      const data: Record<string, any> = {
        nombre: nombre.trim(), dui: dui.trim(), telefono: telefono.trim(),
        edad: edad.trim() || null,
        direccion: direccion.trim(), maps_url: mapsUrl.trim(),
        geo_codigo: geoCodigo.trim(), notas: notas.trim(),
        numero_expediente: expediente.trim() || null,
        ruta_id: rutaId, foto_url, dui_reverso_url, recibo_luz_url, activo: true,
        ref1_nombre: ref1Nombre.trim()||null, ref1_telefono: ref1Telefono.trim()||null, ref1_parentesco: ref1Parentesco.trim()||null,
        ref2_nombre: ref2Nombre.trim()||null, ref2_telefono: ref2Telefono.trim()||null, ref2_parentesco: ref2Parentesco.trim()||null,
      };
      if (perfil?.id) data.created_by = perfil.id;

      if (editando && params.id) {
        await conTimeout(updateDoc(doc(db, col('clientes'),params.id), data));
      } else {
        await conTimeout(addDoc(collection(db, col('clientes')), { ...data, created_at: new Date().toISOString() }));
      }
      router.back();
    } catch(e: any) {
      setError(e?.message || 'Error al guardar. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  const C = useColors();
  const { col } = useEmpresa();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Text variant="titleLarge" style={s.titulo}>{editando ? 'Editar Cliente' : 'Nuevo Cliente'}</Text>

      {/* Foto DUI */}
      <View style={s.fotoSection}>
        <TouchableOpacity style={s.fotoBox} onPress={tomarFoto}>
          {fotoUri
            ? <Image source={{ uri: fotoUri }} style={s.foto}/>
            : <View style={s.fotoPlaceholder}>
                <Text style={s.fotoIcon}>📷</Text>
                <Text style={s.fotoTxt}>Foto / DUI</Text>
              </View>
          }
        </TouchableOpacity>
        <View style={s.fotoBtns}>
          <Button icon="camera" mode="outlined" onPress={tomarConCamara} compact style={{ marginBottom: 8 }}>Cámara</Button>
          <Button icon="image" mode="outlined" onPress={tomarFoto} compact>Galería</Button>
        </View>
      </View>

      {/* DUI Reverso */}
      <View style={s.formPanel}>
        <Text style={s.label}>Reverso del DUI (opcional)</Text>
        <View style={s.fotoSection}>
          <TouchableOpacity style={s.fotoBox} onPress={seleccionarDuiReverso}>
            {duiReversoUri
              ? <Image source={{ uri: duiReversoUri }} style={s.foto}/>
              : <View style={s.fotoPlaceholder}>
                  <Text style={s.fotoIcon}>🪪</Text>
                  <Text style={s.fotoTxt}>Reverso</Text>
                </View>
            }
          </TouchableOpacity>
          <View style={s.fotoBtns}>
            <Button icon="camera" mode="outlined" onPress={tomarDuiReversoConCamara} compact style={{ marginBottom: 8 }}>Cámara</Button>
            <Button icon="image" mode="outlined" onPress={seleccionarDuiReverso} compact>Galería</Button>
          </View>
        </View>
      </View>

      {/* Recibo de Luz */}
      <View style={s.formPanel}>
        <Text style={s.label}>Recibo de Luz (opcional)</Text>
        <View style={s.fotoSection}>
          <TouchableOpacity style={s.fotoBox} onPress={seleccionarReciboLuz}>
            {reciboLuzUri
              ? <Image source={{ uri: reciboLuzUri }} style={s.foto}/>
              : <View style={s.fotoPlaceholder}>
                  <Text style={s.fotoIcon}>💡</Text>
                  <Text style={s.fotoTxt}>Recibo</Text>
                </View>
            }
          </TouchableOpacity>
          <View style={s.fotoBtns}>
            <Button icon="camera" mode="outlined" onPress={tomarReciboLuzConCamara} compact style={{ marginBottom: 8 }}>Cámara</Button>
            <Button icon="image" mode="outlined" onPress={seleccionarReciboLuz} compact>Galería</Button>
            {reciboLuzUri && (
              <Button icon="delete" mode="text" onPress={() => setReciboLuz(null)} compact textColor="#c62828">Quitar</Button>
            )}
          </View>
        </View>
      </View>

      <View style={s.formPanel}>
        <TextInput label="Nombre completo *" value={nombre} onChangeText={setNombre}
          mode="outlined" style={s.input} />
        <TextInput label="DUI" value={dui} onChangeText={formatearDui}
          mode="outlined" style={s.input} keyboardType="numeric" maxLength={10}
          placeholder="00000000-0" right={dui.length===10 ? <TextInput.Icon icon="check-circle" color="#2e7d32"/> : undefined}/>
        <TextInput label="Teléfono" value={telefono} onChangeText={setTelefono}
          mode="outlined" style={s.input} keyboardType="phone-pad" />
        <TextInput label="Edad" value={edad} onChangeText={setEdad}
          mode="outlined" style={s.input} keyboardType="numeric"
          left={<TextInput.Icon icon="cake-variant-outline"/>}
          placeholder="Ej: 35" maxLength={3}/>
        <TextInput label="Dirección" value={direccion} onChangeText={setDir}
          mode="outlined" style={s.input} multiline />
        <TextInput label="Link de Google Maps (opcional)" value={mapsUrl} onChangeText={setMaps}
          mode="outlined" style={s.input}
          right={mapsUrl ? <TextInput.Icon icon="open-in-new" onPress={() => Linking.openURL(mapsUrl)} /> : undefined}/>
        <TextInput label="Código Geo / Plus Code (para colecta)" value={geoCodigo} onChangeText={setGeo}
          mode="outlined" style={s.input} placeholder="Ej: GJ46+XH"
          left={<TextInput.Icon icon="map-marker-outline"/>}/>
        <TextInput label="Nº Expediente" value={expediente} onChangeText={setExpediente}
          mode="outlined" style={[s.input,{marginBottom:0}]} placeholder="Ej: EXP-2025-001"
          left={<TextInput.Icon icon="file-document-outline"/>}
          onBlur={() => {
            const v = expediente.trim();
            if (v && !v.toUpperCase().startsWith('EXP-')) setExpediente('EXP-' + v);
          }}/>
      </View>

      {/* Referencias personales */}
      <View style={s.formPanel}>
        <Text style={s.label}>Referencias Personales</Text>
        <Text style={[s.label,{fontSize:11,marginBottom:4}]}>Referencia 1</Text>
        <TextInput label="Nombre" value={ref1Nombre} onChangeText={setRef1Nombre}
          mode="outlined" style={s.input}/>
        <View style={{flexDirection:'row',gap:8}}>
          <TextInput label="Teléfono" value={ref1Telefono} onChangeText={setRef1Telefono}
            mode="outlined" style={[s.input,{flex:1}]} keyboardType="phone-pad"/>
          <TextInput label="Parentesco" value={ref1Parentesco} onChangeText={setRef1Parentesco}
            mode="outlined" style={[s.input,{flex:1}]}/>
        </View>
        <Text style={[s.label,{fontSize:11,marginBottom:4,marginTop:4}]}>Referencia 2</Text>
        <TextInput label="Nombre" value={ref2Nombre} onChangeText={setRef2Nombre}
          mode="outlined" style={s.input}/>
        <View style={{flexDirection:'row',gap:8}}>
          <TextInput label="Teléfono" value={ref2Telefono} onChangeText={setRef2Telefono}
            mode="outlined" style={[s.input,{flex:1}]} keyboardType="phone-pad"/>
          <TextInput label="Parentesco" value={ref2Parentesco} onChangeText={setRef2Parentesco}
            mode="outlined" style={[s.input,{flex:1,marginBottom:0}]}/>
        </View>
      </View>

      <View style={s.formPanel}>
        <TextInput label="Notas adicionales" value={notas} onChangeText={setNotas}
          mode="outlined" style={[s.input,{marginBottom:0}]} multiline numberOfLines={3} />
      </View>

      {/* Ruta */}
      <View style={s.formPanel}>
        <Text style={s.label}>Ruta asignada</Text>
        <View style={s.rutasRow}>
          {rutas.map(r => (
            <TouchableOpacity key={r.id} style={[s.rutaBtn, rutaId===r.id && s.rutaBtnActive]}
              onPress={() => setRutaId(r.id)}>
              <Text style={[s.rutaTxt, rutaId===r.id && s.rutaTxtActive]}>{r.nombre}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      <Button mode="contained" onPress={guardar} loading={loading} disabled={loading}
        buttonColor={C.primary} textColor="#ffffff"
        style={s.btn} contentStyle={{ paddingVertical: 6 }}>
        {editando ? 'Actualizar' : 'Registrar Cliente'}
      </Button>
      <Button onPress={() => router.back()} style={{ marginTop: 8 }}>Cancelar</Button>
    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:{flex:1, ...w(glassBgStyle(C))},
  titulo:{color:C.primaryText,fontWeight:'800',marginBottom:16},
  fotoSection:{flexDirection:'row',gap:12,marginBottom:16,alignItems:'center'},
  fotoBox:{width:100,height:130,borderRadius:8,overflow:'hidden',borderWidth:2,borderColor:C.primary,borderStyle:'dashed'},
  foto:{width:'100%',height:'100%'},
  fotoPlaceholder:{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:C.surfaceAlt},
  fotoIcon:{fontSize:30},
  fotoTxt:{fontSize:11,color:C.textTer,marginTop:4},
  fotoBtns:{flex:1},
  formPanel:{borderRadius:16, padding:12, marginBottom:12, ...glassStyle(C)},
  input:{marginBottom:12},
  label:{fontSize:13,color:C.textSec,marginBottom:8,fontWeight:'600'},
  rutasRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:16},
  rutaBtn:{borderWidth:1,borderColor:C.border,borderRadius:20,paddingHorizontal:14,paddingVertical:6},
  rutaBtnActive:{backgroundColor:C.primary,borderColor:C.primary},
  rutaTxt:{fontSize:13,color:C.textSec},
  rutaTxtActive:{color:'#fff'},
  btn:{borderRadius:8,marginTop:4},
});
