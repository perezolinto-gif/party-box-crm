import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useProductos, dinero, fechaCorta } from "@/lib/crm";
import { analizarChat, type Monto } from "@shared/analisis";
import { Contenido, horaCorta, etiquetaDia, type Msg } from "@/pages/mensajes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, ShoppingBag, CalendarDays, MapPin, Users, Receipt, Truck, MessageCircleQuestion, ListChecks, Tag, Sparkles } from "lucide-react";

const RANGOS: [string, number][] = [["Último día", 1], ["3 días", 3], ["7 días", 7]];
const montoTxt = (ms: Monto[]) => ms.map((m) => dinero(m.valor, m.moneda)).join(" · ");

// Medianoche (hora de Managua, UTC-6) del día del último mensaje, menos (dias - 1) días.
function desde(ultimo: string, dias: number) {
  const local = new Date(Date.parse(ultimo) - 6 * 3600e3);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (dias - 1), 6)).toISOString();
}

export type DatosCotizacion = { items: { descripcion: string; cantidad: number; precio_unitario: number }[]; fecha_evento: string | null; hora_evento: string | null; lugar: string | null; moneda: "NIO" | "USD"; notas: string; mensaje_id: string | null };

export function AnalisisChat({ telefono, nombre, abierto, onCerrar, onCrear }: {
  telefono: string; nombre: string; abierto: boolean; onCerrar: () => void;
  onCrear: (tipo: "cotizacion" | "pedido", d: DatosCotizacion) => void;
}) {
  const [dias, setDias] = useState(1);
  const { data: productos } = useProductos();
  const q = useQuery({
    queryKey: ["mensajes", "analisis", telefono],
    enabled: abierto,
    queryFn: async () => {
      const { data, error } = await supabase.from("mensajes")
        .select("id, cliente_id, telefono, nombre_contacto, direccion, texto, enviado_en, media_path, media_tipo, media_nombre, media_mime, media_bytes, media_borrado_en")
        .eq("telefono", telefono).order("enviado_en", { ascending: false }).limit(400);
      if (error) throw error;
      const msgs = ((data ?? []) as Msg[]).reverse();
      const rutas = msgs.map((m) => m.media_path).filter(Boolean) as string[];
      const urls: Record<string, string> = {};
      if (rutas.length) {
        const { data: f } = await supabase.storage.from("whatsapp-media").createSignedUrls(rutas, 3600);
        for (const x of f ?? []) if (x.path && x.signedUrl) urls[x.path] = x.signedUrl;
      }
      return { msgs, urls };
    },
  });

  const msgs = useMemo(() => {
    const todos = q.data?.msgs ?? [];
    if (!todos.length) return [];
    const corte = desde(todos[todos.length - 1].enviado_en, dias);
    return todos.filter((m) => m.enviado_en >= corte);
  }, [q.data, dias]);
  const a = useMemo(() => analizarChat(msgs.map((m) => ({ id: m.id, direccion: m.direccion, texto: m.texto, enviado_en: m.enviado_en, media_path: m.media_path })), productos ?? []), [msgs, productos]);
  const urls = q.data?.urls ?? {};
  const hilo = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = hilo.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length]);

  const irA = (id: string) => document.getElementById(`am-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  function crear(tipo: "cotizacion" | "pedido") {
    const lineas = a.lista?.lineas.length ? a.lista.lineas : a.productosCliente;
    const notas = [
      a.total ? `Total dado en el chat: ${montoTxt(a.total.montos)}` : "",
      a.envio ? `Envío: ${montoTxt(a.envio.montos)}` : "",
      a.facturar ? `Facturar a: ${a.facturar.nombre ?? ""} RUC ${a.facturar.ruc}`.trim() : "",
      a.invitados ? `${a.invitados} invitados` : "",
    ].filter(Boolean).join("\n");
    onCrear(tipo, {
      items: lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio?.moneda === "NIO" ? l.precio.valor : 0 })),
      fecha_evento: a.fecha_evento, hora_evento: a.hora_evento, lugar: a.lugar, moneda: "NIO", notas,
      mensaje_id: a.lista?.msgId ?? msgs.filter((m) => m.direccion === "entrante").slice(-1)[0]?.id ?? null,
    });
  }

  const grupos: { dia: string; items: Msg[] }[] = [];
  for (const m of msgs) { const d = etiquetaDia(m.enviado_en); const g = grupos[grupos.length - 1]; if (g && g.dia === d) g.items.push(m); else grupos.push({ dia: d, items: [m] }); }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="flex h-[92vh] max-w-6xl flex-col gap-0 overflow-hidden p-0" data-testid="dialog-analisis">
        <DialogHeader className="border-b px-5 py-3.5 text-left">
          <DialogTitle className="flex items-center gap-2 pr-8"><Sparkles className="h-5 w-5 text-primary" />Análisis del chat · {nombre}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <span>+{telefono} · {msgs.length} mensajes</span>
            <span className="flex gap-1">
              {RANGOS.map(([l, n]) => (
                <button key={n} type="button" onClick={() => setDias(n)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${dias === n ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`} data-testid={`rango-${n}`}>{l}</button>
              ))}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_400px]">
          <div className="min-h-0 overflow-y-auto bg-[hsl(36_30%_95%)] px-3 py-3 sm:px-5 order-2 lg:order-1 max-lg:max-h-[45vh]" ref={hilo} data-testid="analisis-hilo">
            {q.isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Cargando conversación…</p>}
            {grupos.map((g) => (
              <div key={g.dia} className="space-y-1.5">
                <div className="flex justify-center py-2"><span className="rounded-lg bg-white/95 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm">{g.dia}</span></div>
                {g.items.map((m) => (
                  <div key={m.id} id={`am-${m.id}`} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[14px] shadow-sm ${m.direccion === "saliente" ? "bg-[hsl(130_45%_88%)] rounded-tr-sm" : "bg-white rounded-tl-sm"}`}>
                      <Contenido m={m} url={m.media_path ? urls[m.media_path] : undefined} />
                      <p className="mt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">{horaCorta(m.enviado_en)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <aside className="min-h-0 overflow-y-auto border-l px-4 py-4 space-y-4 text-sm order-1 lg:order-2 max-lg:border-b max-lg:border-l-0" data-testid="analisis-resumen">
            <div className={`rounded-xl px-3.5 py-2.5 font-semibold text-white ${a.pagoMsg ? "bg-[hsl(var(--solido-verde))]" : "bg-[hsl(var(--solido-azul))]"}`} data-testid="text-analisis-estado">{a.estado}{a.pagoMsg && <button type="button" onClick={() => irA(a.pagoMsg!)} className="mt-1 block text-xs font-medium underline">Ver comprobante en el chat</button>}</div>

            {a.pendientes.length > 0 && (
              <Bloque icono={MessageCircleQuestion} titulo="Sin responder">
                {a.pendientes.map((p) => <button key={p.msgId} type="button" onClick={() => irA(p.msgId)} className="block w-full rounded-lg bg-[hsl(var(--solido-rojo)/.08)] px-2.5 py-1.5 text-left hover:bg-[hsl(var(--solido-rojo)/.14)]">{p.texto} <span className="text-xs text-muted-foreground">{horaCorta(p.en)}</span></button>)}
              </Bloque>
            )}

            <Bloque icono={ListChecks} titulo={a.lista ? `Lista armada por ${a.lista.de === "equipo" ? "el equipo" : "el cliente"}` : "Productos que pide"}>
              {(a.lista?.lineas.length ? a.lista.lineas : a.productosCliente).length ? (
                <ul className="divide-y rounded-lg border" data-testid="list-analisis-productos">
                  {(a.lista?.lineas.length ? a.lista.lineas : a.productosCliente).map((l, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-2.5 py-1.5"><span><b className="tabular-nums">{l.cantidad}</b> × {l.descripcion}</span>{l.precio && <span className="tabular-nums text-muted-foreground">{dinero(l.precio.valor, l.precio.moneda)}</span>}</li>
                  ))}
                </ul>
              ) : <p className="text-muted-foreground">No se encontró una lista con cantidades. Revisa el chat de la izquierda.</p>}
              {a.lista && <button type="button" onClick={() => irA(a.lista!.msgId)} className="text-xs text-primary hover:underline">Ver en el chat</button>}
            </Bloque>

            {(a.total || a.envio) && (
              <Bloque icono={Receipt} titulo="Total y envío">
                {a.total && <button type="button" onClick={() => irA(a.total!.msgId)} className="block text-left"><span className="font-display text-lg font-extrabold tabular-nums">{montoTxt(a.total.montos)}</span><span className="block text-xs text-muted-foreground">“{a.total.texto}”</span></button>}
                {a.envio && <p className="flex items-center gap-1.5"><Truck className="h-4 w-4 text-muted-foreground" />Envío {montoTxt(a.envio.montos)}</p>}
              </Bloque>
            )}

            {a.precios.length > 0 && (
              <Bloque icono={Tag} titulo={`Precios que se le dieron (${a.precios.length})`}>
                <div className="grid grid-cols-2 gap-2">
                  {a.precios.map((p) => (
                    <button key={p.msgId} type="button" onClick={() => irA(p.msgId)} className="overflow-hidden rounded-lg border bg-card text-left hover:border-primary" data-testid={`precio-${p.msgId}`}>
                      {p.foto && urls[p.foto] && <img src={urls[p.foto]} alt="" className="h-24 w-full object-cover" />}
                      <p className="px-2 py-1.5 text-xs leading-snug"><b className="tabular-nums">{montoTxt(p.montos)}</b>{p.texto.replace(/(c\$|u\$|us\$|\$)\s?[\d.,]+/gi, "").trim() && <span className="block text-muted-foreground line-clamp-2">{p.texto.replace(/(c\$|u\$|us\$|\$)\s?[\d.,]+/gi, "").trim()}</span>}</p>
                    </button>
                  ))}
                </div>
              </Bloque>
            )}

            {(a.fecha_evento || a.lugar || a.invitados || a.facturar) && (
              <Bloque icono={CalendarDays} titulo="Datos del cliente">
                {a.fecha_evento && <button type="button" onClick={() => a.fechaMsg && irA(a.fechaMsg)} className="flex items-center gap-1.5 text-left hover:underline" title="Ver en el chat"><CalendarDays className="h-4 w-4 text-muted-foreground" />Fecha mencionada: {fechaCorta(a.fecha_evento)}{a.hora_evento ? ` · ${a.hora_evento}` : ""}</button>}
                {a.lugar && <p className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-muted-foreground" />{a.lugar}</p>}
                {a.invitados && <p className="flex items-center gap-1.5"><Users className="h-4 w-4 text-muted-foreground" />{a.invitados} invitados</p>}
                {a.facturar && <p className="flex items-center gap-1.5" data-testid="text-facturar"><Receipt className="h-4 w-4 text-muted-foreground" />Facturar a {a.facturar.nombre ?? ""} · RUC {a.facturar.ruc}</p>}
              </Bloque>
            )}

            <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t bg-background px-4 pt-3 pb-1">
              <Button onClick={() => crear("cotizacion")} data-testid="button-analisis-cotizacion"><FileText className="h-4 w-4 mr-1" />Cotización</Button>
              <Button variant="outline" onClick={() => crear("pedido")} data-testid="button-analisis-pedido"><ShoppingBag className="h-4 w-4 mr-1" />Pedido</Button>
              <p className="col-span-2 text-[11px] text-muted-foreground">Se llena con la lista, fecha, total y datos de factura. Revisa los precios antes de guardar.</p>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Bloque({ icono: I, titulo, children }: { icono: any; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground"><I className="h-3.5 w-3.5" />{titulo}</h3>
      {children}
    </section>
  );
}
