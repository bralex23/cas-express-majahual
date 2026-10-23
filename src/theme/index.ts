import { createContext, useContext, useState } from 'react';
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import React from 'react';

/* ══════════════════════════════════════════════════════════════
   PALETAS DE COLOR  — Light-first SaaS palette
   ══════════════════════════════════════════════════════════════ */
export type PaletteId = 'navy' | 'rojo' | 'morado' | 'verde' | 'rosa' | 'negro' | 'azul';

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
  // ── Azul institucional moderno (default Majahual) ─────────────
  azul:   {
    id: 'azul',   name: 'Azul',
    primary:         '#2563eb',   // Blue-600 — botones, tabs, acciones
    primaryDarkText: '#93c5fd',   // Blue-300 — texto sobre fondo oscuro
    bgDark:          '#030d18',
    bgLight:         '#f8fafc',   // Slate-50  — fondo principal light
    bgLightGrad:     '#f1f5f9',   // Slate-100 — variante degradado
  },
  // ── Navy clásico ─────────────────────────────────────────────
  navy:   {
    id: 'navy',   name: 'Navy',
    primary:         '#1d4ed8',   // Blue-700
    primaryDarkText: '#7aadff',
    bgDark:          '#070c1e',
    bgLight:         '#f8fafc',
    bgLightGrad:     '#eef2ff',   // Indigo-50
  },
  // ── Rojo ─────────────────────────────────────────────────────
  rojo:   {
    id: 'rojo',   name: 'Rojo',
    primary:         '#dc2626',   // Red-600
    primaryDarkText: '#fca5a5',
    bgDark:          '#1c0505',
    bgLight:         '#fafafa',
    bgLightGrad:     '#fff1f2',   // Rose-50
  },
  // ── Morado ───────────────────────────────────────────────────
  morado: {
    id: 'morado', name: 'Morado',
    primary:         '#7c3aed',   // Violet-600
    primaryDarkText: '#c4b5fd',
    bgDark:          '#160820',
    bgLight:         '#fafafa',
    bgLightGrad:     '#f5f3ff',   // Violet-50
  },
  // ── Verde ─────────────────────────────────────────────────────
  verde:  {
    id: 'verde',  name: 'Verde',
    primary:         '#16a34a',   // Green-600
    primaryDarkText: '#86efac',
    bgDark:          '#061208',
    bgLight:         '#f8fafc',
    bgLightGrad:     '#f0fdf4',   // Green-50
  },
  // ── Rosa ─────────────────────────────────────────────────────
  rosa:   {
    id: 'rosa',   name: 'Rosa',
    primary:         '#db2777',   // Pink-600
    primaryDarkText: '#f9a8d4',
    bgDark:          '#1a0810',
    bgLight:         '#fafafa',
    bgLightGrad:     '#fdf2f8',   // Pink-50
  },
  // ── Negro ─────────────────────────────────────────────────────
  negro:  {
    id: 'negro',  name: 'Negro',
    primary:         '#1e293b',   // Slate-800
    primaryDarkText: '#cbd5e1',
    bgDark:          '#050508',
    bgLight:         '#f8fafc',
    bgLightGrad:     '#f1f5f9',
  },
};

/* ══════════════════════════════════════════════════════════════
   GENERADOR DE COLORES
   ══════════════════════════════════════════════════════════════ */
export function getColors(isDark: boolean, paletteId: PaletteId) {
  const pal = PALETTES[paletteId];

  /* ── DARK MODE ────────────────────────────────────────────── */
  if (isDark) {
    return {
      isDark:      true,
      bg:          pal.bgDark,
      bgAlt:       pal.bgDark,
      surface:     '#1e2433',
      surfaceAlt:  '#252d3d',
      surfaceCard: '#252d3d',
      text:        '#f1f5f9',      // Slate-100
      textSec:     '#cbd5e1',      // Slate-300
      textTer:     '#94a3b8',      // Slate-400
      textMuted:   '#64748b',      // Slate-500
      border:      '#334155',      // Slate-700
      borderLight: '#1e293b',      // Slate-800
      primary:     pal.primary,
      primaryText: pal.primaryDarkText,
      glassTint:   pal.primary,
      gold:        '#c8a951',
      danger:      '#f87171',      // Red-400
      success:     '#4ade80',      // Green-400
      warning:     '#fb923c',      // Orange-400
      purple:      '#c084fc',      // Purple-400
      info:        '#60a5fa',      // Blue-400
    };
  }

  /* ── LIGHT MODE  (SaaS moderno, alta legibilidad) ─────────── */
  return {
    isDark:      false,
    bg:          pal.bgLight,      // #f8fafc — fondo principal
    bgAlt:       pal.bgLightGrad,  // #f1f5f9 — variante
    surface:     '#ffffff',        // blanco puro para tarjetas
    surfaceAlt:  '#f8fafc',        // Slate-50 — filas alternas, inputs
    surfaceCard: '#ffffff',
    text:        '#0f172a',        // Slate-900 — títulos y texto principal
    textSec:     '#475569',        // Slate-600 — subtítulos, labels
    textTer:     '#64748b',        // Slate-500 — hints, datos secundarios
    textMuted:   '#94a3b8',        // Slate-400 — placeholders, disabled
    border:      '#e2e8f0',        // Slate-200 — bordes de tarjetas
    borderLight: '#f1f5f9',        // Slate-100 — separadores sutiles
    primary:     pal.primary,
    primaryText: pal.primary,      // en light, el primario sirve de texto
    glassTint:   undefined as any,
    gold:        '#b45309',        // Amber-700 — más legible en light
    danger:      '#dc2626',        // Red-600
    success:     '#16a34a',        // Green-600
    warning:     '#d97706',        // Amber-600
    purple:      '#7c3aed',        // Violet-600
    info:        '#2563eb',        // Blue-600
  };
}

