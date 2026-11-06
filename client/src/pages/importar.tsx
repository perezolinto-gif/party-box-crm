import { useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { useClientes, useProductos, useInvalidar, dinero, fechaCorta } from "@/lib/crm";
import { extraer, parsearChatExportado, normalizarTelefono, UMBRAL_DETECCION, type LineaChat, type Extraccion } from "@shared/extractor";
import { Encabezado } from "./inicio";
import { prepararBorrador } from "./documento";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Wand2, FileUp, Loader2, FileText, ShoppingBag, CheckCircle2 } from "lucide-react";

async function asegurarCliente(nombre: string, telefono: string | null): Promise<string> {
  const tel = normalizarTelefono(telefono);
  if (tel) {
    const { data } = await supabase.from("clientes").select("id").eq("telefono", tel).maybeSingle();
    if (data) return data.id;
  } else {
    const { data } = await supabase.from("clientes").select("id").ilike("nombre", nombre).is("telefono", null).maybeSingle();
    if (data) return data.id;
  }
  const { data, error } = await supabase.from("clientes").insert({ nombre: nombre || tel || "Cliente", telefono: tel, origen: "whatsapp" }).select("id").single();
  if (error) throw error;
  return data.id;
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export default function Importar() {
  return (
    <div>
      <Encabezado titulo="Importar chats" sub="Mientras se activa la conexión directa, trae conversaciones de WhatsApp Business aquí. El sistema detecta pedidos y cotizaciones." />
      <Tabs defaultValue="pegar">
        <TabsList className="mb-4">
          <TabsTrigger value="pegar" data-testid="tab-pegar">Pegar un mensaje</TabsTrigger>
          <TabsTrigger value="archivo" data-testid="tab-archivo">Subir chat exportado</TabsTrigger>
        </TabsList>
        <TabsContent value="pegar"><PegarMensaje /></TabsContent>
        <TabsContent value="archivo"><SubirChat /></TabsContent>
      </Tabs>
    </div>
  );
}

function Resultado({ ex }: { ex: Extraccion }) {
  if (!ex.tipo) return <p className="text-sm text-muted-foreground">No se detectó un pedido ni una cotización en este texto. Igual puedes crear el documento a mano.</p>;
  return (
    <div className="space-y-2 text-sm">
      <p><span className="font-medium">{ex.tipo === "pedido" ? "Parece un pedido" : "Parece una solicitud de cotización"}</span> <span className="text-muted-foreground">· confianza {ex.confianza}%</span></p>
      <ul className="grid gap-1 text-muted-foreground">
        {ex.items.length > 0 && <li><span className="text-foreground">Productos:</span> {ex.items.map((i) => `${i.cantidad} × ${i.descripcion}`).join(", ")}</li>}
        {ex.fecha_evento && <li><span className="text-foreground">Fecha:</span> {fechaCorta(ex.fecha_evento)}{ex.hora_evento ? ` · ${ex.hora_evento}` : ""}</li>}
        {ex.lugar && <li><span className="text-foreground">Lugar:</span> {ex.lugar}</li>}
        {ex.montos.length > 0 && <li><span className="text-foreground">Montos:</span> {ex.montos.map((m) => dinero(m.valor, m.moneda)).join(", ")}</li>}
        {ex.invitados && <li><span className="text-foreground">Invitados:</span> {ex.invitados}</li>}
      </ul>
    </div>
  );
}

function PegarMensaje() {
  const { data: clientes } = useClientes();
  const { data: productos } = useProductos();
  const [, navegar] = useLocation();
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [clienteId, setClienteId] = useState<string>("nuevo");
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const ex = useMemo(() => (texto.trim().length > 5 ? extraer(texto, (productos ?? []) as any) : null), [texto, productos]);

  async function crear(tipo: "cotizacion" | "pedido") {
    try {
      const cid = clienteId === "nuevo" ? await asegurarCliente(nombre.trim(), tel) : clienteId;
      const telefono = clienteId === "nuevo" ? normalizarTelefono(tel) : clientes?.find((c) => c.id === cid)?.telefono ?? null;
      const { data: m, error } = await supabase.from("mensajes").insert({ cliente_id: cid, telefono, direccion: "entrante", texto, origen: "manual" }).select("id").single();
      if (error) throw error;
      const monto = ex?.montos[0];
      prepararBorrador({
        cliente_id: cid, mensaje_origen_id: m.id, fecha_evento: ex?.fecha_evento, hora_evento: ex?.hora_evento, lugar: ex?.lugar, moneda: monto?.moneda ?? "NIO",
        notas: ex?.invitados ? `${ex.invitados} invitados` : "",
        items: (ex?.items ?? []).map((i) => ({ producto_id: i.producto_id ?? null, descripcion: i.descripcion, cantidad: i.cantidad, precio_unitario: i.precio_unitario ?? 0 })),
      });
      navegar(`/nuevo/${tipo}`);
    } catch (e: any) {
      toast({ title: "No se pudo continuar", description: e.message, variant: "destructive" });
    }
  }
  const clienteListo = clienteId !== "nuevo" || nombre.trim().length > 1;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
        <div className="space-y-1.5">
          <Label>Mensaje del cliente</Label>
          <Textarea rows={7} placeholder="Pega aquí lo que el cliente escribió en WhatsApp…" value={texto} onChange={(e) => setTexto(e.target.value)} data-testid="input-texto-pegado" />
        </div>
        <div className="space-y-1.5">
          <Label>Cliente</Label>
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger data-testid="select-cliente-pegar"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nuevo">Cliente nuevo…</SelectItem>
              {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}{c.telefono ? ` (+${c.telefono})` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {clienteId === "nuevo" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Nombre</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} data-testid="input-pegar-nombre" /></div>
            <div className="space-y-1.5"><Label>WhatsApp</Label><Input inputMode="tel" placeholder="8888 8888" value={tel} onChange={(e) => setTel(e.target.value)} data-testid="input-pegar-telefono" /></div>
          </div>
        )}
      </section>
      <aside className="rounded-xl border bg-card p-4 space-y-4 h-fit">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="h-4 w-4 text-primary" />Lo que se detectó</h2>
        {ex ? <Resultado ex={ex} /> : <p className="text-sm text-muted-foreground">Pega un mensaje para analizarlo.</p>}
        <div className="grid gap-2">
          <Button disabled={!texto.trim() || !clienteListo} variant={ex?.tipo === "pedido" ? "outline" : "default"} onClick={() => crear("cotizacion")} data-testid="button-pegar-cotizacion"><FileText className="h-4 w-4 mr-1" />Crear cotización</Button>
          <Button disabled={!texto.trim() || !clienteListo} variant={ex?.tipo === "pedido" ? "default" : "outline"} onClick={() => crear("pedido")} data-testid="button-pegar-pedido"><ShoppingBag className="h-4 w-4 mr-1" />Crear pedido</Button>
        </div>
      </aside>
    </div>
  );
}

