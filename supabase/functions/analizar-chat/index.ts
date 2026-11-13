// Analiza un chat completo con ChatGPT (GPT-6 Luna): lee texto, fotos y notas de voz
// (transcritas con gpt-transcribe y guardadas para no pagarlas dos veces).
// Reglas: solo miembros activos y nunca más del tope mensual en dólares configurado.
// Modo automático: pg_cron lo llama cada 5 minutos con el token interno y analiza los chats
// de la Bandeja (Por revisar) con mensajes nuevos que llevan 10 minutos sin actividad.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MODELO = "gpt-6-luna";
const PRECIO_ENTRADA = 0.10 / 1e6, PRECIO_SALIDA = 0.50 / 1e6, PRECIO_AUDIO_MIN = 0.0045;
const MAX_MSGS = 400, MAX_FOTOS = 40, MAX_AUDIOS = 30;
const QUIETO_MS = 10 * 60e3, DIAS_AUTO = 3, TIEMPO_AUTO_MS = 100e3;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function inicioMesManagua(): string {
  const ahora = new Date(Date.now() - 6 * 3600 * 1000);
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1, 6, 0, 0)).toISOString();
}
const horaManagua = (iso: string) => new Date(Date.parse(iso) - 6 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Medianoche (Managua) del día del último mensaje, menos (dias - 1) días.
function desdeDias(ultimo: string, dias: number) {
  const local = new Date(Date.parse(ultimo) - 6 * 3600e3);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (dias - 1), 6)).toISOString();
}

async function estado() {
  const { data: cfg } = await sb.from("config_whatsapp").select("openai_api_key, ia_limite_usd_mes, ia_auto").eq("id", 1).single();
  const { data: usos } = await sb.from("ia_uso").select("costo_usd").gte("creado_en", inicioMesManagua());
  const gastado = (usos ?? []).reduce((s, u: any) => s + Number(u.costo_usd), 0);
  return { clave: cfg?.openai_api_key as string | null, configurado: !!cfg?.openai_api_key, gastado: Math.round(gastado * 10000) / 10000, limite: Number(cfg?.ia_limite_usd_mes ?? 10), usos: usos?.length ?? 0, auto: cfg?.ia_auto ?? true };
}

const nul = (t: string) => ({ type: [t, "null"] });
const MONTO = { type: ["object", "null"], additionalProperties: false, required: ["valor", "moneda", "msg"], properties: { valor: { type: "number" }, moneda: { type: "string", enum: ["NIO", "USD"] }, msg: nul("string") } };
const ESQUEMA = {
  type: "object", additionalProperties: false,
  required: ["estado", "resumen", "items", "total", "envio", "fecha_evento", "hora_evento", "lugar", "invitados", "facturar", "pago", "pendientes", "siguiente_paso", "fotos"],
  properties: {
    estado: { type: "string", enum: ["Consulta", "Cotizando", "Esperando al cliente", "Confirmado sin pago", "Pagado", "Sin interés"] },
    resumen: { type: "string" },
    items: { type: "array", items: { type: "object", additionalProperties: false, required: ["descripcion", "cantidad", "precio_unitario", "moneda", "producto_id", "msg"], properties: { descripcion: { type: "string" }, cantidad: { type: "number" }, precio_unitario: nul("number"), moneda: { type: ["string", "null"], enum: ["NIO", "USD", null] }, producto_id: nul("string"), msg: nul("string") } } },
    total: MONTO, envio: MONTO,
    fecha_evento: nul("string"), hora_evento: nul("string"), lugar: nul("string"), invitados: nul("number"),
    facturar: { type: ["object", "null"], additionalProperties: false, required: ["nombre", "ruc"], properties: { nombre: nul("string"), ruc: { type: "string" } } },
    pago: { type: ["object", "null"], additionalProperties: false, required: ["detalle", "msg"], properties: { detalle: { type: "string" }, msg: nul("string") } },
    pendientes: { type: "array", items: { type: "object", additionalProperties: false, required: ["texto", "msg"], properties: { texto: { type: "string" }, msg: nul("string") } } },
    siguiente_paso: { type: "string" },
    fotos: { type: "array", items: { type: "object", additionalProperties: false, required: ["msg", "descripcion"], properties: { msg: { type: "string" }, descripcion: { type: "string" } } } },
  },
};

