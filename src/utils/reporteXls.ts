/**
 * Reporte Diario de Disponible por Ruta → archivo .xlsx real.
 * La generación ocurre en el proceso Node.js de Electron (IPC),
 * usando la librería xlsx — sin problemas de bundler ni formato.
 */

export interface DatosReporteDiario {
  fecha:            string;   // 'YYYY-MM-DD'
  cobrador:         string;
  ruta:             string;
  zona:             string;
  saldoAnterior:    number;
  cobroDia:         number;
  ingresoEfectivo?: number;  // Dinero que entra de la empresa
  deposito?:        number;  // Depósito bancario (salida)
  cajaChica?:       number;  // Fondo caja chica del día (salida real)
  retiroCajaChica?: number;  // Retiro del fondo acumulado (movimiento interno)
  retiroCajaRazon?: string;  // Razón del retiro
  renovaciones:     { descripcion: string; monto: number }[];
}

/**
 * Llama al proceso principal de Electron para generar y guardar el .xlsx.
 * Muestra automáticamente el diálogo "Guardar como" con el nombre del día.
 * Retorna true si el archivo fue guardado.
 */
export async function guardarReporteDiario(datos: DatosReporteDiario): Promise<boolean> {
  const api = typeof window !== 'undefined' && (window as any).electronAPI;

  if (api?.generarReporteDiario) {
    const result = await api.generarReporteDiario(datos);
    if (result?.error) console.warn('Error guardando reporte:', result.error);
    return result?.saved === true;
  }

  // Fallback en navegador web (modo desarrollo sin Electron)
  console.warn('electronAPI.generarReporteDiario no disponible — solo funciona en Electron.');
  return false;
}
