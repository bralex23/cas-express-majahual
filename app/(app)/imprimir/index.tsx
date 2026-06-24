import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useColors, glassStyle, glassBgStyle } from '../../../src/theme';
const w = (s: any) => s;

interface ImagenItem { original: string; procesada: string; nombre: string; }

export default function Imprimir() {
  const [imagenes, setImagenes]   = useState<ImagenItem[]>([]);
  const [modoCMY, setModoCMY]     = useState(true);
  const [loading, setLoading]     = useState(false);
  const [imprimiendo, setImp]     = useState(false);

  /* ── Transformación CMY píxel a píxel ── */
  async function aplicarCMY(dataUrl: string): Promise<string> {
    return new Promise(resolve => {
      const img = new (window as any).Image() as HTMLImageElement;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d  = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) / 255;
          if (lum < 0.08) { d[i] = 0x1c; d[i+1] = 0x1c; d[i+2] = 0x1c; }
        }
        ctx.putImageData(id, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /* ── Seleccionar imágenes ── */
  async function seleccionar() {
    setLoading(true);
    const input = document.createElement('input');
    input.type     = 'file';
    input.accept   = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      const nuevas: ImagenItem[] = [];
      for (const f of files) {
        const original = await fileToDataUrl(f);
        const procesada = modoCMY ? await aplicarCMY(original) : original;
        nuevas.push({ original, procesada, nombre: f.name });
      }
      setImagenes(prev => [...prev, ...nuevas]);
      setLoading(false);
    };
    input.oncancel = () => setLoading(false);
    input.click();
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = e => res(e.target?.result as string);
      r.readAsDataURL(file);
    });
  }

  /* ── Aplicar/quitar CMY a imágenes ya cargadas ── */
  async function toggleCMY() {
    const nuevo = !modoCMY;
    setModoCMY(nuevo);
    setLoading(true);
    const actualizadas = await Promise.all(imagenes.map(async img => ({
      ...img,
      procesada: nuevo ? await aplicarCMY(img.original) : img.original,
    })));
    setImagenes(actualizadas);
    setLoading(false);
  }

  /* ── Imprimir: todas las imágenes en UNA sola página, 192×121mm c/u ── */
  function imprimir() {
    if (imagenes.length === 0) return;
    setImp(true);

    const imgs = imagenes.map(img =>
      `<div class="img-wrap"><img src="${img.procesada}"/></div>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      @page { margin:5mm; size:letter portrait;
              -webkit-print-color-adjust:exact; print-color-adjust:exact }
      * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; margin:0; padding:0 }
      body { background:#fff }
      .page { display:flex; flex-direction:column; align-items:center;
              justify-content:center; gap:8mm;
              width:100%; height:calc(279mm - 10mm) }
      .img-wrap { line-height:0; border-radius:4mm; overflow:hidden }
      img { width:192mm; height:121mm; object-fit:contain; display:block }
    </style></head><body>
    <div class="page">${imgs}</div>
    </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
      finally { setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); setImp(false); }, 600); }
    };
    (iframe as any).srcdoc = html;
    document.body.appendChild(iframe);
  }

  function eliminar(idx: number) {
    setImagenes(prev => prev.filter((_, i) => i !== idx));
  }

  function limpiar() { setImagenes([]); }

  const C = useColors();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Text variant="titleLarge" style={s.titulo}>🖨️ Imprimir CMY</Text>
      <Text style={s.subtitulo}>Imprime sin usar el cartucho negro K — los colores oscuros se reemplazan por gris #1c1c1c usando tintas CMY.</Text>

      {/* Controles */}
      <View style={s.panel}>
        <View style={s.row}>
          <Button icon="image-plus" mode="contained" onPress={seleccionar}
            loading={loading} disabled={loading}
            buttonColor={C.primary} textColor="#fff" style={{ flex:1 }}>
            Agregar imágenes
          </Button>
          {imagenes.length > 0 && (
            <Button icon="delete-sweep" mode="outlined" onPress={limpiar}
              textColor="#c62828" style={{ borderColor:'#c62828' }}>
              Limpiar
            </Button>
          )}
        </View>

        {/* Toggle CMY */}
        <TouchableOpacity style={s.toggleRow} onPress={toggleCMY} disabled={loading}>
          <View style={[s.check, modoCMY && s.checkOn]}>
            {modoCMY && <Text style={s.checkMark}>✓</Text>}
          </View>
          <View style={{ flex:1 }}>
            <Text style={s.toggleLabel}>Modo CMY activo</Text>
            <Text style={s.toggleSub}>Reemplaza negros oscuros por gris #1c1c1c — no gasta cartucho K</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Preview */}
      {imagenes.length > 0 && (
        <>
          <Text style={s.secLabel}>{imagenes.length} imagen{imagenes.length > 1 ? 'es' : ''} — vista previa</Text>
          {imagenes.map((img, idx) => (
            <View key={idx} style={s.imgCard}>
              <Image source={{ uri: img.procesada }} style={s.preview} resizeMode="contain"/>
              <View style={s.imgFooter}>
                <Text style={s.imgNombre} numberOfLines={1}>{img.nombre}</Text>
                <TouchableOpacity onPress={() => eliminar(idx)}>
                  <Text style={s.eliminar}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <Button mode="contained" icon="printer" onPress={imprimir}
            loading={imprimiendo} disabled={imprimiendo || loading}
            buttonColor="#1b5e20" textColor="#fff"
            style={s.btnImprimir} contentStyle={{ paddingVertical: 8 }}>
            Imprimir {imagenes.length} imagen{imagenes.length > 1 ? 'es' : ''}
          </Button>
        </>
      )}

      {imagenes.length === 0 && !loading && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🖨️</Text>
          <Text style={s.emptyTxt}>Agrega imágenes para imprimir en modo CMY</Text>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container:    { flex:1, ...w(glassBgStyle(C)) },
  titulo:       { color:C.primaryText, fontWeight:'800', marginBottom:6 },
  subtitulo:    { fontSize:12, color:C.textSec, marginBottom:16, lineHeight:18 },
  panel:        { borderRadius:16, padding:14, marginBottom:16, ...glassStyle(C), gap:12 },
  row:          { flexDirection:'row', gap:10 },
  toggleRow:    { flexDirection:'row', alignItems:'flex-start', gap:10, paddingVertical:4 },
  check:        { width:20, height:20, borderRadius:5, borderWidth:2, borderColor:C.primary,
                  alignItems:'center', justifyContent:'center', marginTop:2 },
  checkOn:      { backgroundColor:C.primary },
  checkMark:    { color:'#fff', fontSize:12, fontWeight:'800' },
  toggleLabel:  { fontSize:13, fontWeight:'700', color:C.text },
  toggleSub:    { fontSize:11, color:C.textSec, marginTop:2 },
  secLabel:     { fontSize:12, color:C.textTer, fontWeight:'700', marginBottom:8,
                  textTransform:'uppercase', letterSpacing:0.5 },
  imgCard:      { borderRadius:12, overflow:'hidden', marginBottom:12, ...glassStyle(C) },
  preview:      { width:'100%', height:240, backgroundColor:C.surfaceAlt },
  imgFooter:    { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                  padding:10, gap:8 },
  imgNombre:    { flex:1, fontSize:12, color:C.textSec },
  eliminar:     { fontSize:16, color:'#c62828', paddingHorizontal:6 },
  btnImprimir:  { borderRadius:10, marginTop:8, marginBottom:24 },
  empty:        { alignItems:'center', justifyContent:'center', paddingVertical:60, gap:12 },
  emptyIcon:    { fontSize:48 },
  emptyTxt:     { fontSize:13, color:C.textTer, textAlign:'center' },
});
