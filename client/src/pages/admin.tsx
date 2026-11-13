import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, llamarCuentas, llamarEnvio, llamarIA, WEBHOOK_URL } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useProductos, usePerfiles, useInvalidar, dinero, fechaHora, type Producto } from "@/lib/crm";
import { Encabezado } from "./inicio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Copy, KeyRound, CheckCircle2, CircleDashed, Save, UploadCloud, FileText, Image as ImageIcon, FileSpreadsheet, Loader2, ExternalLink } from "lucide-react";

// ---------------- Archivos de catálogo (proveedores, inventario, precios) ----------------
type ArchivoCatalogo = { id: string; nombre: string; ruta: string; tipo: "proveedor" | "inventario" | "precios"; proveedor: string | null; mime: string | null; bytes: number | null; estado: string; creado_en: string };
const TIPOS_ARCHIVO: { valor: ArchivoCatalogo["tipo"]; etiqueta: string }[] = [
  { valor: "proveedor", etiqueta: "Catálogo de proveedor" },
  { valor: "inventario", etiqueta: "Lista de inventario" },
  { valor: "precios", etiqueta: "Lista de precios" },
];
const ACEPTA = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv";
const MAX_MB = 100;
function tamano(b: number | null) { if (!b) return ""; return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }
function mimeDe(f: File) {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", csv: "text/csv", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

function ArchivosCatalogo() {
  const { perfil } = useAuth();
  const { toast } = useToast();
  const [tipo, setTipo] = useState<ArchivoCatalogo["tipo"]>("proveedor");
  const [proveedor, setProveedor] = useState("");
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState<{ hechos: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ["archivos_catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("archivos_catalogo").select("*").order("creado_en", { ascending: false });
      if (error) throw error;
      return data as ArchivoCatalogo[];
    },
  });

  async function subir(lista: FileList | File[]) {
    const archivos = Array.from(lista);
    const validos = archivos.filter((f) => f.size <= MAX_MB * 1048576 && /\.(pdf|jpe?g|png|webp|heic|xlsx?|csv)$/i.test(f.name));
    const rechazados = archivos.length - validos.length;
    if (rechazados) toast({ title: `${rechazados} ${rechazados === 1 ? "archivo no se subió" : "archivos no se subieron"}`, description: `Solo PDF, imágenes (JPG, PNG), Excel o CSV de hasta ${MAX_MB} MB.`, variant: "destructive" });
    if (!validos.length) return;
    setSubiendo({ hechos: 0, total: validos.length });
    let ok = 0;
    for (const f of validos) {
      const limpio = f.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "-").slice(-80);
      const ruta = `${tipo}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${limpio}`;
      const mime = mimeDe(f);
      const { error } = await supabase.storage.from("catalogos").upload(ruta, f, { contentType: mime, upsert: false });
      if (!error) {
        const { error: e2 } = await supabase.from("archivos_catalogo").insert({ nombre: f.name, ruta, tipo, proveedor: tipo === "proveedor" ? proveedor.trim() || null : null, mime, bytes: f.size, subido_por: perfil?.id });
        if (!e2) ok++; else await supabase.storage.from("catalogos").remove([ruta]);
      } else toast({ title: `No se pudo subir ${f.name}`, description: error.message, variant: "destructive" });
      setSubiendo((s) => s && { ...s, hechos: s.hechos + 1 });
    }
    setSubiendo(null);
    if (ok) toast({ title: ok === 1 ? "Archivo subido" : `${ok} archivos subidos` });
    q.refetch();
  }

  async function abrir(a: ArchivoCatalogo) {
    const w = window.open("", "_blank");
    const { data } = await supabase.storage.from("catalogos").createSignedUrl(a.ruta, 3600);
    if (data?.signedUrl && w) w.location.href = data.signedUrl; else w?.close();
  }
  async function borrar(a: ArchivoCatalogo) {
    if (!confirm(`¿Borrar «${a.nombre}»?`)) return;
    await supabase.storage.from("catalogos").remove([a.ruta]);
    await supabase.from("archivos_catalogo").delete().eq("id", a.id);
    q.refetch();
  }

  const icono = (m: string | null) => m?.startsWith("image/") ? ImageIcon : /sheet|excel|csv/.test(m ?? "") ? FileSpreadsheet : FileText;

  return (
    <section className="tarjeta mb-6 overflow-hidden" data-testid="section-archivos-catalogo">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="text-base font-bold">Catálogos y listas de precios</h2>
        <p className="text-sm text-muted-foreground">Sube los catálogos de proveedores, la lista de inventario y las listas de precios. Con estos archivos se carga el catálogo de productos.</p>
      </div>
      <div className="grid gap-3 px-4 pt-4 sm:grid-cols-2 sm:px-5">
        <div className="space-y-1.5">
          <Label>Tipo de archivo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
            <SelectTrigger data-testid="select-tipo-archivo"><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS_ARCHIVO.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.etiqueta}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {tipo === "proveedor" && (
          <div className="space-y-1.5">
            <Label htmlFor="proveedor">Proveedor (opcional)</Label>
            <Input id="proveedor" placeholder="Nombre del proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} data-testid="input-proveedor" />
          </div>
        )}
      </div>
      <div
        role="button" tabIndex={0}
        onClick={() => !subiendo && input.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !subiendo) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastrando(false); if (!subiendo && e.dataTransfer.files?.length) subir(e.dataTransfer.files); }}
        className={`m-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:mx-5 ${arrastrando ? "border-[hsl(var(--solido-rojo))] bg-[hsl(var(--marca-rojo)/.06)]" : "border-border hover:bg-muted/50"}`}
        data-testid="zona-subir"
      >
        {subiendo ? (
          <><Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--solido-rojo))]" /><p className="mt-2 text-sm font-medium">Subiendo {subiendo.hechos + 1 > subiendo.total ? subiendo.total : subiendo.hechos + 1} de {subiendo.total}…</p></>
        ) : (
          <>
            <UploadCloud className="h-9 w-9 text-[hsl(var(--solido-rojo))]" />
            <p className="mt-2 text-sm font-semibold">Arrastra los archivos aquí</p>
            <p className="text-sm text-muted-foreground">o toca para elegirlos o tomar una foto</p>
            <p className="mt-2 text-xs text-muted-foreground">PDF, JPG, PNG, Excel o CSV · hasta {MAX_MB} MB cada uno · puedes subir varios a la vez</p>
          </>
        )}
        <input ref={input} type="file" multiple accept={ACEPTA} className="hidden" onChange={(e) => { if (e.target.files?.length) subir(e.target.files); e.target.value = ""; }} data-testid="input-archivos" />
      </div>
      {!!q.data?.length && (
        <ul className="divide-y border-t">
          {q.data.map((a) => {
            const Ico = icono(a.mime);
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5" data-testid={`row-archivo-${a.id}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted"><Ico className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.nombre}</p>
                  <p className="truncate text-xs text-muted-foreground">{TIPOS_ARCHIVO.find((t) => t.valor === a.tipo)?.etiqueta}{a.proveedor ? ` · ${a.proveedor}` : ""} · {tamano(a.bytes)} · {fechaHora(a.creado_en)}</p>
                </div>
                <span className={`hidden sm:inline rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${a.estado === "procesado" ? "bg-[hsl(var(--solido-verde))]" : "bg-[hsl(var(--solido-ocre))]"}`}>{a.estado === "procesado" ? "Cargado al catálogo" : "Por cargar"}</span>
                <Button variant="ghost" size="icon" aria-label="Abrir" onClick={() => abrir(a)}><ExternalLink className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Borrar" onClick={() => borrar(a)} data-testid={`button-borrar-archivo-${a.id}`}><Trash2 className="h-4 w-4" /></Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------- Catálogo ----------------
export function Catalogo() {
  const { data, isLoading } = useProductos();
  const [editando, setEditando] = useState<Partial<Producto> | null>(null);
  const invalidar = useInvalidar();
  const { toast } = useToast();

  async function guardar() {
    if (!editando?.nombre?.trim()) return;
    const p = { nombre: editando.nombre.trim(), categoria: editando.categoria || null, precio: Number(editando.precio) || 0, moneda: editando.moneda ?? "NIO", palabras_clave: editando.palabras_clave || null, activo: editando.activo ?? true };
    const { error } = editando.id ? await supabase.from("productos").update(p).eq("id", editando.id) : await supabase.from("productos").insert(p);
    if (error) return toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
    setEditando(null); invalidar("productos");
  }

  const porCat = (data ?? []).reduce<Record<string, Producto[]>>((acc, p) => { (acc[p.categoria || "Sin categoría"] ??= []).push(p); return acc; }, {});

  return (
    <div>
      <Encabezado titulo="Catálogo" sub="Productos y servicios con su precio. Las palabras clave ayudan a reconocerlos en los mensajes de WhatsApp."
        acciones={<Button onClick={() => setEditando({ moneda: "NIO", activo: true })} data-testid="button-nuevo-producto"><Plus className="h-4 w-4 mr-1" />Producto</Button>} />
      <ArchivosCatalogo />
      {!isLoading && !data?.length && (
        <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Agrega los productos de Party Box (cajas, decoraciones, alquileres…) para que se reconozcan en los chats y se llenen los precios solos.
        </div>
      )}
      <div className="space-y-5">
        {Object.entries(porCat).map(([cat, ps]) => (
          <section key={cat} className="overflow-hidden tarjeta">
            <h2 className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h2>
            <div className="divide-y">
              {ps.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid={`row-producto-${p.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${p.activo ? "" : "text-muted-foreground line-through"}`}>{p.nombre}</p>
                    {p.palabras_clave && <p className="text-xs text-muted-foreground truncate">Reconoce: {p.palabras_clave}</p>}
                  </div>
                  <p className="text-sm tabular-nums">{dinero(p.precio, p.moneda)}</p>
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditando(p)} data-testid={`button-editar-producto-${p.id}`}><Pencil className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editando?.id ? "Editar producto" : "Nuevo producto"}</DialogTitle></DialogHeader>
          {editando && (
            <div className="grid gap-3">
              <div className="space-y-1.5"><Label>Nombre</Label><Input value={editando.nombre ?? ""} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} data-testid="input-producto-nombre" /></div>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
                <div className="space-y-1.5"><Label>Categoría</Label><Input placeholder="Ej. Cajas, Decoración" value={editando.categoria ?? ""} onChange={(e) => setEditando({ ...editando, categoria: e.target.value })} data-testid="input-producto-categoria" /></div>
                <div className="space-y-1.5"><Label>Precio</Label><Input type="number" min={0} step="0.01" value={editando.precio ?? ""} onChange={(e) => setEditando({ ...editando, precio: e.target.value as any })} data-testid="input-producto-precio" /></div>
                <div className="space-y-1.5"><Label>Moneda</Label>
                  <Select value={editando.moneda ?? "NIO"} onValueChange={(v) => setEditando({ ...editando, moneda: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="NIO">C$</SelectItem><SelectItem value="USD">US$</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Palabras clave (separadas por coma)</Label><Input placeholder="Ej. caja, box, cajita" value={editando.palabras_clave ?? ""} onChange={(e) => setEditando({ ...editando, palabras_clave: e.target.value })} data-testid="input-producto-claves" /></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={editando.activo ?? true} onCheckedChange={(v) => setEditando({ ...editando, activo: v })} />Activo</label>
            </div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button><Button onClick={guardar} data-testid="button-guardar-producto"><Save className="h-4 w-4 mr-1" />Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------- Equipo ----------------
export function Equipo() {
  const { perfil } = useAuth();
  const { data: perfiles } = usePerfiles();
  const invalidar = useInvalidar();
  const { toast } = useToast();
  const inv = useQuery({ queryKey: ["invitaciones"], queryFn: async () => (await supabase.from("invitaciones").select("*").order("creado_en", { ascending: false })).data ?? [] });
  const [nuevo, setNuevo] = useState({ email: "", nombre: "", rol: "ventas" });
  const [reset, setReset] = useState<{ id: string; nombre: string } | null>(null);
  const [clave, setClave] = useState("");

  async function invitar() {
    const { error } = await supabase.from("invitaciones").insert({ email: nuevo.email.trim().toLowerCase(), nombre: nuevo.nombre.trim(), rol: nuevo.rol, creado_por: perfil?.id });
    if (error) return toast({ title: "No se pudo invitar", description: error.message.includes("duplicate") ? "Ese correo ya fue invitado." : error.message, variant: "destructive" });
    setNuevo({ email: "", nombre: "", rol: "ventas" }); inv.refetch();
    toast({ title: "Invitación creada", description: "Pídele que entre al CRM y elija «¿Te invitaron? Crea tu cuenta»." });
  }
  async function actualizar(id: string, patch: Record<string, unknown>) {
    if (id === perfil?.id && (patch.activo === false || patch.rol === "ventas")) return toast({ title: "No puedes quitarte tu propio acceso de administradora.", variant: "destructive" });
    const { error } = await supabase.from("perfiles").update(patch).eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    invalidar("perfiles");
  }
  async function restablecer() {
    try { await llamarCuentas({ accion: "restablecer", usuario_id: reset!.id, password: clave }); toast({ title: "Contraseña temporal asignada", description: "Compártela por un medio privado." }); setReset(null); setClave(""); }
    catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  return (
    <div>
      <Encabezado titulo="Equipo" sub="Invita por correo; cada persona crea su propia contraseña." />
      <section className="mb-5 tarjeta p-4 sm:p-5">
        <h2 className="mb-3 text-base font-bold">Invitar a alguien</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-end">
          <div className="space-y-1.5"><Label>Nombre</Label><Input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} data-testid="input-invitar-nombre" /></div>
          <div className="space-y-1.5"><Label>Correo</Label><Input type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} data-testid="input-invitar-email" /></div>
          <div className="space-y-1.5"><Label>Rol</Label>
            <Select value={nuevo.rol} onValueChange={(v) => setNuevo({ ...nuevo, rol: v })}>
              <SelectTrigger data-testid="select-invitar-rol"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ventas">Ventas</SelectItem><SelectItem value="admin">Administradora</SelectItem></SelectContent>
            </Select>
          </div>
          <Button onClick={invitar} disabled={!nuevo.email.includes("@") || !nuevo.nombre.trim()} data-testid="button-invitar">Invitar</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Ventas: clientes, cotizaciones, pedidos y bandeja. Administradora: además catálogo, equipo y conexión de WhatsApp.</p>
      </section>

      <section className="mb-5 overflow-hidden tarjeta">
        <h2 className="border-b px-4 py-3 text-base font-bold">Miembros</h2>
        <div className="divide-y">
          {perfiles?.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`row-miembro-${p.id}`}>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{p.nombre}{p.id === perfil?.id ? " (tú)" : ""}</p><p className="text-xs text-muted-foreground break-all">{p.email}</p></div>
              <Select value={p.rol} onValueChange={(v) => actualizar(p.id, { rol: v })}>
                <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ventas">Ventas</SelectItem><SelectItem value="admin">Administradora</SelectItem></SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs"><Switch checked={p.activo} onCheckedChange={(v) => actualizar(p.id, { activo: v })} />Activo</label>
              <Button variant="ghost" size="sm" onClick={() => setReset({ id: p.id, nombre: p.nombre })}><KeyRound className="h-4 w-4 mr-1" />Contraseña</Button>
            </div>
          ))}
        </div>
      </section>

      {(inv.data ?? []).some((i: any) => !i.usado_en) && (
        <section className="overflow-hidden tarjeta">
          <h2 className="border-b px-4 py-3 text-base font-bold">Invitaciones pendientes</h2>
          <div className="divide-y">
            {(inv.data ?? []).filter((i: any) => !i.usado_en).map((i: any) => (
              <div key={i.email} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="text-sm">{i.nombre}</p><p className="text-xs text-muted-foreground break-all">{i.email} · {i.rol === "admin" ? "Administradora" : "Ventas"}</p></div>
                <Button variant="ghost" size="icon" aria-label="Cancelar invitación" onClick={async () => { await supabase.from("invitaciones").delete().eq("email", i.email); inv.refetch(); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!reset} onOpenChange={(o) => !o && setReset(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Contraseña temporal para {reset?.nombre}</DialogTitle><DialogDescription>Compártela solo por un medio privado. Mínimo 8 caracteres.</DialogDescription></DialogHeader>
          <Input type="text" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" data-testid="input-clave-temporal" />
          <DialogFooter><Button variant="ghost" onClick={() => setReset(null)}>Cancelar</Button><Button disabled={clave.length < 8} onClick={restablecer}>Asignar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------- Conexión WhatsApp ----------------
const EVENTOS_YCLOUD = ["whatsapp.inbound_message.received", "whatsapp.smb.message.echoes", "whatsapp.smb.history"];

export function WhatsappConfig() {
  const { toast } = useToast();
  const cfg = useQuery({
    queryKey: ["config_whatsapp"],
    queryFn: async () => {
      const { data } = await supabase.from("config_whatsapp").select("verify_token,numero_mostrado,ultimo_evento,dias_archivos").eq("id", 1).single();
      const { data: sec } = await supabase.rpc("whatsapp_secret_configurado");
      const { data: yc } = await supabase.rpc("ycloud_secret_configurado");
      const { count } = await supabase.from("mensajes").select("id", { count: "exact", head: true }).eq("origen", "api");
      const { count: archivos } = await supabase.from("mensajes").select("id", { count: "exact", head: true }).not("media_path", "is", null);
      return { ...(data as any), secreto: !!sec, ycloud: !!yc, mensajesApi: count ?? 0, archivos: archivos ?? 0 };
    },
    refetchInterval: 20000,
  });
  const [secreto, setSecreto] = useState("");
  const [ycSecreto, setYcSecreto] = useState("");
  const [apiKey, setApiKey] = useState("");
  const envio = useQuery({ queryKey: ["envio-estado", "admin"], queryFn: () => llamarEnvio({ accion: "estado" }), refetchInterval: 60000 });
  const [limite, setLimite] = useState("");
  useEffect(() => { if (envio.data) setLimite(String(envio.data.limite)); }, [envio.data?.limite]);
  const ia = useQuery({ queryKey: ["ia-estado"], queryFn: () => llamarIA({ accion: "estado" }), refetchInterval: 60000 });
  const [iaKey, setIaKey] = useState("");
  const [iaLimite, setIaLimite] = useState("");
  useEffect(() => { if (ia.data) setIaLimite(String(ia.data.limite)); }, [ia.data?.limite]);
  const [numero, setNumero] = useState("");
  useEffect(() => { if (cfg.data?.numero_mostrado) setNumero(cfg.data.numero_mostrado); }, [cfg.data?.numero_mostrado]);

  const copiar = (t: string) => { navigator.clipboard?.writeText(t); toast({ title: "Copiado" }); };
  async function guardar(patch: Record<string, unknown>) {
    const { error } = await supabase.from("config_whatsapp").update(patch).eq("id", 1);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setSecreto(""); setYcSecreto(""); setApiKey(""); setIaKey(""); cfg.refetch(); envio.refetch(); ia.refetch(); toast({ title: "Guardado" });
  }
  const conectado = !!cfg.data?.ultimo_evento;

  return (
    <div className="max-w-3xl">
      <Encabezado titulo="Conexión WhatsApp" sub="Conecta el número que Party Box ya usa en la app WhatsApp Business. La app del teléfono sigue funcionando igual." />
      <section className="mb-5 flex items-start gap-3 tarjeta p-4">
        {conectado ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /> : <CircleDashed className="h-5 w-5 text-muted-foreground shrink-0" />}
        <div className="text-sm">
          <p className="font-medium" data-testid="text-estado-conexion">{conectado ? "Recibiendo mensajes" : "Aún sin conexión"}</p>
          <p className="text-muted-foreground">{conectado ? `Último evento: ${fechaHora(cfg.data!.ultimo_evento)} · ${cfg.data!.mensajesApi} mensajes recibidos` : "Cuando llegue el primer mensaje, aquí verás la confirmación."}</p>
        </div>
      </section>

      <section className="mb-5 tarjeta p-4 sm:p-5 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold">Fotos, videos y documentos</h2>
            <p className="mt-1 text-muted-foreground">Se guardan en el CRM durante el tiempo que elijas y después se borran solos cada madrugada. El texto de los chats no se borra. En el teléfono siguen disponibles en WhatsApp.</p>
            <p className="mt-2 text-muted-foreground" data-testid="text-archivos-guardados">Archivos guardados ahora: <span className="font-semibold text-foreground">{cfg.data?.archivos ?? "—"}</span></p>
          </div>
          <div className="w-full shrink-0 sm:w-44">
            <Label className="mb-1.5 block">Guardar por</Label>
            <Select value={String(cfg.data?.dias_archivos ?? 30)} onValueChange={(v) => guardar({ dias_archivos: Number(v) })}>
              <SelectTrigger data-testid="select-dias-archivos"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 días</SelectItem>
                <SelectItem value="30">30 días</SelectItem>
                <SelectItem value="60">60 días</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="mb-5 tarjeta p-4 sm:p-5 text-sm space-y-4" data-testid="section-envio">
        <div className="flex items-start gap-3">
          {envio.data?.configurado ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /> : <CircleDashed className="h-5 w-5 text-muted-foreground shrink-0" />}
          <div>
            <h2 className="text-base font-bold">Responder y enviar cotizaciones desde el CRM</h2>
            <p className="mt-1 text-muted-foreground">Con la clave de API de YCloud el equipo escribe y manda los PDF desde el CRM, sin abrir WhatsApp. Solo funciona dentro de las 24 horas desde el último mensaje del cliente (regla de WhatsApp). Esos mensajes salen del número de Party Box y también se ven en el teléfono.</p>
            <p className="mt-2" data-testid="text-envio-estado">{envio.data ? (envio.data.configurado ? <>Conectado · <b>{envio.data.usados}</b> de {envio.data.limite} mensajes usados este mes</> : "Aún sin clave de API.") : "—"}</p>
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>En YCloud: <b>Developers › API Keys</b>, copia la clave (o crea una).</li>
          <li>Pégala abajo y guarda. No se muestra después de guardarla.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Clave de API de YCloud {envio.data?.configurado && <span className="text-emerald-700">(configurada)</span>}</Label>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={envio.data?.configurado ? "•••••••• (pega una nueva para cambiarla)" : "Pega aquí la clave"} data-testid="input-ycloud-api-key" />
              <Button onClick={() => guardar({ ycloud_api_key: apiKey.trim() })} disabled={apiKey.trim().length < 10} data-testid="button-guardar-api-key">Guardar</Button>
            </div>
          </div>
          <div className="space-y-1.5 sm:w-44">
            <Label className="text-xs text-muted-foreground">Tope de mensajes al mes</Label>
            <div className="flex gap-2">
              <Input type="number" min={0} max={100000} value={limite} onChange={(e) => setLimite(e.target.value)} data-testid="input-limite-envios" />
              <Button variant="outline" onClick={() => guardar({ envios_limite_mes: Math.max(0, Math.min(100000, Number(limite) || 0)) })} disabled={!limite || Number(limite) === envio.data?.limite} data-testid="button-guardar-limite">OK</Button>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Meta da 1.000 mensajes de servicio gratis al mes; el tope de 950 deja margen para no pagar. Al llegar al tope, el CRM deja de enviar y se responde desde el teléfono.</p>
      </section>

      <section className="mb-5 tarjeta p-4 sm:p-5 text-sm space-y-4" data-testid="section-ia">
        <div className="flex items-start gap-3">
          {ia.data?.configurado ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /> : <CircleDashed className="h-5 w-5 text-muted-foreground shrink-0" />}
          <div>
            <h2 className="text-base font-bold">Analizar chats con ChatGPT</h2>
            <p className="mt-1 text-muted-foreground">En «Ver chat y analizar», el botón «Analizar con IA» lee todo el chat, las fotos y las notas de voz, y arma la lista, precios, fecha, datos de factura y preguntas sin responder. Cada nota de voz se transcribe una sola vez.</p>
            <p className="mt-2" data-testid="text-ia-estado">{ia.data ? (ia.data.configurado ? <>Conectado · <b>US${ia.data.gastado.toFixed(2)}</b> de US${ia.data.limite.toFixed(2)} usados este mes · {ia.data.usos} análisis</> : "Aún sin clave de OpenAI.") : "—"}</p>
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Entra a <a className="text-primary underline" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">platform.openai.com › Billing</a> (es distinto a la suscripción de ChatGPT), agrega una tarjeta y carga saldo, por ejemplo US$10.</li>
          <li>En <a className="text-primary underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API keys</a>, crea una clave nueva (ejemplo: «CRM Party Box»).</li>
          <li>Pégala abajo y guarda. No se muestra después de guardarla.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Clave de API de OpenAI {ia.data?.configurado && <span className="text-emerald-700">(configurada)</span>}</Label>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={iaKey} onChange={(e) => setIaKey(e.target.value)} placeholder={ia.data?.configurado ? "•••••••• (pega una nueva para cambiarla)" : "sk-…"} data-testid="input-openai-key" />
              <Button onClick={() => guardar({ openai_api_key: iaKey.trim() })} disabled={iaKey.trim().length < 20} data-testid="button-guardar-openai">Guardar</Button>
            </div>
          </div>
          <div className="space-y-1.5 sm:w-44">
            <Label className="text-xs text-muted-foreground">Tope al mes (US$)</Label>
            <div className="flex gap-2">
              <Input type="number" min={0} max={500} step="1" value={iaLimite} onChange={(e) => setIaLimite(e.target.value)} data-testid="input-limite-ia" />
              <Button variant="outline" onClick={() => guardar({ ia_limite_usd_mes: Math.max(0, Math.min(500, Number(iaLimite) || 0)) })} disabled={iaLimite === "" || Number(iaLimite) === ia.data?.limite} data-testid="button-guardar-limite-ia">OK</Button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div>
            <p className="font-semibold">Analizar solo los chats nuevos de la Bandeja</p>
            <p className="text-xs text-muted-foreground">Cada 5 minutos revisa «Por revisar» y analiza los chats con mensajes nuevos que llevan 10 minutos sin actividad. El resultado aparece en la tarjeta.</p>
          </div>
          <Switch checked={!!ia.data?.auto} disabled={!ia.data} onCheckedChange={(v) => guardar({ ia_auto: v })} data-testid="switch-ia-auto" />
        </div>
        <p className="text-xs text-muted-foreground">Costo aproximado: 1 a 2 centavos de dólar por chat la primera vez (casi todo por las notas de voz) y menos al volver a analizarlo. Al llegar al tope, el botón deja de funcionar hasta el próximo mes y sigue disponible el análisis normal.</p>
      </section>

      <section className="mb-5 tarjeta p-4 sm:p-5 text-sm space-y-4">
        <div>
          <h2 className="font-semibold">Conectar con YCloud (recomendado)</h2>
          <p className="text-muted-foreground">Proveedor oficial de Meta. Plan gratis, sin recargo por mensaje. Los mensajes que el equipo responde desde la app no tienen costo.</p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>En el teléfono de Party Box, actualiza WhatsApp Business (versión 2.24.17 o superior).</li>
          <li>Crea una cuenta gratis en <a className="text-primary underline" href="https://www.ycloud.com/" target="_blank" rel="noreferrer">ycloud.com</a>.</li>
          <li>En YCloud: <b>WhatsApp accounts › Create channel › WhatsApp Business APP Coexistence</b>. Inicia sesión con Facebook, elige o crea el portafolio de Party Box, escribe el número y escanea el código QR con la app. Acepta compartir el historial de chats.</li>
          <li>En YCloud: <b>Developers › Webhooks › Add endpoint</b>. Pega la URL de abajo y agrega los eventos indicados.</li>
          <li>Copia la clave de firma (<i>Signing secret</i>) que muestra YCloud y pégala abajo en «Clave de firma de YCloud».</li>
          <li>Pide a alguien que escriba al número: el contacto debe aparecer en Clientes y, si parece venta, en la Bandeja.</li>
        </ol>
        <Dato label="URL del webhook (Endpoint URL)" valor={WEBHOOK_URL} onCopy={copiar} testid="webhook-url" />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Eventos a agregar en YCloud</Label>
          <div className="flex flex-wrap gap-2">
            {EVENTOS_YCLOUD.map((e) => (
              <button key={e} type="button" onClick={() => copiar(e)} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs hover:bg-accent" data-testid={`button-evento-${e}`}>{e}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Clave de firma de YCloud {cfg.data?.ycloud ? "· configurada" : "· obligatoria"}</Label>
            <Input type="password" autoComplete="off" placeholder={cfg.data?.ycloud ? "•••••••• (dejar vacío para no cambiar)" : "Signing secret"} value={ycSecreto} onChange={(e) => setYcSecreto(e.target.value)} data-testid="input-ycloud-secret" /></div>
          <Button disabled={!ycSecreto.trim()} onClick={() => guardar({ ycloud_secret: ycSecreto.trim() })} data-testid="button-guardar-ycloud">Guardar clave</Button>
        </div>
        <p className="text-xs text-muted-foreground">Una vez guardada, nadie puede volver a verla desde el CRM. Sin ella, el CRM rechaza los mensajes para evitar datos falsos.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Número de Party Box (referencia)</Label><Input placeholder="505 8888 8888" value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
          <Button variant="outline" onClick={() => guardar({ numero_mostrado: numero })}>Guardar</Button>
        </div>
      </section>

      <details className="mb-5 tarjeta p-4 sm:p-5 text-sm">
        <summary className="cursor-pointer font-semibold">Otra opción: app de Meta propia o 360dialog</summary>
        <div className="mt-4 space-y-4">
          <Dato label="URL del webhook (Callback URL)" valor={WEBHOOK_URL} onCopy={copiar} testid="webhook-url-meta" />
          <Dato label="Token de verificación (Verify token)" valor={cfg.data?.verify_token ?? "…"} onCopy={copiar} testid="verify-token" />
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Campos a suscribir en Meta</Label>
            <p className="text-sm font-mono break-words">messages, smb_message_echoes, history, smb_app_state_sync</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Clave secreta de la app de Meta (opcional) {cfg.data?.secreto ? "· configurada" : ""}</Label>
              <Input type="password" autoComplete="off" placeholder={cfg.data?.secreto ? "•••••••• (dejar vacío para no cambiar)" : "App Secret"} value={secreto} onChange={(e) => setSecreto(e.target.value)} data-testid="input-app-secret" /></div>
            <Button variant="outline" disabled={!secreto} onClick={() => guardar({ app_secret: secreto })}>Guardar clave</Button>
          </div>
        </div>
      </details>
      <p className="text-xs text-muted-foreground">Mientras tanto, el equipo puede usar «Importar chats» para traer conversaciones exportadas desde la app.</p>
    </div>
  );
}

function Dato({ label, valor, onCopy, testid }: { label: string; valor: string; onCopy: (v: string) => void; testid: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 text-xs break-all" data-testid={`text-${testid}`}>{valor}</code>
        <Button variant="outline" size="icon" aria-label="Copiar" onClick={() => onCopy(valor)} data-testid={`button-copiar-${testid}`}><Copy className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
