// Reporte de chats urgentes y pendientes por WhatsApp para el equipo de Party Box.
// - "pedido": el webhook lo llama cuando un número autorizado escribe "reporte" (o toca "Ver reporte").
//   Se responde con el detalle como mensaje normal (gratis, dentro de los 1.000 mensajes de servicio).
// - "diario": pg_cron lo llama cada 15 min; a la hora configurada manda la plantilla con el conteo
//   y el botón "Ver reporte" a cada número (una vez al día).
// - Acciones de administrador (sesión del CRM): estado, crear_plantilla, probar.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const NUMERO_NEGOCIO = "+50587145688";
const PLANTILLA = "reporte_diario_partybox";
const IDIOMA = "es";
const VENTANA_MS = 24 * 3600e3;
const CRM_URL = "https://perezolinto-gif.github.io/party-box-crm/#/bandeja";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const managua = (d = new Date()) => new Date(d.getTime() - 6 * 3600e3); // UTC-6 sin horario de verano
const hoyMgua = () => managua().toISOString().slice(0, 10);
const manana = () => managua(new Date(Date.now() + 86400e3)).toISOString().slice(0, 10);
function punto(t: string) { t = t.trim(); return /[.?!]$/.test(t) ? t : t + "."; }
function horaTxt(iso: string) {
  const d = managua(new Date(iso)); let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "p. m." : "a. m."; h = h % 12 || 12; return `${h}:${m} ${ap}`;
}
const telTxt = (t: string) => t.startsWith("505") && t.length === 11 ? `+505 ${t.slice(3, 7)} ${t.slice(7)}` : `+${t}`;
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fechaLarga(ymd: string) { const d = new Date(ymd + "T12:00:00Z"); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; }
const dinero = (v: number, m: string) => `${m === "USD" ? "US$" : "C$"}${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function cfg() {
  const { data } = await sb.from("config_whatsapp").select("ycloud_api_key, limpieza_token, envios_limite_mes, reporte_destinos, reporte_hora, reporte_auto, reporte_plantilla_estado, reporte_waba_id, reporte_ultimo").eq("id", 1).single();
  return data as any;
}
function inicioMesManagua(): string {
  const a = managua();
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1, 6, 0, 0)).toISOString();
}

type Linea = { nombre: string; tel: string; motivo: string; paso: string; cierra: string | null; orden: number };

// Arma el reporte a partir de la Bandeja (Por revisar) y los análisis con IA guardados.
async function construir() {
  const { data: dets } = await sb.from("detecciones").select("id, mensajes(telefono, nombre_contacto), clientes(nombre, telefono)").eq("estado", "pendiente").limit(300);
  const porTel: Record<string, string> = {};
  for (const d of (dets ?? []) as any[]) {
    const t = String(d.clientes?.telefono ?? d.mensajes?.telefono ?? "").replace(/\D/g, "");
    if (t && !porTel[t]) porTel[t] = (d.clientes?.nombre ?? d.mensajes?.nombre_contacto ?? t).trim();
  }
  const tels = Object.keys(porTel);
  const urg: Linea[] = [], pend: Linea[] = [];
  let sinAnalizar = 0;
  if (tels.length) {
    const { data: ans } = await sb.from("analisis_ia").select("telefono, analisis, hasta").in("telefono", tels);
    const an: Record<string, any> = {};
    for (const a of ans ?? []) an[a.telefono] = a;
    for (const tel of tels) {
      const { data: ult } = await sb.from("mensajes").select("direccion, enviado_en").eq("telefono", tel).order("enviado_en", { ascending: false }).limit(1).maybeSingle();
      const { data: ent } = await sb.from("mensajes").select("enviado_en").eq("telefono", tel).eq("direccion", "entrante").order("enviado_en", { ascending: false }).limit(1).maybeSingle();
      const fin = ent ? Date.parse(ent.enviado_en) + VENTANA_MS : 0;
      const cierra = fin > Date.now() ? `${new Date(fin - 6 * 3600000).toISOString().slice(0, 10) === hoyMgua() ? "hoy" : "mañana"} a las ${horaTxt(new Date(fin).toISOString())}` : null;
      const g = an[tel];
      const esperando = ult?.direccion === "entrante";
      if (!g) { if (esperando) sinAnalizar++; continue; }
      const a = g.analisis;
      if (a.estado === "Sin interés") continue;
      const nuevos = ult && Date.parse(ult.enviado_en) > Date.parse(g.hasta);
      const pronto = a.fecha_evento === hoyMgua() ? "hoy" : a.fecha_evento === manana() ? "mañana" : null;
      const preguntas: string[] = (a.pendientes ?? []).map((p: any) => String(p.texto ?? "").trim().replace(/[.\s]+$/, "")).filter(Boolean);
      // Pagado, sin preguntas ni entrega cercana: la IA lo da por cerrado aunque el último mensaje sea del cliente ("gracias").
      if (a.estado === "Pagado" && !preguntas.length && !pronto && !nuevos) continue;
      const motivo: string[] = [];
      if (pronto) motivo.push(`Entrega ${pronto}${a.hora_evento ? ` a las ${a.hora_evento}` : ""}`);
      if (a.estado === "Pagado") motivo.push(`Pagado${a.total ? ` ${dinero(a.total.valor, a.total.moneda)}` : ""}`);
      else if (a.estado === "Confirmado sin pago") motivo.push(`Confirmado sin pago${a.total ? ` (${dinero(a.total.valor, a.total.moneda)})` : ""}`);
      if (esperando) motivo.push("su último mensaje no tiene respuesta");
      if (preguntas.length) motivo.push(`sin responder: ${preguntas.slice(0, 2).join(" / ")}`);
      if (nuevos) motivo.push("tiene mensajes nuevos");
      const linea: Linea = { nombre: porTel[tel], tel, motivo: motivo.join("; ") || a.resumen, paso: a.siguiente_paso, cierra, orden: pronto === "hoy" ? 0 : pronto ? 1 : 2 };
      const cerrando = ["Cotizando", "Confirmado sin pago", "Pagado"].includes(a.estado);
      if (pronto || (esperando && cerrando) || (preguntas.length && (a.estado === "Confirmado sin pago" || a.estado === "Pagado"))) urg.push(linea);
      else if (preguntas.length || esperando || nuevos) pend.push(linea);
    }
  }
  urg.sort((x, y) => x.orden - y.orden);
  return { urg, pend, sinAnalizar, revisados: tels.length };
}

function texto(r: Awaited<ReturnType<typeof construir>>) {
  const hora = horaTxt(new Date().toISOString());
  const l: string[] = [`*Reporte Party Box* · ${fechaLarga(hoyMgua())}, ${hora}`, `${r.urg.length} urgentes · ${r.pend.length} pendientes · ${r.revisados} chats en la Bandeja`];
  const bloque = (titulo: string, xs: Linea[]) => {
    if (!xs.length) return;
    l.push("", `*${titulo}*`);
    xs.forEach((x, i) => {
      l.push(`${i + 1}. *${x.nombre}* (${telTxt(x.tel)})`, `   ${punto(x.motivo)}`, `   Qué hacer: ${x.paso}`);
      if (x.cierra) l.push(`   Responder desde el CRM antes de ${x.cierra}`);
    });
  };
  bloque("URGENTES", r.urg);
  bloque("PENDIENTES", r.pend);
  if (!r.urg.length && !r.pend.length) l.push("", "No hay chats que necesiten respuesta en este momento.");
  if (r.sinAnalizar) l.push("", `${r.sinAnalizar} chat(s) con mensajes nuevos todavía sin analizar.`);
  l.push("", `Abrir la Bandeja: ${CRM_URL}`);
  let t = l.join("\n");
  if (t.length > 4000) t = t.slice(0, 3900) + `\n…\nVer todo en la Bandeja: ${CRM_URL}`;
  return t;
}

async function ycloud(c: any, ruta: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.ycloud.com/v2${ruta}`, { ...init, headers: { "Content-Type": "application/json", "X-API-Key": c.ycloud_api_key, ...(init.headers ?? {}) } });
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok && j.status !== "failed", status: r.status, j };
}

