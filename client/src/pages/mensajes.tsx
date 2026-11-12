import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { waLink } from "@/lib/crm";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Search, MessageCircle, UserRound, ExternalLink, Check, Camera, ImageOff, Video, FileText, Mic, Download } from "lucide-react";

type Msg = {
  id: string;
  cliente_id: string | null;
  telefono: string | null;
  nombre_contacto: string | null;
  direccion: "entrante" | "saliente";
  texto: string;
  enviado_en: string;
  media_path?: string | null;
  media_tipo?: string | null;
  media_nombre?: string | null;
  media_mime?: string | null;
  media_bytes?: number | null;
  clientes?: { id: string; nombre: string } | null;
};

type Chat = {
  telefono: string;
  nombre: string;
  clienteId: string | null;
  ultimo: Msg;
  recibidosHoy: number;
  sinResponder: number;
};

const REFRESCO = 15_000;

function inicioDeHoy() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-NI", { hour: "numeric", minute: "2-digit" });
}
function cuandoLista(iso: string) {
  const d = new Date(iso); const hoy = inicioDeHoy();
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
  if (d >= hoy) return horaCorta(iso);
  if (d >= ayer) return "Ayer";
  return d.toLocaleDateString("es-NI", { day: "numeric", month: "short" });
}
function etiquetaDia(iso: string) {
  const d = new Date(iso); const hoy = inicioDeHoy();
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
  if (d >= hoy) return "Hoy";
  if (d >= ayer) return "Ayer";
  const t = d.toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
type Clase = "foto" | "video" | "documento" | "audio" | null;
const MARCAS: Record<string, Exclude<Clase, null>> = { image: "foto", sticker: "foto", video: "video", document: "documento", audio: "audio" };
const ETIQUETA: Record<Exclude<Clase, null>, string> = { foto: "Foto", video: "Video", documento: "Documento", audio: "Nota de voz" };
/** Separa el marcador que guarda el sistema ("[image]", "[video]"…) del texto que lo acompaña. */
function partes(texto: string | null): { clase: Clase; texto: string } {
  const t = texto ?? "";
  const m = t.match(/^\[(image|sticker|video|document|audio)\]\s*/);
  return m ? { clase: MARCAS[m[1]], texto: t.slice(m[0].length) } : { clase: null, texto: t };
}
const ICONO = { foto: Camera, video: Video, documento: FileText, audio: Mic };
function Vista({ texto }: { texto: string | null }) {
  const p = partes(texto);
  if (!p.clase) return <span className="truncate">{p.texto || "(sin texto)"}</span>;
  const I = ICONO[p.clase];
  return <><I className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{p.texto || ETIQUETA[p.clase]}</span></>;
}
function tamano(b?: number | null) {
  if (!b) return "";
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function extension(nombre?: string | null, mime?: string | null) {
  const e = nombre?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? mime?.split("/")[1]?.split(/[.+-]/).pop() ?? "";
  return e.slice(0, 4).toUpperCase();
}
function telBonito(t: string) { return t.startsWith("+") ? t : `+${t}`; }

function useChats() {
  return useQuery({
    queryKey: ["mensajes", "chats"],
    refetchInterval: REFRESCO,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensajes")
        .select("id, cliente_id, telefono, nombre_contacto, direccion, texto, enviado_en, clientes(id,nombre)")
        .order("enviado_en", { ascending: false })
        .limit(3000);
      if (error) throw error;
      const hoy = inicioDeHoy().getTime();
      const mapa = new Map<string, Chat>();
      for (const m of (data ?? []) as unknown as Msg[]) {
        const tel = m.telefono ?? m.cliente_id;
        if (!tel) continue;
        let c = mapa.get(tel);
        if (!c) {
          // Los mensajes vienen del más reciente al más antiguo: el primero es el último del chat.
          c = { telefono: tel, nombre: "", clienteId: null, ultimo: m, recibidosHoy: 0, sinResponder: 0 };
          mapa.set(tel, c);
          (c as any)._respondido = m.direccion === "saliente";
        }
        if (!c.clienteId && m.clientes?.id) c.clienteId = m.clientes.id;
        if (!c.nombre && m.clientes?.nombre) c.nombre = m.clientes.nombre;
        if (!c.nombre && m.direccion === "entrante" && m.nombre_contacto) (c as any)._contacto ??= m.nombre_contacto;
        if (m.direccion === "entrante" && new Date(m.enviado_en).getTime() >= hoy) c.recibidosHoy++;
        if ((c as any)._respondido === false) {
          if (m.direccion === "entrante") c.sinResponder++;
          else (c as any)._respondido = true;
        }
      }
      const chats = Array.from(mapa.values());
      for (const c of chats) {
        if (!c.nombre) c.nombre = (c as any)._contacto ?? telBonito(c.telefono);
      }
      // Mismo orden que WhatsApp: el chat con el mensaje más reciente (enviado o recibido) va arriba.
      return chats.sort((a, b) => b.ultimo.enviado_en.localeCompare(a.ultimo.enviado_en));
    },
  });
}

function useConversacion(telefono: string | null) {
  return useQuery({
    queryKey: ["mensajes", "chat", telefono],
    enabled: !!telefono,
    refetchInterval: REFRESCO,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensajes")
        .select("id, cliente_id, telefono, nombre_contacto, direccion, texto, enviado_en, media_path, media_tipo, media_nombre, media_mime, media_bytes")
        .eq("telefono", telefono!)
        .order("enviado_en", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const msgs = ((data ?? []) as Msg[]).reverse();
      const rutas = msgs.map((m) => m.media_path).filter(Boolean) as string[];
      const urls: Record<string, string> = {};
      if (rutas.length) {
        const { data: firmadas } = await supabase.storage.from("whatsapp-media").createSignedUrls(rutas, 60 * 60);
        for (const f of firmadas ?? []) if (f.path && f.signedUrl) urls[f.path] = f.signedUrl;
      }
      return { msgs, urls };
    },
  });
}

function Avatar({ nombre }: { nombre: string }) {
  const letra = (nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/)?.[0] ?? "").toUpperCase() || "?";
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(var(--marca-ciruela)/.12)] text-base font-bold text-[hsl(var(--marca-ciruela))]" aria-hidden>
      {letra}
    </span>
  );
}

