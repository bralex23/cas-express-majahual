/**
 * AnimatedNumber — cuenta desde el valor anterior hasta el nuevo
 * con easing ease-out cubic usando requestAnimationFrame.
 * En native muestra el número directamente sin animación.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text, TextStyle, Platform } from 'react-native';

interface AnimatedNumberProps {
  value:      number;
  duration?:  number;
  formatter?: (n: number) => string;
  style?:     TextStyle | TextStyle[];
}

export function AnimatedNumber({ value, duration = 650, formatter, style }: AnimatedNumberProps) {
  const displayRef = useRef(0);
  const [display, setDisplay] = useState(0);
  const rafRef     = useRef<number>();

  useEffect(() => {
    if (Platform.OS !== 'web') {
      setDisplay(value);
      displayRef.current = value;
      return;
    }

    const from = displayRef.current;
    const to   = value;
    let start: number | null = null;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = (ts: number) => {
      if (!start) start = ts;
      const t      = Math.min((ts - start) / duration, 1);
      const eased  = 1 - Math.pow(1 - t, 3);   // ease-out cubic
      const v      = from + (to - from) * eased;
      displayRef.current = v;
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = to;
        setDisplay(to);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  const text = formatter ? formatter(display) : String(Math.round(display));
  return <Text style={style}>{text}</Text>;
}
