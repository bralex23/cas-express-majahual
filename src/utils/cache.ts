/**
 * Caché en memoria con TTL para reducir queries repetidas a Firestore.
 * Se limpia automáticamente al pasar el tiempo de expiración.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL = 45_000; // 45 segundos

export const cache = {
  /** Guarda un valor con TTL en ms (default 45s) */
  set<T>(key: string, data: T, ttl = DEFAULT_TTL): void {
    store.set(key, { data, expiresAt: Date.now() + ttl });
  },

  /** Retorna el valor si existe y no expiró, o null */
  get<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
    return entry.data as T;
  },

  /** Invalida una clave (o todas las que empiecen con un prefijo) */
  invalidate(keyOrPrefix: string): void {
    for (const k of store.keys()) {
      if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) store.delete(k);
    }
  },

  /** Limpia todo el caché */
  clear(): void { store.clear(); },
};
