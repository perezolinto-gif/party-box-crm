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
  if (m.type === "image" || m.type === "video" || m.type === "document") {
    const o = m[m.type] ?? {};
    const pie = o.caption || (m.type === "document" ? o.filename : "") || "";
    return pie ? `[${m.type}] ${pie}` : `[${m.type}]`;
  }
  if (m.type === "audio") return "[audio]";
  if (m.type === "sticker") return "[sticker]";
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

// ---------- Fotos, videos, documentos y notas de voz ----------
// YCloud entrega un enlace firmado que se puede abrir sin clave durante unos minutos;
// por eso el archivo se descarga en el momento y se guarda en Storage (privado).
type Media = { link: string; mime: string; tipo: "imagen" | "video" | "documento" | "audio"; nombre: string | null };
const MAX_BYTES = 50 * 1024 * 1024;
const TIPOS: Record<string, Media["tipo"]> = { image: "imagen", sticker: "imagen", video: "video", document: "documento", audio: "audio" };
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "application/pdf": "pdf", "application/msword": "doc", "application/vnd.ms-excel": "xls", "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt", "text/csv": "csv", "application/zip": "zip",
};
// Tipos que el navegador podría ejecutar: se guardan como descarga genérica.
const PELIGROSOS = /^(text\/html|application\/xhtml|image\/svg|text\/javascript|application\/javascript|application\/x-sh)/;
function mediaDe(m: any): Media | null {
  if (!m) return null;
  const tipo = TIPOS[m.type];
  const o = tipo ? m[m.type] : null;
  const link = o?.link ?? (m.type === "image" ? m.image_url : null) ?? null;
  if (!tipo || !link) return null;
  return { link, mime: (o?.mime_type ?? "").split(";")[0].trim().toLowerCase(), tipo, nombre: o?.filename ?? null };
}
function limpiarNombre(n: string) { return n.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(-80); }
async function guardarMedia(media: Media, telefono: string, waId: string): Promise<{ ruta: string; mime: string; bytes: number } | null> {
  try {
    let r = await fetch(media.link);
    const clave = Deno.env.get("YCLOUD_API_KEY");
    if (!r.ok && clave) r = await fetch(media.link, { headers: { "X-API-Key": clave } });
    if (!r.ok) { console.error("archivo no descargado", r.status); return null; }
    const largo = Number(r.headers.get("content-length") ?? 0);
    if (largo > MAX_BYTES) { console.error("archivo muy grande", largo); return null; }
    let mime = (media.mime || r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const datos = new Uint8Array(await r.arrayBuffer());
    if (datos.byteLength > MAX_BYTES) return null;
    if (PELIGROSOS.test(mime)) mime = "application/octet-stream";
    const base = waId.replace(/[^A-Za-z0-9_-]/g, "").slice(-60) || crypto.randomUUID();
    const ext = EXT[mime] ?? (media.nombre?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1]?.toLowerCase()) ?? "bin";
    const ruta = `${telefono}/${base}${media.nombre ? "-" + limpiarNombre(media.nombre.replace(/\.[^.]+$/, "")) : ""}.${ext}`;
    const { error } = await sb.storage.from("whatsapp-media").upload(ruta, datos, { contentType: mime, upsert: true });
    if (error) { console.error("archivo no guardado", error.message); return null; }
    return { ruta, mime, bytes: datos.byteLength };
  } catch (e) { console.error("archivo error", e); return null; }
}

// Historial: solo se sugieren pedidos/cotizaciones de los últimos 30 días para no llenar la bandeja de casos viejos.
const DIAS_HISTORIAL = 30;

