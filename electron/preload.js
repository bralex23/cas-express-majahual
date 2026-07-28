// Preload seguro — expone solo lo necesario al renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version:  process.env.npm_package_version || '1.0.0',

  generarReporteDiario: (datos) =>
    ipcRenderer.invoke('generate-reporte-diario', datos),

  printPreview: (html) =>
    ipcRenderer.invoke('print-preview', html),

  printColor: (html) =>
    ipcRenderer.invoke('print-color', html),

  doPrintColor: () =>
    ipcRenderer.invoke('do-print-color'),

  generateContabilidad: (datos) =>
    ipcRenderer.invoke('generate-contabilidad', datos),

  generateLibroIva: (datos) =>
    ipcRenderer.invoke('generate-libro-iva', datos),

  generatePlanilla: (datos) =>
    ipcRenderer.invoke('generate-planilla', datos),

  generateCartera: (datos) =>
    ipcRenderer.invoke('generate-cartera', datos),

  generateCuadroCobrador: (datos) =>
    ipcRenderer.invoke('generate-cuadro-cobrador', datos),

  // ── Facturación Electrónica DTE ──
  leerConfigDTE:   ()             => ipcRenderer.invoke('leer-config-dte'),
  guardarConfigDTE:(config)       => ipcRenderer.invoke('guardar-config-dte', config),
  enviarDTE:       (datos)        => ipcRenderer.invoke('enviar-dte', datos),
  enviarEmailCobro:(datos)        => ipcRenderer.invoke('enviar-email-cobro', datos),

  // ── Cola DTE (guardar local, enviar a Hacienda después) ──
  construirDTE:    (datos)        => ipcRenderer.invoke('construir-dte', datos),
  enviarDTECola:   (dteJson)      => ipcRenderer.invoke('enviar-dte-cola', dteJson),
  enviarEmailDTE:  (args)         => ipcRenderer.invoke('enviar-email-dte', args),
});
