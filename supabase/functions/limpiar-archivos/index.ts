// Borra de Storage las fotos, videos, documentos y notas de voz más viejos que
// config_whatsapp.dias_archivos. El texto del chat se conserva; el mensaje queda
// marcado con media_borrado_en para que el CRM muestre que el archivo venció.
// Lo llama pg_cron una vez al día con el token interno de limpieza.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LOTE = 100;

function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const { data: cfg } = await sb.from("config_whatsapp").select("dias_archivos, limpieza_token").eq("id", 1).single();
  const token = req.headers.get("x-limpieza") ?? "";
  if (!cfg?.limpieza_token || !igualSeguro(token, cfg.limpieza_token)) return new Response("forbidden", { status: 403 });

  const dias = cfg.dias_archivos ?? 30;
  const limite = new Date(Date.now() - dias * 86400000).toISOString();
  let borrados = 0;
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const { data: viejos, error } = await sb.from("mensajes").select("id, media_path").not("media_path", "is", null).lt("enviado_en", limite).limit(LOTE);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!viejos?.length) break;
    const rutas = viejos.map((m) => m.media_path as string);
    const { error: e2 } = await sb.storage.from("whatsapp-media").remove(rutas);
    if (e2) return new Response(JSON.stringify({ error: e2.message, borrados }), { status: 500 });
    const { error: e3 } = await sb.from("mensajes").update({ media_path: null, media_borrado_en: new Date().toISOString() }).in("id", viejos.map((m) => m.id));
    if (e3) return new Response(JSON.stringify({ error: e3.message, borrados }), { status: 500 });
    borrados += viejos.length;
    if (viejos.length < LOTE) break;
  }
  return new Response(JSON.stringify({ dias, borrados }), { headers: { "Content-Type": "application/json" } });
});