async function guardar(opts: { waId: string; telefono: string; nombre: string | null; direccion: "entrante" | "saliente"; texto: string; ts: number; historial?: boolean; media?: Media | null }) {
  const tel = normalizarTelefono(opts.telefono);
  if (!tel) return;
  const cid = await clienteId(tel, opts.nombre);
  const { data: msg, error } = await sb.from("mensajes").insert({
    cliente_id: cid, telefono: tel, nombre_contacto: opts.nombre, direccion: opts.direccion, texto: opts.texto,
    wa_message_id: opts.waId, origen: "api", enviado_en: new Date(opts.ts * 1000).toISOString(),
  }).select("id").single();
  if (error) return; // duplicado (Meta reintenta)
  if (opts.media) {
    const g = await guardarMedia(opts.media, tel, opts.waId);
    if (g) await sb.from("mensajes").update({ media_path: g.ruta, media_tipo: opts.media.tipo, media_nombre: opts.media.nombre, media_mime: g.mime, media_bytes: g.bytes }).eq("id", msg.id);
  }
  if (opts.direccion !== "entrante") return;
  if (opts.historial && Date.now() - opts.ts * 1000 > DIAS_HISTORIAL * 86400000) return;
  const ex = extraer(opts.texto, await productos(), new Date(opts.ts * 1000));
  if (ex.tipo && ex.confianza >= UMBRAL_DETECCION) {
    await sb.from("detecciones").insert({ mensaje_id: msg.id, cliente_id: cid, tipo_sugerido: ex.tipo, confianza: ex.confianza, datos: ex });
  }
}

// ---------- YCloud (proveedor oficial de Meta, coexistencia con la app WhatsApp Business) ----------
function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function firmaYCloudValida(header: string, body: string, secret: string) {
  const campos = header.split(",").map((p) => p.trim().split("="));
  const t = campos.find(([k]) => k === "t")?.[1];
  const firmas = campos.filter(([k]) => k === "s").map(([, v]) => (v ?? "").toLowerCase());
  if (!t || !/^\d+$/.test(t) || !firmas.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const claves = secret.startsWith("whsec_") ? [secret, secret.slice(6)] : [secret];
  const esperadas: string[] = [];
  for (const k of claves) esperadas.push(await hmacHex(k, `${t}.${body}`), await hmacHex(k, `${t}.${body}.`));
  return firmas.some((f) => esperadas.some((e) => igualSeguro(e, f)));
}
const segundos = (iso?: string) => { const n = iso ? Date.parse(iso) : NaN; return Math.floor((isNaN(n) ? Date.now() : n) / 1000); };

async function procesarYCloud(ev: any) {
  const tipo: string = ev.type ?? "";
  const historial = tipo === "whatsapp.smb.history";
  const ent = ev.whatsappInboundMessage;
  const sal = ev.whatsappMessage;
  if (ent && (tipo === "whatsapp.inbound_message.received" || historial)) {
    const t = textoDe(ent);
    if (t && ent.from) await guardar({ waId: ent.wamid || ent.id, telefono: ent.from, nombre: ent.customerProfile?.name ?? null, direccion: "entrante", texto: t, ts: segundos(ent.sendTime), historial, media: mediaDe(ent) });
  }
  if (sal && (tipo === "whatsapp.smb.message.echoes" || tipo === "whatsapp.smb.message.created" || historial)) {
    const t = textoDe(sal);
    if (t && sal.to) await guardar({ waId: sal.wamid || sal.id, telefono: sal.to, nombre: null, direccion: "saliente", texto: t, ts: segundos(sal.sendTime || sal.createTime), historial, media: mediaDe(sal) });
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const { data: cfg } = await sb.from("config_whatsapp").select("verify_token,app_secret,ycloud_secret").eq("id", 1).single();

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === cfg?.verify_token;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok");

  const body = await req.text();

  const firmaYC = req.headers.get("ycloud-signature");
  if (firmaYC) {
    if (!cfg?.ycloud_secret || !(await firmaYCloudValida(firmaYC, body, cfg.ycloud_secret))) return new Response("bad signature", { status: 401 });
    let ev: any;
    try { ev = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
    try {
      await procesarYCloud(ev);
      await sb.from("config_whatsapp").update({ ultimo_evento: new Date().toISOString() }).eq("id", 1);
    } catch (e) { console.error("ycloud error", e); }
    return new Response("ok");
  }
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
            await guardar({ waId: m.id, telefono: th.id, nombre: null, direccion: desdeNegocio ? "saliente" : "entrante", texto: t, ts: +m.timestamp, historial: true });
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
