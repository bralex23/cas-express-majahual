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
});
