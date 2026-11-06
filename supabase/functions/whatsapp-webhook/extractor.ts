// Extractor de pedidos y cotizaciones a partir de mensajes de WhatsApp (español de Nicaragua).
// Sin dependencias: se usa igual en el navegador y en la función de Supabase.

export type ProductoRef = { id: string; nombre: string; precio: number; moneda: string; palabras_clave?: string | null };

export type ItemDetectado = { descripcion: string; cantidad: number; producto_id?: string | null; precio_unitario?: number };

export type Extraccion = {
  tipo: "cotizacion" | "pedido" | null;
  confianza: number; // 0-100
  items: ItemDetectado[];
  montos: { valor: number; moneda: "NIO" | "USD" }[];
  fecha_evento: string | null; // YYYY-MM-DD
  hora_evento: string | null;
  lugar: string | null;
  invitados: number | null;
  razones: string[];
};

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};
const DIAS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const NUM_PALABRA: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, docena: 12,
};

const PEDIDO_KW = [
  "pedido", "pedir", "ordenar", "orden", "confirmo", "confirmado", "confirmamos", "lo quiero", "la quiero", "los quiero", "las quiero",
  "apartar", "aparto", "reservar", "reservo", "reserva", "anticipo", "adelanto", "deposito", "depositar", "transferencia", "transferi",
  "ya pague", "pago", "comprobante", "me lo llevo", "quiero encargar", "encargo", "encargar", "dale", "hagamos el pedido",
];
const COTIZ_KW = [
  "cotizacion", "cotizar", "cotiza", "precio", "precios", "cuanto", "cuesta", "costo", "valor", "presupuesto",
  "disponible", "disponibilidad", "tienen", "manejan", "info", "informacion", "catalogo", "paquete", "paquetes", "promocion",
];
const NEGOCIO_KW = [
  "fiesta", "cumple", "cumpleanos", "evento", "boda", "baby shower", "bautizo", "xv", "quince anos", "graduacion", "decoracion",
  "globos", "arco", "caja", "box", "mesa", "pastel", "invitados", "personas", "ninos", "tematica", "tema", "entrega", "domicilio",
];