export default function Mensajes({ telefono }: { telefono?: string }) {
  const [, navegar] = useLocation();
  const { data: chats, isLoading } = useChats();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "sin" | "hoy">("todos");
  const abierto = telefono ? decodeURIComponent(telefono) : null;

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase(); const dig = q.replace(/\D/g, "");
    return (chats ?? []).filter((c) => {
      if (filtro === "sin" && c.sinResponder === 0) return false;
      if (filtro === "hoy" && c.recibidosHoy === 0) return false;
      if (!t) return true;
      return c.nombre.toLowerCase().includes(t) || (dig && c.telefono.includes(dig)) || c.ultimo.texto?.toLowerCase().includes(t);
    });
  }, [chats, q, filtro]);

  const totalSin = (chats ?? []).filter((c) => c.sinResponder > 0).length;
  const chatAbierto = (chats ?? []).find((c) => c.telefono === abierto) ?? null;

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:mx-0 lg:my-0">
      <div className="grid grid-cols-1 h-[calc(100dvh-4rem)] overflow-hidden bg-card lg:h-[calc(100dvh-5rem)] lg:grid-cols-[360px_1fr] lg:rounded-2xl lg:border lg:shadow-[0_1px_2px_rgba(26,23,20,.04),0_8px_24px_-12px_rgba(26,23,20,.12)]">
        {/* Lista de chats */}
        <section className={`${abierto ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col border-r`}>
          <div className="border-b px-4 pt-5 pb-3 lg:pt-4">
            <h1 className="font-display text-[1.75rem] font-extrabold leading-tight tracking-tight" data-testid="text-titulo">Mensajes</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Ordenados como en WhatsApp: el más reciente arriba.</p>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar nombre, teléfono o texto" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-buscar-mensajes" />
            </div>
            <div className="mt-3 flex gap-1.5" role="tablist">
              {([["todos", "Todos"], ["sin", `Sin responder${totalSin ? ` (${totalSin})` : ""}`], ["hoy", "Hoy"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)}
                  className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${filtro === k ? "bg-[hsl(var(--solido-rojo))] text-white" : "bg-muted text-foreground/80 hover:bg-muted/70"}`}
                  data-testid={`filtro-${k}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="list-chats">
            {isLoading && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3"><Skeleton className="h-11 w-11 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div></div>
            ))}
            {!isLoading && !lista.length && (
              <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                <MessageCircle className="mx-auto mb-2 h-6 w-6" />
                {q || filtro !== "todos" ? "No hay chats con ese filtro." : "Todavía no han llegado mensajes."}
              </div>
            )}
            {lista.map((c) => {
              const activo = c.telefono === abierto;
              return (
                <Link key={c.telefono} href={`/mensajes/${encodeURIComponent(c.telefono)}`}
                  className={`flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors ${activo ? "bg-sidebar-accent" : "hover:bg-muted/60"}`}
                  data-testid={`chat-${c.telefono}`}>
                  <Avatar nombre={c.nombre} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[15px] font-semibold">{c.nombre}</p>
                      <span className={`shrink-0 text-xs tabular-nums ${c.sinResponder ? "font-bold text-[hsl(var(--solido-rojo))]" : "text-muted-foreground"}`}>{cuandoLista(c.ultimo.enviado_en)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-1 truncate text-sm text-muted-foreground">
                        {c.ultimo.direccion === "saliente" && <Check className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--solido-azul))]" aria-label="Respondido" />}
                        <Vista texto={c.ultimo.texto} />
                      </p>
                      {c.sinResponder > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--solido-rojo))] px-1.5 text-[11px] font-bold text-white tabular-nums" aria-label={`${c.sinResponder} sin responder`}>{c.sinResponder}</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Conversación */}
        <section className={`${abierto ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}>
          {abierto ? <Conversacion telefono={abierto} chat={chatAbierto} onVolver={() => navegar("/mensajes")} /> : (
            <div className="grid flex-1 place-items-center bg-[hsl(36_30%_96%)] p-10 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--solido-rojo))] text-white"><MessageCircle className="h-7 w-7" /></span>
                <p className="mt-4 font-display text-xl font-bold">Elegí un chat</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Los mensajes de WhatsApp Business llegan aquí solos. Las respuestas se envían desde el teléfono y también aparecen aquí.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Conversacion({ telefono, chat, onVolver }: { telefono: string; chat: Chat | null; onVolver: () => void }) {
  const { data, isLoading } = useConversacion(telefono);
  const msgs = data?.msgs;
  const urls = data?.urls ?? {};
  const fin = useRef<HTMLDivElement>(null);
  const ultimoId = msgs?.[msgs.length - 1]?.id;
  const abiertoEn = useRef(0);
  useEffect(() => { abiertoEn.current = Date.now(); }, [telefono]);
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [ultimoId, telefono]);
  // Las fotos cargan después del texto; mientras se abre el chat se mantiene abajo, como WhatsApp.
  const alCargarFoto = () => { if (Date.now() - abiertoEn.current < 5000) fin.current?.scrollIntoView({ block: "end" }); };

  const nombre = chat?.nombre ?? telBonito(telefono);
  const wa = waLink(telefono);
  const clienteId = chat?.clienteId ?? msgs?.find((m) => m.cliente_id)?.cliente_id ?? null;

  const grupos: { dia: string; items: Msg[] }[] = [];
  for (const m of msgs ?? []) {
    const dia = etiquetaDia(m.enviado_en);
    const g = grupos[grupos.length - 1];
    if (g && g.dia === dia) g.items.push(m); else grupos.push({ dia, items: [m] });
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b bg-card px-3 py-2.5 sm:px-4">
        <button onClick={onVolver} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted lg:hidden" aria-label="Volver a la lista" data-testid="button-volver"><ArrowLeft className="h-5 w-5" /></button>
        <Avatar nombre={nombre} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold" data-testid="text-chat-nombre">{nombre}</p>
          <p className="truncate text-xs text-muted-foreground">{telBonito(telefono)}</p>
        </div>
        {clienteId && (
          <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex"><Link href={`/clientes/${clienteId}`}><UserRound className="mr-1 h-4 w-4" />Ver cliente</Link></Button>
        )}
        {wa && (
          <Button size="sm" asChild data-testid="button-responder"><a href={wa} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Responder</a></Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(36_30%_95%)] px-3 py-4 sm:px-6" data-testid="list-conversacion">
        {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Cargando conversación…</p>}
        {grupos.map((g) => (
          <div key={g.dia} className="space-y-1.5">
            <div className="flex justify-center py-2">
              <span className="rounded-lg bg-white/95 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm">{g.dia}</span>
            </div>
            {g.items.map((m) => (
              <div key={m.id} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] rounded-xl px-3 py-2 text-[15px] shadow-sm ${m.direccion === "saliente" ? "bg-[hsl(130_45%_88%)] rounded-tr-sm" : "bg-white rounded-tl-sm"}`}>
                  <Contenido m={m} url={m.media_path ? urls[m.media_path] : undefined} onCargar={alCargarFoto} />
                  <p className="mt-0.5 text-right text-[11px] text-muted-foreground tabular-nums">{horaCorta(m.enviado_en)}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={fin} />
      </div>
      <footer className="border-t bg-card px-4 py-2.5 text-center text-xs text-muted-foreground">
        Se responde desde WhatsApp Business en el teléfono; la respuesta aparece aquí sola en unos segundos.
      </footer>
    </>
  );
}

