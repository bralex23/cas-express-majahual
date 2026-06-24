/**
 * FadeIn — wrapper de animación para web (Electron).
 * Usa CSS transitions GPU-aceleradas (opacity + translateY).
 * En native simplemente renderiza los hijos sin animación.
 */
import React, { useState, useEffect, ReactNode } from 'react';
import { View, ViewStyle, Platform } from 'react-native';

interface FadeInProps {
  children: ReactNode;
  /** Retraso antes de aparecer (ms). Usa para efecto escalonado. */
  delay?:    number;
  /** Duración de la transición (ms). Default 200. */
  duration?: number;
  /** Desplazamiento vertical inicial en px. Default 10. */
  dy?:       number;
  style?:    ViewStyle | ViewStyle[];
}

export function FadeIn({ children, delay = 0, duration = 200, dy = 10, style }: FadeInProps) {
  const [vis, setVis] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVis(true), Math.max(delay, 16));
    return () => clearTimeout(t);
  }, [delay]);

  if (Platform.OS !== 'web') {
    return <View style={style}>{children}</View>;
  }

  return (
    <View
      style={[
        {
          opacity:   vis ? 1 : 0,
          transform: [{ translateY: vis ? 0 : dy }],
          // @ts-ignore — prop web-only
          transition: `opacity ${duration}ms ease-out, transform ${duration}ms ease-out`,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Shorthand para stagger de listas: delay = base + index × step */
export function StaggerItem({
  children, index, step = 55, delay: base = 0, duration = 200, dy = 8, style,
}: { children: ReactNode; index: number; step?: number; delay?: number; duration?: number; dy?: number; style?: ViewStyle }) {
  return (
    <FadeIn delay={base + index * step} duration={duration} dy={dy} style={style}>
      {children}
    </FadeIn>
  );
}
