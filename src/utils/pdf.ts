import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { Prestamo, CuotaCalendar, Cliente } from '../types';
import { formatMoneda, formatFecha, calcularVencimiento } from './calculos';

const EMPRESA = 'CAS EXPRESS RUTA MAJAHUAL TAMANIQUE';
const SLOGAN  = 'Créditos Legales · BCR';

/* ── Utilidades internas ──────────────────────────────────────── */
/** Normaliza el número de expediente: si no trae "EXP-" lo agrega */
function fmtExp(exp?: string | null): string {
  if (!exp) return '';
  const v = exp.trim();
  return v.toUpperCase().startsWith('EXP-') ? v : 'EXP-' + v;
}
/* ── Modo CMY: impresión sin cartucho negro ───────────────────
   Cuando la impresora no tiene tinta negra, reemplaza colores oscuros
   en el HTML generado por un gris oscuro (#333333) fabricable con C+M+Y.
   No modifica ninguna función existente — solo se activa si el flag está on.
   ──────────────────────────────────────────────────────────────────────── */
let _modoCMY = false;
export function setModoCMY(activo: boolean) { _modoCMY = activo; }

/* ── Imprimir HTML: Electron → PDF en visor del sistema | Browser/CMY → iframe ── */
/* ── Detectar contexto de ejecución ──────────────────────────────────────── */
function _isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor;
}

/* ── Capacitor: generar PDF con jsPDF y compartir vía share sheet ────────── */
async function _generarYCompartirCapacitor(html: string): Promise<string> {
  const { jsPDF }      = await import('jspdf' as any);
  const h2c            = ((await import('html2canvas' as any)) as any).default as (el: HTMLElement, opts: any) => Promise<HTMLCanvasElement>;
  const { Filesystem } = await import('@capacitor/filesystem' as any);
  const { Share }      = await import('@capacitor/share' as any);

  // ── Detectar orientación desde el CSS del HTML ──────────────────────────────────────────
  const isLandscape = /size\s*:\s*letter\s+landscape/.test(html);
  const orientation = isLandscape ? 'l' : 'p';

  // Tamaño carta en mm
  const pageW_mm = isLandscape ? 279 : 216;
  const pageH_mm = isLandscape ? 216 : 279;
  const marginX  = isLandscape ? 9   : 8;
  const marginY  = isLandscape ? 7   : 8;
  const areaW_mm = pageW_mm - marginX * 2;
  const areaH_mm = pageH_mm - marginY * 2;

  // Ancho del div de captura:
  //   Portrait  8.5\" × 96dpi ≈  816px → 794px
  //   Landscape 11\"  × 96dpi ≈ 1056px → 1060px
  const divW = isLandscape ? 1060 : 794;

  // Overlay de carga
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(10,36,99,0.92);z-index:9998;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-family:sans-serif;';
  overlay.textContent = '\u23f3 Generando PDF...';
  document.body.appendChild(overlay);

  // El div DEBE estar en top:0 left:0 — Android WebView no renderiza en left:-Npx
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;top:0;left:0;width:${divW}px;background:#fff;z-index:9997;overflow:visible;padding:0;margin:0;`;
  div.innerHTML = html;

  // ── Fix espacios en Android WebView ────────────────────────────────────────
  // html2canvas colapsa espacios entre palabras a 0px. Doble solución:
  // 1) CSS word-spacing explícito; 2) reemplazar espacios con U+00A0 que el
  //    canvas API nunca colapsa.
  const wsStyle = document.createElement('style');
  wsStyle.textContent = '* { word-spacing: 0.28em; }';
  div.prepend(wsStyle);

  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    if (textNode.nodeValue) {
      textNode.nodeValue = textNode.nodeValue.replace(/ /g, '\u00a0');
    }
  }

  document.body.appendChild(div);
  // 2 frames + 400 ms: DOM pinta y fuentes cargan
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))));

  try {
    // ── Capturar con html2canvas (scale 2 = alta calidad) ──────────────────────────────
    // CRÍTICO: windowWidth: divW asegura que html2canvas simula el viewport al
    // ancho correcto del div, NO al ancho real del teléfono (~360px).
    // Sin esto la tabla se renderiza estrecha y cada fila ocupa media página.
    const SCALE  = 2;
    const canvas = await h2c(div, {
      scale:       SCALE,
      useCORS:     true,
      allowTaint:  true,
      logging:     false,
      width:       divW,
      windowWidth: divW,
    });

    // ── Paginación manual ─────────────────────────────────────────────────────
    // mm por pixel de canvas = areaW_mm / (divW × SCALE)
    const mmPerPx  = areaW_mm / (divW * SCALE);
    const pageH_px = Math.floor(areaH_mm / mmPerPx);
    const totalH   = canvas.height;

    const doc = new jsPDF({ orientation, unit: 'mm', format: 'letter' });
    let first = true;

    for (let yOff = 0; yOff < totalH; yOff += pageH_px) {
      if (!first) doc.addPage();
      first = false;

      const sliceH_px = Math.min(pageH_px, totalH - yOff);
      const sliceH_mm = sliceH_px * mmPerPx;

      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = Math.ceil(sliceH_px);
      tmp.getContext('2d')!.drawImage(
        canvas, 0, yOff, canvas.width, sliceH_px,
        0,      0, canvas.width, sliceH_px
      );

      doc.addImage(tmp.toDataURL('image/jpeg', 0.93), 'JPEG',
        marginX, marginY, areaW_mm, sliceH_mm);
    }

    // ── Guardar y compartir ────────────────────────────────────────────────────
    const base64 = doc.output('datauristring').split(',')[1];
    const fname  = `CAS_Express_${Date.now()}.pdf`;
    const saved  = await Filesystem.writeFile({
      path: fname, data: base64, directory: 'CACHE', recursive: true,
    });

    await Share.share({
      title: 'CAS Express', url: saved.uri,
      dialogTitle: 'Guardar o compartir PDF',
    });

    return saved.uri;

  } catch (e: any) {
    console.error('[PDF Capacitor]', e);
    window.print();
    return '';
  } finally {
    if (document.body.contains(div))     document.body.removeChild(div);
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
  }
}

/* ── Imprimir HTML: Electron → PDF en visor del sistema | Browser/CMY → iframe ── */
function _imprimirHTML(html: string): Promise<string> {
  // Capacitor Android → PDF con jsPDF + share sheet
  if (_isCapacitor()) {
    return _generarYCompartirCapacitor(html);
  }

  return new Promise((resolve) => {
    const elAPI = (window as any).electronAPI;
    // Sin CMY → PDF en Acrobat/Edge con vista previa completa
    if (elAPI?.printPreview && !_modoCMY) {
      elAPI.printPreview(html).then(() => resolve(''));
      return;
    }
    // Con CMY en Electron → ventana visible con vista previa + botón que fuerza color:true
    if (elAPI?.printColor && _modoCMY) {
      elAPI.printColor(html).then(() => resolve(''));
      return;
    }
    // Fallback browser: iframe invisible → diálogo de impresión del navegador
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
      finally { setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 500); }
      resolve('');
    };
    (iframe as any).srcdoc = html;
    document.body.appendChild(iframe);
  });
}

function _hexLum(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const r = parseInt(h.slice(0,2),16)/255;
  const g = parseInt(h.slice(2,4),16)/255;
  const b = parseInt(h.slice(4,6),16)/255;
  return 0.299*r + 0.587*g + 0.114*b;
}

function _aplicarModoCMY(html: string): string {
  let h = html;
  // 1. Texto oscuro (lum < 0.35) → azul muy oscuro #1c1c2e
  //    El componente azul fuerza al driver Canon a usar cartucho COLOR (no K)
  h = h.replace(/\bcolor\s*:\s*(#[0-9a-fA-F]{3,6})\b/g, (_, hex) =>
    _hexLum(hex) < 0.35 ? 'color:#1c1c2e' : `color:${hex}`
  );
  // 2. Fondos muy oscuros (lum < 0.2) → azul oscuro CMY
  h = h.replace(/\bbackground(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})\b/g, (match, hex) =>
    _hexLum(hex) < 0.2 ? match.replace(hex, '#1e2040') : match
  );
  // 3. Bordes: NO se modifican — cambiarlos causaba "líneas grises" al imprimir en color
  // 4. SVG fill → mismo azul oscuro para forzar cartucho color
  h = h.replace(/\bfill="(#[0-9a-fA-F]{3,6})"/g, (match, hex) =>
    _hexLum(hex) < 0.35 ? 'fill="#1c1c2e"' : match
  );
  return h;
}

/**
 * Modo color normal pero reemplaza SOLO el negro puro / casi negro (lum < 0.06)
 * por gris oscuro #1c1c1c para que la impresora use tinta CMY en lugar del cartucho K.
 * Todos los demás colores (azul, verde, rojo…) se imprimen tal cual en color.
 */