const INSTRUCCIONES = `Eres asistente de ventas de Party Box, tienda de artículos de fiesta en Managua, Nicaragua. Recibes un chat de WhatsApp entre el EQUIPO (Party Box) y un CLIENTE, con etiquetas [m1], [m2]... por mensaje, fotos y notas de voz transcritas.
Extrae lo que el cliente quiere comprar para dar seguimiento y armar una cotización o pedido. Reglas:
- Usa SOLO lo que dice el chat o se ve en las fotos. Si algo no está, déjalo en null. Nunca inventes precios, cantidades ni fechas.
- items: la lista final acordada (si el equipo armó una lista o la corrigió, usa la más reciente). Precio unitario solo si se dio en el chat o en una foto; moneda NIO para C$ y córdobas, USD para $ o dólares. Si coincide con el catálogo pon su producto_id, si no null.
- total y envio: solo si alguien los dijo. msg es la etiqueta del mensaje de donde sale (ej. "m12").
- fecha_evento en formato AAAA-MM-DD, deducida con la fecha de los mensajes ("el sábado" = el próximo sábado tras ese mensaje). hora_evento en formato HH:MM de 24 horas (ej. "15:00").
- facturar: si piden factura con RUC (J + 13 dígitos) o cédula.
- pago: si hay comprobante de transferencia o dicen que pagaron.
- pendientes: preguntas del cliente que el equipo aún no respondió.
- fotos: describe en una línea cada foto relevante (producto, color, tema, texto o precio visible).
- resumen y siguiente_paso: breves, en español de Nicaragua, máximo 2 oraciones cada uno.`;