export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function contieneFrase(texto: string, frase: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${frase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
  return re.test(texto);
}

function parseNumero(s: string): number {
  // "1,500.50" | "1.500" | "1500" | "2,5"
  let t = s.trim();
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ajustarAnio(m: number, d: number, ref: Date): string | null {
  let y = ref.getFullYear();
  const cand = iso(y, m, d);
  if (!cand) return null;
  const refIso = iso(ref.getFullYear(), ref.getMonth() + 1, ref.getDate())!;
  // Si la fecha ya pasó hace más de 7 días, asumimos el año siguiente.
  const diff = (Date.parse(cand) - Date.parse(refIso)) / 86400000;
  if (diff < -7) y += 1;
  return iso(y, m, d);
}

export function extraerFecha(t: string, ref: Date): string | null {
  // 15 de noviembre / 15 nov
  let m = t.match(/\b(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\b(?:\s*(?:de|del)?\s*(\d{4}))?/);
  if (m) {
    const d = +m[1], mes = MESES[m[2]];
    return m[3] ? iso(+m[3], mes, d) : ajustarAnio(mes, d, ref);
  }
  // 15/11 o 15/11/2026 o 15-11-26
  m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const d = +m[1], mes = +m[2];
    if (mes >= 1 && mes <= 12 && d >= 1 && d <= 31) {
      if (m[3]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(y, mes, d); }
      return ajustarAnio(mes, d, ref);
    }
  }
  const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const sumar = (n: number) => { const x = new Date(base); x.setDate(x.getDate() + n); return iso(x.getFullYear(), x.getMonth() + 1, x.getDate()); };
  if (/\bpasado manana\b/.test(t)) return sumar(2);
  if (/\bmanana\b/.test(t) && !/\bmanana en la\b|\bpor la manana\b|\bde la manana\b/.test(t)) return sumar(1);
  if (/\bhoy\b/.test(t)) return sumar(0);
  m = t.match(/\b(?:este|el|para el|proximo|el proximo)\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (m) {
    const objetivo = DIAS[m[1]];
    let n = (objetivo - base.getDay() + 7) % 7; if (n === 0) n = 7;
    if (/proximo/.test(m[0]) && n < 7 && false) n += 7;
    return sumar(n);
  }
  return null;
}

function extraerHora(t: string): string | null {
  const m = t.match(/\b(?:a las|alas|para las|como a las)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?\s?m\.?|p\.?\s?m\.?|de la manana|de la tarde|de la noche)?/);
  if (!m) return null;
  let h = +m[1]; const min = m[2] ? m[2] : "00";
  const suf = (m[3] || "").replace(/[.\s]/g, "");
  if (/pm|tarde|noche/.test(suf) && h < 12) h += 12;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function extraerMontos(original: string): { valor: number; moneda: "NIO" | "USD" }[] {
  const t = original.toLowerCase();
  const res: { valor: number; moneda: "NIO" | "USD" }[] = [];
  const reNIO = /(?:c\$|cs\$?|c\s\$)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:cordobas|córdobas|pesos|c\$)/g;
  const reUSD = /(?:us\$|u\$s?|usd|\$)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:dolares|dólares|usd|dls)/g;
  let m: RegExpExecArray | null;
  const usados = new Set<number>();
  reNIO.lastIndex = 0;
  while ((m = reNIO.exec(t))) { const v = parseNumero(m[1] || m[2]); if (v > 0) { res.push({ valor: v, moneda: "NIO" }); usados.add(m.index); } }
  reUSD.lastIndex = 0;
  while ((m = reUSD.exec(t))) {
    if (usados.has(m.index) || usados.has(m.index - 1)) continue;
    // evitar que "c$" se cuente como "$"
    if (m[0].startsWith("$") && m.index > 0 && /[c]/.test(t[m.index - 1])) continue;
    const v = parseNumero(m[1] || m[2]); if (v > 0) res.push({ valor: v, moneda: "USD" });
  }
  return res;
}

function extraerLugar(original: string): string | null {
  const m = original.match(/(?:direcci[oó]n|entregar en|entrega en|llevar a|lo llevan a|en el barrio|barrio|residencial|colonia|ubicad[oa] en|queda en)\s*:?\s*([^\n.;]{4,80})/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

function singular(s: string): string {
  return normalizar(s).split(" ").map((w) => w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w).join(" ");
}

const NUM_GENERICO = Object.keys(NUM_PALABRA).filter((k) => !["un", "una", "uno"].includes(k));
const CONECTORES = /\s+(?:para|y|con|a|al|el|la|los|las|que|por|en|del|pero|o|me|se|si|tambien|porfa|por favor)$/;

function extraerItems(original: string, t: string, productos: ProductoRef[]): ItemDetectado[] {
  const items: ItemDetectado[] = [];
  const vistos = new Set<string>();
  // 1) Coincidencias con el catálogo (nombre o palabras clave), con cantidad cercana opcional
  for (const p of productos) {
    const claves = [p.nombre, ...(p.palabras_clave ? p.palabras_clave.split(",") : [])].map((x) => normalizar(x)).filter((x) => x.length >= 3);
    for (const c of claves) {
      const esc = singular(c).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:es|s)?").join("\\s+");
      const re = new RegExp(`(?:^|[^a-z0-9])(?:(\\d+|${Object.keys(NUM_PALABRA).join("|")})\\s+(?:[a-z]+\\s+){0,2})?${esc}(?:[^a-z0-9]|$)`);
      const m = t.match(re);
      if (m) {
        const qRaw = m[1];
        const cantidad = qRaw ? (NUM_PALABRA[qRaw] ?? (parseInt(qRaw) || 1)) : 1;
        if (!vistos.has(p.id)) {
          items.push({ descripcion: p.nombre, cantidad, producto_id: p.id, precio_unitario: Number(p.precio) || 0 });
          vistos.add(p.id);
        }
        break;
      }
    }
  }
  // 2) Patrones genéricos "50 globos", "2 cajas sorpresa", "una docena de cupcakes"
  const re = new RegExp(`\\b(\\d{1,4}|${NUM_GENERICO.join("|")})\\s+(?:de\\s+)?([a-zñ]{3,}(?:\\s+(?:de\\s+)?[a-zñ]{3,}){0,2})`, "g");
  const NO_ITEM = /^(personas|invitados|ninos|adultos|pax|de|del|la|las|el|los|anos|ano|dias|dia|horas|hora|minutos|am|pm|personas aprox|cordobas|dolares|pesos|mil|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|semanas|semana|meses|mes|por ciento|veces)\b/;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(t))) {
    const cantidadTxt = m[1];
    let desc = m[2].trim();
    if (NO_ITEM.test(desc)) continue;
    // cortar en conectores
    desc = desc.split(/\s+(?:para|y|con|a|al|el|la|los|las|que|por|en|pero|o)\s+/)[0];
    while (CONECTORES.test(desc)) desc = desc.replace(CONECTORES, "");
    if (desc.length < 3) continue;
    const key = singular(desc);
    if (vistos.has(key) || items.some((i) => { const s2 = singular(i.descripcion); return s2.includes(key) || key.includes(s2); })) continue;
    const cantidad = NUM_PALABRA[cantidadTxt] ?? parseInt(cantidadTxt);
    if (!cantidad || cantidad > 5000) continue;
    // evitar fechas y horas
    const prev = t.slice(Math.max(0, m.index - 6), m.index);
    if (/(a las|las)\s*$/.test(prev)) continue;
    items.push({ descripcion: desc.charAt(0).toUpperCase() + desc.slice(1), cantidad });
    vistos.add(key);
  }
  return items.slice(0, 12);
}