function SubirChat() {
  const { data: productos } = useProductos();
  const { toast } = useToast();
  const invalidar = useInvalidar();
  const [lineas, setLineas] = useState<LineaChat[] | null>(null);
  const [archivo, setArchivo] = useState("");
  const [negocio, setNegocio] = useState<string>("");
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [soloRecientes, setSoloRecientes] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [resumen, setResumen] = useState<{ mensajes: number; detecciones: number } | null>(null);

  const autores = useMemo(() => {
    const cnt: Record<string, number> = {};
    (lineas ?? []).forEach((l) => (cnt[l.autor] = (cnt[l.autor] ?? 0) + 1));
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  }, [lineas]);

  async function leer(f: File) {
    setResumen(null);
    const txt = await f.text();
    const ls = parsearChatExportado(txt);
    setLineas(ls); setArchivo(f.name);
    const cnt: Record<string, number> = {};
    ls.forEach((l) => (cnt[l.autor] = (cnt[l.autor] ?? 0) + 1));
    const aut = Object.keys(cnt);
    const deNombre = f.name.replace(/\.txt$/i, "").replace(/^(chat de whatsapp con|whatsapp chat with)\s*/i, "").trim();
    const cliente = aut.find((a) => a === deNombre) ?? aut.find((a) => /^\+?\d[\d\s-]{6,}$/.test(a)) ?? aut[0] ?? "";
    setNombre(/^\+?\d/.test(cliente) ? "" : cliente);
    setTel(/^\+?\d/.test(cliente) ? cliente : /^\+?\d[\d\s-]{6,}$/.test(deNombre) ? deNombre : "");
    setNegocio(aut.find((a) => a !== cliente) ?? "");
    if (!ls.length) toast({ title: "No se reconocieron mensajes", description: "Exporta el chat desde WhatsApp Business: Más opciones › Exportar chat › Sin archivos.", variant: "destructive" });
  }

  async function importar() {
    if (!lineas) return;
    setProcesando(true);
    try {
      const cid = await asegurarCliente(nombre.trim() || tel, tel);
      const telN = normalizarTelefono(tel);
      const desde = new Date(); desde.setDate(desde.getDate() - 60);
      const filas = lineas.map((l) => ({
        cliente_id: cid, telefono: telN, nombre_contacto: l.autor, direccion: l.autor === negocio ? "saliente" : "entrante", texto: l.texto, origen: "importado",
        enviado_en: l.fecha.toISOString(), wa_message_id: `imp:${cid}:${l.fecha.getTime()}:${hash(l.texto)}`,
      }));
      let insertados: { id: string; texto: string; direccion: string; enviado_en: string }[] = [];
      for (let i = 0; i < filas.length; i += 400) {
        const { data, error } = await supabase.from("mensajes").upsert(filas.slice(i, i + 400), { onConflict: "wa_message_id", ignoreDuplicates: true }).select("id,texto,direccion,enviado_en");
        if (error) throw error;
        insertados = insertados.concat(data ?? []);
      }
      const dets = insertados
        .filter((m) => m.direccion === "entrante" && (!soloRecientes || new Date(m.enviado_en) >= desde))
        .map((m) => ({ m, ex: extraer(m.texto, (productos ?? []) as any, new Date(m.enviado_en)) }))
        .filter(({ ex }) => ex.tipo && ex.confianza >= UMBRAL_DETECCION)
        .map(({ m, ex }) => ({ mensaje_id: m.id, cliente_id: cid, tipo_sugerido: ex.tipo, confianza: ex.confianza, datos: ex }));
      if (dets.length) {
        const { error } = await supabase.from("detecciones").upsert(dets, { onConflict: "mensaje_id", ignoreDuplicates: true });
        if (error) throw error;
      }
      setResumen({ mensajes: insertados.length, detecciones: dets.length });
      invalidar("detecciones", "clientes", "cliente");
    } catch (e: any) {
      toast({ title: "Error al importar", description: e.message, variant: "destructive" });
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center hover:bg-muted/50" data-testid="dropzone-chat">
          <FileUp className="h-7 w-7 text-muted-foreground" />
          <span className="text-sm font-medium">{archivo || "Selecciona el archivo .txt del chat"}</span>
          <span className="text-xs text-muted-foreground">{lineas ? `${lineas.length} mensajes reconocidos` : "En WhatsApp Business: abre el chat › Más opciones › Exportar chat › Sin archivos"}</span>
          <input type="file" accept=".txt,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} data-testid="input-archivo-chat" />
        </label>
        {lineas && lineas.length > 0 && (
          <>
            <div className="space-y-1.5">
              <Label>¿Quién es Party Box en este chat?</Label>
              <Select value={negocio} onValueChange={setNegocio}>
                <SelectTrigger data-testid="select-autor-negocio"><SelectValue placeholder="Elige el autor" /></SelectTrigger>
                <SelectContent>{autores.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Nombre del cliente</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} data-testid="input-chat-nombre" /></div>
              <div className="space-y-1.5"><Label>WhatsApp del cliente</Label><Input inputMode="tel" placeholder="8888 8888" value={tel} onChange={(e) => setTel(e.target.value)} data-testid="input-chat-telefono" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={soloRecientes} onCheckedChange={(v) => setSoloRecientes(!!v)} />Buscar pedidos solo en los últimos 60 días</label>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
              {lineas.slice(-12).map((l, i) => <p key={i} className="break-words"><span className={l.autor === negocio ? "text-primary font-medium" : "font-medium"}>{l.autor}:</span> {l.texto}</p>)}
            </div>
          </>
        )}
      </section>
      <aside className="rounded-xl border bg-card p-4 space-y-3 h-fit">
        <h2 className="text-sm font-semibold">Importar</h2>
        <p className="text-sm text-muted-foreground">Los mensajes se guardan en la ficha del cliente. Los que parezcan pedidos o cotizaciones pasan a la Bandeja. Si importas el mismo chat dos veces, no se duplica.</p>
        <Button className="w-full" disabled={!lineas?.length || !negocio || !(nombre.trim() || tel.trim()) || procesando} onClick={importar} data-testid="button-importar">
          {procesando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Importar chat
        </Button>
        {resumen && (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="text-resumen-importacion">
            <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" />Listo</p>
            <p>{resumen.mensajes} mensajes nuevos · {resumen.detecciones} para revisar.</p>
            {resumen.detecciones > 0 && <Link href="/bandeja" className="font-medium underline">Ir a la Bandeja</Link>}
          </div>
        )}
      </aside>
    </div>
  );
}
