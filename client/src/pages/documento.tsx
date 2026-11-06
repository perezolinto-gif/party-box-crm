import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  useClientes, useProductos, usePerfiles, useInvalidar, crearDocumento, ESTADOS, dinero, fechaHora, waLink, textoDocumento, hoyISO,
  type Documento, type Item, type Seguimiento, type Cliente, type Mensaje,
} from "@/lib/crm";
import { normalizarTelefono } from "@shared/extractor";
import { Encabezado, EstadoPill } from "./inicio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Send, Copy, ArrowLeft, Repeat, MessageSquare, Phone, StickyNote, Loader2, Search, UserPlus } from "lucide-react";

// Borrador compartido entre la Bandeja y el editor (sin almacenamiento del navegador)
export type Borrador = { cliente_id?: string | null; mensaje_origen_id?: string | null; deteccion_id?: string; fecha_evento?: string | null; hora_evento?: string | null; lugar?: string | null; moneda?: "NIO" | "USD"; notas?: string; items?: Item[]; anticipo?: number; convertido_de?: string | null };
let borradorPendiente: Borrador | null = null;
export function prepararBorrador(b: Borrador) { borradorPendiente = b; }

const VACIO_ITEM: Item = { producto_id: null, descripcion: "", cantidad: 1, precio_unitario: 0 };