async function usadosMes() {
  const { count } = await sb.from("mensajes").select("id", { count: "exact", head: true }).eq("origen", "crm").gte("enviado_en", inicioMesManagua());
  return count ?? 0;
}

async function enviar(c: any, tel: string, cuerpo: any, registro: string) {
  if ((await usadosMes()) >= (c.envios_limite_mes ?? 950)) return { ok: false, error: "Se llegó al límite de mensajes del mes." };
  const r = await ycloud(c, "/whatsapp/messages/sendDirectly", { method: "POST", body: JSON.stringify({ from: NUMERO_NEGOCIO, to: `+${tel}`, ...cuerpo }) });
  if (!r.ok) { console.error("ycloud", r.status, JSON.stringify(r.j).slice(0, 400)); return { ok: false, error: r.j?.error?.whatsappApiError?.message || r.j?.error?.message || `Error ${r.status}` }; }
  const { data: cli } = await sb.from("clientes").select("id").eq("telefono", tel).maybeSingle();
  await sb.from("mensajes").insert({ cliente_id: cli?.id ?? null, telefono: tel, direccion: "saliente", texto: registro, origen: "crm", wa_message_id: r.j.wamid || r.j.id || `crm-${crypto.randomUUID()}`, enviado_en: new Date().toISOString() });
  return { ok: true };
}

