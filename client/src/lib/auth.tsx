import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Perfil } from "./crm";

type Ctx = { session: Session | null; perfil: Perfil | null; cargando: boolean; salir: () => Promise<void>; recargar: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ session: null, perfil: null, cargando: true, salir: async () => {}, recargar: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  async function cargarPerfil(s: Session | null) {
    if (!s) { setPerfil(null); return; }
    const { data } = await supabase.from("perfiles").select("*").eq("id", s.user.id).maybeSingle();
    setPerfil((data as Perfil) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await cargarPerfil(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setTimeout(() => cargarPerfil(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        session, perfil, cargando,
        salir: async () => { await supabase.auth.signOut(); setPerfil(null); },
        recargar: async () => cargarPerfil(session),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
