// Análisis de una conversación completa de WhatsApp (cliente + equipo) para cotizar sin abrir el teléfono.
// Reglas simples y transparentes: cada dato muestra de qué mensaje salió.
import { extraer, normalizar, type ProductoRef } from "./extractor";

export type MsgAnalisis = { id: string; direccion: "entrante" | "saliente"; texto: string; enviado_en: string; media_path?: string | null };
export type Monto = { valor: number; moneda: "NIO" | "USD" };
export type LineaLista = { cantidad: number; descripcion: string; precio?: Monto | null };
export type PrecioDado = { msgId: string; texto: string; montos: Monto[]; foto: string | null; en: string };

export type Analisis = {
  lista: { de: "cliente" | "equipo"; msgId: string; en: string; lineas: LineaLista[] } | null;
  productosCliente: LineaLista[];
  precios: PrecioDado[];
  total: { msgId: string; texto: string; montos: Monto[]; en: string } | null;
  envio: { texto: string; montos: Monto[] } | null;
  facturar: { nombre: string | null; ruc: string } | null;
  fechaMsg: string | null;
  pagoMsg: string | null;
  fecha_evento: string | null;
  hora_evento: string | null;
  lugar: string | null;
  invitados: number | null;
  pendientes: { msgId: string; texto: string; en: string }[];
  estado: string;
};

const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, docena: 12 };

function cuerpo(t: string) { return t.replace(/^\[(image|video|document|audio|sticker)\]\s*/i, "").trim(); }

export function montosDe(texto: string): Monto[] {
  const t = texto.toLowerCase().replace(/\$c/g, "c$");
  const res: Monto[] = [];
  const re = /(c\$|cs\$?|u\$s?|us\$|usd|\$)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(cordobas|córdobas|dolares|dólares|usd)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const sim = (m[1] || m[4] || "").toLowerCase();
    const v = Number((m[2] || m[3]).replace(/,/g, ""));
    if (!(v > 0)) continue;
    res.push({ valor: v, moneda: /^c|cord|córd/.test(sim) ? "NIO" : "USD" });
  }
  return res;
}

// Líneas tipo "- 2 servilletas", "• 3 rollos de banderines", "2 x vasos C$50", "10 tenedores"
function lineasLista(texto: string): LineaLista[] {
  const out: LineaLista[] = [];
  for (const crudo of cuerpo(texto).split(/\n+/)) {
    const l = crudo.replace(/[\u2060\u200b\u00a0]/g, " ").trim();
    const m = l.match(/^(?:[-•*·–]\s*)?(\d{1,4}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien)\s*(?:x\s+|×\s*|unidades\s+de\s+)?(.{3,80})$/i);
    if (!m) continue;
    const cantidad = NUM[m[1].toLowerCase()] ?? parseInt(m[1]);
    let desc = m[2].replace(/\s*[-–:]\s*$/, "").trim();
    const precio = montosDe(desc)[0] ?? null;
    desc = desc.replace(/(c\$|u\$|us\$|\$)\s?[\d.,]+/gi, "").replace(/\s+(a|en|por)\s*$/i, "").trim();
    if (!desc || /^(personas|invitados|años|anos|dias|días|horas?|am|pm)\b/i.test(desc)) continue;
    out.push({ cantidad, descripcion: desc.charAt(0).toUpperCase() + desc.slice(1), precio });
  }
  return out;
}

function esLista(texto: string) {
  const l = lineasLista(texto);
  return l.length >= 2 || (l.length === 1 && /^[-•*·–]/.test(cuerpo(texto).split("\n").find((x) => /\d/.test(x))?.trim() ?? ""));
}