async function ventanaAbierta(tel: string) {
  const { data } = await sb.from("mensajes").select("enviado_en").eq("telefono", tel).eq("direccion", "entrante").order("enviado_en", { ascending: false }).limit(1).maybeSingle();
  return !!data && Date.parse(data.enviado_en) + VENTANA_MS > Date.now();
}

async function mandarReporte(c: any, tel: string, forzarPlantilla = false) {
  const r = await construir();
  if (!forzarPlantilla && (await ventanaAbierta(tel))) {
    const t = texto(r);
    return { ...(await enviar(c, tel, { type: "text", text: { body: t } }, t)), modo: "texto" };
  }
  if (c.reporte_plantilla_estado !== "APPROVED") return { ok: false, error: "La plantilla del reporte todavía no está aprobada por Meta.", modo: "plantilla" };
  const vars = [fechaLarga(hoyMgua()), String(r.urg.length), String(r.pend.length)];
  const cuerpo = { type: "template", template: { name: PLANTILLA, language: { code: IDIOMA }, components: [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) }] } };
  return { ...(await enviar(c, tel, cuerpo, `[reporte diario] ${vars[1]} urgentes y ${vars[2]} pendientes`)), modo: "plantilla" };
}

async function estadoPlantilla(c: any) {
  if (!c.reporte_waba_id) return c.reporte_plantilla_estado ?? null;
  const r = await ycloud(c, `/whatsapp/templates/${c.reporte_waba_id}/${PLANTILLA}/${IDIOMA}`);
  const st = r.ok ? (r.j.status ?? null) : c.reporte_plantilla_estado;
  if (st && st !== c.reporte_plantilla_estado) await sb.from("config_whatsapp").update({ reporte_plantilla_estado: st }).eq("id", 1);
  return st;
}

