const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const fs   = require('fs');
const path2 = require('path');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http  = require('http');

const isDev   = !app.isPackaged;
const EXPO_URL = 'http://localhost:8082';

/** Espera hasta que Expo responda (sin límite de tiempo) */
function waitForExpo(win) {
  http.get(EXPO_URL, () => {
    console.log('✅ Expo listo — cargando app...');
    win.loadURL(EXPO_URL);
  }).on('error', () => {
    setTimeout(() => waitForExpo(win), 2000); // reintenta cada 2s indefinidamente
  });
}

/* ── Servir archivos estáticos en producción ── */
let serveApp;
if (!isDev) {
  const serve = require('electron-serve');
  serveApp = serve({ directory: path.join(__dirname, '../dist') });
}

/* ── Ventana principal ── */
let mainWindow = null;

/** Devuelve el foco de teclado a la ventana principal.
 *  Crear/destruir ventanas ocultas (printToPDF, vista CMY) puede dejar
 *  la ventana principal "viva" pero sin foco de teclado en Windows —
 *  los clics funcionan pero no se puede escribir en ningún input. */
function refocusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.focus();
    mainWindow.webContents.focus();
  }, 250);
}

function createWindow() {
  const win = new BrowserWindow({
    width:    1280,
    height:   820,
    minWidth: 960,
    minHeight:640,
    backgroundColor: '#070c1e',
    show: false,
    icon: path.join(__dirname, '../assets/icon.ico'),
    title: 'CAS Express — Majahual Tamanique',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
      sandbox:          false,
    },
  });

  // Ocultar menú por defecto (se ve más limpio)
  win.setMenuBarVisibility(false);

  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  // Mostrar ventana y forzar foco cuando la página termina de cargar
  win.webContents.on('did-finish-load', () => {
    win.show();
    win.focus();
    win.webContents.focus();
  });

  // Fallback: si por algún motivo no cargó, mostrar de todas formas
  win.once('ready-to-show', () => {
    if (!win.isVisible()) {
      win.show();
      win.focus();
    }
  });

  if (isDev) {
    // Muestra pantalla de espera mientras Expo bundlea
    win.loadURL(`data:text/html,
      <html><body style="background:#0a2463;display:flex;flex-direction:column;align-items:center;
        justify-content:center;height:100vh;margin:0;font-family:Arial,sans-serif;color:white">
        <h2 style="font-size:28px;margin-bottom:8px">CAS Express</h2>
        <p style="color:#aaa;font-size:14px">Iniciando servidor... por favor espera</p>
        <div style="margin-top:20px;width:40px;height:40px;border:4px solid #ffffff44;
          border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite"></div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </body></html>`);
    // Espera a que Expo responda y carga la app
    waitForExpo(win);
    // win.webContents.openDevTools({ mode: 'detach' }); // desactivado
  } else {
    // Producción: sirve el bundle estático
    serveApp(win);
  }

  // Abrir links externos en el navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ── IPC: vista previa normal → genera PDF y abre en visor del sistema ── */
ipcMain.handle('print-preview', async (_event, html) => {
  const ts      = Date.now();
  const tmpHtml = path2.join(app.getPath('temp'), `cas-print-${ts}.html`);
  const tmpPdf  = path2.join(app.getPath('temp'), `cas-print-${ts}.pdf`);
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const hidden = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, webSecurity: false,
      deviceScaleFactor: 2,   // renderiza a 2× DPI → PDF más nítido
    },
  });
  await hidden.loadFile(tmpHtml);
  const pdfData = await hidden.webContents.printToPDF({
    printBackground: true,
    pageSize: 'Letter',
    margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
  });
  hidden.destroy();
  fs.writeFileSync(tmpPdf, pdfData);
  shell.openPath(tmpPdf);
  refocusMainWindow();
});

/* ── IPC: vista previa CMY → ventana visible + botón que fuerza color:true ── */
let _cmy_win = null;

