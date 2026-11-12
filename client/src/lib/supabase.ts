import { createClient } from "@supabase/supabase-js";

// URL y clave pública (anon) del proyecto. La seguridad la aplica RLS en la base de datos.
export const SUPABASE_URL = "https://orjitoksmiwocsnvrjoo.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yaml0b2tzbWl3b2NzbnZyam9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzM0MjYsImV4cCI6MjEwOTU0OTQyNn0._zcbksh_PXAhNR-yZYhzfqw6GbUZZnQKFXv5aaTcmKk";

// Almacenamiento de sesión: usa el del navegador si está disponible; si está bloqueado (vista previa), memoria.
const memoria = new Map<string, string>();
function storageSeguro() {
  try {
    const k = "__pb_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return {
      getItem: (k: string) => memoria.get(k) ?? null,
      setItem: (k: string, v: string) => void memoria.set(k, v),
      removeItem: (k: string) => void memoria.delete(k),
    };
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { storage: storageSeguro() as any, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

export async function llamarCuentas(body: Record<string, unknown>) {
  return llamarFuncion("cuentas", body);
}

export type EstadoEnvio = { configurado: boolean; usados: number; limite: number; ventanaHasta: string | null };

// Envía desde el CRM por YCloud (texto o PDF). La función valida ventana de 24 h y tope mensual.
export async function llamarEnvio(body: Record<string, unknown>): Promise<EstadoEnvio & { ok?: boolean }> {
  return llamarFuncion("enviar-whatsapp", body);
}

async function llamarFuncion(nombre: string, body: Record<string, unknown>) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${s.session?.access_token ?? SUPABASE_ANON}`,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Error de servidor");
  return j;
}
