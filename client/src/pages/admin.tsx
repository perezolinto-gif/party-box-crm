import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, llamarCuentas, WEBHOOK_URL } from "@/lib/supabase";
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
import { Plus, Pencil, Trash2, Copy, KeyRound, CheckCircle2, CircleDashed, Save } from "lucide-react";

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
      const { data } = await supabase.from("config_whatsapp").select("verify_token,numero_mostrado,ultimo_evento").eq("id", 1).single();
      const { data: sec } = await supabase.rpc("whatsapp_secret_configurado");
      const { data: yc } = await supabase.rpc("ycloud_secret_configurado");
      const { count } = await supabase.from("mensajes").select("id", { count: "exact", head: true }).eq("origen", "api");
      return { ...(data as any), secreto: !!sec, ycloud: !!yc, mensajesApi: count ?? 0 };
    },
    refetchInterval: 20000,
  });
  const [secreto, setSecreto] = useState("");
  const [ycSecreto, setYcSecreto] = useState("");
  const [numero, setNumero] = useState("");
  useEffect(() => { if (cfg.data?.numero_mostrado) setNumero(cfg.data.numero_mostrado); }, [cfg.data?.numero_mostrado]);

  const copiar = (t: string) => { navigator.clipboard?.writeText(t); toast({ title: "Copiado" }); };
  async function guardar(patch: Record<string, unknown>) {
    const { error } = await supabase.from("config_whatsapp").update(patch).eq("id", 1);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setSecreto(""); setYcSecreto(""); cfg.refetch(); toast({ title: "Guardado" });
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