export function extraer(texto: string, productos: ProductoRef[] = [], ref: Date = new Date()): Extraccion {
  const t = normalizar(texto);
  const razones: string[] = [];
  let pedido = 0, cotiz = 0, negocio = 0;
  for (const k of PEDIDO_KW) if (contieneFrase(t, k)) { pedido += 1; razones.push(`palabra «${k}»`); }
  for (const k of COTIZ_KW) if (contieneFrase(t, k)) { cotiz += 1; razones.push(`palabra «${k}»`); }
  for (const k of NEGOCIO_KW) if (contieneFrase(t, k)) negocio += 1;
  if (/\?/.test(texto) && cotiz > 0) cotiz += 0.5;

  const items = extraerItems(texto, t, productos);
  const montos = extraerMontos(texto);
  const fecha_evento = extraerFecha(t, ref);
  const hora_evento = extraerHora(t);
  const lugar = extraerLugar(texto);
  const mInv = t.match(/\b(\d{1,4})\s+(?:personas|invitados|ninos|adultos|pax)\b/);
  const invitados = mInv ? parseInt(mInv[1]) : null;

  if (items.length) razones.push(`${items.length} producto(s)`);
  if (fecha_evento) razones.push("fecha del evento");
  if (montos.length) razones.push("monto");
  if (lugar) razones.push("lugar de entrega");

  let score = pedido * 18 + cotiz * 14 + Math.min(negocio, 3) * 8 + items.length * 12 + (fecha_evento ? 12 : 0) + (montos.length ? 8 : 0) + (lugar ? 8 : 0);
  if (t.length < 12) score -= 20;
  const confianza = Math.max(0, Math.min(100, Math.round(score)));

  let tipo: Extraccion["tipo"] = null;
  if (pedido === 0 && cotiz === 0 && items.length === 0 && negocio === 0) tipo = null;
  else tipo = pedido > cotiz ? "pedido" : "cotizacion";

  if (invitados) razones.push(`${invitados} invitados`);
  return { tipo, confianza, items, montos, fecha_evento, hora_evento, lugar, invitados, razones: Array.from(new Set(razones)).slice(0, 8) };
}

export const UMBRAL_DETECCION = 35;

// ---- Importación de chats exportados desde WhatsApp ("Exportar chat" → sin archivos) ----
export type LineaChat = { fecha: Date; autor: string; texto: string };

export function parsearChatExportado(contenido: string): LineaChat[] {
  const lineas = contenido.replace(/\r/g, "").replace(/\u200e|\u202f|\u00a0/g, " ").split("\n");
  // Formatos: "6/11/26, 8:05 a. m. - Ana: hola"  |  "[6/11/26, 8:05:12 a. m.] Ana: hola"  | "06/11/2026 20:05 - Ana: hola"
  const re = /^\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:-\s*)?([^:]{1,60}):\s?([\s\S]*)$/i;
  const out: LineaChat[] = [];
  for (const raw of lineas) {
    const l = raw.trim();
    if (!l) continue;
    const m = l.match(re);
    if (m) {
      const d = +m[1], mo = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
      let h = +m[4]; const mi = +m[5];
      const suf = (m[7] || "").toLowerCase().replace(/[.\s]/g, "");
      if (suf === "pm" && h < 12) h += 12; if (suf === "am" && h === 12) h = 0;
      const fecha = new Date(y, mo - 1, d, h, mi);
      const texto = m[9].trim();
      if (/^<(multimedia omitido|media omitted|archivo omitido)>$/i.test(texto) || /cifrados de extremo a extremo/i.test(texto)) continue;
      out.push({ fecha, autor: m[8].trim(), texto });
    } else if (out.length) {
      out[out.length - 1].texto += "\n" + l; // continuación de mensaje multilínea
    }
  }
  return out;
}

export function normalizarTelefono(t: string | null | undefined): string | null {
  if (!t) return null;
  let d = t.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 8) d = "505" + d; // número local de Nicaragua
  return d;
}
