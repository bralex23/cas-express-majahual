import { createContext, useContext, useState } from 'react';
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import React from 'react';

/* ══════════════════════════════════════════════════════════════
   PALETAS DE COLOR
   ══════════════════════════════════════════════════════════════ */
export type PaletteId = 'navy' | 'rojo' | 'morado' | 'verde' | 'rosa' | 'negro';

export interface Palette {
  id: PaletteId;
  name: string;
  primary: string;          // color principal (botones, headers, iconos activos)
  primaryDarkText: string;  // versión legible sobre fondo oscuro
  bgDark: string;
  bgLight: string;
  bgLightGrad: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  navy:   { id:'navy',   name:'Navy',   primary:'#0a2463', primaryDarkText:'#7aadff', bgDark:'#070c1e', bgLight:'#b8ccf0', bgLightGrad:'#ccdaff' },
  rojo:   { id:'rojo',   name:'Rojo',   primary:'#8b1515', primaryDarkText:'#ff8a80', bgDark:'#1c0505', bgLight:'#f5d0d0', bgLightGrad:'#ffcccc' },
  morado: { id:'morado', name:'Morado', primary:'#5b0080', primaryDarkText:'#e040fb', bgDark:'#160820', bgLight:'#e8d5f8', bgLightGrad:'#f0e0ff' },
  verde:  { id:'verde',  name:'Verde',  primary:'#1b5e20', primaryDarkText:'#69f0ae', bgDark:'#061208', bgLight:'#c8e8c8', bgLightGrad:'#daf5da' },
  rosa:   { id:'rosa',   name:'Rosa',   primary:'#880e4f', primaryDarkText:'#ff80ab', bgDark:'#1a0810', bgLight:'#f8bbd0', bgLightGrad:'#ffd6e7' },
  negro:  { id:'negro',  name:'Negro',  primary:'#1c1c2e', primaryDarkText:'#b0b8ff', bgDark:'#050508', bgLight:'#d5d5e8', bgLightGrad:'#e0e0f0' },
};

/* ══════════════════════════════════════════════════════════════
   GENERADOR DE COLORES
   ══════════════════════════════════════════════════════════════ */
export function getColors(isDark: boolean, paletteId: PaletteId) {
  const pal = PALETTES[paletteId];
  if (isDark) {
    return {
      isDark:      true,
      bg:          pal.bgDark,
      bgAlt:       pal.bgDark,
      surface:     '#1e1e1e',
      surfaceAlt:  '#252525',
      surfaceCard: '#252d3d',
      text:        '#f0f0f0',
      textSec:     '#bbbbbb',
      textTer:     '#888888',
      textMuted:   '#666666',
      border:      '#2e2e2e',
      borderLight: '#252525',
      primary:     pal.primary,
      primaryText: pal.primaryDarkText,
      glassTint:   pal.primary,
      gold:        '#c8a951',
      danger:      '#ef5350',
      success:     '#4caf50',
      warning:     '#ff9800',
      purple:      '#ba68c8',
      info:        '#42a5f5',
    };
  }
  return {
    isDark:      false,
    bg:          pal.bgLight,
    bgAlt:       pal.bgLightGrad,
    surface:     '#ffffff',
    surfaceAlt:  'rgba(255,255,255,0.60)',
    surfaceCard: 'rgba(255,255,255,0.80)',
    text:        '#111111',
    textSec:     '#555555',
    textTer:     '#888888',
    textMuted:   '#aaaaaa',
    border:      '#e0e0e0',
    borderLight: '#f0f0f0',
    primary:     pal.primary,
    primaryText: pal.primary,
    glassTint:   undefined as any,
    gold:        '#c8a951',
    danger:      '#c62828',
    success:     '#2e7d32',
    warning:     '#e65100',
    purple:      '#6a1b9a',
    info:        '#1565c0',
  };
}

export type AppColors = ReturnType<typeof getColors>;

export const LIGHT = getColors(false, 'navy');
export const DARK  = getColors(true,  'navy');

/* ══════════════════════════════════════════════════════════════
   TEMAS DE PAPER
   ══════════════════════════════════════════════════════════════ */
export function getPaperTheme(isDark: boolean, paletteId: PaletteId) {
  const pal = PALETTES[paletteId];
  if (isDark) {
    return {
      ...MD3DarkTheme,
      colors: { ...MD3DarkTheme.colors, primary: pal.primaryDarkText, secondary: '#c8a951',
                surface: '#1e1e1e', background: '#121212' },
    };
  }
  return {
    ...MD3LightTheme,
    colors: { ...MD3LightTheme.colors, primary: pal.primary, secondary: '#c8a951' },
  };
}

