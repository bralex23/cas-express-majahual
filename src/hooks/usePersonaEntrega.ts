import { useState, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { db } from '../lib/firebase';
import { Perfil } from '../types';

const STORAGE_KEY = 'cas_persona_entrega';

/**
 * Hook para seleccionar qué nombre aparece como "persona que entrega/cobra"
 * en los documentos PDF (contratos, colectas, etc.), en lugar de usar
 * automáticamente el nombre del usuario que tiene la sesión iniciada.
 *
 * Recuerda la última selección en localStorage para sugerirla la próxima vez.
 */
export function usePersonaEntrega(perfilNombre?: string) {
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [visible, setVisible]   = useState(false);
  const [valor, setValor]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [accion, setAccion]     = useState<{ fn: ((nombre: string) => void | Promise<void>) | null }>({ fn: null });

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'perfiles'));
        setUsuarios(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as Perfil))
            .filter(u => u.activo !== false)
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
        );
      } catch {}
    })();
  }, []));

  function pedir(onConfirm: (nombre: string) => void | Promise<void>) {
    let guardada = '';
    try { guardada = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
    setValor(guardada || perfilNombre || '');
    setAccion({ fn: onConfirm });
    setVisible(true);
  }

  async function confirmar() {
    const nombre = valor.trim();
    if (!nombre) return;
    try { localStorage.setItem(STORAGE_KEY, nombre); } catch {}
    setLoading(true);
    try { await accion.fn?.(nombre); }
    finally { setLoading(false); setVisible(false); }
  }

  function cancelar() { setVisible(false); }

  return { usuarios, visible, valor, setValor, loading, pedir, confirmar, cancelar };
}
