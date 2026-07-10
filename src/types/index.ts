export type Rol = 'admin' | 'supervisor' | 'asesor' | 'cobrador';
export type Frecuencia = 'diario' | 'semanal' | 'mensual';
export type EstadoPrestamo = 'activo' | 'completado' | 'mora' | 'cancelado';

export interface Perfil {
  id: string;
  nombre: string;
  telefono?: string;
  rol: Rol;
  ruta_id?: string;
  activo: boolean;
  created_at: string;
  ruta?: Ruta;
}

export interface Ruta {
  id: string;
  nombre: string;
  descripcion?: string;
  activa: boolean;
}

export interface Cliente {
  id: string;
  nombre: string;
  dui?: string;
  telefono?: string;
  direccion?: string;
  maps_url?: string;
  geo_codigo?: string;  // Plus Code corto para colecta PDF (ej: "GJ46+XH")
  foto_url?: string;
  dui_reverso_url?: string;
  recibo_luz_url?: string;
  ruta_id?: string;
  activo: boolean;
  notas?: string;
  numero_expediente?: string;
  ref1_nombre?: string;
  ref1_telefono?: string;
  ref1_parentesco?: string;
  ref2_nombre?: string;
  ref2_telefono?: string;
  ref2_parentesco?: string;
  email?: string;
  edad?: string;
  profesion?: string;
  nit?: string;
  created_at: string;
  ruta?: Ruta;
}

export interface Prestamo {
  id: string;
  cliente_id: string;
  monto: number;
  interes: number;
  plazo: number;
  cuota: number;
  frecuencia: Frecuencia;
  fecha_inicio: string;
  fecha_desembolso?: string;  // fecha real en que se entregó el dinero (puede diferir de fecha_inicio)
  fecha_fin: string;
  monto_total: number;
  estado: EstadoPrestamo;
  asesor_id?: string;
  observaciones?: string;
  numero_credito?: number;
  created_at: string;
  cliente?: Cliente;
  asesor?: Perfil;
}

export interface Pago {
  id: string;
  prestamo_id: string;
  numero_cuota: number;
  monto_cuota: number;
  monto_pagado: number;
  mora: number;
  multa: number;
  fecha_vencimiento: string;
  fecha_pago: string;
  cobrador_id?: string;
  observaciones?: string;
  created_at: string;
}

export interface CuotaCalendar {
  numero: number;
  fecha_vencimiento: string;
  monto: number;
  pagada: boolean;
  pago?: Pago;
  mora: number;
  atrasada: boolean;
}