ipcMain.handle('print-color', async (_event, html) => {
  const tmpHtml = path2.join(app.getPath('temp'), 'cas-color.html');

  // Inyectar barra flotante con botón de impresión
  const barra = `
  <style>
    #_cas_bar{position:fixed;bottom:0;left:0;right:0;z-index:99999;
      background:rgba(10,36,99,0.97);padding:12px 20px;
      display:flex;align-items:center;justify-content:center;gap:14px;
      box-shadow:0 -4px 24px rgba(0,0,0,0.5)}
    #_cas_bar button{border:none;border-radius:8px;font-size:14px;
      font-weight:800;cursor:pointer;padding:10px 26px}
    .bp{background:#c8a951;color:#0a2463}
    .bc{background:#c62828;color:#fff}
    @media print{#_cas_bar{display:none!important}}
  </style>
  <div id="_cas_bar">
    <span style="color:#ccc;font-size:12px">Vista previa CMY</span>
    <button class="bp" onclick="window.electronAPI.doPrintColor()">🖨️ Imprimir en Color (CMY)</button>
    <button class="bc" onclick="window.close()">✕ Cerrar</button>
  </div>`;

  const htmlFinal = html.replace('</body>', barra + '</body>');
  fs.writeFileSync(tmpHtml, htmlFinal, 'utf8');

  if (_cmy_win && !_cmy_win.isDestroyed()) _cmy_win.close();

  _cmy_win = new BrowserWindow({
    width: 960, height: 740,
    title: 'CAS Express — Vista Previa CMY',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  _cmy_win.setMenuBarVisibility(false);
  _cmy_win.on('closed', () => { _cmy_win = null; refocusMainWindow(); });
  await _cmy_win.loadFile(tmpHtml);
  _cmy_win.show();
});

/* ── IPC: ejecutar impresión en color desde la ventana CMY ── */
ipcMain.handle('do-print-color', async () => {
  if (_cmy_win && !_cmy_win.isDestroyed()) {
    _cmy_win.webContents.print({
      color: true,
      silent: false,
      printBackground: true,   // sin esto los fondos de tablas salen en blanco
    });
  }
});

/* ── IPC: generar y guardar Reporte Diario como .xlsx real ── */
ipcMain.handle('generate-reporte-diario', async (_event, datos) => {
  let XLSX;
  try { XLSX = require('xlsx'); } catch(e) {
    return { saved: false, error: 'xlsx no instalado — ejecuta: npm install' };
  }

  const { fecha, cobrador, ruta, zona, saldoAnterior, cobroDia,
          ingresoEfectivo = 0, deposito = 0, cajaChica = 0,
          renovaciones } = datos;
  const [y, m, d] = fecha.split('-').map(Number);
  const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const fechaFmt = `${d}/${m}/${y}`;

  // ENTRADAS
  const totalEntrada = (saldoAnterior || 0) + (cobroDia || 0) + (ingresoEfectivo || 0);

  // SALIDAS: depósito + caja chica + renovaciones
  const totalRenov = (renovaciones || []).reduce((s, r) => s + (r.monto || 0), 0);
  const totalSalida = (deposito || 0) + (cajaChica || 0) + totalRenov;

  const saldoFinal = totalEntrada - totalSalida;

  // ── Construir filas de renovaciones/otros ──
  const renovFilas = (renovaciones && renovaciones.length)
    ? renovaciones.map(r => ['    ' + r.descripcion, '', r.monto > 0 ? r.monto : '', ''])
    : [['    (ninguno)', '', '', '']];

  const rows = [
    [],
    ['SOLUCIONES FINANCIERAS CAS EXPRESS'],
    ['REPORTE DIARIO DE DISPONIBLE POR RUTA'],
    [],
    ['FECHA', fechaFmt],
    [],
    ['ZONA', zona || '', 'RUTA #1', ruta || ''],
    [],
    [`NOMBRE : ${cobrador || ''}`],
    [],
    ['DETALLE',              'ENTRADA',             'SALIDA',   'SALDO'],
    ['SALDO ANTERIOR',       saldoAnterior || 0,    '',         ''],
    ['',                     '',                    '',         ''],
    ['COBRO DEL DIA',        cobroDia || 0,         '',         ''],
    ['INGRESO DE EFECTIVO',  ingresoEfectivo || 0,  '',         ''],
    ['DEPOSITO',             '',                    deposito || 0, ''],
    ['',                     '',                    '',         ''],
    ['CAJA CHICA',           '',                    cajaChica || 0, ''],
    ['',                     '',                    '',         ''],
    ['RENOVACIONES , OTROS', '',                    '',         ''],
    ...renovFilas,
    ...Array(Math.max(0, 5 - renovFilas.length)).fill(['','','','']),
    ['TOTAL', totalEntrada, totalSalida, saldoFinal],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Ancho de columnas
  ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

  // Formato moneda en columnas B/C/D para todas las filas con números
  const fmtMoneda = '"$"#,##0.00';
  for (let ri = 11; ri <= rows.length; ri++) {
    ['B','C','D'].forEach(col => {
      const ref = col + ri;
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = fmtMoneda;
    });
  }

  XLSX.utils.book_append_sheet(wb, ws, `Reporte ${fechaFmt}`);

  // ── Diálogo de guardado ──
  const sugerido = `REPORTE ${d} de ${MESES[m - 1]} ${y}.xlsx`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: sugerido,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { saved: false };

  try {
    const dir = path2.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    XLSX.writeFile(wb, filePath);
    return { saved: true, filePath };
  } catch(e) {
    return { saved: false, error: String(e) };
  }
});

/* ── IPC: generar Reporte de Contabilidad mensual como .xlsx ── */
ipcMain.handle('generate-contabilidad', async (_event, datos) => {
  let XLSX;
  try { XLSX = require('xlsx'); } catch(e) {
    return { saved: false, error: 'xlsx no instalado — ejecuta: npm install' };
  }

  const { year, month, mesLabel, totalIngresos, totalGastos, utilidad, cobros, gastos } = datos;
  const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const fmt = (n) => Number(n || 0);
  const fmtMoneda = '"$"#,##0.00';

  const wb = XLSX.utils.book_new();

  /* ── Hoja 1: Resumen mensual ── */
  const resumenRows = [
    [],
    ['SOLUCIONES FINANCIERAS CAS EXPRESS'],
    ['REPORTE CONTABLE MENSUAL'],
    [mesLabel.toUpperCase()],
    [],
    ['RESUMEN FINANCIERO'],
    ['CONCEPTO', 'MONTO'],
    ['Total ingresos (cobros del mes)', fmt(totalIngresos)],
    ['Total gastos operativos',         fmt(totalGastos)],
    ['UTILIDAD DEL MES',                fmt(utilidad)],
    [],
    ['Nota: Los ingresos incluyen cuotas cobradas, mora y multas registradas en el sistema.'],
    ['Este reporte es para uso interno y presentacion al contador.'],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 42 }, { wch: 18 }];
  [8, 9, 10].forEach(ri => {
    const ref = 'B' + ri;
    if (wsResumen[ref] && typeof wsResumen[ref].v === 'number') wsResumen[ref].z = fmtMoneda;
  });
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  /* ── Hoja 2: Detalle de Cobros ── */
  const cobroRows = [
    [],
    ['DETALLE DE COBROS — ' + mesLabel.toUpperCase()],
    [],
    ['FECHA', 'COBRADO', 'MORA', 'MULTA', 'TOTAL'],
    ...(cobros || []).map(c => [c.fecha, fmt(c.cobrado), fmt(c.mora), fmt(c.multa), fmt(c.monto)]),
    [],
    ['TOTAL', '', '', '', fmt(totalIngresos)],
  ];
  const wsCobros = XLSX.utils.aoa_to_sheet(cobroRows);
  wsCobros['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  const cobroStart = 5;
  for (let ri = cobroStart; ri < cobroStart + (cobros||[]).length + 2; ri++) {
    ['B','C','D','E'].forEach(col => {
      const ref = col + ri;
      if (wsCobros[ref] && typeof wsCobros[ref].v === 'number') wsCobros[ref].z = fmtMoneda;
    });
  }
  XLSX.utils.book_append_sheet(wb, wsCobros, 'Cobros');

  /* ── Hoja 3: Detalle de Gastos ── */
  const gastoRows = [
    [],
    ['DETALLE DE GASTOS — ' + mesLabel.toUpperCase()],
    [],
    ['FECHA', 'CATEGORIA', 'DESCRIPCION', 'COMPROBANTE', 'MONTO'],
    ...(gastos || []).map(g => [g.fecha, g.categoria, g.descripcion, g.comprobante || '', fmt(g.monto)]),
    [],
    ['TOTAL', '', '', '', fmt(totalGastos)],
  ];
  const wsGastos = XLSX.utils.aoa_to_sheet(gastoRows);
  wsGastos['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 38 }, { wch: 16 }, { wch: 14 }];
  const gastoStart = 5;
  for (let ri = gastoStart; ri < gastoStart + (gastos||[]).length + 2; ri++) {
    const ref = 'E' + ri;
    if (wsGastos[ref] && typeof wsGastos[ref].v === 'number') wsGastos[ref].z = fmtMoneda;
  }
  XLSX.utils.book_append_sheet(wb, wsGastos, 'Gastos');

  /* ── Diálogo de guardado ── */
  const sugerido = `CONTABILIDAD ${MESES[month - 1]} ${year}.xlsx`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: sugerido,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { saved: false };

  try {
    const dir = path2.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    XLSX.writeFile(wb, filePath);
    return { saved: true, filePath };
  } catch(e) {
    return { saved: false, error: String(e) };
  }
});

/* ── IPC: generar Libros de IVA (Compras, Ventas Consumidor Final, Ventas Contribuyentes) ── */
ipcMain.handle('generate-libro-iva', async (_event, datos) => {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch(e) {
    return { saved: false, error: 'exceljs no instalado — ejecuta: npm install' };
  }

  const { year, month, mesLabel, empresaNombre, titular, nit, registroIva, compras, ventasCF, ventasCont } = datos;
  const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const fmt = (n) => Number(n || 0);
  const fmtMoneda = '"$"#,##0.00';
  const nombreTitular = titular || empresaNombre || 'CAS EXPRESS';

  const thin   = { style: 'thin' };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center', vertical: 'middle', wrapText: true };

  function borderRange(ws, r1, c1, r2, c2) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = border;
    }
  }
  function tituloRows(ws, ncols, fila3Izq, fila3Centro, fila3Der) {
    ws.mergeCells(1, 1, 1, ncols);
    const c1 = ws.getCell(1, 1);
    c1.value = nombreTitular; c1.font = { bold: true, size: 13 }; c1.alignment = { horizontal: 'center' };

    ws.mergeCells(2, 1, 2, ncols);
    const c2 = ws.getCell(2, 1);
    c2.value = tituloLibro; c2.font = { bold: true, size: 12 }; c2.alignment = { horizontal: 'center' };

    // fila 3 vacía como separación visual antes de la fila 4
    const mitad = Math.ceil(ncols / 2);
    if (fila3Izq) {
      const cellL = ws.getCell(4, 1);
      cellL.value = fila3Izq; cellL.font = { bold: true };
    }
    if (fila3Centro) {
      ws.mergeCells(4, Math.max(2, mitad - 1), 4, mitad + 1);
      const cellC = ws.getCell(4, Math.max(2, mitad - 1));
      cellC.value = fila3Centro; cellC.font = { bold: true }; cellC.alignment = { horizontal: 'center' };
    }
    if (fila3Der) {
      ws.mergeCells(4, ncols - 2, 4, ncols);
      const cellR = ws.getCell(4, ncols - 2);
      cellR.value = fila3Der; cellR.font = { bold: true }; cellR.alignment = { horizontal: 'right' };
    }
  }
  function pieFirma(ws, ncols, filaIni) {
    ws.getCell(filaIni, 1).value = 'F:_______________________________';
    ws.mergeCells(filaIni + 1, 1, filaIni + 1, ncols);
    const cn = ws.getCell(filaIni + 1, 1);
    cn.value = nombreTitular; cn.alignment = { horizontal: 'center' }; cn.font = { bold: true };
  }
  function pageSetupCarta(ws, landscape = true) {
    ws.pageSetup = {
      paperSize: 1, // Letter
      orientation: landscape ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
    };
  }
  let tituloLibro; // var compartida usada por tituloRows()

  const wb = new ExcelJS.Workbook();

  /* ── Hoja 1: LIBRO DE COMPRAS ── */
  tituloLibro = 'LIBRO DE COMPRAS';
  const wsC = wb.addWorksheet('Libro Compras');
  wsC.columns = [
    { width: 5 }, { width: 11 }, { width: 12 }, { width: 9 }, { width: 26 },
    { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 9 }, { width: 10 }, { width: 11 }, { width: 18 },
  ];
  tituloRows(wsC, 14,
    registroIva ? `REGISTRO DE IVA Nº ${registroIva}` : '',
    `MES : ${mesLabel.toUpperCase()}`,
    nit ? `NIT ${nit}` : '');

  // Encabezado de tabla (filas 6-7)
  const h1 = 6, h2 = 7;
  const simples1 = [
    [1, 'Corr.'], [2, 'Fecha'], [3, 'No. Comp\nCCF'], [4, 'No. Reg.'], [5, 'Nombre Proveedor'],
    [10, 'IVA PERCIBIDO\n1%'], [11, 'IVA 13%'], [12, 'Total\ncompra'], [13, 'Retenciones\na terceros'], [14, 'Clasificación\nde gastos'],
  ];
  simples1.forEach(([c, label]) => {
    wsC.mergeCells(h1, c, h2, c);
    const cell = wsC.getCell(h1, c);
    cell.value = label; cell.font = { bold: true }; cell.alignment = center;
  });
  wsC.mergeCells(h1, 6, h1, 7);
  wsC.getCell(h1, 6).value = 'Compras Exentas';
  wsC.mergeCells(h1, 8, h1, 9);
  wsC.getCell(h1, 8).value = 'Compras Gravadas';
  [6, 8].forEach(c => { wsC.getCell(h1, c).font = { bold: true }; wsC.getCell(h1, c).alignment = center; });
  wsC.getCell(h2, 6).value = 'Locales/\nInternas';
  wsC.getCell(h2, 7).value = 'Importaciones';
  wsC.getCell(h2, 8).value = 'Locales/\nInternas';
  wsC.getCell(h2, 9).value = 'Importaciones';
  [6, 7, 8, 9].forEach(c => { wsC.getCell(h2, c).font = { bold: true }; wsC.getCell(h2, c).alignment = center; });
  borderRange(wsC, h1, 1, h2, 14);

  let row = 8;
  (compras || []).forEach((c, i) => {
    wsC.getCell(row, 1).value  = i + 1;
    wsC.getCell(row, 2).value  = c.fecha;
    wsC.getCell(row, 3).value  = c.noComp || '';
    wsC.getCell(row, 4).value  = c.noReg || '';
    wsC.getCell(row, 5).value  = c.proveedor || '';
    wsC.getCell(row, 6).value  = fmt(c.exentaLocal);
    wsC.getCell(row, 7).value  = fmt(c.exentaImport);
    wsC.getCell(row, 8).value  = fmt(c.gravadaLocal);
    wsC.getCell(row, 9).value  = fmt(c.gravadaImport);
    wsC.getCell(row, 10).value = fmt(c.ivaPercibido);
    wsC.getCell(row, 11).value = fmt(c.iva13);
    wsC.getCell(row, 12).value = fmt(c.total);
    wsC.getCell(row, 13).value = fmt(c.retencion);
    wsC.getCell(row, 14).value = c.clasificacion || '';
    for (let cc = 6; cc <= 13; cc++) wsC.getCell(row, cc).numFmt = fmtMoneda;
    borderRange(wsC, row, 1, row, 14);
    row++;
  });
  wsC.mergeCells(row, 1, row, 5);
  wsC.getCell(row, 1).value = 'TOTALES'; wsC.getCell(row, 1).font = { bold: true }; wsC.getCell(row, 1).alignment = center;
  const sumC = (key) => fmt((compras||[]).reduce((s,c)=>s+fmt(c[key]),0));
  [['exentaLocal',6],['exentaImport',7],['gravadaLocal',8],['gravadaImport',9],
   ['ivaPercibido',10],['iva13',11],['total',12],['retencion',13]].forEach(([key,c]) => {
    const cell = wsC.getCell(row, c);
    cell.value = sumC(key); cell.numFmt = fmtMoneda; cell.font = { bold: true };
  });
  borderRange(wsC, row, 1, row, 14);
  pieFirma(wsC, 14, row + 2);
  pageSetupCarta(wsC, true);

  /* ── Hoja 2: LIBRO DE VENTAS A CONSUMIDOR FINAL ── */
  tituloLibro = 'LIBRO DE VENTA A CONSUMIDOR FINAL';
  const vcfByDia = {};
  (ventasCF || []).forEach(v => { vcfByDia[v.dia] = v; });
  const totalExentas  = (ventasCF||[]).reduce((s,v)=>s+fmt(v.ventasExentas),0);
  const totalGravadas = (ventasCF||[]).reduce((s,v)=>s+fmt(v.ventasGravadas),0);
  const totalExport   = (ventasCF||[]).reduce((s,v)=>s+fmt(v.exportaciones),0);
  const totalDiario   = (ventasCF||[]).reduce((s,v)=>s+fmt(v.total),0);
  const totalTerceros = (ventasCF||[]).reduce((s,v)=>s+fmt(v.ventasTerceros),0);
  const debitoGravadas = Math.round((totalGravadas - totalGravadas/1.13) * 100) / 100;

  const wsV = wb.addWorksheet('Ventas Consumidor Final');
  wsV.columns = [
    { width: 6 }, { width: 16 }, { width: 12 }, { width: 13 },
    { width: 15 }, { width: 13 }, { width: 16 }, { width: 16 },
  ];
  tituloRows(wsV, 8,
    registroIva ? `REGISTRO DE IVA Nº ${registroIva}` : '',
    `AÑO: ${year}   MES: ${mesLabel.toUpperCase()}`,
    nit ? `NIT ${nit}` : '');

  const vh = 6;
  ['DIA','DOCUMENTOS EMITIDOS\nDEL NUMERO','AL NUMERO','VENTAS\nEXENTAS',
   'VENTAS INTERNAS\nGRAVADAS','EXPORTACIONES','TOTAL VENTAS\nDIARIAS PROPIAS','VENTAS A CUENTA\nDE TERCEROS']
    .forEach((label, idx) => {
      const cell = wsV.getCell(vh, idx + 1);
      cell.value = label; cell.font = { bold: true }; cell.alignment = center;
    });
  borderRange(wsV, vh, 1, vh, 8);

  row = vh + 1;
  for (let dia = 1; dia <= 31; dia++) {
    const v = vcfByDia[dia];
    wsV.getCell(row, 1).value = dia;
    wsV.getCell(row, 2).value = v ? (v.docDel || '') : '';
    wsV.getCell(row, 3).value = v ? (v.docAl  || '') : '';
    wsV.getCell(row, 4).value = v ? fmt(v.ventasExentas)  : 0;
    wsV.getCell(row, 5).value = v ? fmt(v.ventasGravadas) : 0;
    wsV.getCell(row, 6).value = v ? fmt(v.exportaciones)  : 0;
    wsV.getCell(row, 7).value = v ? fmt(v.total)          : 0;
    wsV.getCell(row, 8).value = v ? fmt(v.ventasTerceros) : 0;
    for (let cc = 4; cc <= 8; cc++) wsV.getCell(row, cc).numFmt = fmtMoneda;
    borderRange(wsV, row, 1, row, 8);
    row++;
  }
  wsV.mergeCells(row, 1, row, 3);
  wsV.getCell(row, 1).value = 'TOTALES DEL MES'; wsV.getCell(row, 1).font = { bold: true }; wsV.getCell(row, 1).alignment = center;
  [[4,totalExentas],[5,totalGravadas],[6,totalExport],[7,totalDiario],[8,totalTerceros]].forEach(([c,val]) => {
    const cell = wsV.getCell(row, c);
    cell.value = fmt(val); cell.numFmt = fmtMoneda; cell.font = { bold: true };
  });
  borderRange(wsV, row, 1, row, 8);
  row += 2;

  wsV.mergeCells(row, 1, row, 8);
  wsV.getCell(row, 1).value = 'RESUMEN DE OPERACIONES';
  wsV.getCell(row, 1).font = { bold: true }; wsV.getCell(row, 1).alignment = { horizontal: 'center' };
  row++;
  const resHdrRow = row;
  ['', 'PROPIAS\nVALOR TOTAL', 'PROPIAS\nDÉBITO FISCAL', 'A CTA TERCEROS\nVALOR TOTAL', 'A CTA TERCEROS\nDÉBITO FISCAL']
    .forEach((label, idx) => {
      const cell = wsV.getCell(resHdrRow, idx + 1);
      cell.value = label; cell.font = { bold: true }; cell.alignment = center;
    });
  wsV.mergeCells(resHdrRow, 1, resHdrRow, 1);
  row++;
  const filasResumen = [
    ['VENTAS INTERNAS GRAVADAS A CONSUMIDORES', fmt(totalGravadas), fmt(debitoGravadas), '', ''],
    ['VENTAS INTERNAS EXENTAS A CONSUMIDORES',  fmt(totalExentas),  '', '', ''],
    ['EXPORTACIONES SEGÚN FACTURAS DE EXPORTACIÓN', fmt(totalExport), '', '', ''],
  ];
  filasResumen.forEach(fila => {
    wsV.getCell(row, 1).value = fila[0];
    for (let i = 1; i <= 4; i++) {
      const cell = wsV.getCell(row, i + 1);
      cell.value = fila[i] === '' ? '' : fmt(fila[i]);
      if (fila[i] !== '') cell.numFmt = fmtMoneda;
    }
    row++;
  });
  borderRange(wsV, resHdrRow, 1, row - 1, 5);
  pieFirma(wsV, 8, row + 1);
  pageSetupCarta(wsV, false);

  /* ── Hoja 3: LIBRO DE VENTAS A CONTRIBUYENTES ── */
  tituloLibro = 'LIBRO DE VENTAS A CONTRIBUYENTES';
  const wsT = wb.addWorksheet('Ventas Contribuyentes');
  wsT.columns = [
    { width: 5 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 24 }, { width: 11 },
    { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 11 },
  ];
  tituloRows(wsT, 14,
    registroIva ? `REGISTRO DE IVA Nº ${registroIva}` : '',
    `MES : ${mesLabel.toUpperCase()}`,
    nit ? `NIT ${nit}` : '');

  const th1 = 6, th2 = 7;
  const tSimples1 = [
    [1,'No'], [2,'Fecha de\nemisión'], [3,'No. Correlativo\npre-impreso'], [4,'No. Control\ninterno'],
    [5,'Nombre de cliente,\nmandatario o Mandante'], [6,'N.R.C.'],
    [13,'IVA\nRetenido'], [14,'Ventas\ntotales'],
  ];
  tSimples1.forEach(([c, label]) => {
    wsT.mergeCells(th1, c, th2, c);
    const cell = wsT.getCell(th1, c);
    cell.value = label; cell.font = { bold: true }; cell.alignment = center;
  });
  wsT.mergeCells(th1, 7, th1, 9);
  wsT.getCell(th1, 7).value = 'Propias';
  wsT.mergeCells(th1, 10, th1, 12);
  wsT.getCell(th1, 10).value = 'A cuenta de terceros';
  [7, 10].forEach(c => { wsT.getCell(th1, c).font = { bold: true }; wsT.getCell(th1, c).alignment = center; });
  ['Exentas','Internas\nGravadas','Débito\nfiscal','Exentas','Internas\nGravadas','Débito\nfiscal']
    .forEach((label, idx) => {
      const cell = wsT.getCell(th2, 7 + idx);
      cell.value = label; cell.font = { bold: true }; cell.alignment = center;
    });
  borderRange(wsT, th1, 1, th2, 14);

  row = 8;
  (ventasCont || []).forEach((v, i) => {
    wsT.getCell(row, 1).value  = i + 1;
    wsT.getCell(row, 2).value  = v.fecha;
    wsT.getCell(row, 3).value  = v.noCorrelativo || '';
    wsT.getCell(row, 4).value  = v.noControl || '';
    wsT.getCell(row, 5).value  = v.cliente || '';
    wsT.getCell(row, 6).value  = v.nrc || '';
    wsT.getCell(row, 7).value  = fmt(v.exentaPropia);
    wsT.getCell(row, 8).value  = fmt(v.gravadaPropia);
    wsT.getCell(row, 9).value  = fmt(v.debitoPropia);
    wsT.getCell(row, 10).value = fmt(v.exentaTercero);
    wsT.getCell(row, 11).value = fmt(v.gravadaTercero);
    wsT.getCell(row, 12).value = fmt(v.debitoTercero);
    wsT.getCell(row, 13).value = fmt(v.ivaRetenido);
    wsT.getCell(row, 14).value = fmt(v.total);
    for (let cc = 7; cc <= 14; cc++) wsT.getCell(row, cc).numFmt = fmtMoneda;
    borderRange(wsT, row, 1, row, 14);
    row++;
  });
  wsT.mergeCells(row, 1, row, 6);
  wsT.getCell(row, 1).value = 'TOTALES'; wsT.getCell(row, 1).font = { bold: true }; wsT.getCell(row, 1).alignment = center;
  const sumT = (key) => fmt((ventasCont||[]).reduce((s,v)=>s+fmt(v[key]),0));
  [['exentaPropia',7],['gravadaPropia',8],['debitoPropia',9],['exentaTercero',10],
   ['gravadaTercero',11],['debitoTercero',12],['ivaRetenido',13],['total',14]].forEach(([key,c]) => {
    const cell = wsT.getCell(row, c);
    cell.value = sumT(key); cell.numFmt = fmtMoneda; cell.font = { bold: true };
  });
  borderRange(wsT, row, 1, row, 14);
  pieFirma(wsT, 14, row + 2);
  pageSetupCarta(wsT, true);

  /* ── Diálogo de guardado ── */
  const sugerido = `LIBROS DE IVA ${MESES[month - 1]} ${year}.xlsx`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: sugerido,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { saved: false };

  try {
    const dir = path2.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(filePath);
    return { saved: true, filePath };
  } catch(e) {
    return { saved: false, error: String(e) };
  }
});

/* ── Cuadro Cobrador ── */
ipcMain.handle('generate-cuadro-cobrador', async (_event, datos) => {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch(e) {
    return { saved: false, error: 'exceljs no instalado' };
  }

  const {
    cobrador = 'COBRADOR', ruta = '', mes = '', anio = '',
    empresaNombre = '',
    carteraAnt = 0, carteraAct = 0, mora = 0,
    q1 = [], q2 = [],
  } = datos;

  // ── Helpers ──
  const bdr    = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  const center = { horizontal:'center', vertical:'middle' };
  const right  = { horizontal:'right',  vertical:'middle' };
  const left   = { horizontal:'left',   vertical:'middle' };
  const fmtM   = '"$"#,##0.00';
  const fmtPct = '0%';
  const YELLOW = 'FFFFFF00';
  const NAVY   = 'FF0A2463';
  const WHITE  = 'FFFFFFFF';
  const LGRAY  = 'FFF2F2F2';

  function fillSolid(argb) { return { type:'pattern', pattern:'solid', fgColor:{ argb } }; }
  function bdrRange(ws, r1, c1, r2, c2) {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r,c).border = bdr;
  }
  function setCell(ws, row, col, value, opts = {}) {
    const cell = ws.getCell(row, col);
    cell.value = value;
    if (opts.font)      cell.font      = opts.font;
    if (opts.alignment) cell.alignment = opts.alignment;
    if (opts.fill)      cell.fill      = opts.fill;
    if (opts.numFmt)    cell.numFmt    = opts.numFmt;
    if (opts.border !== false) cell.border = bdr;
    return cell;
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(cobrador || 'Cobrador');
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 };

  // Columnas: A=etiq_q1, B=monto_q1, C=etiq_q2, D=monto_q2
  ws.columns = [
    { key:'A', width: 14 },
    { key:'B', width: 14 },
    { key:'C', width: 14 },
    { key:'D', width: 14 },
  ];

  // Calcular tamaño dinámico de filas (Q1: hasta 15, Q2: hasta 16)
  const FILAS_XLS   = Math.max(q1.length, q2.length) || 16;
  const totalRowXls = 7 + FILAS_XLS;        // fila TOTAL en el Excel
  const lastDataXls = 6 + FILAS_XLS;        // última fila con datos

  // ── Fila 1: COBRADOR | (nombre) | | RUTA ──
  setCell(ws,1,1,'COBRADOR', { font:{bold:true,size:11}, alignment:left, fill:fillSolid(LGRAY) });
  setCell(ws,1,2,cobrador.toUpperCase(), { font:{bold:true,size:11}, alignment:left });
  setCell(ws,1,3,'', { fill:fillSolid(LGRAY) });
  setCell(ws,1,4,ruta.toUpperCase(), { font:{bold:true,size:11,color:{argb:NAVY}}, alignment:center });
  ws.getRow(1).height = 18;

  // ── Fila 2: Cartera anterior ──
  setCell(ws,2,1,'Cartera anterior', { font:{size:10}, alignment:left });
  setCell(ws,2,2,'$',                { font:{size:10}, alignment:right });
  setCell(ws,2,3,'',                 {});
  setCell(ws,2,4,Number(carteraAnt),  { font:{bold:true,size:10}, alignment:right, numFmt:fmtM });

  // ── Fila 3: Cartera actual ──
  setCell(ws,3,1,'Cartera actual', { font:{size:10}, alignment:left });
  setCell(ws,3,2,'$',              { font:{size:10}, alignment:right });
  setCell(ws,3,3,'',               {});
  setCell(ws,3,4,Number(carteraAct), { font:{bold:true,size:10}, alignment:right, numFmt:fmtM });

  // ── Fila 4: DIFERENCIA — fórmula =D2-D3 ──
  setCell(ws,4,1,'DIFERENCIA', { font:{bold:true,size:10}, alignment:left });
  setCell(ws,4,2,'-$',         { font:{bold:true,size:10}, alignment:right });
  setCell(ws,4,3,'',           {});
  const d4 = ws.getCell(4,4);
  d4.value  = { formula:'D2-D3', result: Number(carteraAnt)-Number(carteraAct) };
  d4.numFmt = fmtM; d4.font = { bold:true, size:10, color:{argb: (Number(carteraAnt)-Number(carteraAct)) < 0 ? 'FFCC0000' : 'FF006600'} };
  d4.alignment = right; d4.border = bdr;
  ws.getRow(4).height = 15;

  // ── Fila 5: COBRO TOTAL | =Btotal+Dtotal | MORA | mora_amt ──
  setCell(ws,5,1,'COBRO TOTAL', { font:{bold:true,size:10}, alignment:left });
  const b5 = ws.getCell(5,2);
  b5.value  = { formula:`B${totalRowXls}+D${totalRowXls}`, result: q1.reduce((s,f)=>s+Number(f.monto||0),0) + q2.reduce((s,f)=>s+Number(f.monto||0),0) };
  b5.numFmt = fmtM; b5.font = { bold:true, size:10 }; b5.alignment = right; b5.border = bdr;
  setCell(ws,5,3,'MORA', { font:{bold:true,size:10,color:{argb:'FFCC0000'}}, alignment:center });
  setCell(ws,5,4,Number(mora), { font:{bold:true,size:10}, alignment:right, numFmt:fmtM });
  ws.getRow(5).height = 15;

  // ── Fila 6: Headers COBRO | Q1 | | Q2 (amarillo) ──
  const yellowFill = fillSolid(YELLOW);
  const yellowFont = { bold:true, size:11, color:{argb:'FF000000'} };
  setCell(ws,6,1,'COBRO', { font:yellowFont, alignment:center, fill:yellowFill });
  setCell(ws,6,2,'Q1',    { font:yellowFont, alignment:center, fill:yellowFill });
  setCell(ws,6,3,'',      { fill:yellowFill });
  setCell(ws,6,4,'Q2',    { font:yellowFont, alignment:center, fill:yellowFill });
  ws.getRow(6).height = 16;

  // ── Filas 7+: datos Q1 (A/B) y Q2 (C/D) — dinámico según tamaño de arrays ──
  for (let i = 0; i < FILAS_XLS; i++) {
    const rowN = 7 + i;
    const f1   = q1[i] || { fecha:'', monto:0 };
    const f2   = q2[i] || { fecha:'', monto:0 };
    const bg   = fillSolid(i % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF');

    setCell(ws, rowN, 1, f1.fecha || '', { font:{size:11}, alignment:right, fill:bg });
    if (f1.monto) {
      setCell(ws, rowN, 2, Number(f1.monto), { font:{size:11}, alignment:right, numFmt:fmtM, fill:bg });
    } else {
      setCell(ws, rowN, 2, '', { font:{size:11}, fill:bg });
    }
    setCell(ws, rowN, 3, f2.fecha || '', { font:{size:11}, alignment:right, fill:bg });
    if (f2.monto) {
      setCell(ws, rowN, 4, Number(f2.monto), { font:{size:11}, alignment:right, numFmt:fmtM, fill:bg });
    } else {
      setCell(ws, rowN, 4, '', { font:{size:11}, fill:bg });
    }
    ws.getRow(rowN).height = 16;
  }

  // ── Fila TOTAL (justo después de los datos) ──
  setCell(ws,totalRowXls,1,'TOTAL', { font:{bold:true,size:11}, alignment:left });
  const b23 = ws.getCell(totalRowXls,2);
  b23.value  = { formula:`SUM(B7:B${lastDataXls})`, result: q1.reduce((s,f)=>s+Number(f.monto||0),0) };
  b23.numFmt = fmtM; b23.font = { bold:true, size:11 }; b23.alignment = right; b23.border = bdr;
  setCell(ws,totalRowXls,3,'', {});
  const d23 = ws.getCell(totalRowXls,4);
  d23.value  = { formula:`SUM(D7:D${lastDataXls})`, result: q2.reduce((s,f)=>s+Number(f.monto||0),0) };
  d23.numFmt = fmtM; d23.font = { bold:true, size:11 }; d23.alignment = right; d23.border = bdr;
  ws.getRow(totalRowXls).height = 16;

  // ── Fila EFECTIVIDAD (después del TOTAL) ──
  const efectRow = totalRowXls + 1;
  const totCobro = q1.reduce((s,f)=>s+Number(f.monto||0),0) + q2.reduce((s,f)=>s+Number(f.monto||0),0);
  setCell(ws,efectRow,1,'EFECTIVIDAD', { font:yellowFont, alignment:center, fill:yellowFill });
  const b24 = ws.getCell(efectRow,2);
  b24.value  = { formula:'IF(D2=0,0,B5/D2)', result: Number(carteraAnt) > 0 ? totCobro / Number(carteraAnt) : 0 };
  b24.numFmt = fmtPct; b24.font = { bold:true, size:11 }; b24.alignment = center;
  b24.fill   = yellowFill; b24.border = bdr;
  setCell(ws,efectRow,3,'MORA', { font:{...yellowFont, color:{argb:'FFCC0000'}}, alignment:center, fill:yellowFill });
  const d24 = ws.getCell(efectRow,4);
  d24.value  = { formula:'IF(D2=0,0,D5/D2)', result: Number(carteraAnt) > 0 ? Number(mora) / Number(carteraAnt) : 0 };
  d24.numFmt = fmtPct; d24.font = { bold:true, size:11 }; d24.alignment = center;
  d24.fill   = yellowFill; d24.border = bdr;
  ws.getRow(efectRow).height = 16;

  // Guardar
  try {
    const nombreArchivo = `COBRADOR ${(ruta || cobrador).toUpperCase()} ${mes} ${anio}`.trim();
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Guardar Cuadro Cobrador',
      defaultPath: `${nombreArchivo}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { saved: false };
    const buf = await wb.xlsx.writeBuffer();
    require('fs').writeFileSync(filePath, buf);
    return { saved: true, path: filePath };
  } catch(e) {
    return { saved: false, error: String(e) };
  }
});

/* ── Balance de Cartera ── */
ipcMain.handle('generate-cartera', async (_event, datos) => {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch(e) {
    return { saved: false, error: 'exceljs no instalado' };
  }

  const { fecha, empresaNombre, filas = [], resumen = {} } = datos;

  // ── Helpers ──
  const bdr   = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  const ctr   = { horizontal:'center', vertical:'middle', wrapText:true };
  const rgt   = { horizontal:'right',  vertical:'middle' };
  const lft   = { horizontal:'left',   vertical:'middle', wrapText:true };
  const fmtM  = '"$"#,##0.00';
  const fmtN  = '#,##0';
  const bgTot = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE3EAF8' } };

  function fill(argb) { return { type:'pattern', pattern:'solid', fgColor:{ argb } }; }
  function hdr(ws, rowN, c1, c2, value, argbBg, argbFont, bold, size) {
    if (c1 !== c2) ws.mergeCells(rowN, c1, rowN, c2);
    const cell = ws.getCell(rowN, c1);
    cell.value = value;
    cell.font  = { bold: bold !== false, size: size || 11, color: { argb: argbFont || 'FF000000' } };
    cell.alignment = ctr;
    if (argbBg) cell.fill = fill(argbBg);
    return cell;
  }

  // ── Workbook ──
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cartera');
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left:0.5, right:0.5, top:0.6, bottom:0.6, header:0.3, footer:0.3 },
  };

  // Columnas (14): Nº, Cliente, Exp, Tel, M.Original, Cuota, Frec, Plazo, Pagadas, Pend, T.Pagado, Saldo, Mora, Estado, Vence
  const NCOLS = 15;
  ws.columns = [
    { width: 4  }, // 1  Nº
    { width: 28 }, // 2  Cliente
    { width: 10 }, // 3  Expediente
    { width: 12 }, // 4  Teléfono
    { width: 13 }, // 5  Monto Original
    { width: 10 }, // 6  Cuota
    { width: 8  }, // 7  Frecuencia
    { width: 6  }, // 8  Plazo
    { width: 7  }, // 9  Pagadas
    { width: 7  }, // 10 Pendientes
    { width: 13 }, // 11 Total Pagado
    { width: 13 }, // 12 Saldo Pendiente
    { width: 10 }, // 13 Mora
    { width: 9  }, // 14 Estado
    { width: 11 }, // 15 Vencimiento
  ];

  // Filas de encabezado
  hdr(ws, 1, 1, NCOLS, (empresaNombre || '').toUpperCase(), null, 'FF0A2463', true, 13);
  hdr(ws, 2, 1, NCOLS, 'BALANCE DE CARTERA — SALDOS PENDIENTES', 'FFE3EAF8', 'FF0A2463', true, 12);
  hdr(ws, 3, 1, NCOLS,
    `Fecha de corte: ${fecha}   ·   Total cartera: $${Number(resumen.totalCartera||0).toFixed(2)}   ·   Activos: ${resumen.cantActivos||0}   ·   En mora: ${resumen.cantMora||0}`,
    null, 'FF666666', false, 9);
  ws.getRow(1).height = 18;
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 13;

  // Encabezados de columnas
  const HDR_LABELS = ['Nº','Cliente','Expediente','Teléfono','Monto\nOriginal','Cuota','Frec.','Plazo','Pagadas','Pendientes','Total\nPagado','Saldo\nPendiente','Mora','Estado','Vencimiento'];
  HDR_LABELS.forEach((label, ci) => {
    const cell = ws.getCell(4, ci + 1);
    cell.value = label;
    cell.font  = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = ctr;
    cell.fill  = fill('FF0A2463');
    cell.border = bdr;
  });
  ws.getRow(4).height = 26;

  // Filas de datos
  let row = 5;
  let totMonto = 0, totPagado = 0, totSaldo = 0, totMora = 0;

  filas.forEach((f, i) => {
    const isMoraRow = f.estado === 'mora';
    const rowFill   = isMoraRow ? fill('FFFFF0F0') : (i % 2 === 0 ? fill('FFFFFFFF') : fill('FFF5F8FF'));

    const cols = [
      { v: i + 1,                    al: ctr                             },
      { v: f.cliente || '',          al: lft                             },
      { v: f.expediente || '',       al: ctr                             },
      { v: f.telefono || '',         al: ctr                             },
      { v: Number(f.montoTotal||0),  al: rgt, fmt: fmtM                 },
      { v: Number(f.cuota||0),       al: rgt, fmt: fmtM                 },
      { v: (f.frecuencia||'').charAt(0).toUpperCase() + (f.frecuencia||'').slice(1), al: ctr },
      { v: Number(f.plazo||0),       al: ctr, fmt: fmtN                 },
      { v: Number(f.pagadas||0),     al: ctr, fmt: fmtN                 },
      { v: Number(f.pendientes||0),  al: ctr, fmt: fmtN                 },
      { v: Number(f.totalPagado||0), al: rgt, fmt: fmtM                 },
      { v: Number(f.saldo||0),       al: rgt, fmt: fmtM, bold: true, color: Number(f.saldo||0)>0?'FFC62828':'FF2E7D32' },
      { v: Number(f.mora||0),        al: rgt, fmt: fmtM, color: Number(f.mora||0)>0?'FFC62828':'FF999999' },
      { v: (f.estado||'').toUpperCase(), al: ctr, bold: true, color: isMoraRow?'FFC62828':'FF1565C0' },
      { v: f.fechaFin || '',         al: ctr                             },
    ];

    cols.forEach((col, ci) => {
      const cell = ws.getCell(row, ci + 1);
      cell.value = col.v;
      cell.alignment = col.al;
      cell.fill = rowFill;
      cell.border = bdr;
      if (col.fmt)   cell.numFmt = col.fmt;
      cell.font = { size: 9, bold: !!col.bold, color: col.color ? { argb: col.color } : undefined };
    });

    ws.getRow(row).height = 14;
    totMonto  += Number(f.montoTotal  || 0);
    totPagado += Number(f.totalPagado || 0);
    totSaldo  += Number(f.saldo       || 0);
    totMora   += Number(f.mora        || 0);
    row++;
  });

  // Fila de totales
  ws.mergeCells(row, 1, row, 4);
  const totLbl = ws.getCell(row, 1);
  totLbl.value = `TOTAL (${filas.length} préstamos)`;
  totLbl.font  = { bold: true, size: 10 };
  totLbl.alignment = ctr;
  totLbl.fill  = bgTot;
  totLbl.border = bdr;
  // rellenar celdas fusionadas
  for (let c = 2; c <= 4; c++) { ws.getCell(row, c).fill = bgTot; ws.getCell(row, c).border = bdr; }

  const totCols = {5: totMonto, 6:null, 7:null, 8:null, 9:null, 10:null, 11: totPagado, 12: totSaldo, 13: totMora, 14:null, 15:null};
  for (const [ci, val] of Object.entries(totCols)) {
    const colNum = Number(ci);
    const cell = ws.getCell(row, colNum);
    cell.fill  = bgTot;
    cell.border = bdr;
    if (val !== null) {
      cell.value  = Number(val);
      cell.numFmt = fmtM;
      cell.alignment = rgt;
      cell.font = { bold: true, size: 10, color: colNum === 12 ? { argb: 'FFC62828' } : undefined };
    }
  }
  ws.getRow(row).height = 18;

  // Guardar archivo
  try {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Guardar Balance de Cartera',
      defaultPath: `BALANCE CARTERA ${(fecha||'').replace(/\//g,'-')}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { saved: false };
    const buf = await wb.xlsx.writeBuffer();
    require('fs').writeFileSync(filePath, buf);
    return { saved: true, path: filePath };
  } catch(e) {
    return { saved: false, error: String(e) };
  }
});

/* ── Planilla de Sueldos ── */
ipcMain.handle('generate-planilla', async (_event, datos) => {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch(e) {
    return { saved: false, error: 'exceljs no instalado — ejecuta: npm install' };
  }

  const { year, month, mesLabel, empresaNombre, titular, registros, resumen } = datos;
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const fmt = (n) => Number(n || 0);
  const fmtM = '"$"#,##0.00';
  const nombreTitular = titular || empresaNombre || '';
  const thin   = { style: 'thin' };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const left   = { horizontal: 'left',   vertical: 'middle', wrapText: true };

  function borderRange(ws, r1, c1, r2, c2) {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = border;
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planilla');

  // Columnas: Nº, Nombre, Cargo, Sueldo Base, Bonificación, Devengado, ISSS, AFP, Renta, Otros, Total Desc, Neto
  ws.columns = [
    { width: 4 },  // A - Nº
    { width: 26 }, // B - Nombre
    { width: 18 }, // C - Cargo
    { width: 12 }, // D - Sueldo Base
    { width: 12 }, // E - Bonificación
    { width: 13 }, // F - Total Devengado
    { width: 10 }, // G - ISSS
    { width: 10 }, // H - AFP
    { width: 10 }, // I - Renta
    { width: 10 }, // J - Otros desc
    { width: 13 }, // K - Total Desc
    { width: 13 }, // L - Neto a Pagar
  ];

  const NCOLS = 12;

  // Fila 1 – Nombre empresa
  ws.mergeCells(1, 1, 1, NCOLS);
  const r1 = ws.getCell(1, 1);
  r1.value = nombreTitular.toUpperCase();
  r1.font = { bold: true, size: 13 };
  r1.alignment = center;

  // Fila 2 – Título
  ws.mergeCells(2, 1, 2, NCOLS);
  const r2 = ws.getCell(2, 1);
  r2.value = 'PLANILLA DE SUELDOS Y SALARIOS';
  r2.font = { bold: true, size: 12 };
  r2.alignment = center;

  // Fila 3 – Mes
  ws.mergeCells(3, 1, 3, NCOLS);
  const r3 = ws.getCell(3, 1);
  r3.value = `CORRESPONDIENTE AL MES DE ${mesLabel.toUpperCase()}`;
  r3.font = { bold: true, size: 11 };
  r3.alignment = center;

  ws.getRow(1).height = 18;
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 16;

  // Fila 4 – sub-encabezados agrupados
  const HDR4 = 4, HDR5 = 5;
  // Grupo "Ingresos" cols D-F, "Descuentos Empleado" cols G-K
  ws.mergeCells(HDR4, 1, HDR5, 1); // Nº
  ws.mergeCells(HDR4, 2, HDR5, 2); // Nombre
  ws.mergeCells(HDR4, 3, HDR5, 3); // Cargo
  ws.mergeCells(HDR4, 4, HDR4, 6); // Ingresos
  ws.mergeCells(HDR4, 7, HDR4, 11); // Descuentos
  ws.mergeCells(HDR4, 12, HDR5, 12); // Neto

  const simples4 = [[1,'Nº'],[2,'Nombre completo'],[3,'Cargo'],[12,'Neto a\nPagar']];
  simples4.forEach(([c, label]) => {
    const cell = ws.getCell(HDR4, c);
    cell.value = label; cell.font = { bold:true, size:9 }; cell.alignment = center; cell.border = border;
  });

  const cell4ing = ws.getCell(HDR4, 4);
  cell4ing.value = 'INGRESOS'; cell4ing.font = { bold:true, size:9 }; cell4ing.alignment = center; cell4ing.border = border;
  borderRange(ws, HDR4, 4, HDR4, 6);

  const cell4desc = ws.getCell(HDR4, 7);
  cell4desc.value = 'DESCUENTOS EMPLEADO'; cell4desc.font = { bold:true, size:9 }; cell4desc.alignment = center; cell4desc.border = border;
  borderRange(ws, HDR4, 7, HDR4, 11);

  // Fila 5 – encabezados individuales de ingresos y descuentos
  const hdrs5 = [
    [4,'Sueldo\nBase'], [5,'Bonifi-\ncación'], [6,'Total\nDevengado'],
    [7,'ISSS\n(3%)'], [8,'AFP\n(7.25%)'], [9,'Renta'], [10,'Otros'], [11,'Total\nDesc.'],
  ];
  hdrs5.forEach(([c, label]) => {
    const cell = ws.getCell(HDR5, c);
    cell.value = label; cell.font = { bold:true, size:8 }; cell.alignment = center; cell.border = border;
  });

  ws.getRow(HDR4).height = 22;
  ws.getRow(HDR5).height = 28;

  // Filas de datos
  let row = HDR5 + 1;
  let totSueldoBase = 0, totBoni = 0, totDev = 0, totISSS = 0, totAFP = 0, totRenta = 0, totOtros = 0, totDesc = 0, totNeto = 0;

  registros.forEach((r, i) => {
    const dataRow = ws.getRow(row);
    dataRow.height = 15;
    const vals = [
      i + 1,
      r.nombre,
      r.cargo || '',
      fmt(r.sueldoBase),
      fmt(r.bonificacion),
      fmt(r.devengado),
      fmt(r.isss),
      fmt(r.afp),
      fmt(r.renta),
      fmt(r.otrosDescuentos),
      fmt(r.descuentos),
      fmt(r.neto),
    ];
    vals.forEach((v, ci) => {
      const cell = ws.getCell(row, ci + 1);
      cell.value = v; cell.border = border;
      cell.alignment = (ci === 0) ? center : (ci === 1 || ci === 2) ? left : { horizontal:'right', vertical:'middle' };
      if (ci >= 3) { cell.numFmt = fmtM; }
    });
    totSueldoBase += fmt(r.sueldoBase);
    totBoni       += fmt(r.bonificacion);
    totDev        += fmt(r.devengado);
    totISSS       += fmt(r.isss);
    totAFP        += fmt(r.afp);
    totRenta      += fmt(r.renta);
    totOtros      += fmt(r.otrosDescuentos);
    totDesc       += fmt(r.descuentos);
    totNeto       += fmt(r.neto);
    row++;
  });

  // Fila de totales
  ws.mergeCells(row, 1, row, 3);
  const cellTotLabel = ws.getCell(row, 1);
  cellTotLabel.value = 'TOTALES'; cellTotLabel.font = { bold:true, size:9 };
  cellTotLabel.alignment = center; cellTotLabel.border = border;

  const tots = [totSueldoBase, totBoni, totDev, totISSS, totAFP, totRenta, totOtros, totDesc, totNeto];
  tots.forEach((v, i) => {
    const cell = ws.getCell(row, 4 + i);
    cell.value = Math.round((v + Number.EPSILON) * 100) / 100;
    cell.numFmt = fmtM; cell.font = { bold: true }; cell.border = border;
    cell.alignment = { horizontal:'right', vertical:'middle' };
  });
  ws.getRow(row).height = 16;
  row += 2;

  // Nota descargo
  ws.mergeCells(row, 1, row, NCOLS);
  const nota = ws.getCell(row, 1);
  nota.value = 'Nota: Verifique los porcentajes de ISSS, AFP y la tabla de Renta con su contador antes de efectuar los pagos.';
  nota.font = { italic: true, size: 8 }; nota.alignment = left;
  row += 2;

  // Firma
  ws.mergeCells(row, 1, row, 4);
  ws.mergeCells(row, 5, row, 8);
  ws.mergeCells(row, 9, row, NCOLS);
  ['Elaborado por: ___________________', 'Revisado por: ___________________', 'Autorizado por: ___________________'].forEach((label, i) => {
    const startCol = [1, 5, 9][i];
    const cell = ws.getCell(row, startCol);
    cell.value = label; cell.font = { size: 9 }; cell.alignment = center;
  });

  ws.pageSetup = {
    paperSize: 1, orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    horizontalCentered: true,
  };

  /* ── Diálogo de guardado ── */
  const sugerido = `PLANILLA ${MESES[month - 1]} ${year}.xlsx`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: sugerido,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { saved: false };

  try {
    const dir = path2.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(filePath);
    return { saved: true, filePath };
  } catch(e) {
    return { saved: false, error: String(e) };
  }
});

/* ── App ready ── */
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Verificar actualizaciones (solo en producción)
  if (!isDev) {
    autoUpdater.autoDownload        = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Esperar 5s para que la app cargue antes de verificar
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('checkForUpdates error:', err);
      });
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ── Auto-updater eventos ── */
autoUpdater.on('error', (err) => {
  dialog.showMessageBox({
    type: 'error',
    title: 'Error de actualización',
    message: 'No se pudo verificar actualizaciones.\n\n' + err.message,
    buttons: ['OK'],
  });
});

autoUpdater.on('update-available', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Actualización disponible',
    message: `Nueva versión ${info.version} disponible. Se descargará en segundo plano.`,
    buttons: ['OK'],
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('CAS Majahual: ya está en la versión más reciente.');
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) {
    mainWindow.setProgressBar(progress.percent / 100);
    mainWindow.setTitle(`CAS Express — Descargando actualización ${Math.round(progress.percent)}%`);
  }
});

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    mainWindow.setProgressBar(-1);
    mainWindow.setTitle('CAS Express — Majahual Tamanique');
  }
  dialog.showMessageBox({
    type: 'info',
    title: 'Actualización lista',
    message: 'La actualización fue descargada. CAS Express se reiniciará para instalarla.',
    buttons: ['Reiniciar ahora', 'Más tarde'],
  }).then(({ response }) => {
    if (response === 0) autoUpdater.quitAndInstall();
  });
});