export const paperLight = getPaperTheme(false, 'navy');
export const paperDark  = getPaperTheme(true,  'navy');

/* ══════════════════════════════════════════════════════════════
   CONTEXTO DE TEMA
   ══════════════════════════════════════════════════════════════ */
interface ThemeCtxType {
  dark:       boolean;
  toggle:     () => void;
  palette:    PaletteId;
  setPalette: (id: PaletteId) => void;
}

export const ThemeCtx = createContext<ThemeCtxType>({
  dark: false, toggle: () => {},
  palette: 'navy', setPalette: () => {},
});

const DARK_KEY    = 'cas_dark_mode';
const PALETTE_KEY = 'cas_palette';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(DARK_KEY) === '1' : false; }
    catch { return false; }
  });

  const [palette, setPaletteState] = useState<PaletteId>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(PALETTE_KEY) : null;
      return (saved && saved in PALETTES) ? (saved as PaletteId) : 'verde';  // default verde para Majahual
    } catch { return 'verde'; }
  });

  function toggle() {
    setDark(d => {
      const next = !d;
      try { window.localStorage.setItem(DARK_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }

  function setPalette(id: PaletteId) {
    try { window.localStorage.setItem(PALETTE_KEY, id); } catch {}
    setPaletteState(id);
  }

  return React.createElement(ThemeCtx.Provider, { value: { dark, toggle, palette, setPalette } }, children);
}

/* ══════════════════════════════════════════════════════════════
   HOOKS
   ══════════════════════════════════════════════════════════════ */
export function useTheme()      { return useContext(ThemeCtx); }
export function useColors()     { const { dark, palette } = useContext(ThemeCtx); return getColors(dark, palette); }
export function usePaperTheme() { const { dark, palette } = useContext(ThemeCtx); return getPaperTheme(dark, palette); }

/* ══════════════════════════════════════════════════════════════
   LIQUID GLASS HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Convierte hex a rgba */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function glassStyle(isDarkOrC: boolean | { isDark: boolean; glassTint?: string }, primaryHex?: string): any {
  const isDark   = typeof isDarkOrC === 'boolean' ? isDarkOrC : isDarkOrC.isDark;
  const resolved = typeof isDarkOrC === 'object' ? isDarkOrC.glassTint : primaryHex;
  if (isDark) {
    const tint   = resolved ? hexToRgba(resolved, 0.20) : 'rgba(80,110,200,0.18)';
    const border = resolved ? hexToRgba(resolved, 0.35) : 'rgba(255,255,255,0.18)';
    return {
      backgroundColor: tint,
      backdropFilter: 'blur(24px) brightness(1.25)',
      WebkitBackdropFilter: 'blur(24px) brightness(1.25)',
      borderWidth: 1,
      borderColor: border,
      boxShadow: `0 4px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 0.5px rgba(255,255,255,0.10)`,
    };
  }
  return {
    backgroundColor: 'rgba(255,255,255,0.70)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.90)',
  };
}

export function glassBgStyle(isDarkOrC: boolean | { isDark: boolean; bg?: string; bgAlt?: string }, paletteId?: PaletteId): any {
  const isDark = typeof isDarkOrC === 'boolean' ? isDarkOrC : isDarkOrC.isDark;
  const pal = PALETTES[paletteId ?? 'verde'];
  const bgBase = (typeof isDarkOrC === 'object' && isDarkOrC.bg)  ? isDarkOrC.bg  : (isDark ? pal.bgDark  : pal.bgLight);
  const bgAlt  = (typeof isDarkOrC === 'object' && isDarkOrC.bgAlt) ? isDarkOrC.bgAlt : (isDark ? pal.bgDark : pal.bgLightGrad);
  return {
    backgroundColor: bgBase,
    backgroundImage: isDark
      ? `linear-gradient(145deg,${bgBase} 0%,${bgBase}cc 55%,${bgBase} 100%)`
      : `linear-gradient(145deg,${bgBase} 0%,${bgAlt} 45%,${bgBase}ee 100%)`,
  };
}

export function glassNavyStyle(): any {
  return {
    backgroundColor: 'rgba(5,18,8,0.95)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(105,240,174,0.18)',
    boxShadow: '0 2px 20px rgba(0,0,0,0.30), inset 0 -1px 0 rgba(255,255,255,0.05)',
  };
}