function Contenido({ m, url, onCargar }: { m: Msg; url?: string; onCargar?: () => void }) {
  const p = partes(m.texto);
  if (!p.clase) return <p className="whitespace-pre-wrap break-words">{m.texto}</p>;
  const pie = p.clase === "documento" && p.texto === m.media_nombre ? "" : p.texto;
  let cuerpo: React.ReactNode;
  if (!url) {
    cuerpo = (
      <div className="flex w-[240px] max-w-full items-center gap-2 rounded-lg bg-muted/70 px-3 py-3 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
        <span>{m.media_path ? "Cargando…" : `${ETIQUETA[p.clase]} (llegó antes de activar los archivos)`}</span>
      </div>
    );
  } else if (p.clase === "foto") {
    cuerpo = (
      <a href={url} target="_blank" rel="noreferrer" className="block" data-testid={`foto-${m.id}`}>
        <img src={url} alt={p.texto || "Foto enviada por WhatsApp"} onLoad={onCargar} className="max-h-80 w-full max-w-[280px] rounded-lg bg-muted object-cover" />
      </a>
    );
  } else if (p.clase === "video") {
    cuerpo = (
      <video src={url} controls playsInline preload="metadata" onLoadedMetadata={onCargar} className="max-h-80 w-[280px] max-w-full rounded-lg bg-black" data-testid={`video-${m.id}`} />
    );
  } else if (p.clase === "audio") {
    cuerpo = <audio src={url} controls preload="metadata" className="w-[260px] max-w-full" data-testid={`audio-${m.id}`} />;
  } else {
    const nombre = m.media_nombre || "Documento";
    const descarga = `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(nombre)}`;
    cuerpo = (
      <div className="flex w-[280px] max-w-full items-center gap-3 rounded-lg bg-black/[.04] p-2.5" data-testid={`doc-${m.id}`}>
        <span className="grid h-11 w-10 shrink-0 place-items-center rounded-md bg-[hsl(var(--solido-rojo))] text-[10px] font-bold text-white">{extension(m.media_nombre, m.media_mime) || <FileText className="h-4 w-4" />}</span>
        <div className="min-w-0 flex-1">
          <a href={url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold hover:underline">{nombre}</a>
          <p className="text-xs text-muted-foreground">{[extension(m.media_nombre, m.media_mime), tamano(m.media_bytes)].filter(Boolean).join(" · ")}</p>
        </div>
        <a href={descarga} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-black/5" aria-label={`Descargar ${nombre}`}><Download className="h-4 w-4" /></a>
      </div>
    );
  }
  return (
    <div className="-mx-1 -mt-0.5">
      {cuerpo}
      {pie && <p className="mt-1.5 px-1 whitespace-pre-wrap break-words">{pie}</p>}
    </div>
  );
}
