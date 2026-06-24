import React, { createContext, useContext } from 'react';
import { PaletteId } from '../theme';

/* ══════════════════════════════════════════════════════════════
   TIPOS Y DEFINICIONES
══════════════════════════════════════════════════════════════ */
export type EmpresaId = 'majahual';

export interface EmpresaInfo {
  id:           EmpresaId;
  nombre:       string;
  nombreCorto:  string;
  slogan:       string;
  palette:      PaletteId;
  tasaMaxima:   number | null;
  titular?:     string;
  nit?:         string;
  registroIva?: string;
}

export const EMPRESA_MAJAHUAL: EmpresaInfo = {
  id:          'majahual',
  nombre:      'CAS EXPRESS RUTA MAJAHUAL TAMANIQUE',
  nombreCorto: 'CAS Majahual',
  slogan:      'Ruta Majahual · Tamanique',
  palette:     'verde',
  tasaMaxima:  null,
  titular:     '',   // Completar con el nombre del titular cuando esté disponible
  nit:         '',   // Completar con NIT cuando esté disponible
  registroIva: '',   // Completar con Nº de Registro IVA cuando esté disponible
};

/* ══════════════════════════════════════════════════════════════
   CONTEXTO
   col() siempre devuelve el nombre de colección tal cual (sin
   prefijo "maj_") porque este proyecto tiene su propio Firebase.
══════════════════════════════════════════════════════════════ */
interface EmpresaCtxType {
  empresa: EmpresaInfo;
  setEmpresa: (id: EmpresaId) => void;
  col: (name: string) => string;
}

const EmpresaCtx = createContext<EmpresaCtxType>({
  empresa:    EMPRESA_MAJAHUAL,
  setEmpresa: () => {},
  col:        (n) => n,
});

/* ══════════════════════════════════════════════════════════════
   PROVIDER
══════════════════════════════════════════════════════════════ */
export function EmpresaProvider({ children }: { children: React.ReactNode }) {
  // Empresa única — no hay selección de empresa en el standalone
  const col = (name: string): string => name;

  return (
    <EmpresaCtx.Provider value={{ empresa: EMPRESA_MAJAHUAL, setEmpresa: () => {}, col }}>
      {children}
    </EmpresaCtx.Provider>
  );
}

/* ══════════════════════════════════════════════════════════════
   HOOK
══════════════════════════════════════════════════════════════ */
export function useEmpresa() { return useContext(EmpresaCtx); }
