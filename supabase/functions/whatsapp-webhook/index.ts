import { createClient } from "npm:@supabase/supabase-js@2";
import { extraer, normalizarTelefono, UMBRAL_DETECCION, type ProductoRef } from "./extractor.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function textoDe(m: any): string | null {
  if (!m) return null;
  if (m.type === "text" || m.text?.body) return m.text?.body ?? null;
  if (m.type === "button") return m.button?.text ?? null;
  if (m.type === "interactive") return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  if (m.type === "image" || m.type === "video" || m.type === "document") return m[m.type]?.caption ? `[${m.type}] ${m[m.type].caption}` : `[${m.type}]`;
  if (m.type === "audio") return "[audio]";
  if (m.type === "location") return `[ubicación] ${m.location?.name ?? ""} ${m.location?.address ?? ""} (${m.location?.latitude},${m.location?.longitude})`.trim();
  return null;
}

let productosCache: { t: number; data: ProductoRef[] } | null = null;
async function productos(): Promise<ProductoRef[]> {
  if (productosCache && Date.now() - productosCache.t < 60000) return productosCache.data;
  const { data } = await sb.from("productos").select("id,nombre,precio,moneda,palabras_clave").eq("activo", true);
  productosCache = { t: Date.now(), data: (data ?? []) as ProductoRef[] };
  return productosCache.data;
}

async function clienteId(telefono: string, nombre: string | null): Promise<string> {
  const { data: ex } = await sb.from("clientes").select("id,nombre").eq("telefono", telefono).maybeSingle();
  if (ex) {
    if (nombre && ex.nombre === telefono) await sb.from("clientes").update({ nombre }).eq("id", ex.id);
    return ex.id;
  }
  const { data, error } = await sb.from("clientes").insert({ nombre: nombre || telefono, telefono, origen: "whatsapp" }).select("id").single();
  if (error) {
    const { data: again } = await sb.from("clientes").select("id").eq("telefono", telefono).single();
    return again!.id;
  }
  return data.id;
}

async function guardar(opts: { waId: string; telefono: string; nombre: string | null; direccion: "entrante" | "saliente"; texto: string; ts: number }) {
  const tel = normalizarTelefono(opts.telefono);
  if (!tel) return;
  const cid = await clienteId(tel, opts.nombre);
  const { data: msg, error } = await sb.from("mensajes").insert({
    cliente_id: cid, telefono: tel, nombre_contacto: opts.nombre, direccion: opts.direccion, texto: opts.texto,
    wa_message_id: opts.waId, origen: "api", enviado_en: new Date(opts.ts * 1000).toISOString(),
  }).select("id").single();
  if (error) return; // duplicado (Meta reintenta)
  if (opts.direccion !== "entrante") return;
  const ex = extraer(opts.texto, await productos(), new Date(opts.ts * 1000));
  if (ex.tipo && ex.confianza >= UMBRAL_DETECCION) {
    await sb.from("detecciones").insert({ mensaje_id: msg.id, cliente_id: cid, tipo_sugerido: ex.tipo, confianza: ex.confianza, datos: ex });
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const { data: cfg } = await sb.from("config_whatsapp").select("verify_token,app_secret").eq("id", 1).single();

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === cfg?.verify_token;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok");

  const body = await req.text();
  if (cfg?.app_secret) {
    const firma = req.headers.get("x-hub-signature-256") ?? "";
    const esperado = "sha256=" + (await hmacHex(cfg.app_secret, body));
    if (firma !== esperado) return new Response("bad signature", { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }

  try {
    for (const entry of payload.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        const v = ch.value ?? {};
        const negocio = normalizarTelefono(v.metadata?.display_phone_number);
        if (ch.field === "messages") {
          const nombres: Record<string, string> = {};
          for (const c of v.contacts ?? []) nombres[c.wa_id] = c.profile?.name;
          for (const m of v.messages ?? []) {
            const t = textoDe(m); if (!t) continue;
            await guardar({ waId: m.id, telefono: m.from, nombre: nombres[m.from] ?? null, direccion: "entrante", texto: t, ts: +m.timestamp });
          }
        } else if (ch.field === "smb_message_echoes") {
          // Mensajes enviados desde la app WhatsApp Business (coexistencia)
          for (const m of v.message_echoes ?? []) {
            const t = textoDe(m); if (!t) continue;
            await guardar({ waId: m.id, telefono: m.to, nombre: null, direccion: "saliente", texto: t, ts: +m.timestamp });
          }
        } else if (ch.field === "history") {
          // Sincronización de historial (hasta 6 meses) al conectar la app
          for (const h of v.history ?? []) for (const th of h.threads ?? []) for (const m of th.messages ?? []) {
            const t = textoDe(m); if (!t) continue;
            const desdeNegocio = negocio && normalizarTelefono(m.from) === negocio;
            await guardar({ waId: m.id, telefono: th.id, nombre: null, direccion: desdeNegocio ? "saliente" : "entrante", texto: t, ts: +m.timestamp });
          }
        } else if (ch.field === "smb_app_state_sync") {
          for (const s of v.state_sync ?? []) {
            const tel = normalizarTelefono(s.contact?.phone_number); const nom = s.contact?.full_name || s.contact?.first_name;
            if (tel && nom && s.action !== "remove") await clienteId(tel, nom);
          }
        }
      }
    }
    await sb.from("config_whatsapp").update({ ultimo_evento: new Date().toISOString() }).eq("id", 1);
  } catch (e) {
    console.error("webhook error", e);
  }
  return new Response("ok");
});