async function crearPlantilla(c: any) {
  const nums = await ycloud(c, `/whatsapp/phoneNumbers?limit=100`);
  if (!nums.ok) return { ok: false, error: "No se pudo leer la cuenta de WhatsApp en YCloud." };
  const n = (nums.j.items ?? []).find((x: any) => String(x.phoneNumber ?? "").replace(/\D/g, "") === NUMERO_NEGOCIO.replace(/\D/g, "")) ?? nums.j.items?.[0];
  if (!n?.wabaId) return { ok: false, error: "No se encontró la cuenta de WhatsApp de Party Box en YCloud." };
  const r = await ycloud(c, "/whatsapp/templates", {
    method: "POST",
    body: JSON.stringify({
      wabaId: n.wabaId, name: PLANTILLA, language: IDIOMA, category: "UTILITY",
      components: [
        { type: "BODY", text: "Reporte de seguimiento de Party Box del {{1}}: hay {{2}} chats urgentes y {{3}} pendientes en la Bandeja del CRM. Toque Ver reporte para recibir el detalle.", example: { body_text: [["viernes 13 de noviembre", "4", "5"]] } },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ver reporte" }] },
      ],
    }),
  });
  const ya = !r.ok && /exist/i.test(JSON.stringify(r.j));
  if (!r.ok && !ya) { console.error("plantilla", r.status, JSON.stringify(r.j).slice(0, 600)); return { ok: false, error: r.j?.error?.whatsappApiError?.error_user_msg || r.j?.error?.message || `Error ${r.status}` }; }
  await sb.from("config_whatsapp").update({ reporte_waba_id: n.wabaId, reporte_plantilla_estado: r.j.status ?? "PENDING" }).eq("id", 1);
  return { ok: true, estado: ya ? await estadoPlantilla({ ...c, reporte_waba_id: n.wabaId }) : (r.j.status ?? "PENDING") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let b: any; try { b = await req.json(); } catch { b = {}; }
  const c = await cfg();
  if (!c?.ycloud_api_key) return json({ error: "Falta la clave de API de YCloud." }, 409);
  const destinos: { nombre: string; telefono: string }[] = c.reporte_destinos ?? [];

  // Llamadas internas (webhook y pg_cron) con el token de limpieza.
  const interno = req.headers.get("x-limpieza");
  if (interno !== null) {
    if (!c.limpieza_token || !igualSeguro(interno, c.limpieza_token)) return new Response("forbidden", { status: 403 });
    if (b.accion === "pedido") {
      const tel = String(b.telefono ?? "").replace(/\D/g, "");
      if (!destinos.some((d) => d.telefono === tel)) return json({ ok: false, motivo: "no autorizado" });
      return json(await mandarReporte(c, tel));
    }
    if (b.accion === "diario") {
      if (!c.reporte_auto || !destinos.length) return json({ ok: true, motivo: "apagado" });
      const ahora = managua();
      const [h, m] = String(c.reporte_hora ?? "07:30").split(":").map(Number);
      const desde = h * 60 + m, now = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
      // Solo en las 3 horas siguientes a la hora elegida, una vez al día.
      if (now < desde || now > desde + 180 || c.reporte_ultimo === hoyMgua()) return json({ ok: true, motivo: "no es la hora" });
      const st = await estadoPlantilla(c);
      await sb.from("config_whatsapp").update({ reporte_ultimo: hoyMgua() }).eq("id", 1);
      const res: any[] = [];
      // Ventana de 24 h abierta: reporte completo como texto (sin costo). Si no, la plantilla aprobada.
      for (const d of destinos) res.push({ tel: d.telefono.slice(-4), ...(await mandarReporte({ ...c, reporte_plantilla_estado: st }, d.telefono)) });
      return json({ ok: true, res });
    }
    return json({ error: "Acción desconocida" }, 400);
  }

  // Acciones desde el CRM: solo administradores activos.
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return json({ error: "No autorizado" }, 401);
  const { data: perfil } = await sb.from("perfiles").select("id, activo, rol").eq("id", who.user.id).single();
  if (!perfil?.activo || perfil.rol !== "admin") return json({ error: "Solo administradores." }, 403);

  if (b.accion === "estado") return json({ plantilla: await estadoPlantilla(c), ultimo: c.reporte_ultimo });
  if (b.accion === "crear_plantilla") return json(await crearPlantilla(c));
  if (b.accion === "vista") return json({ texto: texto(await construir()) });
  if (b.accion === "probar") {
    const tel = String(b.telefono ?? "").replace(/\D/g, "");
    if (!destinos.some((d) => d.telefono === tel)) return json({ error: "Ese número no está en la lista del reporte." }, 400);
    const r = await mandarReporte(c, tel);
    return r.ok ? json(r) : json({ error: r.modo === "plantilla" && r.error?.includes("aprobada") ? "Ese número no le ha escrito a Party Box en las últimas 24 horas y la plantilla aún no está aprobada. Pídale que escriba «reporte» al número de la tienda." : r.error }, 409);
  }
  return json({ error: "Acción desconocida" }, 400);
});
