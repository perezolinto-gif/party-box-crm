import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useClientes, useDocumentos, usePerfiles, useInvalidar, fechaCorta, fechaHora, waLink, dinero, type Cliente, type Mensaje, type Seguimiento } from "@/lib/crm";
import { normalizarTelefono } from "@shared/extractor";
import { Encabezado, FilaDoc } from "./inicio";
import { Bitacora, prepararBorrador } from "./documento";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, ArrowLeft, MessageCircle, Save } from "lucide-react";

export default function Clientes() {
  const { data, isLoading } = useClientes();
  const { data: docs } = useDocumentos();
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const lista = (data ?? []).filter((c) => !q || c.nombre.toLowerCase().includes(q.toLowerCase()) || (c.telefono ?? "").includes(q.replace(/\D/g, "") || "~"));

  return (
    <div>
      <Encabezado titulo="Clientes" sub="Se crean solos cuando alguien escribe por WhatsApp; también puedes agregarlos a mano."
        acciones={<Button onClick={() => setNuevo(true)} data-testid="button-nuevo-cliente"><Plus className="h-4 w-4 mr-1" />Cliente</Button>} />
      <div className="relative mb-4 sm:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-buscar-clientes" />
      </div>
      <div className="overflow-hidden tarjeta divide-y">
        {isLoading && <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
        {!isLoading && !lista.length && <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aún no hay clientes.</p>}
        {lista.map((c) => {
          const suyos = (docs ?? []).filter((d) => d.cliente_id === c.id);
          const vendido = suyos.filter((d) => d.tipo === "pedido" && d.estado !== "cancelado" && d.moneda === "NIO").reduce((s, d) => s + Number(d.total), 0);
          return (
            <Link key={c.id} href={`/clientes/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50" data-testid={`row-cliente-${c.id}`}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--marca-ciruela)/.12)] text-sm font-bold text-[hsl(var(--marca-ciruela))]">{c.nombre.charAt(0).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{c.nombre}</p>
                <p className="text-xs text-muted-foreground">{c.telefono ? `+${c.telefono}` : "Sin teléfono"}{c.origen === "whatsapp" ? " · WhatsApp" : ""}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <p>{suyos.length} {suyos.length === 1 ? "documento" : "documentos"}</p>
                {vendido > 0 && <p className="font-medium text-foreground tabular-nums">{dinero(vendido)}</p>}
              </div>
            </Link>
          );
        })}
      </div>
      <ClienteDialogo abierto={nuevo} onClose={() => setNuevo(false)} />
    </div>
  );
}

function ClienteDialogo({ abierto, onClose, cliente }: { abierto: boolean; onClose: () => void; cliente?: Cliente }) {
  const [f, setF] = useState({ nombre: "", telefono: "", email: "", direccion: "", notas: "" });
  const invalidar = useInvalidar();
  const { toast } = useToast();
  useEffect(() => {
    if (abierto) setF({ nombre: cliente?.nombre ?? "", telefono: cliente?.telefono ?? "", email: cliente?.email ?? "", direccion: cliente?.direccion ?? "", notas: cliente?.notas ?? "" });
  }, [abierto]);
  async function guardar() {
    const payload = { nombre: f.nombre.trim(), telefono: normalizarTelefono(f.telefono), email: f.email || null, direccion: f.direccion || null, notas: f.notas || null };
    const { error } = cliente ? await supabase.from("clientes").update(payload).eq("id", cliente.id) : await supabase.from("clientes").insert(payload);
    if (error) return toast({ title: "No se pudo guardar", description: error.message.includes("duplicate") ? "Ya existe un cliente con ese teléfono." : error.message, variant: "destructive" });
    invalidar("clientes", "cliente"); onClose();
  }
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{cliente ? "Editar cliente" : "Nuevo cliente"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label>Nombre</Label><Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} data-testid="input-dlg-nombre" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>WhatsApp</Label><Input inputMode="tel" placeholder="8888 8888" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} data-testid="input-dlg-telefono" /></div>
            <div className="space-y-1.5"><Label>Correo</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Dirección</Label><Input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Notas</Label><Textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={!f.nombre.trim()} data-testid="button-dlg-guardar"><Save className="h-4 w-4 mr-1" />Guardar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClienteDetalle({ id }: { id: string }) {
  const { data: docs } = useDocumentos();
  const { data: perfiles } = usePerfiles();
  const [editar, setEditar] = useState(false);
  const q = useQuery({
    queryKey: ["cliente", id],
    queryFn: async () => {
      const [{ data: c, error }, { data: m }, { data: s }] = await Promise.all([
        supabase.from("clientes").select("*").eq("id", id).single(),
        supabase.from("mensajes").select("*").eq("cliente_id", id).order("enviado_en", { ascending: false }).limit(200),
        supabase.from("seguimientos").select("*").eq("cliente_id", id).is("documento_id", null).order("creado_en", { ascending: false }),
      ]);
      if (error) throw error;
      return { cliente: c as Cliente, mensajes: ((m ?? []) as Mensaje[]).reverse(), seguimientos: (s ?? []) as Seguimiento[] };
    },
    refetchInterval: 30000,
  });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!q.data) return <p className="text-sm text-destructive">Cliente no encontrado.</p>;
  const { cliente, mensajes, seguimientos } = q.data;
  const suyos = (docs ?? []).filter((d) => d.cliente_id === id);
  const wa = waLink(cliente.telefono);

  return (
    <div>
      <Link href="/clientes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Clientes</Link>
      <Encabezado titulo={cliente.nombre} sub={[cliente.telefono ? `+${cliente.telefono}` : null, cliente.email, cliente.direccion].filter(Boolean).join(" · ") || "Sin datos de contacto"}
        acciones={<>
          <Button variant="outline" onClick={() => setEditar(true)} data-testid="button-editar-cliente">Editar</Button>
          {wa && <Button variant="outline" asChild><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-1" />WhatsApp</a></Button>}
        </>} />
      {cliente.notas && <p className="mb-5 rounded-lg border bg-accent/50 px-4 py-2.5 text-sm">{cliente.notas}</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5 min-w-0">
          <section className="tarjeta">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-bold">Cotizaciones y pedidos</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" asChild><Link href="/nuevo/cotizacion" onClick={() => prepararBorrador({ cliente_id: id })}>+ Cotización</Link></Button>
                <Button size="sm" variant="ghost" asChild><Link href="/nuevo/pedido" onClick={() => prepararBorrador({ cliente_id: id })}>+ Pedido</Link></Button>
              </div>
            </div>
            {suyos.length ? <div className="divide-y">{suyos.map((d) => <FilaDoc key={d.id} d={d} detalle={d.fecha_evento ? `evento ${fechaCorta(d.fecha_evento)}` : `creado ${fechaCorta(d.creado_en)}`} />)}</div>
              : <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sin documentos todavía.</p>}
          </section>
          <section className="tarjeta">
            <h2 className="border-b px-4 py-3 text-base font-bold">Conversación de WhatsApp</h2>
            <div className="max-h-[480px] space-y-2 overflow-y-auto bg-[hsl(36_30%_95%)] p-4" data-testid="list-mensajes">
              {!mensajes.length && <p className="py-6 text-center text-sm text-muted-foreground">Sin mensajes registrados.</p>}
              {mensajes.map((m) => (
                <div key={m.id} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm ${m.direccion === "saliente" ? "bg-[hsl(130_45%_88%)]" : "bg-white"}`}>
                    <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                    <p className="mt-0.5 text-right text-[11px] text-muted-foreground">{fechaHora(m.enviado_en)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="min-w-0"><Bitacora docId={null} clienteId={id} seguimientos={seguimientos} perfiles={perfiles ?? []} /></aside>
      </div>
      <ClienteDialogo abierto={editar} onClose={() => setEditar(false)} cliente={cliente} />
    </div>
  );
}