export default function DocumentoEditor({ id, nuevoTipo }: { id?: string; nuevoTipo?: "cotizacion" | "pedido" }) {
  const esNuevo = !id;
  const [, navegar] = useLocation();
  const { toast } = useToast();
  const { perfil } = useAuth();
  const invalidar = useInvalidar();
  const { data: clientes } = useClientes();
  const { data: productos } = useProductos();
  const { data: perfiles } = usePerfiles();

  const docQ = useQuery({
    queryKey: ["documento", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: d, error }, { data: it }, { data: seg }] = await Promise.all([
        supabase.from("documentos").select("*, clientes(id,nombre,telefono)").eq("id", id!).single(),
        supabase.from("documento_items").select("*").eq("documento_id", id!).order("orden"),
        supabase.from("seguimientos").select("*").eq("documento_id", id!).order("creado_en", { ascending: false }),
      ]);
      if (error) throw error;
      let origen: Mensaje | null = null;
      if (d.mensaje_origen_id) origen = (await supabase.from("mensajes").select("*").eq("id", d.mensaje_origen_id).maybeSingle()).data as Mensaje;
      return { doc: d as Documento, items: (it ?? []) as Item[], seguimientos: (seg ?? []) as Seguimiento[], origen };
    },
  });

  const [tipo, setTipo] = useState<"cotizacion" | "pedido">(nuevoTipo ?? "cotizacion");
  const [f, setF] = useState<Partial<Documento>>({ estado: "nuevo", moneda: "NIO", anticipo: 0 });
  const [items, setItems] = useState<Item[]>([{ ...VACIO_ITEM }]);
  const [detId, setDetId] = useState<string | undefined>();
  const [nuevoCliente, setNuevoCliente] = useState<{ nombre: string; telefono: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (esNuevo) {
      const b = borradorPendiente; borradorPendiente = null;
      const sig = new Date(); sig.setDate(sig.getDate() + 2);
      setTipo(nuevoTipo ?? "cotizacion");
      setF({ estado: "nuevo", moneda: b?.moneda ?? "NIO", anticipo: b?.anticipo ?? 0, cliente_id: b?.cliente_id ?? null, mensaje_origen_id: b?.mensaje_origen_id ?? null, fecha_evento: b?.fecha_evento ?? null, hora_evento: b?.hora_evento ?? null, lugar: b?.lugar ?? null, notas: b?.notas ?? "", convertido_de: b?.convertido_de ?? null, asignado_a: perfil?.id ?? null, proximo_seguimiento: sig.toISOString().slice(0, 10) });
      setItems(b?.items?.length ? b.items : [{ ...VACIO_ITEM }]);
      setDetId(b?.deteccion_id);
    }
  }, [esNuevo, nuevoTipo]);

  useEffect(() => {
    if (docQ.data) {
      setTipo(docQ.data.doc.tipo);
      setF(docQ.data.doc);
      setItems(docQ.data.items.length ? docQ.data.items : [{ ...VACIO_ITEM }]);
    }
  }, [docQ.data]);

  const total = useMemo(() => items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0), 0), [items]);
  const set = (k: keyof Documento, v: any) => setF((p) => ({ ...p, [k]: v }));
  const setItem = (idx: number, patch: Partial<Item>) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  async function guardar() {
    setGuardando(true);
    try {
      let clienteId = f.cliente_id ?? null;
      if (nuevoCliente?.nombre.trim()) {
        const tel = normalizarTelefono(nuevoCliente.telefono);
        const ex = tel ? (await supabase.from("clientes").select("id").eq("telefono", tel).maybeSingle()).data : null;
        if (ex) clienteId = ex.id;
        else {
          const { data: c, error } = await supabase.from("clientes").insert({ nombre: nuevoCliente.nombre.trim(), telefono: tel, origen: "manual" }).select("id").single();
          if (error) throw error;
          clienteId = c.id;
        }
      }
      const limpios = items.filter((i) => i.descripcion.trim()).map((i) => ({ ...i, cantidad: Number(i.cantidad) || 0, precio_unitario: Number(i.precio_unitario) || 0 }));
      const payload: Partial<Documento> = {
        cliente_id: clienteId, estado: f.estado ?? "nuevo", fecha_evento: f.fecha_evento || null, hora_evento: f.hora_evento || null, lugar: f.lugar || null,
        moneda: f.moneda ?? "NIO", anticipo: Number(f.anticipo) || 0, notas: f.notas || null, asignado_a: f.asignado_a || null, proximo_seguimiento: f.proximo_seguimiento || null,
      };
      if (esNuevo) {
        const nuevoId = await crearDocumento({ ...payload, tipo, mensaje_origen_id: f.mensaje_origen_id ?? null, convertido_de: f.convertido_de ?? null }, limpios);
        if (detId) await supabase.from("detecciones").update({ estado: "convertida", documento_id: nuevoId, revisado_por: perfil?.id }).eq("id", detId);
        invalidar("documentos", "detecciones", "clientes");
        toast({ title: tipo === "cotizacion" ? "Cotización creada" : "Pedido creado" });
        navegar(`/documento/${nuevoId}`);
      } else {
        const { error } = await supabase.from("documentos").update(payload).eq("id", id!);
        if (error) throw error;
        await supabase.from("documento_items").delete().eq("documento_id", id!);
        if (limpios.length) {
          const { error: e2 } = await supabase.from("documento_items").insert(limpios.map((i, idx) => ({ documento_id: id, producto_id: i.producto_id ?? null, descripcion: i.descripcion, cantidad: i.cantidad, precio_unitario: i.precio_unitario, orden: idx })));
          if (e2) throw e2;
        }
        invalidar("documentos", "documento", "clientes");
        setNuevoCliente(null);
        toast({ title: "Cambios guardados" });
      }
    } catch (e: any) {
      toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  }

  async function convertirEnPedido() {
    const d = docQ.data!;
    prepararBorrador({ cliente_id: d.doc.cliente_id, mensaje_origen_id: d.doc.mensaje_origen_id, fecha_evento: d.doc.fecha_evento, hora_evento: d.doc.hora_evento, lugar: d.doc.lugar, moneda: d.doc.moneda, notas: d.doc.notas ?? "", items: d.items.map(({ id: _i, documento_id: _d, ...r }) => r), anticipo: d.doc.anticipo, convertido_de: d.doc.id });
    if (d.doc.estado !== "aceptada") await supabase.from("documentos").update({ estado: "aceptada" }).eq("id", d.doc.id);
    invalidar("documentos");
    navegar("/nuevo/pedido");
  }

  if (!esNuevo && docQ.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-60" /><Skeleton className="h-64 w-full" /></div>;
  if (!esNuevo && docQ.error) return <p className="text-sm text-destructive">No se encontró el documento.</p>;

  const doc = docQ.data?.doc;
  const cliente = clientes?.find((c) => c.id === f.cliente_id) ?? doc?.clientes ?? null;
  const textoWa = doc ? textoDocumento({ ...(doc as Documento), ...(f as Documento), total }, items.filter((i) => i.descripcion.trim()), cliente) : "";
  const linkWa = waLink(cliente?.telefono, textoWa);
  const titulo = esNuevo ? (tipo === "cotizacion" ? "Nueva cotización" : "Nuevo pedido") : `${tipo === "cotizacion" ? "Cotización" : "Pedido"} ${doc?.numero}`;

  return (
    <div>
      <Link href={tipo === "cotizacion" ? "/cotizaciones" : "/pedidos"} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-volver">
        <ArrowLeft className="h-4 w-4" /> {tipo === "cotizacion" ? "Cotizaciones" : "Pedidos"}
      </Link>
      <Encabezado
        titulo={titulo}
        sub={doc ? `Creado ${fechaHora(doc.creado_en)}` : detId ? "Prellenado desde un mensaje de WhatsApp. Revisa y ajusta antes de guardar." : undefined}
        acciones={<>
          {doc && tipo === "cotizacion" && <Button variant="outline" onClick={convertirEnPedido} data-testid="button-convertir"><Repeat className="h-4 w-4 mr-1" />Convertir en pedido</Button>}
          <Button onClick={guardar} disabled={guardando} data-testid="button-guardar">{guardando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Guardar</Button>
        </>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 min-w-0">
          <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
            <SelectorCliente clientes={clientes ?? []} valor={f.cliente_id ?? null} onChange={(v) => { set("cliente_id", v); setNuevoCliente(null); }} nuevo={nuevoCliente} setNuevo={setNuevoCliente} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Fecha del evento"><Input type="date" value={f.fecha_evento ?? ""} onChange={(e) => set("fecha_evento", e.target.value)} data-testid="input-fecha-evento" /></Campo>
              <Campo label="Hora"><Input type="time" value={f.hora_evento ?? ""} onChange={(e) => set("hora_evento", e.target.value)} data-testid="input-hora" /></Campo>
              <Campo label="Estado">
                <Select value={f.estado ?? "nuevo"} onValueChange={(v) => set("estado", v)}>
                  <SelectTrigger data-testid="select-estado"><SelectValue /></SelectTrigger>
                  <SelectContent>{ESTADOS[tipo].map((e) => <SelectItem key={e.valor} value={e.valor}>{e.etiqueta}</SelectItem>)}</SelectContent>
                </Select>
              </Campo>
            </div>
            <Campo label="Lugar / dirección de entrega"><Input value={f.lugar ?? ""} onChange={(e) => set("lugar", e.target.value)} placeholder="Ej. Residencial Las Colinas, casa 45" data-testid="input-lugar" /></Campo>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Productos y servicios</h2>
              <Select value={f.moneda ?? "NIO"} onValueChange={(v) => set("moneda", v)}>
                <SelectTrigger className="h-8 w-[120px]" data-testid="select-moneda"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="NIO">Córdobas</SelectItem><SelectItem value="USD">Dólares</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="divide-y">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto] gap-2 p-3 sm:grid-cols-[1fr_80px_120px_110px_auto] sm:items-center" data-testid={`row-item-${idx}`}>
                  <div className="col-span-2 sm:col-span-1 min-w-0">
                    <Input list="lista-productos" value={it.descripcion} placeholder="Producto o servicio"
                      onChange={(e) => {
                        const v = e.target.value; const p = productos?.find((x) => x.nombre === v);
                        setItem(idx, p ? { descripcion: p.nombre, producto_id: p.id, precio_unitario: Number(p.precio) } : { descripcion: v, producto_id: null });
                      }} data-testid={`input-item-desc-${idx}`} />
                  </div>
                  <Input type="number" min={0} step="1" inputMode="decimal" aria-label="Cantidad" value={it.cantidad} onChange={(e) => setItem(idx, { cantidad: e.target.value as any })} data-testid={`input-item-cant-${idx}`} />
                  <Input type="number" min={0} step="0.01" inputMode="decimal" aria-label="Precio unitario" value={it.precio_unitario} onChange={(e) => setItem(idx, { precio_unitario: e.target.value as any })} data-testid={`input-item-precio-${idx}`} />
                  <p className="text-sm tabular-nums text-right self-center">{dinero((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), f.moneda)}</p>
                  <Button variant="ghost" size="icon" aria-label="Quitar" onClick={() => setItems((a) => (a.length > 1 ? a.filter((_, i) => i !== idx) : [{ ...VACIO_ITEM }]))} data-testid={`button-quitar-item-${idx}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <datalist id="lista-productos">{productos?.filter((p) => p.activo).map((p) => <option key={p.id} value={p.nombre}>{dinero(p.precio, p.moneda)}</option>)}</datalist>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setItems((a) => [...a, { ...VACIO_ITEM }])} data-testid="button-agregar-item"><Plus className="h-4 w-4 mr-1" />Agregar línea</Button>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-total">{dinero(total, f.moneda)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4 sm:p-5 grid gap-4 sm:grid-cols-2">
            <Campo label="Anticipo recibido"><Input type="number" min={0} step="0.01" value={f.anticipo ?? 0} onChange={(e) => set("anticipo", e.target.value)} data-testid="input-anticipo" /></Campo>
            <div className="self-end text-sm"><span className="text-muted-foreground">Saldo pendiente: </span><span className="font-semibold tabular-nums" data-testid="text-saldo">{dinero(total - (Number(f.anticipo) || 0), f.moneda)}</span></div>
            <div className="sm:col-span-2"><Campo label="Notas (se incluyen al enviar por WhatsApp)"><Textarea rows={3} value={f.notas ?? ""} onChange={(e) => set("notas", e.target.value)} data-testid="input-notas" /></Campo></div>
          </section>
        </div>

        <aside className="space-y-5 min-w-0">
          <section className="rounded-xl border bg-card p-4 space-y-4">
            <h2 className="text-sm font-semibold">Seguimiento</h2>
            <Campo label="Próximo seguimiento"><Input type="date" value={f.proximo_seguimiento ?? ""} onChange={(e) => set("proximo_seguimiento", e.target.value)} data-testid="input-seguimiento" /></Campo>
            <div className="flex flex-wrap gap-1.5">
              {[["Mañana", 1], ["3 días", 3], ["1 semana", 7]].map(([l, n]) => (
                <button key={l as string} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted" onClick={() => { const d = new Date(); d.setDate(d.getDate() + (n as number)); set("proximo_seguimiento", d.toISOString().slice(0, 10)); }}>{l}</button>
              ))}
            </div>
            <Campo label="Responsable">
              <Select value={f.asignado_a ?? "ninguno"} onValueChange={(v) => set("asignado_a", v === "ninguno" ? null : v)}>
                <SelectTrigger data-testid="select-responsable"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ninguno">Sin asignar</SelectItem>{perfiles?.filter((p) => p.activo).map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </Campo>
            {doc && (
              <div className="grid gap-2 pt-1">
                <Button variant="outline" asChild disabled={!linkWa} data-testid="button-enviar-wa">
                  {linkWa ? <a href={linkWa} target="_blank" rel="noopener noreferrer"><Send className="h-4 w-4 mr-1" />Enviar por WhatsApp</a> : <span><Send className="h-4 w-4 mr-1" />Cliente sin teléfono</span>}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(textoWa); toast({ title: "Texto copiado" }); }} data-testid="button-copiar"><Copy className="h-4 w-4 mr-1" />Copiar texto</Button>
              </div>
            )}
          </section>

          {docQ.data?.origen && (
            <section className="rounded-xl border bg-card p-4">
              <h2 className="text-sm font-semibold mb-2">Mensaje de origen</h2>
              <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{docQ.data.origen.texto}</p>
              <p className="mt-1 text-xs text-muted-foreground">{fechaHora(docQ.data.origen.enviado_en)}</p>
            </section>
          )}

          {doc && <Bitacora docId={doc.id} clienteId={doc.cliente_id} seguimientos={docQ.data!.seguimientos} perfiles={perfiles ?? []} />}
        </aside>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5 min-w-0"><Label className="text-xs text-muted-foreground font-medium">{label}</Label>{children}</div>;
}

function SelectorCliente({ clientes, valor, onChange, nuevo, setNuevo }: { clientes: Cliente[]; valor: string | null; onChange: (v: string | null) => void; nuevo: { nombre: string; telefono: string } | null; setNuevo: (v: { nombre: string; telefono: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const sel = clientes.find((c) => c.id === valor);
  const filtrados = clientes.filter((c) => !q || c.nombre.toLowerCase().includes(q.toLowerCase()) || (c.telefono ?? "").includes(q.replace(/\D/g, "") || "~")).slice(0, 8);

  if (nuevo)
    return (
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Campo label="Nombre del cliente nuevo"><Input autoFocus value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} data-testid="input-cliente-nombre" /></Campo>
        <Campo label="WhatsApp"><Input inputMode="tel" placeholder="8888 8888" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} data-testid="input-cliente-telefono" /></Campo>
        <Button variant="ghost" onClick={() => setNuevo(null)}>Cancelar</Button>
      </div>
    );

  return (
    <div className="relative">
      <Campo label="Cliente">
        {sel && !abierto ? (
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="min-w-0"><p className="text-sm font-medium truncate" data-testid="text-cliente">{sel.nombre}</p><p className="text-xs text-muted-foreground">{sel.telefono ? `+${sel.telefono}` : "Sin teléfono"}</p></div>
            <Button variant="ghost" size="sm" onClick={() => setAbierto(true)} data-testid="button-cambiar-cliente">Cambiar</Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por nombre o teléfono" value={q} onFocus={() => setAbierto(true)} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} data-testid="input-buscar-cliente" />
          </div>
        )}
      </Campo>
      {abierto && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
          {filtrados.map((c) => (
            <button key={c.id} type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onChange(c.id); setAbierto(false); setQ(""); }} data-testid={`option-cliente-${c.id}`}>
              <span className="truncate">{c.nombre}</span><span className="text-xs text-muted-foreground">{c.telefono ? `+${c.telefono}` : ""}</span>
            </button>
          ))}
          <button type="button" className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted" onClick={() => { setNuevo({ nombre: q && !/^\d/.test(q) ? q : "", telefono: /^\d/.test(q) ? q : "" }); setAbierto(false); onChange(null); }} data-testid="button-nuevo-cliente">
            <UserPlus className="h-4 w-4" /> Cliente nuevo{q ? ` «${q}»` : ""}
          </button>
          <button type="button" className="w-full border-t px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => setAbierto(false)}>Cerrar</button>
        </div>
      )}
    </div>
  );
}

const ICONO_SEG: Record<string, any> = { nota: StickyNote, llamada: Phone, whatsapp: MessageSquare, visita: StickyNote, cambio_estado: Repeat };

export function Bitacora({ docId, clienteId, seguimientos, perfiles }: { docId: string | null; clienteId: string | null; seguimientos: Seguimiento[]; perfiles: { id: string; nombre: string }[] }) {
  const [tipo, setTipo] = useState("whatsapp");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const invalidar = useInvalidar();
  const { perfil } = useAuth();
  async function agregar() {
    if (!nota.trim()) return;
    setGuardando(true);
    await supabase.from("seguimientos").insert({ documento_id: docId, cliente_id: clienteId, tipo, nota: nota.trim(), usuario_id: perfil?.id });
    setNota(""); setGuardando(false);
    invalidar("documento", "cliente");
  }
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold mb-3">Bitácora</h2>
      <div className="space-y-2">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="h-8" data-testid="select-tipo-seguimiento"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="whatsapp">Mensaje de WhatsApp</SelectItem><SelectItem value="llamada">Llamada</SelectItem><SelectItem value="visita">Visita</SelectItem><SelectItem value="nota">Nota interna</SelectItem></SelectContent>
        </Select>
        <Textarea rows={2} placeholder="¿Qué se habló? ¿Qué sigue?" value={nota} onChange={(e) => setNota(e.target.value)} data-testid="input-nota-seguimiento" />
        <Button size="sm" className="w-full" onClick={agregar} disabled={guardando || !nota.trim()} data-testid="button-agregar-nota">Registrar</Button>
      </div>
      <ol className="mt-4 space-y-3">
        {seguimientos.map((s) => {
          const I = ICONO_SEG[s.tipo] ?? StickyNote;
          return (
            <li key={s.id} className="flex gap-2.5" data-testid={`item-seguimiento-${s.id}`}>
              <I className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm break-words">{s.nota}</p>
                <p className="text-xs text-muted-foreground">{perfiles.find((p) => p.id === s.usuario_id)?.nombre ?? "Sistema"} · {fechaHora(s.creado_en)}</p>
              </div>
            </li>
          );
        })}
        {!seguimientos.length && <li className="text-xs text-muted-foreground">Sin registros todavía.</li>}
      </ol>
    </section>
  );
}

export { EstadoPill, hoyISO };
