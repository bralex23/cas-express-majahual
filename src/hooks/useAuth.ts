import { useState, useEffect, createContext, useContext } from 'react';
import { User, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Perfil } from '../types';

interface AuthContextType {
  user: User | null;
  perfil: Perfil | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isSupervisor: boolean;
}

export const AuthContext = createContext<AuthContextType>({
  user: null, perfil: null, loading: true,
  signOut: async () => {}, isAdmin: false, isSupervisor: false,
});

export function useAuth() { return useContext(AuthContext); }

export function useAuthProvider(): AuthContextType {
  const [user, setUser]       = useState<User | null>(null);
  const [perfil, setPerfil]   = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadPerfil(uid: string) {
    const snap = await getDoc(doc(db, 'perfiles', uid));
    if (snap.exists()) setPerfil({ id: snap.id, ...snap.data() } as Perfil);
  }

  useEffect(() => {
    // Timeout de seguridad: si Firebase no responde en 6s, ir al login
    const timeout = setTimeout(() => setLoading(false), 6000);

    const unsub = auth.onAuthStateChanged(async (u) => {
      clearTimeout(timeout);
      setUser(u);
      if (u) {
        try { await loadPerfil(u.uid); } catch {}
      } else {
        setPerfil(null);
      }
      setLoading(false);
    });
    return () => { unsub(); clearTimeout(timeout); };
  }, []);

  return {
    user, perfil, loading,
    signOut: () => fbSignOut(auth),
    isAdmin: perfil?.rol === 'admin',
    isSupervisor: perfil?.rol === 'admin' || perfil?.rol === 'supervisor',
  };
}

export function login(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}
