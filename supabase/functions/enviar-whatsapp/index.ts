// Envía respuestas y cotizaciones (PDF) desde el CRM por medio de YCloud.
// Reglas: solo miembros activos, solo dentro de las 24 h desde el último mensaje del cliente,
// y nunca más del límite mensual configurado (para quedarse dentro de los mensajes gratis).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const NUMERO_NEGOCIO = "+50587145688";
const VENTANA_MS = 24 * 3600 * 1000;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function inicioMesManagua(): string {
  const ahora = new Date(Date.now() - 6 * 3600 * 1000); // Managua = UTC-6, sin horario de verano
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1, 6, 0, 0)).toISOString();
}

async function estado(telefono?: string) {
  const { data: cfg } = await sb.from("config_whatsapp").select("ycloud_api_key, envios_limite_mes").eq("id", 1).single();
  const { count } = await sb.from("mensajes").select("id", { count: "exact", head: true }).eq("origen", "crm").gte("enviado_en", inicioMesManagua());
  let ventanaHasta: string | null = null;
  if (telefono) {
    const { data: ult } = await sb.from("mensajes").select("enviado_en").eq("telefono", telefono).eq("direccion", "entrante").order("enviado_en", { ascending: false }).limit(1).maybeSingle();
    if (ult) { const fin = Date.parse(ult.enviado_en) + VENTANA_MS; if (fin > Date.now()) ventanaHasta = new Date(fin).toISOString(); }
  }
  return { configurado: !!cfg?.ycloud_api_key, clave: cfg?.ycloud_api_key as string | null, usados: count ?? 0, limite: cfg?.envios_limite_mes ?? 950, ventanaHasta };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return json({ error: "No autorizado" }, 401);
  const { data: perfil } = await sb.from("perfiles").select("id, activo").eq("id", who.user.id).single();
  if (!perfil?.activo) return json({ error: "No autorizado" }, 403);

  let b: any; try { b = await req.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }
  const telefono = String(b.telefono ?? "").replace(/\D/g, "") || undefined;
  const e = await estado(telefono);
  const publico = { configurado: e.configurado, usados: e.usados, limite: e.limite, ventanaHasta: e.ventanaHasta };

  if (b.accion === "estado") return json(publico);
  if (b.accion !== "texto" && b.accion !== "pdf") return json({ error: "Acción desconocida" }, 400);
  if (!telefono) return json({ error: "Falta el teléfono del cliente." }, 400);
  if (!e.configurado) return json({ error: "Falta configurar la clave de YCloud en Conexión WhatsApp.", ...publico }, 409);
  if (!e.ventanaHasta) return json({ error: "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite responderle desde el teléfono.", codigo: "ventana", ...publico }, 409);
  if (e.usados >= e.limite) return json({ error: `Se llegó al límite de ${e.limite} mensajes de este mes. Responde desde el teléfono.`, codigo: "limite", ...publico }, 409);

  const { data: cli } = await sb.from("clientes").select("id").eq("telefono", telefono).maybeSingle();
  let cuerpo: any, texto: string, media: any = null;

  if (b.accion === "texto") {
    texto = String(b.texto ?? "").trim();
    if (!texto) return json({ error: "Escribe un mensaje." }, 400);
    if (texto.length > 4096) return json({ error: "El mensaje es demasiado largo (máximo 4096 caracteres)." }, 400);
    cuerpo = { type: "text", text: { body: texto } };
  } else {
    const nombre = String(b.nombre ?? "cotizacion.pdf").replace(/[^\w.\-]+/g, "-").slice(-80);
    const bin = Uint8Array.from(atob(String(b.pdf_base64 ?? "")), (c) => c.charCodeAt(0));
    if (!bin.length || bin.length > 15 * 1048576) return json({ error: "El PDF no es válido." }, 400);
    if (new TextDecoder().decode(bin.slice(0, 5)) !== "%PDF-") return json({ error: "El archivo no es un PDF." }, 400);
    const ruta = `${telefono}/crm-${crypto.randomUUID()}-${nombre}`;
    const up = await sb.storage.from("whatsapp-media").upload(ruta, bin, { contentType: "application/pdf" });
    if (up.error) return json({ error: "No se pudo preparar el PDF." }, 500);
    const { data: firm } = await sb.storage.from("whatsapp-media").createSignedUrl(ruta, 3600);
    const pie = String(b.texto ?? "").trim().slice(0, 1024);
    cuerpo = { type: "document", document: { link: firm!.signedUrl, filename: nombre, ...(pie ? { caption: pie } : {}) } };
    texto = pie ? `[document] ${pie}` : `[document] ${nombre}`;
    media = { media_path: ruta, media_tipo: "documento", media_nombre: nombre, media_mime: "application/pdf", media_bytes: bin.length };
  }

  const r = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": e.clave! },
    body: JSON.stringify({ from: NUMERO_NEGOCIO, to: `+${telefono}`, ...cuerpo }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.status === "failed") {
    if (media) await sb.storage.from("whatsapp-media").remove([media.media_path]);
    const motivo = j?.error?.whatsappApiError?.message || j?.error?.message || j?.errorMessage || `Error ${r.status}`;
    console.error("ycloud", r.status, JSON.stringify(j).slice(0, 500));
    return json({ error: r.status === 401 || r.status === 403 ? "YCloud rechazó la clave. Revisa la clave en Conexión WhatsApp." : `WhatsApp no aceptó el mensaje: ${motivo}`, ...publico }, 502);
  }

  await sb.from("mensajes").insert({
    cliente_id: cli?.id ?? null, telefono, direccion: "saliente", texto, origen: "crm", enviado_por: perfil.id,
    wa_message_id: j.wamid || j.id || `crm-${crypto.randomUUID()}`, enviado_en: new Date().toISOString(), ...(media ?? {}),
  });
  return json({ ok: true, ...publico, usados: e.usados + 1 });
});