async function transcribir(clave: string, m: any): Promise<{ texto: string | null; seg: number }> {
  const { data: blob, error } = await sb.storage.from("whatsapp-media").download(m.media_path);
  if (error || !blob) return { texto: null, seg: 0 };
  const fd = new FormData();
  fd.append("file", new File([blob], "nota.ogg", { type: m.media_mime || "audio/ogg" }));
  fd.append("model", "gpt-transcribe");
  fd.append("language", "es");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${clave}` }, body: fd });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("transcribe", r.status, JSON.stringify(j).slice(0, 300)); throw Object.assign(new Error(j?.error?.message || `Error ${r.status}`), { status: r.status }); }
  const seg = j?.usage?.type === "duration" ? Number(j.usage.seconds) : j?.duration ? Number(j.duration) : Math.max(1, (m.media_bytes ?? blob.size) / 2000);
  const texto = String(j.text ?? "").trim();
  await sb.from("mensajes").update({ ia_transcripcion: texto || "(sin voz)" }).eq("id", m.id);
  return { texto, seg };
}

async function analizar(clave: string, telefono: string, desde: string, dias: number, usuario: string | null): Promise<{ error?: string; status?: number; a?: any; transcripciones?: Record<string, string>; costo?: number }> {
  const { data: filas } = await sb.from("mensajes")
    .select("id, direccion, texto, enviado_en, media_path, media_tipo, media_mime, media_bytes, media_borrado_en, ia_transcripcion")
    .eq("telefono", telefono).gte("enviado_en", desde).order("enviado_en", { ascending: false }).limit(MAX_MSGS);
  const msgs = (filas ?? []).reverse();
  if (!msgs.length) return { error: "No hay mensajes en ese rango.", status: 400 };

  // 1) Notas de voz: transcribir solo las que aún no tienen texto guardado.
  let audioSeg = 0;
  const audios = msgs.filter((m: any) => m.media_tipo === "audio" && m.media_path && !m.media_borrado_en && !m.ia_transcripcion).slice(-MAX_AUDIOS);
  try {
    for (let i = 0; i < audios.length; i += 4) {
      const res = await Promise.all(audios.slice(i, i + 4).map((m: any) => transcribir(clave, m)));
      res.forEach((r, k) => { audioSeg += r.seg; (audios[i + k] as any).ia_transcripcion = r.texto; });
    }
  } catch (err: any) {
    const costo = (audioSeg / 60) * PRECIO_AUDIO_MIN;
    if (costo) await sb.from("ia_uso").insert({ usuario, telefono, audio_seg: audioSeg, costo_usd: costo, automatico: !usuario });
    return { error: err.status === 401 ? "OpenAI rechazó la clave. Revísala en Conexión WhatsApp." : err.status === 429 ? "La cuenta de OpenAI no tiene saldo o llegó a su límite. Revisa la facturación en platform.openai.com." : `No se pudieron transcribir los audios: ${err.message}`, status: 502 };
  }

  // 2) Fotos: enlaces firmados por 10 minutos, solo las más recientes.
  const fotos = msgs.filter((m: any) => m.media_path && !m.media_borrado_en && (m.media_tipo === "imagen" || (m.media_mime ?? "").startsWith("image/"))).slice(-MAX_FOTOS);
  const urls: Record<string, string> = {};
  if (fotos.length) {
    const { data: f } = await sb.storage.from("whatsapp-media").createSignedUrls(fotos.map((m: any) => m.media_path), 600);
    for (const x of f ?? []) if (x.path && x.signedUrl) urls[x.path] = x.signedUrl;
  }

  // 3) Armar el chat con etiquetas cortas.
  const etiqueta: Record<string, string> = {}, deEtiqueta: Record<string, string> = {};
  const contenido: any[] = [];
  let bloque = "";
  msgs.forEach((m: any, i: number) => {
    const t = `m${i + 1}`; etiqueta[m.id] = t; deEtiqueta[t] = m.id;
    const quien = m.direccion === "entrante" ? "CLIENTE" : "EQUIPO";
    let linea = `[${t}] ${horaManagua(m.enviado_en)} ${quien}: `;
    const txt = String(m.texto ?? "").replace(/^\[(image|audio|video|document|sticker)\]\s*/i, "").trim();
    if (m.media_tipo === "audio") linea += `(nota de voz) ${m.ia_transcripcion ?? "(no disponible)"}`;
    else if (m.media_path && urls[m.media_path]) linea += `(foto adjunta)${txt ? " " + txt : ""}`;
    else if (m.media_tipo) linea += `(${m.media_tipo}${m.media_borrado_en ? " ya borrado" : ""})${txt ? " " + txt : ""}`;
    else linea += txt;
    bloque += linea + "\n";
    if (m.media_path && urls[m.media_path]) {
      contenido.push({ type: "input_text", text: bloque }); bloque = "";
      contenido.push({ type: "input_image", image_url: urls[m.media_path], detail: "auto" });
    }
  });
  if (bloque) contenido.push({ type: "input_text", text: bloque });

  const { data: prods } = await sb.from("productos").select("id, nombre, precio, moneda").eq("activo", true).limit(300);
  const catalogo = (prods ?? []).map((p: any) => `${p.id} | ${p.nombre} | ${p.precio ?? "-"} ${p.moneda ?? ""}`).join("\n");
  const hoy = horaManagua(new Date().toISOString());
  contenido.unshift({ type: "input_text", text: `Fecha y hora actual en Managua: ${hoy}.\nCatálogo (id | nombre | precio):\n${catalogo || "(vacío)"}\n\nCHAT:\n` });

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: MODELO, instructions: INSTRUCCIONES, store: false,
      reasoning: { effort: "low" },
      input: [{ role: "user", content: contenido }],
      text: { format: { type: "json_schema", name: "analisis_chat", strict: true, schema: ESQUEMA } },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  const tin = Number(j?.usage?.input_tokens ?? 0), tout = Number(j?.usage?.output_tokens ?? 0);
  const costo = tin * PRECIO_ENTRADA + tout * PRECIO_SALIDA + (audioSeg / 60) * PRECIO_AUDIO_MIN;
  if (costo > 0) await sb.from("ia_uso").insert({ usuario, telefono, tokens_entrada: tin, tokens_salida: tout, audio_seg: audioSeg, costo_usd: costo, automatico: !usuario });
  if (!r.ok) {
    console.error("openai", r.status, JSON.stringify(j).slice(0, 500));
    const msg = r.status === 401 ? "OpenAI rechazó la clave. Revísala en Conexión WhatsApp." : r.status === 429 ? "La cuenta de OpenAI no tiene saldo o llegó a su límite. Revisa la facturación en platform.openai.com." : `OpenAI no pudo analizar el chat: ${j?.error?.message ?? r.status}`;
    return { error: msg, status: 502 };
  }
  const salida = (j.output ?? []).flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text;
  let a: any; try { a = JSON.parse(salida); } catch { return { error: "La respuesta de la IA no se pudo leer. Intenta de nuevo.", status: 502 }; }

  // Volver a convertir las etiquetas m1, m2... a los id reales de los mensajes.
  const id = (t: string | null) => (t ? deEtiqueta[t.replace(/[\[\]\s]/g, "")] ?? null : null);
  for (const it of a.items) it.msg = id(it.msg);
  for (const p of a.pendientes) p.msg = id(p.msg);
  if (a.total) a.total.msg = id(a.total.msg);
  if (a.envio) a.envio.msg = id(a.envio.msg);
  if (a.pago) a.pago.msg = id(a.pago.msg);
  a.fotos = a.fotos.map((f: any) => ({ ...f, msg: id(f.msg) })).filter((f: any) => f.msg);
  const transcripciones: Record<string, string> = {};
  for (const m of msgs as any[]) if (m.media_tipo === "audio" && m.ia_transcripcion) transcripciones[m.id] = m.ia_transcripcion;

  await sb.from("analisis_ia").upsert({ telefono, analisis: a, desde, hasta: (msgs[msgs.length - 1] as any).enviado_en, dias, automatico: !usuario, costo_usd: costo, creado_en: new Date().toISOString() });
  return { a, transcripciones, costo };
}

// Recorre la Bandeja y analiza los chats con mensajes nuevos que ya se calmaron.
async function automatico() {
  const t0 = Date.now();
  const e = await estado();
  if (!e.auto || !e.configurado) return { analizados: 0, motivo: !e.auto ? "apagado" : "sin clave" };
  const { data: dets } = await sb.from("detecciones").select("id, cliente_id, mensajes(telefono), clientes(telefono)").eq("estado", "pendiente").limit(200);
  const tels = [...new Set((dets ?? []).map((d: any) => String(d.clientes?.telefono ?? d.mensajes?.telefono ?? "").replace(/\D/g, "")).filter(Boolean))];
  if (!tels.length) return { analizados: 0 };
  const { data: hechos } = await sb.from("analisis_ia").select("telefono, hasta").in("telefono", tels);
  const hasta: Record<string, string> = {};
  for (const h of hechos ?? []) hasta[h.telefono] = h.hasta;
  const cola: { tel: string; ultimo: string }[] = [];
  for (const tel of tels) {
    const { data: ult } = await sb.from("mensajes").select("enviado_en").eq("telefono", tel).order("enviado_en", { ascending: false }).limit(1).maybeSingle();
    if (!ult) continue;
    if (Date.now() - Date.parse(ult.enviado_en) < QUIETO_MS) continue; // todavía conversando
    if (hasta[tel] && Date.parse(hasta[tel]) >= Date.parse(ult.enviado_en)) continue; // ya analizado
    cola.push({ tel, ultimo: ult.enviado_en });
  }
  cola.sort((x, y) => y.ultimo.localeCompare(x.ultimo)); // primero los más recientes
  let analizados = 0, gastado = e.gastado; const errores: string[] = [];
  for (const c of cola) {
    if (Date.now() - t0 > TIEMPO_AUTO_MS || gastado >= e.limite) break;
    const r = await analizar(e.clave!, c.tel, desdeDias(c.ultimo, DIAS_AUTO), DIAS_AUTO, null);
    if (r.error) { errores.push(`${c.tel.slice(-4)}: ${r.error}`); if (r.status === 502) break; continue; }
    analizados++; gastado += r.costo ?? 0;
  }
  return { analizados, pendientes: cola.length - analizados, gastado: Math.round(gastado * 10000) / 10000, errores };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const interno = req.headers.get("x-limpieza");
  if (interno !== null) {
    const { data: cfg } = await sb.from("config_whatsapp").select("limpieza_token").eq("id", 1).single();
    if (!cfg?.limpieza_token || !igualSeguro(interno, cfg.limpieza_token)) return new Response("forbidden", { status: 403 });
    return json(await automatico());
  }
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return json({ error: "No autorizado" }, 401);
  const { data: perfil } = await sb.from("perfiles").select("id, activo").eq("id", who.user.id).single();
  if (!perfil?.activo) return json({ error: "No autorizado" }, 403);

  let b: any; try { b = await req.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }
  const e = await estado();
  const publico = { configurado: e.configurado, gastado: e.gastado, limite: e.limite, usos: e.usos, auto: e.auto };
  if (b.accion === "estado") return json(publico);
  if (b.accion !== "analizar") return json({ error: "Acción desconocida" }, 400);

  const telefono = String(b.telefono ?? "").replace(/\D/g, "");
  const desde = typeof b.desde === "string" && !isNaN(Date.parse(b.desde)) ? b.desde : new Date(Date.now() - 86400e3).toISOString();
  if (!telefono) return json({ error: "Falta el teléfono del cliente." }, 400);
  if (!e.configurado) return json({ error: "Falta pegar la clave de OpenAI en Conexión WhatsApp.", ...publico }, 409);
  if (e.gastado >= e.limite) return json({ error: `Se llegó al tope de US$${e.limite} de este mes para el análisis con IA. Un administrador puede subirlo en Conexión WhatsApp.`, codigo: "limite", ...publico }, 409);

  const r = await analizar(e.clave!, telefono, desde, Number(b.dias) || 1, perfil.id);
  if (r.error) return json({ error: r.error, ...publico }, r.status ?? 500);
  const { a, transcripciones, costo = 0 } = r;
  return json({ ok: true, analisis: a, transcripciones, costo: Math.round(costo * 10000) / 10000, ...publico, gastado: Math.round((e.gastado + costo) * 10000) / 10000, usos: e.usos + 1 });
});
