import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type Perfil = { id: string; nombre: string; email: string; rol: "admin" | "ventas"; activo: boolean };
export type Cliente = { id: string; nombre: string; telefono: string | null; email: string | null; direccion: string | null; notas: string | null; origen: string; creado_en: string };
export type Producto = { id: string; nombre: string; categoria: string | null; precio: number; moneda: "NIO" | "USD"; palabras_clave: string | null; activo: boolean };
export type Mensaje = { id: string; cliente_id: string | null; telefono: string | null; nombre_contacto: string | null; direccion: "entrante" | "saliente"; texto: string; origen: string; enviado_en: string };
export type Item = { id?: string; documento_id?: string; producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number; orden?: number };
export type Documento = {
  id: string; tipo: "cotizacion" | "pedido"; numero: string; cliente_id: string | null; estado: string;
  fecha_evento: string | null; hora_evento: string | null; lugar: string | null; moneda: "NIO" | "USD";
  total: number; anticipo: number; notas: string | null; asignado_a: string | null; proximo_seguimiento: string | null;
  mensaje_origen_id: string | null; convertido_de: string | null; creado_en: string; actualizado_en: string;
  clientes?: Pick<Cliente, "id" | "nombre" | "telefono"> | null;
};
export type Seguimiento = { id: string; documento_id: string | null; cliente_id: string | null; tipo: string; nota: string; usuario_id: string | null; creado_en: string };
export type Deteccion = {
  id: string; mensaje_id: string; cliente_id: string | null; tipo_sugerido: "cotizacion" | "pedido"; confianza: number;
  datos: any; estado: string; documento_id: string | null; creado_en: string;
  mensajes?: Mensaje | null; clientes?: Pick<Cliente, "id" | "nombre" | "telefono"> | null;
};

export const ESTADOS: Record<"cotizacion" | "pedido", { valor: string; etiqueta: string }[]> = {
  cotizacion: [
    { valor: "nuevo", etiqueta: "Nueva" },
    { valor: "enviada", etiqueta: "Enviada" },
    { valor: "negociando", etiqueta: "Negociando" },
    { valor: "aceptada", etiqueta: "Aceptada" },
    { valor: "perdida", etiqueta: "Perdida" },
  ],
  pedido: [
    { valor: "nuevo", etiqueta: "Por confirmar" },
    { valor: "confirmado", etiqueta: "Confirmado" },
    { valor: "en_preparacion", etiqueta: "En preparación" },
    { valor: "listo", etiqueta: "Listo" },
    { valor: "entregado", etiqueta: "Entregado" },
    { valor: "cancelado", etiqueta: "Cancelado" },
  ],
};
export const ESTADOS_CERRADOS = ["aceptada", "perdida", "entregado", "cancelado"];

export function etiquetaEstado(tipo: "cotizacion" | "pedido", estado: string) {
  return ESTADOS[tipo].find((e) => e.valor === estado)?.etiqueta ?? estado;
}

export function tonoEstado(estado: string): string {
  switch (estado) {
    case "aceptada": case "entregado": return "bg-[hsl(86_45%_92%)] text-[hsl(86_55%_24%)] border-[hsl(86_40%_80%)]";
    case "perdida": case "cancelado": return "bg-stone-100 text-stone-600 border-stone-300";
    case "enviada": case "confirmado": return "bg-[hsl(211_45%_93%)] text-[hsl(211_50%_32%)] border-[hsl(211_40%_82%)]";
    case "negociando": case "en_preparacion": return "bg-[hsl(37_80%_92%)] text-[hsl(32_70%_28%)] border-[hsl(37_60%_78%)]";
    case "listo": return "bg-[hsl(324_40%_94%)] text-[hsl(324_45%_34%)] border-[hsl(324_35%_84%)]";
    default: return "bg-[hsl(357_85%_95%)] text-[hsl(357_75%_36%)] border-[hsl(357_70%_86%)]";
  }
}

export function dinero(v: number | null | undefined, moneda: "NIO" | "USD" = "NIO") {
  const n = Number(v ?? 0);
  const s = n.toLocaleString("es-NI", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return moneda === "USD" ? `US$ ${s}` : `C$ ${s}`;
}

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fechaCorta(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  return d.toLocaleDateString("es-NI", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}
export function fechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-NI", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function waLink(telefono: string | null | undefined, texto?: string) {
  if (!telefono) return null;
  return `https://wa.me/${telefono.replace(/\D/g, "")}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

export function textoDocumento(d: Documento, items: Item[], cliente?: { nombre: string } | null) {
  const titulo = d.tipo === "cotizacion" ? "Cotización" : "Pedido";
  const lineas = [
    `*Party Box — ${titulo} ${d.numero}*`,
    cliente ? `Cliente: ${cliente.nombre}` : "",
    d.fecha_evento ? `Fecha del evento: ${fechaCorta(d.fecha_evento)}${d.hora_evento ? ` · ${d.hora_evento}` : ""}` : "",
    d.lugar ? `Lugar: ${d.lugar}` : "",
    "",
    ...items.map((i) => `• ${i.cantidad} × ${i.descripcion} — ${dinero(i.cantidad * i.precio_unitario, d.moneda)}`),
    "",
    `*Total: ${dinero(d.total, d.moneda)}*`,
    d.anticipo > 0 ? `Anticipo recibido: ${dinero(d.anticipo, d.moneda)} · Saldo: ${dinero(d.total - d.anticipo, d.moneda)}` : "",
    d.notas ? `\n${d.notas}` : "",
  ];
  return lineas.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

// ---------- Consultas ----------
export function useProductos() {
  return useQuery({
    queryKey: ["productos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("productos").select("*").order("categoria").order("nombre");
      if (error) throw error;
      return data as Producto[];
    },
  });
}

export function usePerfiles() {
  return useQuery({
    queryKey: ["perfiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("perfiles").select("*").order("nombre");
      if (error) throw error;
      return data as Perfil[];
    },
  });
}

export function useDocumentos() {
  return useQuery({
    queryKey: ["documentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documentos").select("*, clientes(id,nombre,telefono)").order("creado_en", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as Documento[];
    },
  });
}

export function useClientes() {
  return useQuery({
    queryKey: ["clientes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("*").order("creado_en", { ascending: false }).limit(2000);
      if (error) throw error;
      return data as Cliente[];
    },
  });
}

export function useDetecciones(estado = "pendiente") {
  return useQuery({
    queryKey: ["detecciones", estado],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("detecciones")
        .select("*, mensajes(*), clientes(id,nombre,telefono)")
        .eq("estado", estado)
        .order("creado_en", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Deteccion[];
    },
    refetchInterval: 30000,
  });
}

export function useInvalidar() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// Crea un documento con sus partidas y devuelve el id
export async function crearDocumento(doc: Partial<Documento>, items: Item[]) {
  const { data, error } = await supabase.from("documentos").insert(doc).select("id").single();
  if (error) throw error;
  if (items.length) {
    const { error: e2 } = await supabase.from("documento_items").insert(
      items.map((i, idx) => ({ documento_id: data.id, producto_id: i.producto_id ?? null, descripcion: i.descripcion, cantidad: i.cantidad, precio_unitario: i.precio_unitario, orden: idx })),
    );
    if (e2) throw e2;
  }
  return data.id as string;
}