export type AppColors = ReturnType<typeof getColors>;

export const LIGHT = getColors(false, 'azul');
export const DARK  = getColors(true,  'azul');

/* ══════════════════════════════════════════════════════════════
   TEMAS DE PAPER (React Native Paper MD3)
   ══════════════════════════════════════════════════════════════ */
export function getPaperTheme(isDark: boolean, paletteId: PaletteId) {
  const pal = PALETTES[paletteId];
  if (isDark) {
    return {
      ...MD3DarkTheme,
      colors: {
        ...MD3DarkTheme.colors,
        primary:    pal.primaryDarkText,
        secondary:  '#f59e0b',        // Amber-400
        surface:    '#1e2433',
        background: '#0f172a',
      },
    };
  }
  return {
    ...MD3LightTheme,
    colors: {
      ...MD3LightTheme.colors,
      primary:   pal.primary,
      secondary: '#b45309',           // Amber-700
      surface:   '#ffffff',
      background: '#f8fafc',
    },
  };
}

export const paperLight = getPaperTheme(false, 'azul');
export const paperDark  = getPaperTheme(true,  'azul');

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
  palette: 'azul', setPalette: () => {},
});

// Claves de localStorage — NO cambiar (romperían preferencias guardadas)
const DARK_KEY    = 'cas_dark_mode';
const PALETTE_KEY = 'cas_palette';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined'
        ? window.localStorage.getItem(DARK_KEY) === '1'
        : false;  // Light por defecto para sesiones nuevas
    } catch { return false; }
  });

  const [palette, setPaletteState] = useState<PaletteId>(() => {
    try {
      const saved = typeof window !== 'undefined'
        ? window.localStorage.getItem(PALETTE_KEY)
        : null;
      return (saved && saved in PALETTES) ? (saved as PaletteId) : 'azul';
    } catch { return 'azul'; }
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

  return React.createElement(
    ThemeCtx.Provider,
    { value: { dark, toggle, palette, setPalette } },
    children,
  );
}

/* ══════════════════════════════════════════════════════════════
   HOOKS
   ══════════════════════════════════════════════════════════════ */
export function useTheme()      { return useContext(ThemeCtx); }
export function useColors()     { const { dark, palette } = useContext(ThemeCtx); return getColors(dark, palette); }
export function usePaperTheme() { const { dark, palette } = useContext(ThemeCtx); return getPaperTheme(dark, palette); }

/* ══════════════════════════════════════════════════════════════
   HELPERS DE ESTILO — SaaS / Clean Design
   ══════════════════════════════════════════════════════════════ */

/** Hex → rgba */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * glassStyle — tarjeta SaaS limpia en light; liquid glass en dark.
 * Firma idéntica a la versión anterior (acepta boolean o AppColors).
 */
export function glassStyle(
  isDarkOrC: boolean | { isDark: boolean; glassTint?: string },
  primaryHex?: string,
): any {
  const isDark   = typeof isDarkOrC === 'boolean' ? isDarkOrC : isDarkOrC.isDark;
  const resolved = typeof isDarkOrC === 'object'  ? isDarkOrC.glassTint : primaryHex;

  if (isDark) {
    // Dark: liquid glass sutil (menos pesado que antes)
    const tint   = resolved ? hexToRgba(resolved, 0.16) : 'rgba(71,97,178,0.16)';
    const border = resolved ? hexToRgba(resolved, 0.28) : 'rgba(255,255,255,0.14)';
    return {
      backgroundColor:      tint,
      backdropFilter:       'blur(20px) brightness(1.18)',
      WebkitBackdropFilter: 'blur(20px) brightness(1.18)',
      borderWidth:          1,
      borderColor:          border,
      boxShadow:            '0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.18)',
    };
  }

  // Light: tarjeta SaaS — blanco puro, borde Slate-200, sombra de elevación mínima
  return {
    backgroundColor: '#ffffff',
    borderWidth:     1,
    borderColor:     '#e2e8f0',
    borderRadius:    16,
    boxShadow:       '0 2px 8px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.03)',
  };
}

/**
 * glassBgStyle — fondo de página.
 * En light: Slate-50 / Slate-100 limpio.
 * En dark: mantiene degradado oscuro.
 */
export function glassBgStyle(
  isDarkOrC: boolean | { isDark: boolean; bg?: string; bgAlt?: string },
  paletteId?: PaletteId,
): any {
  const isDark = typeof isDarkOrC === 'boolean' ? isDarkOrC : isDarkOrC.isDark;
  const pal    = PALETTES[paletteId ?? 'azul'];
  const bgBase = (typeof isDarkOrC === 'object' && isDarkOrC.bg)
    ? isDarkOrC.bg
    : (isDark ? pal.bgDark  : pal.bgLight);
  const bgAlt  = (typeof isDarkOrC === 'object' && isDarkOrC.bgAlt)
    ? isDarkOrC.bgAlt
    : (isDark ? pal.bgDark  : pal.bgLightGrad);

  return {
    backgroundColor:  bgBase,
    backgroundImage:  isDark
      ? `linear-gradient(145deg, ${bgBase} 0%, ${bgBase}cc 55%, ${bgBase} 100%)`
      : `linear-gradient(160deg, ${bgBase} 0%, ${bgAlt} 60%, #ffffff 100%)`,
  };
}

/**
 * glassNavyStyle — barra lateral / header oscuro.
 * En light SaaS: fondo primario sólido con borde inferior sutil.
 * La firma se mantiene (acepta primaryHex opcional).
 */
export function glassNavyStyle(primaryHex?: string): any {
  const base = primaryHex || '#2563eb';
  return {
    backgroundColor:      base,
    backdropFilter:       'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderBottomWidth:    1,
    borderBottomColor:    'rgba(255,255,255,0.10)',
    boxShadow:            `0 1px 0 rgba(255,255,255,0.06), 0 4px 16px ${hexToRgba(base, 0.22)}`,
  };
}

/* ══════════════════════════════════════════════════════════════
   HELPERS DE DEGRADADO (v2) — Firmas intactas
   ══════════════════════════════════════════════════════════════ */

/** Aclara (percent > 0) u oscurece (percent < 0) un color hex */
export function shadeHex(hex: string, percent: number): string {
  const h   = hex.replace('#', '');
  const num = parseInt(h, 16);
  const r   = Math.min(255, Math.max(0, Math.round((num >> 16)         + 255 * percent)));
  const g   = Math.min(255, Math.max(0, Math.round(((num >> 8) & 0xff) + 255 * percent)));
  const b   = Math.min(255, Math.max(0, Math.round((num & 0xff)        + 255 * percent)));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * topBarGradientStyle — TopBar / Sidebar header.
 * Light: degradado sutil del primario hacia una versión ligeramente oscurecida.
 * Dark: degradado más dramático al morado.
 */
export function topBarGradientStyle(primaryHex?: string, isDark?: boolean): any {
  const base  = primaryHex || '#2563eb';
  const shade = shadeHex(base, -0.14);          // tono 14% más oscuro
  const grad  = isDark
    ? `linear-gradient(160deg, ${base} 0%, #1e1b4b 130%)`  // dark → índigo profundo
    : `linear-gradient(160deg, ${base} 0%, ${shade} 100%)`; // light → mismo tono más oscuro
  return { backgroundColor: base, backgroundImage: grad };
}

/**
 * actionGradientStyle — botones primarios.
 * SaaS: color sólido con degradado mínimo y sombra de color suave.
 */
export function actionGradientStyle(hex: string): any {
  const darker = shadeHex(hex, -0.18);
  return {
    backgroundColor:  hex,
    backgroundImage:  `linear-gradient(135deg, ${hex} 0%, ${darker} 100%)`,
    borderRadius:     12,
    boxShadow:        `0 4px 12px ${hexToRgba(hex, 0.30)}, 0 1px 3px ${hexToRgba(hex, 0.20)}`,
  };
}