function _aplicarNegroGris(html: string): string {
  const GRIS = '#1c1c1c';
  let h = html;
  h = h.replace(/\bcolor\s*:\s*(#[0-9a-fA-F]{3,6})\b/g, (_, hex) =>
    _hexLum(hex) < 0.06 ? `color:${GRIS}` : `color:${hex}`
  );
  h = h.replace(/\b(border(?:-\w+)?)\s*:\s*([^;{}"']*?)(#[0-9a-fA-F]{3,6})\b/g,
    (match, prop, before, hex) =>
      _hexLum(hex) < 0.06 ? `${prop}:${before}${GRIS}` : match
  );
  return h;
}

async function imprimir(html: string): Promise<string> {
  const finalHtml = _modoCMY ? _aplicarModoCMY(html) : html;
  if (Platform.OS === 'web') {
    return _imprimirHTML(finalHtml);
  }
  const { uri } = await Print.printToFileAsync({ html: finalHtml, base64: false });
  return uri;
}

export async function compartir(uri: string) {
  if (!uri) return;
  // Capacitor: el PDF ya fue compartido dentro de _generarYCompartirCapacitor
  if (_isCapacitor()) return;
  // Expo nativo
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(uri, { mimeType:'application/pdf', dialogTitle:'CAS Express' });
}

function numeroALetras(n: number): string {
  const u = ['','UN','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE',
              'DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS',
              'DIECISIETE','DIECIOCHO','DIECINUEVE'];
  const d = ['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  const c = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS',
              'SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  const int = Math.floor(n);
  const dec = Math.round((n - int) * 100);

  function grupo(x: number): string {
    if (x === 0) return '';
    if (x === 100) return 'CIEN';
    const h = Math.floor(x/100), r = x%100;
    const cientos = h ? c[h] + (r?' ':''): '';
    if (r === 0) return cientos;
    if (r < 20) return cientos + u[r];
    const di = Math.floor(r/10), uni = r%10;
    return cientos + d[di] + (uni?' Y '+u[uni]:'');
  }

  const miles = Math.floor(int/1000), resto = int%1000;
  let txt = '';
  if (miles > 0) txt += (miles===1?'MIL ':grupo(miles)+' MIL ');
  txt += grupo(resto);
  txt += dec > 0 ? ` CON ${dec}/100` : ' CON 00/100';
  return txt + ' DÓLARES DE LOS ESTADOS UNIDOS DE AMERICA';
}

const PAGE_RESET = `@page{margin:0;size:letter portrait}`;

const baseStyle = `
  ${PAGE_RESET}
  body{font-family:Arial,sans-serif;padding:20px;font-size:11px;color:#111;margin:0}
  table{width:100%;border-collapse:collapse}
  th{background:#0a2463;color:#fff;padding:5px 7px;font-size:10px;text-align:left}
  td{padding:4px 7px;border:1px solid #ccc;font-size:10px}
  .tc{text-align:center} .tr{text-align:right}
  .footer{margin-top:16px;text-align:center;color:#aaa;font-size:9px;border-top:1px solid #ddd;padding-top:6px}
  .firma{border-bottom:1px solid #333;min-width:140px;display:inline-block;margin-bottom:2px}
`;

/* ══════════════════════════════════════════════════════════════
   1. ESTADO DE PRÉSTAMO
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFPrestamo(prestamo: Prestamo, cal: CuotaCalendar[]) {
  const pagadas    = cal.filter(c => c.pagada).length;
  const atrasadas  = cal.filter(c => c.atrasada).length;
  const pendientes = cal.filter(c => !c.pagada).length;
  const mora       = cal.reduce((s,c) => s+c.mora, 0);
  const saldo      = (prestamo.plazo - pagadas) * prestamo.cuota;
  // NOTA: el fondo va en cada <td>, no en <tr> — html2canvas (PDF en Android)
  // no pinta backgrounds puestos directamente en <tr>.
  const filas      = cal.map(c => {
    const bg = c.pagada?'#e8f5e9':c.atrasada?'#ffebee':'#fff';
    return `
    <tr>
      <td class="tc" style="background:${bg}">${c.numero}</td>
      <td class="tc" style="background:${bg}">${formatFecha(c.fecha_vencimiento)}</td>
      <td class="tr" style="background:${bg}">${formatMoneda(c.monto)}</td>
      <td class="tr" style="background:${bg}">${c.mora>0?formatMoneda(c.mora):'-'}</td>
      <td class="tc" style="background:${bg}">${c.pagada?'✅ '+formatFecha(c.pago!.fecha_pago):c.atrasada?'⚠️ Atrasada':'⏳ Pendiente'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseStyle}
    .hdr{border-bottom:3px solid #0a2463;padding-bottom:8px;margin-bottom:14px;width:100%;border-collapse:collapse}
    .hdr td{border:none;vertical-align:bottom;padding:0 0 8px 0}
    .grid{width:100%;border-collapse:collapse;margin-bottom:12px}
    .grid td{padding:2px 4px;width:50%;vertical-align:top}
    .kv b{min-width:110px;color:#555;display:inline-block}
    .cards{width:100%;border-collapse:collapse;margin-bottom:12px}
    .cards td{background:#f5f7ff;padding:8px;text-align:center;border:2px solid #fff}
    .v{font-size:16px;font-weight:bold}.l{font-size:9px;color:#888}
  </style></head><body>
  <table class="hdr"><tr>
    <td><b style="font-size:14px;color:#0a2463">${EMPRESA}</b><br/><span style="color:#888;font-size:10px">${SLOGAN} · Estado de Préstamo</span></td>
    <td style="text-align:right;font-size:10px;color:#888">${formatFecha(new Date().toISOString().split('T')[0])}</td>
  </tr></table>
  <table class="grid"><tbody>
    <tr><td class="kv"><b>Cliente:</b>&nbsp;${prestamo.cliente?.nombre||''}</td><td class="kv"><b>DUI:</b>&nbsp;${prestamo.cliente?.dui||'-'}</td></tr>
    <tr><td class="kv"><b>Teléfono:</b>&nbsp;${prestamo.cliente?.telefono||'-'}</td><td class="kv"><b>N° Exp.:</b>&nbsp;${fmtExp(prestamo.cliente?.numero_expediente)||'-'}</td></tr>
    <tr><td class="kv"><b>Monto:</b>&nbsp;${formatMoneda(prestamo.monto)}</td><td class="kv"><b>Interés:</b>&nbsp;${prestamo.interes}%</td></tr>
    <tr><td class="kv"><b>Total a pagar:</b>&nbsp;${formatMoneda(prestamo.monto_total)}</td><td class="kv"><b>Cuota ${prestamo.frecuencia}:</b>&nbsp;${formatMoneda(prestamo.cuota)}</td></tr>
    <tr><td class="kv"><b>Inicio:</b>&nbsp;${formatFecha(prestamo.fecha_inicio)}</td><td class="kv"><b>Fin:</b>&nbsp;${formatFecha(prestamo.fecha_fin)}</td></tr>
  </tbody></table>
  <table class="cards"><tr>
    <td><div class="v" style="color:#2e7d32">${pagadas}</div><div class="l">Pagadas</div></td>
    <td><div class="v" style="color:#1565c0">${pendientes}</div><div class="l">Pendientes</div></td>
    <td><div class="v" style="color:#c62828">${atrasadas}</div><div class="l">Atrasadas</div></td>
    <td><div class="v" style="color:#b71c1c">${formatMoneda(saldo)}</div><div class="l">Saldo</div></td>
    <td><div class="v" style="color:#e65100">${formatMoneda(mora)}</div><div class="l">Mora</div></td>
  </tr></table>
  <table><thead><tr><th class="tc">#</th><th>Vencimiento</th><th class="tr">Cuota</th><th class="tr">Mora</th><th class="tc">Estado</th></tr></thead>
  <tbody>${filas}</tbody></table>
  <div class="footer">${EMPRESA} · Generado automáticamente</div></body></html>`;
  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   2. CONTRATO DE CRÉDITO NUEVO
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFContrato(prestamo: Prestamo, cobrador?: string) {
  const c       = prestamo.cliente;
  const hoyFmt  = formatFecha(new Date().toISOString().split('T')[0]);
  const enLetras = numeroALetras(prestamo.monto);
  const diasSemana: Record<string,string> = {
    diario:'DIARIO', semanal:'SEMANAL', mensual:'MENSUAL'
  };

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${PAGE_RESET}
    body{font-family:Arial,sans-serif;padding:28px 44px;font-size:13px;color:#111;max-width:760px;margin:0 auto}
    .logo{text-align:center;margin-bottom:8px}
    .subtit{text-align:center;font-size:16px;font-weight:bold;margin-bottom:22px;letter-spacing:1px}
    .linea{width:100%;border-collapse:collapse;margin-bottom:14px}
    .linea td{vertical-align:bottom;padding:0 6px 0 0}
    .campo{border-bottom:1.5px solid #333;min-width:80px;height:20px;display:inline-block;font-size:13px;width:100%}
    .lbl{font-size:12px;font-weight:bold;white-space:nowrap}
    .parrafo{margin:24px 0;text-align:justify;line-height:2.0;font-size:13px}
    .firma-sec{width:100%;border-collapse:collapse;margin-top:50px}
    .firma-sec td{text-align:center;width:50%}
    .firma-box{text-align:center}
    .firma-linea{border-bottom:1px solid #333;width:220px;margin:0 auto 6px}
    .seccion{margin-bottom:14px}
  </style></head><body>
  <div class="logo">
    <div style="font-size:20px;font-weight:900;color:#0a2463;letter-spacing:1px">${EMPRESA}</div>
    <div style="font-size:12px;color:#888">${SLOGAN}</div>
  </div>
  <div class="subtit">CREDITO NUEVO</div>

  <div class="seccion">
    <table class="linea"><tr>
      <td style="width:auto"><span class="lbl">FECHA DE SOLICITUD</span><br/><span class="campo">&nbsp;${hoyFmt}&nbsp;</span></td>
      <td style="width:auto"><span class="lbl">MONTO:</span><br/><span class="campo">&nbsp;${formatMoneda(prestamo.monto)}&nbsp;</span></td>
      <td style="width:auto"><span class="lbl">CICLO:</span><br/><span class="campo">&nbsp;${prestamo.numero_credito ?? ''}&nbsp;</span></td>
    </tr></table>
    <table class="linea"><tr>
      <td><span class="lbl">CUOTA:</span><br/><span class="campo">&nbsp;${formatMoneda(prestamo.cuota)}&nbsp;</span></td>
      <td><span class="lbl">Nº DE EXPEDIENTE:</span><br/><span class="campo">&nbsp;${fmtExp(c?.numero_expediente)}&nbsp;</span></td>
    </tr></table>
    <table class="linea"><tr>
      <td><span class="lbl">SUCURSAL:</span><br/><span class="campo">&nbsp;</span></td>
      <td><span class="lbl">FORMA DE PAGO:</span><br/><span class="campo">&nbsp;${diasSemana[prestamo.frecuencia]||''}&nbsp;</span></td>
    </tr></table>
    <table class="linea"><tr>
      <td style="width:100%"><span class="lbl">NOMBRE:</span><br/><span class="campo">&nbsp;${c?.nombre||''}&nbsp;</span></td>
    </tr></table>
    <table class="linea"><tr>
      <td><span class="lbl">DUI:</span><br/><span class="campo">&nbsp;${c?.dui||''}&nbsp;</span></td>
      <td><span class="lbl">TELÉFONO:</span><br/><span class="campo">&nbsp;${c?.telefono||''}&nbsp;</span></td>
    </tr></table>
    <table class="linea"><tr>
      <td style="width:100%"><span class="lbl">DOMICILIO:</span><br/><span class="campo">&nbsp;${c?.direccion||''}&nbsp;</span></td>
    </tr></table>
  </div>

  <table class="linea" style="margin-top:20px"><tr>
    <td style="width:100%"><span class="lbl">FIRMA:</span><br/><span class="campo">&nbsp;</span></td>
  </tr></table>

  <div class="parrafo">
    YO(CLIENTE),&nbsp;<span style="border-bottom:1px solid #333;padding:0 90px">&nbsp;${c?.nombre||''}&nbsp;</span>&nbsp;
    ME CONSTITUYO DEUDOR(A) DE LA INSTITUCIÓN ${EMPRESA}, POR UN CRÉDITO APROBADO ESTE DÍA DE LA CANTIDAD DE
    $&nbsp;<b>${prestamo.monto.toFixed(2)}</b>&nbsp;${enLetras}, PARA UN PLAZO DE
    &nbsp;<span style="border-bottom:1px solid #333;padding:0 24px">&nbsp;${prestamo.plazo}&nbsp;</span>&nbsp;
    CON UNA CUOTA DE&nbsp;<span style="border-bottom:1px solid #333;padding:0 24px">&nbsp;${formatMoneda(prestamo.cuota)}&nbsp;</span>&nbsp;
    ${diasSemana[prestamo.frecuencia]||''}
    &nbsp;DIA DE PAGO&nbsp;<span style="border-bottom:1px solid #333;padding:0 50px">&nbsp;${formatFecha(prestamo.fecha_inicio)}&nbsp;</span>&nbsp;
    EN EL CUAL ME OBLIGO A PAGAR EN EL TIEMPO Y FORMA ESTABLECIDO.
    TAMBIÉN HAGO CONSTAR QUE ME COMPROMETO A PAGAR LA MORA ESTABLECIDA EN CASO DE INCUMPLIMIENTO CON LA FECHA ACORDADA.
  </div>

  <div class="seccion">
    <table class="linea"><tr>
      <td><span class="lbl">MONTO REFINANCIADO:</span><br/><span class="campo">&nbsp;</span></td>
      <td><span class="lbl">FECHA DE DESEMBOLSO:</span><br/><span class="campo">&nbsp;${formatFecha(prestamo.fecha_inicio)}&nbsp;</span></td>
    </tr></table>
    <table class="linea"><tr>
      <td style="width:70%"><span class="lbl">PERSONA QUE ENTREGA:</span><br/><span class="campo">&nbsp;${(cobrador||'').toUpperCase()}&nbsp;</span></td>
      <td><span class="lbl">F:</span><br/><span class="campo">&nbsp;</span></td>
    </tr></table>
  </div>

  <!-- Observaciones -->
  <div style="margin-top:18px">
    <div style="font-size:12px;font-weight:bold;margin-bottom:6px">OBSERVACIONES:</div>
    <div style="border:1px solid #ccc;min-height:60px;border-radius:4px;padding:6px">&nbsp;</div>
  </div>

  <table class="firma-sec" style="margin-top:40px"><tr>
    <td class="firma-box">
      <div style="font-size:13px">F.________________________________</div>
      <div style="font-size:12px;margin-top:6px">FIRMA DE RECIBIDO (CLIENTE)</div>
    </td>
    <td class="firma-box">
      <div style="font-size:13px">F.________________________________</div>
      <div style="font-size:12px;margin-top:6px">FIRMA DEL EJECUTIVO</div>
    </td>
  </tr></table>

  <div style="margin-top:24px;text-align:center;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:8px">
    ${EMPRESA} · Documento generado el ${hoyFmt}
  </div></body></html>`;
  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   3. SOLICITUD DE CRÉDITO NUEVO (3 secciones)
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFSolicitud(cliente: Cliente, expediente: string) {
  const hoyFmt = formatFecha(new Date().toISOString().split('T')[0]);
  const camp = (label: string, val = '', flex = 1) =>
    `<div style="display:flex;gap:4px;align-items:flex-end;margin-bottom:5px;flex:${flex}">
      <span style="font-weight:bold;font-size:11px;white-space:nowrap">${label}:</span>
      <span style="border-bottom:1px solid #444;flex:1;font-size:12px;min-height:18px;display:inline-block">&nbsp;${val}&nbsp;</span>
    </div>`;
  const row = (...campos: string[]) =>
    `<div style="display:flex;gap:8px;margin-bottom:2px">${campos.join('')}</div>`;
  const seccion = (titulo: string, contenido: string) =>
    `<div style="background:#0a2463;color:#fff;text-align:center;font-weight:bold;font-size:12px;padding:5px;margin:8px 0 5px">
      ${titulo}</div>${contenido}`;

  // Filas de la tabla de dación en pago (10 artículos — caben en 1 página)
  const filasDacion = Array.from({length:10}, (_,i) => `
    <tr>
      <td style="text-align:center;width:28px;border:1px solid #999;padding:2px 3px">${i+1}</td>
      <td style="border:1px solid #999;padding:2px 3px">&nbsp;</td>
      <td style="border:1px solid #999;padding:2px 3px">&nbsp;</td>
      <td style="border:1px solid #999;padding:2px 3px">&nbsp;</td>
      <td style="border:1px solid #999;padding:2px 3px">&nbsp;</td>
      <td style="border:1px solid #999;padding:2px 3px">&nbsp;</td>
      <td style="border:1px solid #999;padding:2px 3px">&nbsp;</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${PAGE_RESET}
    body{font-family:'Arial Narrow',Arial,sans-serif;padding:14px 20px;font-size:12px;color:#111;max-width:740px;margin:0 auto}
    .hdr{width:100%;border-collapse:collapse;margin-bottom:4px;border-bottom:2px solid #0a2463;padding-bottom:5px}
    .hdr td{border:none;vertical-align:middle;padding:0}
    .empresa{font-size:16px;font-weight:900;color:#0a2463}
    .titulo-doc{text-align:center;font-size:14px;font-weight:bold;background:#0a2463;color:#fff;padding:5px;margin-bottom:6px}
    .page-break{page-break-before:always;padding-top:14px}
    table{width:100%;border-collapse:collapse}
    th{background:#0a2463;color:#fff;font-size:11px;padding:3px 4px;border:1px solid #0a2463;text-align:center}
  </style></head><body>

  <!-- ══════ PÁGINA 1: SOLICITUD DE CRÉDITO ══════ -->
  <div class="hdr">
    <div>
      <div class="empresa">${EMPRESA}</div>
      <div style="font-size:9px;color:#666">${SLOGAN}</div>
    </div>
  </div>
  <div class="titulo-doc">SOLICITUD DE CRÉDITO NUEVO</div>

  ${row(camp('FECHA Y LUGAR', hoyFmt), camp('N° DE EXP', expediente), camp('FORMA DE PAGO'))}
  ${row(camp('DESTINO DEL CRÉDITO', '', 2), camp('VALOR SOLICITADO'))}

  ${seccion('DATOS PERSONALES', `
    ${row(camp('NOMBRE', cliente.nombre, 3), camp('SEXO'))}
    ${row(camp('DUI', cliente.dui||''), camp('NIT'), camp('FECHA DE NACIMIENTO'), camp('ESTADO CIVIL'))}
    ${row(camp('DEPENDIENTES'), camp('OCUPACIÓN SEGÚN EL DUI', '', 2))}
    ${row(camp('ACTIVIDAD ECONÓMICA', '', 2), camp('NIVEL EDUCATIVO'))}
  `)}

  ${seccion('CONTACTO', `
    ${row(camp('CELULAR', cliente.telefono||''), camp('CORREO ELECTRÓNICO'), camp('NÚMERO DE EMERGENCIA'))}
  `)}

  ${seccion('VIVIENDA', `
    ${row(camp('TENENCIA'), camp('ALQUILADA'), camp('PROPIA'), camp('AÑOS DE RESIDENCIA'))}
    ${row(camp('DEPARTAMENTO'), camp('CÓDIGO DE CLIENTE'), camp('MUNICIPIO'))}
    ${row(camp('DIRECCIÓN', cliente.direccion||'', 3))}
  `)}

  ${seccion('REFERENCIAS PERSONALES', `
    <b style="font-size:9px">REFERENCIA #1</b>
    ${row(camp('NOMBRE', (cliente as any).ref1_nombre||'', 2), camp('OCUPACIÓN'), camp('PARENTESCO', (cliente as any).ref1_parentesco||''))}
    ${row(camp('TELÉFONO', (cliente as any).ref1_telefono||''), camp('DIRECCIÓN', '', 2))}
    <b style="font-size:9px">REFERENCIA #2</b>
    ${row(camp('NOMBRE', (cliente as any).ref2_nombre||'', 2), camp('OCUPACIÓN'), camp('PARENTESCO', (cliente as any).ref2_parentesco||''))}
    ${row(camp('TELÉFONO', (cliente as any).ref2_telefono||''), camp('DIRECCIÓN', '', 2))}
  `)}

  ${seccion('DATOS LABORALES DEL CLIENTE', `
    ${row(camp('LUGAR DEL TRABAJO', '', 2), camp('DIRECCIÓN', '', 2))}
    ${row(camp('SALARIO MENSUAL'), camp('CARGO'), camp('JEFE INMEDIATO'))}
  `)}

  ${seccion('DATOS DEL NEGOCIO', `
    ${row(camp('NOMBRE DEL NEGOCIO', '', 2), camp('TIPO DEL NEGOCIO'))}
    ${row(camp('VENTAS MENSUALES'), camp('GANANCIAS'), camp('GASTOS'))}
    ${row(camp('DIRECCIÓN DEL NEGOCIO', '', 3))}
  `)}

  <!-- ══════ PÁGINA 2: DACIÓN EN PAGO ══════ -->
  <div class="page-break" style="page-break-inside:avoid">
    <div style="text-align:center;font-size:16px;font-weight:900;color:#0a2463;margin-bottom:2px">${EMPRESA}</div>
    <div style="text-align:center;font-size:15px;font-weight:bold;border:2px solid #0a2463;padding:4px;margin-bottom:8px;letter-spacing:2px">
      DACIÓN EN PAGO
    </div>

    <div style="font-size:13px;line-height:1.8;margin-bottom:8px;text-align:justify">
      Yo:&nbsp;<span style="border-bottom:1px solid #333;padding:0 120px">&nbsp;<b>${cliente.nombre||''}</b>&nbsp;</span>
      &nbsp;de&nbsp;<span style="border-bottom:1px solid #333;padding:0 30px">&nbsp;</span>&nbsp;años de edad,
      de profesión u oficio&nbsp;<span style="border-bottom:1px solid #333;padding:0 80px">&nbsp;</span>
      <br/>
      y de domicilio&nbsp;<span style="border-bottom:1px solid #333;padding:0 200px">&nbsp;<b>${cliente.direccion||''}</b>&nbsp;</span>
      <br/>
      que me identifico con el número de DUI&nbsp;<span style="border-bottom:1px solid #333;padding:0 60px">&nbsp;<b>${cliente.dui||''}</b>&nbsp;</span>
      &nbsp;y número de NIT&nbsp;<span style="border-bottom:1px solid #333;padding:0 60px">&nbsp;</span>
      &nbsp;declaro que desde este momento las garantías abajo detalladas
      son de la empresa <b>${EMPRESA}</b> como garantía al crédito que otorgan
      y que los faculte para proceder al retiro de las mismas una vez el crédito sin estar cancelado y sin
      ejecución de proceso legal previo.
    </div>

    <table style="margin-bottom:8px">
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>DESCRIPCIÓN</th>
          <th>MARCA</th>
          <th>MODELO</th>
          <th>SERIE</th>
          <th>COLOR</th>
          <th>PRECIO</th>
        </tr>
      </thead>
      <tbody>${filasDacion}</tbody>
    </table>

    <div style="font-weight:bold;font-size:12px;margin-bottom:4px;text-align:center;background:#e0e0e0;padding:3px">
      CARGOS MORATORIOS
    </div>
    <div style="font-size:12px;margin-bottom:2px">
      1. Se recargará el 10% adicional al saldo que no se solvente luego de la fecha de vencimiento indicada.
    </div>
    <div style="font-size:12px;margin-bottom:10px">
      2. Luego de 10 días de vencido el crédito y no retomar regularidad de abono o acuerdos de pago, se procederá
      al retiro de los artículos comprometidos con la empresa ${EMPRESA}.
    </div>

    <div style="display:flex;justify-content:space-between;margin-top:30px;font-size:14px">
      <div style="text-align:center;width:45%">
        <div style="border-bottom:2px solid #333;height:48px;margin-bottom:8px"></div>
        <div style="margin-bottom:6px">NOMBRE:&nbsp;<span style="border-bottom:1px solid #333;display:inline-block;width:160px;height:24px">&nbsp;</span></div>
        <div style="font-size:13px;font-weight:700">FIRMA DEL DEUDOR</div>
      </div>
      <div style="text-align:center;width:45%">
        <div style="border-bottom:2px solid #333;height:48px;margin-bottom:8px"></div>
        <div style="margin-bottom:6px">NOMBRE:&nbsp;<span style="border-bottom:1px solid #333;display:inline-block;width:160px;height:24px">&nbsp;</span></div>
        <div style="font-size:13px;font-weight:700">FIRMA DEL EJECUTIVO</div>
      </div>
    </div>

    <div style="text-align:center;font-size:8px;color:#aaa;border-top:1px solid #ddd;padding-top:5px;margin-top:20px">
      ${EMPRESA} · Dación en Pago generada el ${hoyFmt}
    </div>
  </div>

  <!-- ══════ PÁGINA 3: DECLARACIONES + COMITÉ EVALUADOR ══════ -->
  <div class="page-break">
    <div style="text-align:center;font-size:17px;font-weight:900;color:#0a2463;margin-bottom:12px">${EMPRESA}</div>

    <!-- Declaración Jurada Lavado de Dinero -->
    <div style="background:#333;color:#fff;text-align:center;font-weight:bold;font-size:16px;padding:8px;margin-bottom:16px;letter-spacing:1px">
      DECLARACIÓN JURADA SOBRE LAVADO DE DINERO
    </div>
    <div style="font-size:14px;margin-bottom:12px;text-align:justify;line-height:1.7">
      Yo&nbsp;<span style="border-bottom:1px solid #333;padding:0 80px">&nbsp;<b>${cliente.nombre||''}</b>&nbsp;</span>
      &nbsp;con documento único de identidad No.&nbsp;<span style="border-bottom:1px solid #333;padding:0 40px">&nbsp;<b>${cliente.dui||''}</b>&nbsp;</span>
      &nbsp;actuando en lo personal o a nombre y/o representación&nbsp;<span style="border-bottom:1px solid #333;padding:0 50px">&nbsp;</span>
      &nbsp;para efectos de la Ley para la Prevención de Lavado de Dinero y de Activos, declaro bajo juramento que
      toda la información proporcionada en este formulario es real y verídica y que la declaración de fuentes
      de ingresos y/o recursos son fidedignas y provienen de actividades lícitas y que pueden ser verificados
      ante cualquier persona natural o jurídica, privada o pública, sin limitación alguna desde ahora
      y mientras subsista alguna relación de servicios con <b>${EMPRESA}.</b>
      En constancia de haber leído, entendido y aceptado lo anterior, firmo el presente Formulario en la
      ciudad de&nbsp;<span style="border-bottom:1px solid #333;padding:0 80px">&nbsp;</span>.
    </div>

    <!-- Firmas declaración lavado -->
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;gap:20px">
      <div style="flex:1;text-align:center">
        <div style="border-bottom:2px solid #333;height:36px;margin-bottom:6px"></div>
        <div style="font-size:13px;font-weight:700">NOMBRE DE PRESTAMISTA</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="border-bottom:2px solid #333;height:36px;margin-bottom:6px"></div>
        <div style="font-size:13px;font-weight:700">NOMBRE Y FIRMA DE PRESTARIO</div>
      </div>
    </div>

    <!-- Espacio reservado CAS Express -->
    <div style="font-size:13px;font-weight:bold;margin-bottom:6px">Espacio reservado para ${EMPRESA}.</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;gap:16px">
      <div style="flex:2">
        <div style="font-size:13px;margin-bottom:4px">NOMBRE DE QUIEN RECIBE LA INFORMACIÓN:</div>
        <div style="border-bottom:2px solid #333;height:28px"></div>
      </div>
      <div style="flex:1">
        <div style="font-size:13px;margin-bottom:4px">FIRMA:</div>
        <div style="border-bottom:2px solid #333;height:28px"></div>
      </div>
    </div>

    <hr style="border:none;border-top:2px solid #333;margin-bottom:10px"/>

    <!-- Declaración Jurada Veracidad -->
    <div style="background:#333;color:#fff;text-align:center;font-weight:bold;font-size:14px;padding:6px;margin-bottom:10px;letter-spacing:1px">
      DECLARACIÓN JURADA SOBRE LA VERACIDAD DE LA INFORMACIÓN
    </div>
    <div style="font-size:14px;margin-bottom:12px;text-align:justify;line-height:1.7">
      Declaro que la información antes solicitada es verdadera y faculto a <b>${EMPRESA}</b> para que haga las
      verificaciones necesarias, así como ser consultada en los buros de crédito y a su vez me someto a penalidades
      de ley si la información fuese falsa.
    </div>

    <!-- Firma del cliente -->
    <div style="display:flex;justify-content:space-between;margin-bottom:14px;gap:20px">
      <div style="flex:1;text-align:center">
        <div style="border-bottom:2px solid #333;height:36px;margin-bottom:6px"></div>
        <div style="font-size:13px;font-weight:700">NOMBRE Y FIRMA DEL CLIENTE</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="border-bottom:2px solid #333;height:36px;margin-bottom:6px"></div>
        <div style="font-size:13px;font-weight:700">NOMBRE Y FIRMA DEL EJECUTIVO</div>
      </div>
    </div>

    <!-- Espacio para Comité Evaluador -->
    <div style="border:2px solid #333;padding:10px;page-break-inside:avoid">
      <div style="font-weight:bold;font-size:14px;margin-bottom:10px;text-decoration:underline">
        ESPACIO PARA COMITÉ EVALUADOR:
      </div>

      <div style="display:flex;gap:16px;margin-bottom:10px">
        <div style="flex:2">
          <div style="font-size:13px;margin-bottom:4px">CRÉDITO APROBADO POR: $</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;margin-bottom:4px">CUOTA DE: $</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:10px">
        <div style="flex:2">
          <div style="font-size:13px;margin-bottom:4px">PLAZO DEL CRÉDITO:</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;margin-bottom:4px">DÍAS:</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
        <div style="flex:2">
          <div style="font-size:13px;margin-bottom:4px">A PARTIR DEL DÍA:</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:4px">
        <div style="flex:2">
          <div style="font-size:13px;margin-bottom:4px">NOMBRE QUIEN AUTORIZA:</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;margin-bottom:4px">FIRMA:</div>
          <div style="border-bottom:2px solid #333;height:26px"></div>
        </div>
      </div>
    </div>

    <div style="text-align:center;font-size:9px;color:#aaa;border-top:1px solid #ddd;padding-top:4px;margin-top:12px">
      ${EMPRESA} · Solicitud generada el ${hoyFmt}
    </div>
  </div>

  </body></html>`;
  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   4. COLECTA DEL DÍA
   ══════════════════════════════════════════════════════════════ */
export interface ItemColecta {
  cliente: string;
  expediente?: string;
  telefono?: string;
  geoLocal?: string;         // código/URL de geo localización
  fechaVencimiento?: string; // fecha en que vence la cuota
  plazo: number;
  monto: number;             // monto original del préstamo
  cuota: number;
  frecuencia: string;
  numeroCuota: number;
  mora: number;              // atraso/pagar acumulado
  deudaTotal?: number;       // deuda total pendiente del préstamo
}

/** Suma N días a una fecha en formato YYYY-MM-DD */
function agregarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

/** Devuelve el día de la semana en español para préstamos semanales */
function diaSemana(fechaInicio: string): string {
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const d = new Date(fechaInicio + 'T00:00:00');
  // El primer pago cae 7 días después del inicio
  d.setDate(d.getDate() + 7);
  return dias[d.getDay()];
}

export async function generarPDFColecta(
  fecha: string,
  items: ItemColecta[],
  ruta: string,
  cobrador: string = ''
) {
  // ── Ordenar por número de expediente ascendente ──
  const itemsOrdenados = [...items].sort((a, b) => {
    const numA = parseInt((a.expediente || '').replace(/\D/g, '') || '99999');
    const numB = parseInt((b.expediente || '').replace(/\D/g, '') || '99999');
    return numA - numB;
  });

  const totalCuotas  = itemsOrdenados.reduce((s,c) => s + c.cuota, 0);
  const totalMora    = itemsOrdenados.reduce((s,c) => s + c.mora, 0);
  const totalDeuda   = itemsOrdenados.reduce((s,c) => s + (c.deudaTotal || 0), 0);

  // ── Calcular altura de fila dinámica para llenar la página ──
  // Mínimo 20px (antes 14px) para que las casillas de "Abono $" y "Firma"
  // queden cómodas para escribir a mano; si no caben todas en una página,
  // la tabla continúa en la siguiente (paginación automática del navegador).
  const rowH = Math.max(20, Math.min(36, Math.floor(470 / Math.max(itemsOrdenados.length, 1))));
  // Font size un poco más grande manteniendo el mismo tamaño de celda
  const fs   = rowH >= 28 ? 14 : rowH >= 20 ? 12 : 11;

  const filas = itemsOrdenados.map((c, i) => {
    const frecTxt = c.frecuencia === 'semanal'
      ? `SEMANAL ${diaSemana(c.fechaVencimiento || fecha)}`
      : c.frecuencia === 'diario' ? 'DIARIO' : 'MENSUAL';
    const venceFmt = c.fechaVencimiento ? formatFecha(agregarDias(c.fechaVencimiento, 5)) : '';
    const atraso   = c.mora;
    const deuda    = c.deudaTotal ?? 0;
    const pad      = Math.max(2, Math.floor((rowH - fs) / 2));

    return `
    <tr class="${i%2===0?'par':'impar'}" style="height:${rowH}px">
      <td class="tc" style="font-size:${fs}px;padding:${pad}px 4px;color:#666">${i+1}</td>
      <td style="font-size:${fs}px;padding:${pad}px 5px">
        ${c.expediente ? `<span style="font-size:${fs-1}px;color:#1565c0;font-weight:600">${fmtExp(c.expediente)}&nbsp;</span>` : ''}
        <b>${c.cliente}</b>
      </td>
      <td class="tc" style="font-size:${fs-1}px;color:#444;padding:${pad}px 3px">${c.geoLocal||''}</td>
      <td class="tc" style="font-size:${fs}px;padding:${pad}px 3px">${venceFmt}</td>
      <td class="tc" style="font-size:${fs}px;padding:${pad}px 3px">${c.plazo}</td>
      <td class="tr" style="font-size:${fs}px;padding:${pad}px 5px">${c.monto.toFixed(2)}</td>
      <td class="tr" style="font-size:${fs}px;padding:${pad}px 5px">${c.cuota.toFixed(2)}</td>
      <td class="tr" style="font-size:${fs}px;padding:${pad}px 5px;color:${atraso>0?'#c62828':atraso<0?'#2e7d32':'#333'}">${atraso.toFixed(2)}</td>
      <td class="tr" style="font-size:${fs}px;padding:${pad}px 5px">${deuda>0?deuda.toFixed(2):''}</td>
      <td style="font-size:${fs}px;text-align:center;padding:${pad}px 3px">${frecTxt}</td>
      <td style="width:78px;height:${rowH}px"></td>
      <td style="width:78px;height:${rowH}px"></td>
    </tr>`;
  }).join('');

  const fechaFmt = formatFecha(fecha);
  // Tamaño de encabezado proporcional a rowH
  const hdrFs = fs + 1;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{margin:7mm 9mm;size:letter landscape}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Arial,Helvetica,sans-serif;font-size:${fs}px;color:#1a1a2e;margin:0;padding:4px 8px}
    /* ── Encabezado (TABLE — flex no funciona en html2canvas) ── */
    .hdr-tbl{width:100%;border-collapse:collapse;border-bottom:3px solid #1565c0;padding-bottom:4px;margin-bottom:5px}
    .hdr-tbl td{border:none;vertical-align:bottom;padding:0 0 4px 0}
    .titulo{font-size:${hdrFs+2}px;font-weight:900;color:#1565c0;letter-spacing:.5px;text-transform:uppercase}
    .sub{font-size:${hdrFs}px;color:#444;margin-top:1px}
    .hdr-right{text-align:right;font-size:${fs}px;color:#555}
    .hdr-right .fecha{font-size:${hdrFs+1}px;font-weight:700;color:#1565c0}
    /* ── Tabla datos (gradient → solid; html2canvas no soporta gradient) ──
       NOTA: html2canvas no pinta fondos puestos en <tr>/<thead>/<tfoot> —
       hay que ponerlos en cada <th>/<td> directamente. ── */
    table.datos{width:100%;border-collapse:collapse;table-layout:fixed}
    table.datos th{background:#1565c0;color:#fff;padding:5px 4px;font-size:${fs}px;text-align:center;
       border:1px solid #1a4f99;font-weight:700;white-space:nowrap;letter-spacing:.2px}
    table.datos td{border:1px solid #d0d7e3;overflow:hidden;padding:0;background:#fff}
    table.datos tr.par td{background:#f0f4ff}
    table.datos tr.impar td{background:#fff}
    .tc{text-align:center} .tr{text-align:right}
    /* ── Totales ── */
    table.datos tfoot td{background:#1565c0;color:#fff;font-weight:700;border:1px solid #1a4f99;font-size:${fs}px;padding:4px 5px}
    /* ── Firma (TABLE — flex no funciona en html2canvas) ── */
    .firmas-tbl{margin-top:5px;width:100%;border-collapse:collapse}
    .firmas-tbl td{border-bottom:1.5px solid #1565c0;padding:0 8px 2px 0;
                   font-size:${fs}px;color:#333;width:33%}
    .firmas-tbl .lbl{color:#1565c0;font-weight:600;font-size:${fs-1}px;display:block}
    .footer{margin-top:4px;text-align:center;font-size:7px;color:#999;
            border-top:1px solid #e0e0e0;padding-top:3px;letter-spacing:.3px}
  </style></head><body>

  <table class="hdr-tbl"><tr>
    <td>
      <div class="titulo">Colecta · ${ruta}</div>
      <div class="sub">Cobrador: <b>${cobrador||ruta}</b> &nbsp;·&nbsp; Todas las líneas &nbsp;·&nbsp; Todos los tipos de pago</div>
    </td>
    <td class="hdr-right">
      <div class="fecha">${fechaFmt}</div>
      <div>${EMPRESA}</div>
    </td>
  </tr></table>

  <table class="datos">
    <colgroup>
      <col style="width:22px"/>
      <col/>
      <col style="width:50px"/>
      <col style="width:72px"/>
      <col style="width:32px"/>
      <col style="width:54px"/>
      <col style="width:52px"/>
      <col style="width:54px"/>
      <col style="width:56px"/>
      <col style="width:90px"/>
      <col style="width:78px"/>
      <col style="width:78px"/>
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th style="text-align:left">Expediente &nbsp; Nombre</th>
        <th>Geo<br/>Local.</th>
        <th>Vence</th>
        <th>Plazo</th>
        <th>Monto</th>
        <th>Cuota</th>
        <th>Atraso/<br/>Pagar</th>
        <th>Deuda<br/>Total</th>
        <th>Frecuencia<br/>de Pago</th>
        <th>Abono<br/>$</th>
        <th>Firma</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right;padding:4px 6px;letter-spacing:.5px">TOTALES</td>
        <td class="tr" style="padding:4px 5px"></td>
        <td class="tr" style="padding:4px 5px">${totalCuotas.toFixed(2)}</td>
        <td class="tr" style="padding:4px 5px;color:#ffcdd2">${totalMora.toFixed(2)}</td>
        <td class="tr" style="padding:4px 5px">${totalDeuda>0?totalDeuda.toFixed(2):''}</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>
  </table>

  <table class="firmas-tbl"><tr>
    <td><span class="lbl">Asesor</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
    <td><span class="lbl">Firma</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
    <td><span class="lbl">Efectivo $</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
  </tr></table>
  <div class="footer">${EMPRESA} &nbsp;·&nbsp; Colecta generada automáticamente &nbsp;·&nbsp; ${fechaFmt}</div>
  </body></html>`;
  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   5. CUADRATURA DIARIA (grid tipo planilla física 5×25)
   ══════════════════════════════════════════════════════════════ */
export interface SlotCuadratura {
  numero: number; cliente: string; monto: number | null;
}
export async function generarPDFCuadraturaDiaria(
  fecha: string, slots: SlotCuadratura[],
  cobrador: string, ruta: string, sucursal: string
) {
  // 50 slots — 2 columnas de 25 filas
  const total50: SlotCuadratura[] = Array.from({length:50}, (_,i) =>
    slots[i] || {numero:i+1, cliente:'', monto:null}
  );
  const colA = total50.slice(0, 25);
  const colB = total50.slice(25, 50);

  const totalEfec = slots.filter(s=>s.monto!=null).reduce((a,s)=>a+(s.monto||0),0);
  const cobrados  = slots.filter(s=>s.monto!=null).length;

  const celdas = Array.from({length:25}, (_,row) => {
    const a = colA[row], b = colB[row];
    const celda = (s: SlotCuadratura) =>
      `<td style="width:50%;border:1px solid #999;padding:3px 6px;height:20px">
        <span style="font-weight:900;font-size:11px;color:#0a2463">${s.numero}&nbsp;</span>
        <span style="font-size:11px;border-bottom:1px solid #bbb;display:inline-block;width:calc(100% - 24px);text-align:right;vertical-align:bottom">
          ${s.monto!=null?'<b>'+formatMoneda(s.monto)+'</b>':''}
        </span>
      </td>`;
    return `<tr>${celda(a)}${celda(b)}</tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${PAGE_RESET}
    body{font-family:Arial,sans-serif;padding:14px 18px;font-size:11px;color:#111}
    table{width:100%;border-collapse:collapse}
    .hdr{text-align:center;margin-bottom:8px}
    .meta{width:100%;border-collapse:collapse;margin-bottom:6px;border-bottom:1px solid #ccc}
    .meta td{font-size:11px;padding:2px 8px 4px 0;width:33%}
    .totales{margin-top:8px;width:100%;border-collapse:collapse;border:1px solid #ccc;padding:0}
    .totales td{padding:2px 6px;vertical-align:top;width:50%}
    .tot-campo{margin-bottom:5px;display:table;width:100%}
    .tot-lbl{font-weight:bold;font-size:10px;white-space:nowrap;display:table-cell;padding-right:4px}
    .tot-val{border-bottom:1px solid #333;font-size:11px;text-align:right;display:table-cell;width:100%}
  </style></head><body>
  <div class="hdr">
    <div style="font-size:16px;font-weight:900;color:#0a2463">${EMPRESA}</div>
    <div style="font-size:13px;font-weight:bold;margin-top:2px">CUADRATURA DIARIA</div>
  </div>
  <table class="meta"><tr>
    <td><b>SUCURSAL:</b> ${sucursal||'_______________'}</td>
    <td><b>ZONA:</b> _______________</td>
    <td></td>
  </tr></table>
  <table class="meta"><tr>
    <td><b>COBRADOR:</b> ${cobrador||'_______________'}</td>
    <td><b>RUTA:</b> ${ruta||'_______________'}</td>
    <td><b>FECHA:</b> ${formatFecha(fecha)}</td>
  </tr></table>
  <table><tbody>${celdas}</tbody></table>
  <table class="totales"><tr>
    <td>
      <div class="tot-campo"><span class="tot-lbl">Total Efectivo $</span><span class="tot-val">${cobrados>0?formatMoneda(totalEfec):''}</span></div>
      <div class="tot-campo"><span class="tot-lbl">Monto a refinanciar $</span><span class="tot-val"></span></div>
      <div class="tot-campo"><span class="tot-lbl">TOTAL COBRO $</span><span class="tot-val">${cobrados>0?formatMoneda(totalEfec):''}</span></div>
    </td>
    <td>
      <div class="tot-campo"><span class="tot-lbl">Depósito $</span><span class="tot-val"></span></div>
      <div class="tot-campo"><span class="tot-lbl">Semanal $</span><span class="tot-val"></span></div>
      <div class="tot-campo"><span class="tot-lbl">Nota:</span><span class="tot-val"></span></div>
    </td>
  </tr></table>
  <div style="margin-top:5px;text-align:center;font-size:8px;color:#aaa;border-top:1px solid #ddd;padding-top:4px">
    ${EMPRESA} · Cuadratura generada el ${formatFecha(fecha)}
  </div></body></html>`;
  return imprimir(html);
}

/* Helpers internos para el reporte diario */
function _cssDiario(): string {
  return `
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1a1a1a;margin:0;padding:0}
    .bloque{padding:6px 10px}
    .corte{text-align:left;font-size:9px;color:#aaa;border-top:1px dashed #aaa;padding:2px 0;letter-spacing:2px;margin:2px 0}
    .footer{text-align:center;font-size:7px;color:#aaa;border-top:1px solid #eee;padding:3px;letter-spacing:.3px}

    /* ── Header: TABLE (flex no funciona en html2canvas) ── */
    .hdr-tbl{width:100%;border-collapse:collapse;border-bottom:2px solid #0a2463;padding-bottom:5px;margin-bottom:6px}
    .hdr-empresa{font-size:12px;font-weight:900;color:#0a2463;letter-spacing:.5px}
    .hdr-slogan{font-size:8px;color:#888;margin-top:1px}
    .hdr-badge{background:#0a2463;color:#fff;border-radius:5px;padding:3px 8px;font-size:8px;font-weight:700;letter-spacing:.5px;display:inline-block}
    .hdr-fecha{font-size:8px;color:#555;margin-top:3px}

    /* ── Meta: TABLE (grid no funciona en html2canvas) ── */
    .meta-tbl{width:100%;border-collapse:collapse;margin-bottom:6px;background:#f5f7ff;border-left:3px solid #0a2463}
    .mlbl{font-size:8px;font-weight:800;color:#0a2463;text-transform:uppercase;letter-spacing:.4px;padding:3px 4px 3px 8px;width:58px;white-space:nowrap}
    .mval{font-size:9px;color:#222;padding:3px 8px 3px 2px;border-bottom:1px solid #dde0e8}

    /* ── Cards resumen: TABLE ── */
    .cards-tbl{width:100%;border-collapse:separate;border-spacing:4px;margin-bottom:6px}
    .card{padding:5px 6px;text-align:center;border-radius:5px}
    .card-ent{background:#e8f5e9;border:1px solid #a5d6a7}
    .card-sal{background:#fce4ec;border:1px solid #f48fb1}
    .card-sdo{background:#e3f2fd;border:1px solid #90caf9}
    .card-cch{background:#fff8e1;border:1px solid #ffd54f}
    .card-lbl{font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px}
    .card-ent .card-lbl{color:#2e7d32} .card-sal .card-lbl{color:#c62828} .card-sdo .card-lbl{color:#1565c0} .card-cch .card-lbl{color:#a06c00}
    .card-val{font-size:13px;font-weight:900}
    .card-ent .card-val{color:#1b5e20} .card-sal .card-val{color:#b71c1c} .card-cch .card-val{color:#a06c00}

    /* ── Tabla datos ── */
    table.datos{width:100%;border-collapse:collapse}
    table.datos th{background:#0a2463;color:#fff;padding:4px 6px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border:1px solid #083080}
    table.datos td{border:1px solid #dde0e8;padding:3px 6px;font-size:9px}
    .tr{text-align:right} .tc{text-align:center}
    .sec-hdr td{background:#37474f;color:#fff;font-weight:700;font-size:9px;letter-spacing:.3px;padding:3px 6px}
    .row-ent td{background:#f1f8e9} .row-sal td{background:#fff8f8}
    .row-total td{background:#0a2463;color:#fff;font-weight:900;font-size:10px}
    .row-total .saldo-cell{background:#c8a951;color:#1a1a1a}

    /* ── Firmas: TABLE ── */
    .firmas-tbl{width:100%;border-collapse:collapse;margin-top:8px}
    .firma-campo{border-bottom:1.5px solid #0a2463;padding-bottom:2px;font-size:8px;color:#0a2463;font-weight:700;letter-spacing:.4px;width:48%}
    .firma-sep{width:4%}
  `;
}


function _bloqueReporteDiario(
  fecha: string, cobroDia: number, saldoAnterior: number,
  cobrador: string, ruta: string, zona: string,
  renovaciones: {descripcion:string;monto:number}[] = [],
  ingresoEfectivo = 0, deposito = 0, cajaChicaFondo = 0, cajaChicaAcum?: number,
  retiroCajaRazon = '', retiroCajaChica = 0
): string {
  // cajaChicaFondo = dinero puesto en caja chica HOY desde ingresos del día (salida real)
  // retiroCajaChica = dinero retirado del fondo acumulado (movimiento interno de la caja, NO afecta totalSalida)
  const cajaChicaTotal = cajaChicaAcum != null ? cajaChicaAcum : (cajaChicaFondo - retiroCajaChica);
  const totalRenov   = renovaciones.reduce((s, r) => s + (r.monto || 0), 0);
  const totalEntrada = saldoAnterior + cobroDia + ingresoEfectivo;
  const totalSalida  = deposito + cajaChicaFondo + totalRenov;  // retiro NO entra aquí
  const saldo        = totalEntrada - totalSalida;
  const M  = (n: number) => n ? formatMoneda(n) : '';
  const saldoColor = saldo >= 0 ? '#1b5e20' : '#b71c1c';

  const filaRenov = renovaciones.length
    ? renovaciones.map((r, i) => {
        const bg  = i % 2 === 0 ? '#fafafa' : '#fff';
        const esE = /^EXP\s/i.test(r.descripcion);
        const esF = /^FAC\s/i.test(r.descripcion);
        const esG = /^GTO\s/i.test(r.descripcion);
        const icon= esE ? '📋' : esF ? '🧾' : esG ? '💼' : '•';
        const desc= esF ? r.descripcion.replace(/^FAC\s/i,'') : esG ? r.descripcion.replace(/^GTO\s/i,'') : r.descripcion;
        // Fondo en cada <td> — html2canvas (PDF Android) ignora background en <tr>.
        return `<tr><td style="background:${bg};padding-left:18px;font-size:9px;color:#444">${icon} ${desc}</td><td style="background:${bg}"></td><td class="tr" style="background:${bg};font-size:9px;color:#b71c1c">${r.monto>0?formatMoneda(r.monto):''}</td><td style="background:${bg}"></td></tr>`;
      }).join('')
    : `<tr><td style="padding-left:18px;color:#bbb;font-size:9px;font-style:italic">Sin movimientos</td><td></td><td></td><td></td></tr>`;

  return `
    <!-- ── Header ── -->
    <table class="hdr-tbl"><tr>
      <td style="vertical-align:top">
        <div class="hdr-empresa">${EMPRESA}</div>
        <div class="hdr-slogan">${SLOGAN} · Reporte Financiero</div>
      </td>
      <td style="text-align:right;vertical-align:top;white-space:nowrap">
        <div class="hdr-badge">REPORTE DIARIO&nbsp;&nbsp;DE DISPONIBLE</div>
        <div class="hdr-fecha">${formatFecha(fecha)}</div>
      </td>
    </tr></table>

    <!-- ── Meta ── -->
    <table class="meta-tbl"><tr>
      <td class="mlbl">FECHA:</td><td class="mval">${formatFecha(fecha)}</td>
      <td class="mlbl">ZONA:</td><td class="mval">${zona||'—'}</td>
    </tr><tr>
      <td class="mlbl">RUTA:</td><td class="mval">${ruta||'—'}</td>
      <td class="mlbl">COBRADOR:</td><td class="mval">${cobrador||'—'}</td>
    </tr></table>

    <!-- ── Cards resumen ── -->
    <table class="cards-tbl"><tr>
      <td class="card card-ent">
        <div class="card-lbl">&#9650; Total Entradas</div>
        <div class="card-val">${formatMoneda(totalEntrada)}</div>
      </td>
      <td class="card card-sal">
        <div class="card-lbl">&#9660; Total Salidas</div>
        <div class="card-val">${formatMoneda(totalSalida)}</div>
      </td>
      <td class="card card-sdo">
        <div class="card-lbl">&#9670; Saldo</div>
        <div class="card-val" style="color:${saldoColor}">${formatMoneda(saldo)}</div>
      </td>
      <td class="card card-cch">
        <div class="card-lbl">&#128176; Caja Chica</div>
        <div class="card-val">${formatMoneda(cajaChicaTotal)}</div>
      </td>
    </tr></table>

    <!-- ── Tabla detalle ── -->
    <table class="datos">
      <thead><tr>
        <th style="text-align:left;width:55%">DETALLE</th>
        <th class="tr">ENTRADA</th><th class="tr">SALIDA</th><th class="tr">SALDO</th>
      </tr></thead>
      <tbody>
        <tr class="sec-hdr"><td colspan="4">&#9650; ENTRADAS</td></tr>
        <tr class="row-ent"><td><b>Saldo Anterior</b></td><td class="tr">${M(saldoAnterior)}</td><td></td><td></td></tr>
        <tr class="row-ent"><td><b>Cobro del Dia</b></td><td class="tr" style="color:#2e7d32;font-weight:700">${M(cobroDia)}</td><td></td><td></td></tr>
        ${ingresoEfectivo?`<tr class="row-ent"><td>Ingreso de Efectivo</td><td class="tr" style="color:#1565c0;font-weight:600">${M(ingresoEfectivo)}</td><td></td><td></td></tr>`:''}
        <tr class="sec-hdr"><td colspan="4">&#9660; SALIDAS</td></tr>
        ${deposito?`<tr class="row-sal"><td>Deposito</td><td></td><td class="tr">${M(deposito)}</td><td></td></tr>`:''}
        ${cajaChicaFondo>0?`<tr class="row-sal"><td>Caja Chica (fondo)</td><td></td><td class="tr">${M(cajaChicaFondo)}</td><td></td></tr>`:''}
        ${retiroCajaChica>0?`<tr class="row-sal" style="background:#fff8f0"><td style="color:#888;font-size:9px;padding-left:14px">🏧 Retiro caja chica${retiroCajaRazon?` — <i>${retiroCajaRazon}</i>`:''}<br/><span style="color:#aaa;font-size:8px">(movimiento interno, no contabilizado en total)</span></td><td></td><td class="tr" style="color:#e65100;font-size:9px">${M(retiroCajaChica)}</td><td></td></tr>`:''}
        <tr class="row-sal"><td><b>Renovaciones / Otros</b></td><td></td><td></td><td></td></tr>
        ${filaRenov}
        <tr class="row-total">
          <td>TOTAL</td>
          <td class="tr">${formatMoneda(totalEntrada)}</td>
          <td class="tr">${formatMoneda(totalSalida)}</td>
          <td class="tr saldo-cell">${formatMoneda(saldo)}</td>
        </tr>
      </tbody>
    </table>

    <!-- ── Firmas ── -->
    <table class="firmas-tbl"><tr>
      <td class="firma-campo">NOMBRE</td>
      <td class="firma-sep"></td>
      <td class="firma-campo">FIRMA</td>
    </tr></table>`;
}

/* ══════════════════════════════════════════════════════════════
   6. REPORTE DIARIO DE DISPONIBLE POR RUTA
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFReporteDiario(
  fecha: string, cobroDia: number, saldoAnterior: number,
  cobrador: string, ruta: string, zona: string,
  renovaciones: {descripcion: string; monto: number}[] = [],
  ingresoEfectivo = 0, deposito = 0, cajaChicaFondo = 0, cajaChicaAcum?: number,
  retiroCajaRazon = '', retiroCajaChica = 0
) {
  const bloque   = _bloqueReporteDiario(fecha, cobroDia, saldoAnterior, cobrador, ruta, zona,
    renovaciones, ingresoEfectivo, deposito, cajaChicaFondo, cajaChicaAcum, retiroCajaRazon, retiroCajaChica);
  const totalRenov  = renovaciones.reduce((s, r) => s + (r.monto || 0), 0);
  const totalEntrada = saldoAnterior + cobroDia + ingresoEfectivo;
  const totalSalida  = deposito + cajaChicaFondo + totalRenov;  // retiro no afecta total
  const saldo        = totalEntrada - totalSalida;
  const saldoColor   = saldo >= 0 ? '#1b5e20' : '#b71c1c';

  const CSS = _cssDiario();
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${PAGE_RESET}
    ${CSS}
    @page{margin:5mm 8mm;size:letter portrait}
    /* Override card-sdo color with saldo color */
    .card-sdo .card-val{color:${saldoColor}}
  </style></head><body>
  <div class="bloque">${bloque}</div>
  <div class="footer">${EMPRESA} &nbsp;·&nbsp; Reporte generado automaticamente &nbsp;·&nbsp; ${formatFecha(fecha)}</div>
  </body></html>`;
  return imprimir(html);
}


export async function generarPDFReportesJuntos(reportes: DatosReporteDiario[]) {
  const bloques = reportes.slice(0, 3).map(r =>
    _bloqueReporteDiario(
      r.fecha, r.cobroDia, r.saldoAnterior, r.cobrador, r.ruta, r.zona,
      r.renovaciones||[], r.ingresoEfectivo||0, r.deposito||0, r.cajaChica||0, (r as any).cajaChicaAcum,
      (r as any).retiroCajaRazon||'', (r as any).retiroCajaChica||0
    )
  );

  const corte = `<div class="corte">✂ &nbsp;- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>`;

  const CSS = _cssDiario();
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${PAGE_RESET} ${CSS}
    @page{margin:5mm 8mm;size:letter portrait}
  </style></head><body>
    <div class="bloque">${bloques[0]}</div>
    ${bloques[1] ? `${corte}<div class="bloque">${bloques[1]}</div>` : ''}
    ${bloques[2] ? `${corte}<div class="bloque">${bloques[2]}</div>` : ''}
    <div class="footer">${EMPRESA} &nbsp;·&nbsp; Impresión múltiple de reportes</div>
  </body></html>`;
  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   7. CARTERA GENERAL
   ══════════════════════════════════════════════════════════════ */
export interface ItemCartera {
  cliente:string; expediente?:string; monto:number; cuota:number; frecuencia:string;
  plazo:number; pagadas:number; saldo:number; mora:number; estado:string; fechaInicio:string;
}
export async function generarPDFCartera(items: ItemCartera[], fecha: string) {
  // Capital = suma de todos los items (ya vienen filtrados: solo activo y mora)
  const totMonto = items.reduce((s,i)=>s+i.monto,0);
  const totSaldo = items.reduce((s,i)=>s+i.saldo,0);
  const totMora  = items.reduce((s,i)=>s+i.mora,0);
  const activos  = items.filter(i=>i.estado==='activo').length;
  const enMora   = items.filter(i=>i.mora>0).length;
  const CE: Record<string,string> = {activo:'#1565c0',completado:'#2e7d32',mora:'#c62828',cancelado:'#666'};
  // Fondo en cada <td> — html2canvas (PDF Android) ignora background en <tr>.
  const filas = items.map((p,i) => {
    const bg = i%2===0?'#f9f9f9':'#fff';
    return `
    <tr>
      <td style="background:${bg}">${p.cliente}${p.expediente?`<br/><span style="color:#999;font-size:9px">Exp: ${fmtExp(p.expediente)}</span>`:''}</td>
      <td class="tc" style="background:${bg}">${formatFecha(p.fechaInicio)}</td>
      <td class="tr" style="background:${bg}">${formatMoneda(p.monto)}</td>
      <td class="tc" style="background:${bg}">${p.frecuencia}</td>
      <td class="tc" style="background:${bg}">${p.pagadas}/${p.plazo}</td>
      <td class="tr" style="background:${bg};color:#b71c1c"><b>${formatMoneda(p.saldo)}</b></td>
      <td class="tr" style="background:${bg};color:${p.mora>0?'#c62828':'#999'}">${p.mora>0?formatMoneda(p.mora):'-'}</td>
      <td class="tc" style="background:${bg}"><span style="color:${CE[p.estado]||'#666'};font-weight:bold;font-size:9px">${p.estado.toUpperCase()}</span></td>
    </tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseStyle}
    .hdr{border-bottom:3px solid #0a2463;padding-bottom:8px;margin-bottom:12px;width:100%;border-collapse:collapse}
    .hdr td{border:none;vertical-align:bottom;padding:0 0 8px 0}
    .cards{width:100%;border-collapse:collapse;margin-bottom:12px}
    .cards td{background:#f5f7ff;padding:8px;text-align:center;border:2px solid #fff}
    .card{flex:1;background:#f5f7ff;border-radius:6px;padding:8px;text-align:center}
    .v{font-size:16px;font-weight:bold}.l{font-size:9px;color:#888}
  </style></head><body>
  <div class="hdr">
    <div><b style="font-size:14px;color:#0a2463">${EMPRESA}</b><br/><span style="font-size:9px;color:#888">${SLOGAN} · Estado de Cartera</span></div>
    <div style="font-size:9px;color:#888">${formatFecha(fecha)}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="v" style="color:#1565c0">${activos}</div><div class="l">Activos</div></div>
    <div class="card"><div class="v" style="color:#c62828">${enMora}</div><div class="l">Con mora</div></div>
    <div class="card"><div class="v" style="color:#0a2463">${formatMoneda(totMonto)}</div><div class="l">Capital</div></div>
    <div class="card"><div class="v" style="color:#b71c1c">${formatMoneda(totSaldo)}</div><div class="l">Saldo pend.</div></div>
    <div class="card"><div class="v" style="color:#e65100">${formatMoneda(totMora)}</div><div class="l">Mora total</div></div>
  </div>
  <table><thead><tr><th>Cliente</th><th class="tc">Inicio</th><th class="tr">Monto</th><th class="tc">Freq.</th>
    <th class="tc">Cuotas</th><th class="tr">Saldo</th><th class="tr">Mora</th><th class="tc">Estado</th>
  </tr></thead><tbody>${filas}</tbody></table>
  <div style="margin-top:8px;text-align:right;font-size:10px">
    <b>Saldo total: ${formatMoneda(totSaldo)}</b> &nbsp;|&nbsp; <b style="color:#c62828">Mora: ${formatMoneda(totMora)}</b>
  </div>
  <div class="footer">${EMPRESA} · Cartera generada automáticamente</div></body></html>`;
  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   8. CUADRATURA / PAGOS DEL DÍA (tabla detallada)
   ══════════════════════════════════════════════════════════════ */
export interface ItemCuadratura {
  cliente:string; expediente?:string; numeroCuota:number; montoCuota:number; mora:number; total:number;
  cobrador:string; fechaPago:string;
}
export async function generarPDFCuadratura(fecha: string, items: ItemCuadratura[], ruta: string) {
  // ── Agrupar por cliente: un solo total por persona ──
  const mapaCliente = new Map<string, { cuotas: number; mora: number; total: number; cobrador: string; expediente: string }>();
  items.forEach(p => {
    const key = p.cliente;
    const prev = mapaCliente.get(key) || { cuotas: 0, mora: 0, total: 0, cobrador: p.cobrador, expediente: p.expediente || '' };
    mapaCliente.set(key, {
      cuotas:     prev.cuotas + p.montoCuota,
      mora:       prev.mora   + p.mora,
      total:      prev.total  + p.total,
      cobrador:   p.cobrador,
      expediente: p.expediente || prev.expediente,
    });
  });
  const agrupados = Array.from(mapaCliente.entries())
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => {
      const nA = parseInt(a.expediente.replace(/\D/g,'') || '99999');
      const nB = parseInt(b.expediente.replace(/\D/g,'') || '99999');
      return nA - nB;
    });

  const totalCuotas = agrupados.reduce((s,i)=>s+i.cuotas,0);
  const totalMora   = agrupados.reduce((s,i)=>s+i.mora,0);
  const totalEfec   = agrupados.reduce((s,i)=>s+i.total,0);

  // Fondo en cada <td> — html2canvas (PDF Android) ignora background en <tr>.
  const filas = agrupados.map((p,i) => {
    const bg = i%2===0?'#f9f9f9':'#fff';
    return `
    <tr>
      <td style="background:${bg}">${p.nombre}</td>
      <td class="tr" style="background:${bg}">${formatMoneda(p.cuotas)}</td>
      <td class="tr" style="background:${bg};color:${p.mora>0?'#c62828':'#999'}">${p.mora>0?formatMoneda(p.mora):'-'}</td>
      <td class="tr" style="background:${bg}"><b>${formatMoneda(p.total)}</b></td>
      <td style="background:${bg}">${p.cobrador}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseStyle}
    .hdr{border-bottom:3px solid #0a2463;padding-bottom:8px;margin-bottom:12px;width:100%;border-collapse:collapse}
    .hdr td{border:none;vertical-align:bottom;padding:0 0 8px 0}
    .totbox{background:#0a2463;color:#fff;border-radius:6px;padding:6px 12px;display:inline-block}
  </style></head><body>
  <div class="hdr">
    <div><b style="font-size:14px;color:#0a2463">${EMPRESA}</b><br/><span style="font-size:9px;color:#888">${SLOGAN} · Pagos del Día</span></div>
    <div style="text-align:right"><b style="font-size:14px;color:#0a2463">${formatFecha(fecha)}</b><br/><span style="font-size:9px;color:#888">Ruta: ${ruta}</span></div>
  </div>
  <table><thead><tr><th>Cliente</th><th class="tr">Cuotas</th><th class="tr">Mora</th><th class="tr">Total cobrado</th><th>Cobrador</th></tr></thead>
  <tbody>${filas}</tbody></table>
  <div style="margin-top:10px;text-align:right">
    <span class="totbox">Clientes: ${agrupados.length} &nbsp;|&nbsp; Cuotas: ${formatMoneda(totalCuotas)} &nbsp;|&nbsp; Mora: ${formatMoneda(totalMora)} &nbsp;|&nbsp; <b>TOTAL: ${formatMoneda(totalEfec)}</b></span>
  </div>
  <div style="margin-top:20px;display:flex;gap:50px;font-size:10px">
    <div>Supervisor:&nbsp;<span style="border-bottom:1px solid #333;padding:0 80px">&nbsp;</span></div>
    <div>Firma:&nbsp;<span style="border-bottom:1px solid #333;padding:0 80px">&nbsp;</span></div>
  </div>
  <div class="footer">${EMPRESA} · Cuadratura generada automáticamente</div></body></html>`;
  return imprimir(html);
}

/** Carga el logo y lo convierte a data-URL base64.
 *  En web usa canvas (evita expo-asset registry).
 *  En nativo usa expo-asset.
 *  Resultado cacheado en módulo para que llamadas repetidas sean instantáneas. */
let _logoCache: string | null = null;

async function logoBase64(): Promise<string> {
  // Caché de módulo: si ya lo cargamos una vez, retorna de inmediato
  if (_logoCache !== null) return _logoCache;

  // ── Web: canvas approach con timeout por URL ──
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const urls = [
      '/assets/logo.png',
      './assets/logo.png',
      `${window.location.origin}/assets/logo.png`,
    ];
    for (const src of urls) {
      try {
        const b64 = await Promise.race([
          // Intento de carga real
          new Promise<string>((res, rej) => {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width  = img.naturalWidth  || 600;
              c.height = img.naturalHeight || 600;
              c.getContext('2d')?.drawImage(img, 0, 0);
              res(c.toDataURL('image/png'));
            };
            img.onerror = () => rej(new Error('img-error'));
            img.src = src;
          }),
          // Timeout de 1.5 s por URL para no bloquear la generación
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), 1500)
          ),
        ]);
        if (b64) {
          _logoCache = b64;
          return b64;
        }
      } catch { /* próxima URL */ }
    }
    _logoCache = '';
    return '';
  }

  // ── Nativo: expo-asset ──
  try {
    const [asset] = await Asset.loadAsync(require('../../assets/logo.png'));
    const uri = asset.localUri ?? asset.uri;
    const res  = await fetch(uri);
    const blob = await res.blob();
    const b64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    _logoCache = b64;
    return b64;
  } catch {
    _logoCache = '';
    return '';
  }
}

/** Muestra el día (o días) en que se pasa a cobrar, en vez del nombre genérico
 *  de la frecuencia — así el cobrador sabe directamente cuándo visitar. */
const DIAS_SEMANA = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
function etiquetaPeriodo(p: Prestamo): string {
  if (p.frecuencia === 'semanal') {
    const fv = calcularVencimiento(p.fecha_inicio, 1, 'semanal');
    const dia = DIAS_SEMANA[new Date(fv + 'T00:00:00').getDay()];
    return `SEMANAL · ${dia}`;
  }
  if (p.frecuencia === 'mensual') {
    const fv = calcularVencimiento(p.fecha_inicio, 1, 'mensual');
    const diaMes = new Date(fv + 'T00:00:00').getDate();
    return `MENSUAL · DÍA ${diaMes}`;
  }
  return p.frecuencia.toUpperCase();
}

/* ══════════════════════════════════════════════════════════════
   9. FICHAS DE PAGO (30 días / 22 días)
      2 fichas por página landscape, separadas por línea de corte.
      Pasar array de préstamos; se agrupan de a 2 por página.
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFFicha(prestamos: Prestamo[]) {
  /** Detecta automáticamente el tamaño de ficha según el plazo del préstamo */
  function tipoFicha(plazo: number): 22 | 30 | 40 {
    if (plazo <= 22) return 22;
    if (plazo <= 30) return 30;
    return 40;
  }

  /** Marca de agua con logo real o fallback SVG */
  const logoSrc = await logoBase64();
  const WATERMARK = logoSrc
    ? `<div class="wm"><img src="${logoSrc}" style="width:280px;height:280px;opacity:0.15;object-fit:contain"/></div>`
    : `<div class="wm">
        <svg viewBox="0 0 300 120" xmlns="http://www.w3.org/2000/svg" style="width:300px;height:120px;opacity:0.07">
          <text x="150" y="40" text-anchor="middle" font-family="Arial" font-weight="900"
                font-size="28" fill="#0a2463" letter-spacing="2">CAS EXPRESS</text>
          <text x="150" y="70" text-anchor="middle" font-family="Arial" font-weight="900"
                font-size="28" fill="#0a2463" letter-spacing="2">MAJAHUAL</text>
          <text x="150" y="105" text-anchor="middle" font-family="Arial" font-weight="900"
                font-size="36" fill="#0a2463" letter-spacing="3">TAMANIQUE</text>
        </svg>
      </div>`;

  /** Renderiza el HTML de una sola ficha */
  function renderFicha(p: Prestamo): string {
    const c = p.cliente;
    const totalFilas = tipoFicha(p.plazo);
    const mitad = Math.ceil(totalFilas / 2);

    // Altura de fila según cantidad
    const rowH = totalFilas >= 40 ? 16 : totalFilas >= 30 ? 17 : 19;
    const fs   = totalFilas >= 40 ? 10 : 12; // font-size de celdas

    // Filas en blanco — sin fechas ni cuotas precalculadas
    // Border va inline para garantizar impresión en Chromium/Electron
    // (los bordes en CSS class son ignorados por el engine de print cuando la tabla tiene position:relative)
    const BDR  = 'border:1px solid #555;';
    const BDRT = 'border:1.5px solid #111;';
    const PAD  = totalFilas >= 40 ? '1px 2px' : '2px 4px';
    function fila(n: number): string {
      return `<tr>
        <td class="tc num" style="${BDR}height:${rowH}px;font-size:${fs}px;padding:${PAD};text-align:center;font-weight:bold">${n <= p.plazo ? n : ''}</td>
        <td class="fecha"  style="${BDR}height:${rowH}px;font-size:${fs}px;padding:${PAD};width:70px"></td>
        <td class="cuota"  style="${BDR}height:${rowH}px;font-size:${fs}px;padding:${PAD};width:52px;text-align:right"></td>
        <td class="firma"  style="${BDR}height:${rowH}px;font-size:${fs}px;padding:${PAD};width:68px"></td>
      </tr>`;
    }

    const filasIzq = Array.from({ length: mitad },             (_, i) => fila(i + 1)).join('');
    const filasDer = Array.from({ length: totalFilas - mitad }, (_, i) => fila(mitad + i + 1)).join('');

    const infoMb  = totalFilas >= 40 ? '0px' : '3px';
    const hdrPb   = totalFilas >= 40 ? '1px' : '4px';
    const hdrMb   = totalFilas >= 40 ? '1px' : '4px';
    const tabMt   = totalFilas >= 40 ? '1px' : '4px';

    return `
      <div class="ficha">
        <div class="hdr" style="padding-bottom:${hdrPb};margin-bottom:${hdrMb}">
          <div class="empresa">CAS Express Majahual Tamanique</div>
          <div class="logo-box">
            <div class="logo-sup">CAS EXPRESS MAJAHUAL</div>
            <div class="logo-nom">CAS Express</div>
            <div class="logo-sub">CRÉDITOS LEGALES BCR</div>
          </div>
        </div>
        <div class="info-row" style="margin-bottom:${infoMb}">
          <span class="lbl">CLIENTE:</span>
          <span class="campo" style="flex:4">&nbsp;${c?.nombre || ''}</span>
        </div>
        <div class="info-row" style="margin-bottom:${infoMb}">
          <span class="lbl">MONTO:</span><b>&nbsp;$</b>
          <span class="campo">&nbsp;${p.monto.toFixed(2)}</span>
          <span class="lbl">PLAZO:</span>
          <span class="campo">&nbsp;${p.plazo}</span>
          <span class="lbl">CUOTA:</span><b>&nbsp;$</b>
          <span class="campo">&nbsp;${p.cuota.toFixed(2)}</span>
          <span class="lbl">CICLO:</span>
          <span class="campo" style="flex:0.6;text-align:center">&nbsp;${p.numero_credito ?? ''}</span>
        </div>
        <div class="info-row" style="margin-bottom:${infoMb}">
          <span class="lbl">PERIODO:</span>
          <span class="campo">&nbsp;${etiquetaPeriodo(p)}</span>
          <span class="lbl">TELEFONO:</span>
          <span class="campo">&nbsp;${c?.telefono || ''}</span>
          <span class="lbl">CARTERA:</span>
          <span class="campo">&nbsp;</span>
        </div>
        <div class="info-row" style="margin-bottom:${infoMb}">
          <span class="lbl">INICIO:</span>
          <span class="campo">&nbsp;${formatFecha(p.fecha_inicio)}</span>
          <span class="lbl">FINAL:</span>
          <span class="campo">&nbsp;${formatFecha(p.fecha_fin)}</span>
          <span class="lbl">USO:</span>
          <span class="campo">&nbsp;</span>
        </div>
        <div class="info-row" style="margin-bottom:${infoMb}">
          <span class="lbl">DUI:</span>
          <span class="campo">&nbsp;${c?.dui || ''}</span>
          <span class="lbl">NIT:</span>
          <span class="campo">&nbsp;</span>
          <span class="lbl">EXP:</span>
          <span class="campo">&nbsp;${fmtExp(c?.numero_expediente)}</span>
        </div>
        <div class="tablas" style="margin-top:${tabMt}">
          ${WATERMARK}
          <table class="tbl">
            <thead><tr>
              <th class="num" style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:26px;-webkit-print-color-adjust:exact;print-color-adjust:exact">N°</th>
              <th style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:70px;-webkit-print-color-adjust:exact;print-color-adjust:exact">FECHA</th>
              <th style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:52px;-webkit-print-color-adjust:exact;print-color-adjust:exact">CUOTA</th>
              <th style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:68px;-webkit-print-color-adjust:exact;print-color-adjust:exact">FIRMA</th>
            </tr></thead>
            <tbody>${filasIzq}</tbody>
          </table>
          <table class="tbl">
            <thead><tr>
              <th class="num" style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:26px;-webkit-print-color-adjust:exact;print-color-adjust:exact">N°</th>
              <th style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:70px;-webkit-print-color-adjust:exact;print-color-adjust:exact">FECHA</th>
              <th style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:52px;-webkit-print-color-adjust:exact;print-color-adjust:exact">CUOTA</th>
              <th style="${BDRT}font-size:${fs}px;padding:${totalFilas>=40?'1px 2px':'3px 4px'};text-align:center;font-weight:bold;background:#1c1c2e;color:#fff;width:68px;-webkit-print-color-adjust:exact;print-color-adjust:exact">FIRMA</th>
            </tr></thead>
            <tbody>${filasDer}</tbody>
          </table>
        </div>
      </div>`;
  }

  // 2 copias idénticas por cliente: 1 para el cliente, 1 para el cobrador
  const paginas: string[] = [];
  for (let i = 0; i < Math.max(prestamos.length, 1); i++) {
    const f1 = renderFicha(prestamos[i]);
    const f2 = renderFicha(prestamos[i]);
    paginas.push(`
      <div class="pagina">
        <div style="font-size:9px;color:#999;text-align:right;padding-right:4px;margin-bottom:1px">COPIA CLIENTE</div>
        ${f1}
        <div class="corte">✂ &nbsp;- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>
        <div style="font-size:9px;color:#999;text-align:right;padding-right:4px;margin-bottom:1px">COPIA COBRADOR</div>
        ${f2}
      </div>`);
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{margin:3mm 5mm;size:letter portrait}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:0;padding:0}

    /* Contenedor de página: 2 fichas apiladas */
    .pagina{display:flex;flex-direction:column;height:99vh;page-break-after:always}
    .pagina:last-child{page-break-after:auto}
    .ficha{flex:1;padding:3px 5px;display:flex;flex-direction:column;overflow:hidden;position:relative}
    .ficha.empty{flex:1}

    /* Marca de agua centrada dentro de las tablas */
    .tablas{position:relative;display:flex;gap:6px;margin-top:4px;flex:1}
    .wm{position:absolute;top:0;left:0;right:0;bottom:0;
        display:flex;align-items:center;justify-content:center;
        pointer-events:none;z-index:1}
    /* border-collapse:separate + border-spacing:0 produce el mismo aspecto visual que
       collapse pero evitan el bug de Chromium/Electron donde position:relative+collapse
       hace desaparecer las líneas al imprimir. El table necesita position:relative
       para que z-index:2 lo ponga por encima de la marca de agua. */
    .tbl{flex:1;border-collapse:separate;border-spacing:0;width:100%;position:relative;z-index:2;
         -webkit-print-color-adjust:exact;print-color-adjust:exact}

    /* Línea de corte */
    .corte{text-align:left;font-size:9px;color:#999;
           border-top:1px dashed #aaa;padding:1px 0;letter-spacing:2px}

    /* Encabezado de cada ficha */
    .hdr{display:flex;justify-content:space-between;align-items:center;
         border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:4px}
    .empresa{font-size:16px;font-weight:900;color:#111}
    .logo-box{border:1.5px solid #111;padding:3px 10px;text-align:center;border-radius:3px}
    .logo-sup{font-size:9px;font-weight:bold;letter-spacing:1px}
    .logo-nom{font-size:14px;font-weight:900}
    .logo-sub{font-size:8px;color:#555;letter-spacing:1px}

    /* Campos de datos */
    .info-row{display:flex;gap:5px;align-items:flex-end;margin-bottom:3px}
    .lbl{font-weight:bold;white-space:nowrap;font-size:12px}
    .campo{border-bottom:1px solid #555;flex:1;min-height:14px;font-size:12px;padding:0 2px}

    /* Bordes van inline en cada th/td — el CSS solo define layout */
    .tbl th,.tbl td{white-space:nowrap}
    .tc{text-align:center}
    .num{width:26px;font-weight:bold;text-align:center}
    .fecha{width:70px}
    .cuota{width:52px;text-align:right}
    .firma{width:68px}
  </style></head><body>
  ${paginas.join('')}
  </body></html>`;

  return imprimir(html);
}

/* ══════════════════════════════════════════════════════════════
   10. COPIA DUI (frente + reverso en una sola página)
       Impresión a COLOR con negro → gris oscuro #1c1c1c
       para no gastar cartucho K. Tarjeta al 150 % (128×81 mm).
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFCopiaDUI(cliente: Cliente, soloImagenes = false) {
  const hoyFmt  = formatFecha(new Date().toISOString().split('T')[0]);
  const frente  = (cliente as any).foto_url        || '';
  const reverso = (cliente as any).dui_reverso_url || '';

  // DUI físico: 85.6×54 mm  →  al 170%: 145×92 mm (más grande = más nítido)
  const imgTag = (url: string, etiqueta: string) => url
    ? `<img src="${url}" style="width:145mm;height:92mm;object-fit:cover;display:block;border-radius:3mm;
           image-rendering:high-quality;image-rendering:-webkit-optimize-contrast"/>`
    : `<div style="width:145mm;height:92mm;border:2px dashed #555555;border-radius:3mm;
                   display:flex;flex-direction:column;align-items:center;justify-content:center;
                   color:#555555;font-size:13px;gap:6px">
         <span style="font-size:26px">🪪</span>
         <span>${etiqueta} — Sin imagen</span>
       </div>`;

  const CSS_HQ = `image-rendering:high-quality;image-rendering:-webkit-optimize-contrast`;

  const htmlRaw = soloImagenes
    /* ── MODO SOLO IMÁGENES: sin texto, imágenes grandes centradas ── */
    ? `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        @page { margin:3mm; size:letter portrait;
                -webkit-print-color-adjust:exact; print-color-adjust:exact }
        * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; margin:0; padding:0 }
        html,body { height:100%; margin:0; padding:0 }
        body { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6mm }
        .img-wrap { border-radius:4mm; overflow:hidden; line-height:0 }
        img { width:200mm; height:126mm; object-fit:cover; display:block; border-radius:4mm;
              ${CSS_HQ} }
        .ph  { width:200mm; height:126mm; border:2px dashed #888; border-radius:4mm;
               display:flex; align-items:center; justify-content:center;
               color:#888; font-size:14px; font-family:Arial,sans-serif }
      </style></head><body>
        <div class="img-wrap">${frente
          ? `<img src="${frente}"/>`
          : `<div class="ph">🪪 Sin imagen (frente)</div>`}</div>
        <div class="img-wrap">${reverso
          ? `<img src="${reverso}"/>`
          : `<div class="ph">🪪 Sin imagen (reverso)</div>`}</div>
      </body></html>`
    /* ── MODO COMPLETO: con encabezado, etiquetas e info ── */
    : `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        @page { margin:4mm; size:letter portrait;
                -webkit-print-color-adjust:exact; print-color-adjust:exact }
        *     { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
        html,body { height:100%; margin:0; padding:0 }
        body  { font-family:Arial,sans-serif; color:#1c1c1c;
                display:flex; flex-direction:column; align-items:center; gap:5mm }
        .hdr  { width:100%; text-align:center; border-bottom:1.5px solid #0a2463; padding-bottom:3px }
        .hdr b { font-size:12px; letter-spacing:.5px; color:#0a2463 }
        .hdr small { display:block; font-size:9px; color:#666; margin-top:1px }
        .slot { display:flex; flex-direction:column; align-items:center; gap:1.5mm }
        .lbl  { font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#0a2463 }
        .img-wrap { border:1px solid #ccc; border-radius:3mm; overflow:hidden }
        img   { ${CSS_HQ} }
        hr    { width:100%; border:none; border-top:1px dashed #ccc; margin:0 }
        .info { font-size:9px; text-align:center; color:#555 }
        .ftr  { width:100%; text-align:center; font-size:7px; color:#aaa;
                border-top:1px solid #eee; padding-top:3px }
      </style></head><body>
        <div class="hdr">
          <b>${EMPRESA}</b>
          <small>COPIA DUI &nbsp;·&nbsp; ${hoyFmt}</small>
        </div>
        <div class="slot">
          <div class="lbl">▶ Frente</div>
          <div class="img-wrap">${imgTag(frente,'FRENTE')}</div>
        </div>
        <hr/>
        <div class="slot">
          <div class="lbl">▶ Reverso</div>
          <div class="img-wrap">${imgTag(reverso,'REVERSO')}</div>
        </div>
        <div class="info">
          <b>${cliente.nombre}</b>
          ${cliente.dui ? `&nbsp;·&nbsp; DUI: ${cliente.dui}` : ''}
          ${cliente.numero_expediente ? `&nbsp;·&nbsp; Exp: ${fmtExp(cliente.numero_expediente)}` : ''}
        </div>
        <div class="ftr">${EMPRESA} · Copia DUI generada el ${hoyFmt}</div>
      </body></html>`;

  // Solo negro puro → #1c1c1c; todos los demás colores se imprimen tal cual
  const htmlFinal = _aplicarNegroGris(htmlRaw);

  if (Platform.OS === 'web') {
    return _imprimirHTML(htmlFinal);
  }
  const { uri } = await Print.printToFileAsync({ html: htmlFinal, base64: false });
  return uri;
}

/* ══════════════════════════════════════════════════════════════
   11. RECIBO DE LUZ (imagen a página completa)
   ══════════════════════════════════════════════════════════════ */
export async function generarPDFReciboLuz(cliente: Cliente) {
  const hoyFmt = formatFecha(new Date().toISOString().split('T')[0]);
  const img    = (cliente as any).recibo_luz_url || '';

  const htmlRaw = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      @page { margin:3mm; size:letter portrait;
              -webkit-print-color-adjust:exact; print-color-adjust:exact }
      * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; margin:0; padding:0 }
      html,body { height:100%; font-family:Arial,sans-serif; color:#1c1c1c }
      body { display:flex; flex-direction:column; padding:0 }
      .hdr { text-align:center; padding:3px 0 2px; border-bottom:1.5px solid #0a2463; flex-shrink:0 }
      .hdr b { font-size:11px; letter-spacing:.5px; color:#0a2463 }
      .hdr small { font-size:8px; color:#666; display:block; margin-top:1px }
      .img-wrap { flex:1; display:flex; align-items:center; justify-content:center;
                  overflow:hidden; padding:2mm 0 }
      img { max-width:100%; max-height:100%;
            object-fit:contain; display:block;
            image-rendering:high-quality;
            image-rendering:-webkit-optimize-contrast }
      .ph  { width:100%; height:200mm; border:2px dashed #aaa; border-radius:3mm;
             display:flex; flex-direction:column; align-items:center; justify-content:center;
             color:#aaa; font-size:14px; gap:8px }
      .info { font-size:9px; text-align:center; color:#555; padding:2px 0; flex-shrink:0 }
      .ftr  { font-size:7px; color:#aaa; text-align:center;
              border-top:1px solid #eee; padding:2px 0; flex-shrink:0 }
    </style></head><body>
      <div class="hdr">
        <b>${EMPRESA}</b>
        <small>RECIBO DE LUZ &nbsp;·&nbsp; ${hoyFmt} &nbsp;·&nbsp;
          ${cliente.nombre}${cliente.dui ? ' · DUI: '+cliente.dui : ''}${cliente.numero_expediente ? ' · Exp: '+fmtExp(cliente.numero_expediente) : ''}
        </small>
      </div>
      <div class="img-wrap">
        ${img
          ? `<img src="${img}"/>`
          : `<div class="ph"><span style="font-size:32px">💡</span><span>Sin imagen registrada</span></div>`
        }
      </div>
      <div class="ftr">${EMPRESA} · Generado el ${hoyFmt}</div>
    </body></html>`;

  const htmlFinal = _aplicarNegroGris(htmlRaw);

  if (Platform.OS === 'web') {
    return _imprimirHTML(htmlFinal);
  }
  const { uri } = await Print.printToFileAsync({ html: htmlFinal, base64: false });
  return uri;
}

/* ══════════════════════════════════════════════════════════════
   12. TIRAS / FAJAS PARA BILLETES (estilo bancario)
       Una faja por denominación, con logo de la empresa,
       cantidad de billetes y total — para amarrar los fajos.
   ══════════════════════════════════════════════════════════════ */
export interface TiraBillete {
  denominacion: number;
  cantidad: number;
}

// Color de faja por denominación — estilo "straps" bancarios
const COLOR_TIRA: Record<number, string> = {
  300: '#004d40', // verde oscuro
  200: '#5d4037', // marrón
  100: '#0a2463', // azul marca
  50:  '#6a1b9a', // morado
  20:  '#c62828', // rojo
  10:  '#e65100', // naranja
  5:   '#1b5e20', // verde
  1:   '#37474f', // gris azulado
};

// Las franjas (barras superior/inferior) siempre van en negro
const COLOR_FRANJA = '#000000';

export async function generarPDFTirasBilletes(tiras: TiraBillete[], persona?: string) {
  const logoSrc = await logoBase64();
  const hoyFmt  = formatFecha(new Date().toISOString().split('T')[0]);

  // Logo desvanecido (multiply + opacidad baja) — funciona aunque el PNG tenga
  // fondo blanco, porque "multiply" sobre blanco vuelve invisible el blanco
  // y deja solo el trazo del logo muy tenue. Si no hay logo, texto tenue.
  const WM_HTML = logoSrc
    ? `<img class="wm" src="${logoSrc}"/>`
    : `<div class="wm wm-txt">CAS Express</div>`;

  const validas = tiras.filter(t => t.cantidad > 0 && t.denominacion > 0);

  const filas = validas.map(t => {
    const total  = t.denominacion * t.cantidad;
    const totalF = formatMoneda(total);
    const denomF = formatMoneda(t.denominacion);
    const color  = COLOR_TIRA[t.denominacion] || '#0a2463';

    const tirasHtml = Array.from({ length: t.cantidad }).map(() => `
    <div class="tira" style="border-color:${color}">
      <div class="bar" style="background:${COLOR_FRANJA}"></div>
      <div class="row">
        <div class="seg seg-ext" style="color:${color}">
          <div class="flip">
            <div class="amt">${denomF}</div>
          </div>
        </div>
        <div class="seg seg-centro">
          ${WM_HTML}
          <div class="amt big" style="color:${color}">${denomF}</div>
          <div class="sub" style="color:${color}">${EMPRESA}</div>
        </div>
        <div class="seg seg-ext" style="color:${color}">
          <div class="amt">${denomF}</div>
        </div>
      </div>
      <div class="bar" style="background:${COLOR_FRANJA}"></div>
    </div>`).join('');

    return `${tirasHtml}
    <div class="meta">${t.cantidad} tira${t.cantidad > 1 ? 's' : ''} de ${denomF} = ${totalF} &nbsp;·&nbsp; ${hoyFmt}${persona ? ` &nbsp;·&nbsp; ${persona}` : ''}</div>
    <div class="corte">✂ &nbsp;- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{margin:8mm;size:letter portrait}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;margin:0;padding:0;color:#111;background:#fff}
    /* Faja: fondo blanco (poca tinta) + borde + 2 barritas de color (poca área) */
    .tira{position:relative;display:flex;flex-direction:column;
          height:28mm;border:1.5px solid;border-radius:2mm;overflow:hidden;background:#fff;
          -webkit-print-color-adjust:exact;print-color-adjust:exact}
    .bar{height:2mm;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .row{flex:1;display:flex;align-items:stretch}
    .seg{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
         position:relative;text-align:center}
    .seg-ext{flex:0.75}
    .seg-centro{flex:1.5;border-left:1px solid #ddd;border-right:1px solid #ddd}
    .flip{transform:rotate(180deg);display:flex;flex-direction:column;align-items:center}
    .amt{font-size:15px;font-weight:900;letter-spacing:.5px;position:relative;z-index:1}
    .amt.big{font-size:25px}
    .sub{font-size:8px;opacity:.75;margin-top:2px;position:relative;z-index:1;letter-spacing:.5px;color:#666}
    .seg-centro .sub{opacity:1}
    /* Marca de agua centrada y desvanecida */
    .wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        width:20mm;height:20mm;object-fit:contain;opacity:.18;
        mix-blend-mode:multiply;pointer-events:none}
    .wm-txt{width:auto;height:auto;white-space:nowrap;font-size:13px;font-weight:900;
            letter-spacing:2px;color:#000;opacity:.07;mix-blend-mode:normal}
    .meta{font-size:8px;color:#888;text-align:center;margin:1.5mm 0 2mm}
    .corte{font-size:8px;color:#bbb;text-align:center;letter-spacing:1px;margin-bottom:1.5mm}
  </style></head><body>
    ${filas}
  </body></html>`;

  return imprimir(html);
}
