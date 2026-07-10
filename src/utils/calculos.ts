import { Frecuencia, CuotaCalendar, Pago } from '../types';

/* ─────────────────────────────────────────────────────────────────
   MÉTODO LEGAL BCR: interés sobre saldo pendiente (amortización)
   Tasa anual: 82.87 % (Seg. 3 — consumo sin descuento, hasta 12 SMV)

   Fórmula de anualidad:
     r     = tasa_por_período
     cuota = P × r / (1 − (1+r)^−n)

   Tasas por período:
     Diario:  r = 82.87% / 365
     Semanal: r = 82.87% / 365 × 7
     Mensual: r = 82.87% / 365 × 30
───────────────────────────────────────────────────────────────── */
export const TASA_ANUAL_BCR = 82.87;

function tasaPorPeriodo(freq: Frecuencia): number {
  const diaria = TASA_ANUAL_BCR / 100 / 365;
  if (freq === 'diario')  return diaria;
  if (freq === 'semanal') return diaria * 7;
  return diaria * 30;
}

/** Cuota fija por amortización sobre saldo pendiente (método BCR legal) */
export function calcularCuotaAmort(monto: number, n: number, freq: Frecuencia): number {
  if (n <= 0 || monto <= 0) return 0;
  const r = tasaPorPeriodo(freq);
  if (r === 0) return Math.round(monto / n * 100) / 100;
  const cuota = monto * r / (1 - Math.pow(1 + r, -n));
  return Math.round(cuota * 100) / 100;
}

/** Total a pagar = cuota × n  (interés viene de la amortización, no de un %) */
export function calcularTotalAmort(monto: number, n: number, freq: Frecuencia): number {
  return Math.round(calcularCuotaAmort(monto, n, freq) * n * 100) / 100;
}

/**
 * Tabla de amortización completa (igual a la que muestra el AI en pantalla).
 * Devuelve un array con una entrada por cuota:
 *   { numero, saldo, cuota, interes, abono }
 */
export function tablaAmortizacion(
  monto: number, n: number, freq: Frecuencia
): { numero: number; saldo: number; cuota: number; interes: number; abono: number }[] {
  const r    = tasaPorPeriodo(freq);
  const base = calcularCuotaAmort(monto, n, freq);
  const rows = [];
  let saldo  = monto;

  for (let i = 1; i <= n; i++) {
    const int    = Math.round(saldo * r * 100) / 100;
    const isLast = i === n;
    // Última cuota: paga exactamente el saldo restante
    const cuota  = isLast ? Math.round((saldo + int) * 100) / 100 : base;
    const abono  = Math.round((cuota - int) * 100) / 100;
    rows.push({ numero: i, saldo: Math.round(saldo * 100) / 100, cuota, interes: int, abono });
    saldo = Math.max(0, Math.round((saldo - abono) * 100) / 100);
  }
  return rows;
}

/* ── Funciones antiguas — mantenidas para préstamos ya creados ── */
export function calcularCuota(monto: number, interes: number, plazo: number): number {
  return Math.round(monto * (1 + interes / 100) / plazo * 100) / 100;
}
export function calcularTotal(monto: number, interes: number): number {
  return Math.round(monto * (1 + interes / 100) * 100) / 100;
}

export function calcularFechaFin(fechaInicio: string, plazo: number, frecuencia: Frecuencia): string {
  const f = new Date(fechaInicio + 'T00:00:00');
  if (isNaN(f.getTime())) return '';
  if (frecuencia === 'diario')  f.setDate(f.getDate() + plazo);
  else if (frecuencia === 'semanal') f.setDate(f.getDate() + plazo * 7);
  else f.setMonth(f.getMonth() + plazo);
  return f.toISOString().split('T')[0];
}

export function calcularVencimiento(fechaInicio: string, n: number, frecuencia: Frecuencia): string {
  const f = new Date(fechaInicio + 'T00:00:00');
  // Cuota #1 cae al siguiente período (día/semana/mes) desde la fecha de inicio
  if (frecuencia === 'diario')       f.setDate(f.getDate() + n);
  else if (frecuencia === 'semanal') f.setDate(f.getDate() + n * 7);
  else                               f.setMonth(f.getMonth() + n);
  return f.toISOString().split('T')[0];
}

/**
 * Multa fija de $5 si el pago es semanal y lleva 14+ días de atraso (2 semanas).
 */
export function calcularMulta(fechaVencimiento: string, frecuencia: Frecuencia): number {
  if (frecuencia !== 'semanal') return 0;
  const hoyStr  = hoy();
  if (hoyStr <= fechaVencimiento) return 0;
  const dias = Math.floor(
    (new Date(hoyStr + 'T00:00:00').getTime() - new Date(fechaVencimiento + 'T00:00:00').getTime())
    / 86400000
  );
  return dias >= 14 ? 5 : 0;
}

/**
 * Días de gracia según ley:
 *  - Créditos diarios 29 cuotas → 5 días de gracia
 *  - Créditos diarios 22 cuotas → 3 días de gracia
 *  - Créditos semanales         → 0 días de gracia
 */
export function diasGracia(frecuencia?: Frecuencia, plazo?: number): number {
  if (frecuencia === 'semanal') return 0;
  if (frecuencia === 'diario')  return plazo && plazo >= 29 ? 5 : 3;
  return 0;
}

export function calcularMora(
  fechaFin: string, cuota: number,
  frecuencia?: Frecuencia, plazo?: number, pct = 5
): number {
  const hoyStr = hoy();
  if (hoyStr <= fechaFin) return 0;
  const hoyMs      = new Date(hoyStr   + 'T00:00:00').getTime();
  const finMs      = new Date(fechaFin + 'T00:00:00').getTime();
  const diasAtraso = Math.floor((hoyMs - finMs) / 86400000);
  const gracia     = diasGracia(frecuencia, plazo);
  const dias       = Math.max(0, diasAtraso - gracia);
  if (dias === 0) return 0;
  return Math.round(cuota * (pct / 100) * dias * 100) / 100;
}

export function generarCalendario(
  plazo: number, cuota: number, frecuencia: Frecuencia,
  fechaInicio: string, pagos: Pago[], fechaFin: string
): CuotaCalendar[] {
  const hoyStr = hoy();
  return Array.from({ length: plazo }, (_, i) => {
    const num = i + 1;
    const fv  = calcularVencimiento(fechaInicio, num, frecuencia);
    const p   = pagos.find(x => x.numero_cuota === num);
    return {
      numero: num, fecha_vencimiento: fv, monto: cuota,
      pagada: !!p, pago: p,
      mora: p ? p.mora : calcularMora(fechaFin, cuota, frecuencia, plazo),
      atrasada: !p && fv < hoyStr,
    };
  });
}

export const formatMoneda = (n: number) => `$${Number(n).toFixed(2)}`;
export const formatFecha  = (s: string) => { if (!s) return ''; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };
// Siempre hora salvadoreña (UTC-6, sin cambio de horario)
export const hoy = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
export const FRECUENCIAS  = [
  { label: 'Diario',   value: 'diario'   as Frecuencia },
  { label: 'Semanal',  value: 'semanal'  as Frecuencia },
  { label: 'Mensual',  value: 'mensual'  as Frecuencia },
];