export function analizarChat(msgs: MsgAnalisis[], productos: ProductoRef[] = []): Analisis {
  const orden = [...msgs].sort((a, b) => a.enviado_en.localeCompare(b.enviado_en));
  let lista: Analisis["lista"] = null;
  const precios: PrecioDado[] = [];
  let total: Analisis["total"] = null;
  let envio: Analisis["envio"] = null;
  let facturar: Analisis["facturar"] = null;
  let fechaMsg: string | null = null;
  let fecha_evento: string | null = null, hora_evento: string | null = null, lugar: string | null = null, invitados: number | null = null;
  const productosCliente = new Map<string, LineaLista>();

  for (const m of orden) {
    const txt = cuerpo(m.texto ?? "");
    if (!txt && !m.media_path) continue;
    const n = normalizar(txt);

    if (esLista(m.texto)) lista = { de: m.direccion === "entrante" ? "cliente" : "equipo", msgId: m.id, en: m.enviado_en, lineas: lineasLista(m.texto) };

    const ms = montosDe(txt);
    if (m.direccion === "saliente" && ms.length) {
      if (/\btotal\b/.test(n) || /\ben los productos\b/.test(n) || /\ble quedaria\b/.test(n)) total = { msgId: m.id, texto: txt, montos: ms, en: m.enviado_en };
      else if (/\benvio\b|\bdelivery\b/.test(n)) envio = { texto: txt, montos: ms };
      else precios.push({ msgId: m.id, texto: txt, montos: ms, foto: m.media_path ?? null, en: m.enviado_en });
    }
    if (m.direccion === "entrante" && ms.length && /\btotal\b|\bdeposit|\btransfer/.test(n) && !total) total = { msgId: m.id, texto: txt, montos: ms, en: m.enviado_en };

    // Datos de facturación: RUC jurídico (J + 13 dígitos) o cédula nicaragüense
    const ruc = txt.match(/\b(J\s?\d{13}|\d{3}-?\d{6}-?\d{4}[A-Z])\b/i);
    if (m.direccion === "entrante" && ruc) {
      const nombre = txt.replace(ruc[0], "").replace(/a nombre de|ruc|n[uú]mero|:/gi, " ").split("\n").map((s) => s.trim()).find((s) => s.length > 2) ?? null;
      facturar = { nombre, ruc: ruc[1].replace(/\s/g, "").toUpperCase() };
    }

    if (m.direccion === "entrante") {
      const x = extraer(txt, productos, new Date(m.enviado_en));
      if (x.fecha_evento) { fecha_evento = x.fecha_evento; fechaMsg = m.id; }
      if (x.hora_evento) hora_evento = x.hora_evento;
      if (x.lugar) lugar = x.lugar;
      if (x.invitados) invitados = x.invitados;
      for (const i of x.items) if (!/^(con |de |y |que |cual|cuant|como|donde|cuando|por )/i.test(normalizar(i.descripcion)) && !/cuant|cual/.test(normalizar(i.descripcion))) productosCliente.set(normalizar(i.descripcion), { cantidad: i.cantidad, descripcion: i.descripcion, precio: i.precio_unitario ? { valor: i.precio_unitario, moneda: "NIO" } : null });
    }
  }

  // Preguntas o pedidos del cliente que llegaron después de la última respuesta del equipo
  const ultSal = [...orden].reverse().find((m) => m.direccion === "saliente")?.enviado_en ?? "";
  const pendientes = orden.filter((m) => m.direccion === "entrante" && m.enviado_en > ultSal && cuerpo(m.texto ?? "").length > 1)
    .map((m) => ({ msgId: m.id, texto: cuerpo(m.texto) || "[archivo]", en: m.enviado_en }));

  const ultimo = orden[orden.length - 1];
  // Comprobante de pago: archivo o frase de transferencia del cliente después del total
  const pago = orden.find((m) => m.direccion === "entrante" && (!total || m.enviado_en >= total.en) &&
    (/comprobante|transferencia|transferi|deposite|deposito|ya pague|ya le pague|ya transferi/.test(normalizar(m.texto ?? "")) ||
     (/^\[document\]/i.test(m.texto ?? "") && /comprobante|transfer|pago|bac|lafise|banpro|bdf/.test(normalizar(m.texto ?? "")))));
  let estado = "Conversación sin datos de venta claros";
  if (pago && total) estado = "El cliente mandó comprobante de pago: registrar como pedido";
  else if (pendientes.length) estado = "El cliente espera respuesta";
  else if (total && ultimo && total.en >= (lista?.en ?? "")) estado = "Ya se le dio el total; falta confirmar pago o pedido";
  else if (lista?.de === "equipo") estado = "El equipo armó la lista; falta dar el total";
  else if (lista?.de === "cliente") estado = "El cliente mandó su lista; falta cotizar";
  else if (precios.length) estado = "Se le mandaron precios; el cliente está eligiendo";

  return { pagoMsg: pago?.id ?? null, fechaMsg, lista, productosCliente: Array.from(productosCliente.values()), precios, total, envio, facturar, fecha_evento, hora_evento, lugar, invitados, pendientes, estado };
}
