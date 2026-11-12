import { useState } from "react";
import { Link } from "wouter";
import { useDocumentos, useDetecciones, useMensajesHoy, ESTADOS_CERRADOS, hoyISO, fechaCorta, dinero, etiquetaEstado, tonoEstado, type Documento, type Deteccion } from "@/lib/crm";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Inbox, CalendarClock, PartyPopper, ArrowRight, ShoppingBag, FileText, MessageCircle, Gift, X } from "lucide-react";

export function Encabezado({ titulo, sub, acciones }: { titulo: string; sub?: string; acciones?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] sm:text-[2rem] font-extrabold leading-tight tracking-tight" data-testid="text-titulo">{titulo}</h1>
        {sub && <p className="mt-1.5 text-[15px] text-muted-foreground">{sub}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </div>
  );
}

export function EstadoPill({ d }: { d: Pick<Documento, "tipo" | "estado"> }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tonoEstado(d.estado)}`}>{etiquetaEstado(d.tipo, d.estado)}</span>;
}

export function FilaDoc({ d, detalle }: { d: Documento; detalle?: React.ReactNode }) {
  return (
    <Link href={`/documento/${d.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/60 transition-colors" data-testid={`row-doc-${d.id}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${d.tipo === "pedido" ? "bg-[hsl(var(--solido-verde))] text-white" : "bg-[hsl(var(--solido-azul))] text-white"}`} aria-hidden>
        {d.tipo === "pedido" ? <ShoppingBag className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold truncate">{d.clientes?.nombre ?? "Sin cliente"}</p>
        <p className="text-xs text-muted-foreground truncate">{d.numero}{detalle ? <> · {detalle}</> : null}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[15px] font-semibold tabular-nums">{dinero(d.total, d.moneda)}</p>
        <EstadoPill d={d} />
      </div>
    </Link>
  );
}

function Panel({ titulo, icono: Icono, color = "rojo", children, vacio, enlace, cuenta }: { titulo: string; icono: any; color?: string; children: React.ReactNode[] | React.ReactNode; vacio: string; enlace?: { href: string; label: string }; cuenta?: number }) {
  const lista = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 text-white" style={{ background: `hsl(var(--solido-${color}))` }}>
        <h2 className="flex items-center gap-2.5 text-base font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/20"><Icono className="h-4 w-4" /></span>
          <span className="min-w-0">{titulo}</span>
          {cuenta !== undefined && <span className="rounded-full bg-white px-2 py-0.5 text-sm font-extrabold tabular-nums leading-none" style={{ color: `hsl(var(--solido-${color}))` }} data-testid={`cuenta-${titulo}`}>{cuenta}</span>}
        </h2>
        {enlace && <Link href={enlace.href} className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold hover:bg-white/25 flex items-center gap-1 shrink-0">{enlace.label}<ArrowRight className="h-3.5 w-3.5" /></Link>}
      </div>
      {lista.length ? <div className="divide-y">{lista}</div> : (
        <div className="m-5 rounded-xl border border-dashed px-4 py-7 text-center text-sm text-muted-foreground" style={{ background: `hsl(var(--marca-${color}) / .05)`, borderColor: `hsl(var(--marca-${color}) / .3)` }}>{vacio}</div>
      )}
    </section>
  );
}

function FilaChatSeguir({ x, hoy }: { x: Deteccion; hoy: string }) {
  return (
    <Link href="/bandeja" className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/60 transition-colors" data-testid={`row-seguir-${x.id}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--solido-rojo))] text-white" aria-hidden><MessageCircle className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold truncate">{x.clientes?.nombre ?? x.mensajes?.telefono ?? "Cliente"}</p>
        <p className="text-xs text-muted-foreground truncate">Chat de WhatsApp · {x.seguir_el! < hoy ? <span className="text-destructive font-medium">vencido {fechaCorta(x.seguir_el)}</span> : "hoy"}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{x.tipo_sugerido === "pedido" ? "Posible pedido" : "Posible cotización"}</span>
    </Link>
  );
}

const PASOS_BIENVENIDA: [string, string, string][] = [
  ["Bandeja", "Los mensajes de WhatsApp que parecen venta caen aquí solos. Conviértelos en cotización o pedido, ponles fecha de seguimiento o márcalos como «No es venta».", "/bandeja"],
  ["Mensajes", "Todas las conversaciones en el mismo orden que WhatsApp, con fotos, videos y documentos. Las respuestas se siguen enviando desde el teléfono.", "/mensajes"],
  ["Dar seguimiento hoy", "Cada día aquí en Inicio verás a quién toca escribirle y los eventos de los próximos 14 días.", "/"],
];

function Bienvenida({ usuarioId, nombre }: { usuarioId?: string; nombre: string }) {
  const clave = usuarioId ? `pb-bienvenida-${usuarioId}` : null;
  const [visto, setVisto] = useState(() => { try { return !clave || localStorage.getItem(clave) === "1"; } catch { return false; } });
  if (!clave || visto) return null;
  const cerrar = () => { try { localStorage.setItem(clave, "1"); } catch {} setVisto(true); };
  return (
    <section className="tarjeta relative mb-6 overflow-hidden" data-testid="card-bienvenida">
      <div className="bg-[hsl(var(--solido-ciruela))] px-6 py-5 text-white sm:px-7">
        <button type="button" onClick={cerrar} aria-label="Cerrar bienvenida" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-white/90 hover:bg-white/15" data-testid="button-cerrar-bienvenida"><X className="h-5 w-5" /></button>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-white/85">Party Box</p>
        <h2 className="mt-1 pr-10 font-display text-2xl sm:text-[1.75rem] font-extrabold leading-tight">Te damos la bienvenida{nombre ? `, ${nombre}` : ""}</h2>
        <p className="mt-1.5 max-w-2xl text-[15px] text-white/95">Este es el CRM de Party Box: los mensajes de WhatsApp llegan solos y aquí se convierten en cotizaciones y pedidos para no perder a ningún cliente.</p>
      </div>
      <ol className="grid gap-px bg-border sm:grid-cols-3">
        {PASOS_BIENVENIDA.map(([t, d, href], i) => (
          <li key={t} className="bg-card p-5">
            <Link href={href} className="group block" onClick={href === "/" ? cerrar : undefined}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--solido-ciruela))] text-sm font-bold text-white">{i + 1}</span>
              <p className="mt-2.5 font-semibold group-hover:underline">{t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex justify-end border-t px-5 py-3"><Button size="sm" onClick={cerrar} data-testid="button-entendido">Entendido</Button></div>
    </section>
  );
}

export default function Inicio() {
  const { perfil } = useAuth();
  const { data: docs, isLoading } = useDocumentos();
  const { data: det } = useDetecciones("pendiente");
  const { data: detSeg } = useDetecciones("seguimiento");
  const { data: hoyMsg, isLoading: cargandoHoy } = useMensajesHoy();
  const hoy = hoyISO();
  const en14 = new Date(); en14.setDate(en14.getDate() + 14);
  const lim = en14.toISOString().slice(0, 10);

  const abiertos = (docs ?? []).filter((d) => !ESTADOS_CERRADOS.includes(d.estado));
  const seguimientos = abiertos.filter((d) => d.proximo_seguimiento && d.proximo_seguimiento <= hoy).sort((a, b) => a.proximo_seguimiento!.localeCompare(b.proximo_seguimiento!));
  const chatsSeguir = (detSeg ?? []).filter((d) => d.seguir_el && d.seguir_el <= hoy).sort((a, b) => a.seguir_el!.localeCompare(b.seguir_el!));
  const totalSeguir = seguimientos.length + chatsSeguir.length;
  const sinSeguimiento = abiertos.filter((d) => d.tipo === "cotizacion" && !d.proximo_seguimiento);
  const eventos = (docs ?? []).filter((d) => d.tipo === "pedido" && d.estado !== "cancelado" && d.fecha_evento && d.fecha_evento >= hoy && d.fecha_evento <= lim).sort((a, b) => a.fecha_evento!.localeCompare(b.fecha_evento!));
  const cotAbiertas = abiertos.filter((d) => d.tipo === "cotizacion");
  const fechaLarga = new Date().toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long" });

  const nombre = perfil?.nombre?.split(" ")[0] ?? "";
  const resumen = (det?.length ?? 0) + totalSeguir === 0
    ? "Todo al día. Cuando entre un pedido por WhatsApp aparecerá aquí."
    : `Tienes ${det?.length ?? 0} ${(det?.length ?? 0) === 1 ? "mensaje" : "mensajes"} por revisar y ${totalSeguir} ${totalSeguir === 1 ? "seguimiento" : "seguimientos"} para hoy.`;

  return (
    <div>
      <Bienvenida usuarioId={perfil?.id} nombre={nombre} />
      <section className="tarjeta relative mb-6 overflow-hidden">
        <div className="h-2 franjas" aria-hidden />
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1)}</p>
            <h1 className="mt-1 font-display text-[2rem] sm:text-[2.5rem] font-extrabold leading-[1.05] tracking-tight" data-testid="text-titulo">Hola, {nombre}</h1>
            <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">{resumen}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/mensajes" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--solido-rojo))] px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 tabular-nums" data-testid="chip-mensajes-hoy">
                <MessageCircle className="h-4 w-4" />
                {cargandoHoy ? "Mensajes de hoy…" : `Hoy: ${hoyMsg?.recibidos ?? 0} ${(hoyMsg?.recibidos ?? 0) === 1 ? "recibido" : "recibidos"} · ${hoyMsg?.respondidos ?? 0} ${(hoyMsg?.respondidos ?? 0) === 1 ? "respondido" : "respondidos"}`}
              </Link>
              <Link href="/cotizaciones" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--solido-azul))] px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 tabular-nums" data-testid="chip-cotizaciones">
                <FileText className="h-4 w-4" />
                {isLoading ? "Cotizaciones…" : `${cotAbiertas.length} ${cotAbiertas.length === 1 ? "cotización abierta" : "cotizaciones abiertas"}`}
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" size="lg" asChild data-testid="button-nueva-cotizacion"><Link href="/nuevo/cotizacion"><Plus className="h-4 w-4 mr-1" />Cotización</Link></Button>
            <Button size="lg" asChild data-testid="button-nuevo-pedido"><Link href="/nuevo/pedido"><Gift className="h-4 w-4 mr-1.5" />Nuevo pedido</Link></Button>
          </div>
        </div>
      </section>


      <div className="grid gap-5 lg:grid-cols-2">
        <Panel titulo="Dar seguimiento hoy" icono={CalendarClock} color="ocre" cuenta={totalSeguir} vacio="Nada vencido. Buen trabajo." enlace={{ href: "/cotizaciones", label: "Ver todo" }}>
          {chatsSeguir.slice(0, 8).map((x) => <FilaChatSeguir key={x.id} x={x} hoy={hoy} />)}
          {seguimientos.slice(0, Math.max(0, 8 - chatsSeguir.length)).map((d) => (
            <FilaDoc key={d.id} d={d} detalle={d.proximo_seguimiento! < hoy ? <span className="text-destructive font-medium">vencido {fechaCorta(d.proximo_seguimiento)}</span> : "hoy"} />
          ))}
        </Panel>
        <Panel titulo="Próximos eventos" icono={PartyPopper} color="verde" cuenta={eventos.length} vacio="No hay pedidos con evento en los próximos 14 días." enlace={{ href: "/pedidos", label: "Pedidos" }}>
          {eventos.slice(0, 8).map((d) => <FilaDoc key={d.id} d={d} detalle={`${fechaCorta(d.fecha_evento)}${d.hora_evento ? " · " + d.hora_evento : ""}`} />)}
        </Panel>
        <Panel titulo="Detectado en WhatsApp" icono={Inbox} color="rojo" cuenta={det?.length ?? 0} vacio="Sin mensajes nuevos por revisar." enlace={{ href: "/bandeja", label: "Abrir bandeja" }}>
          {(det ?? []).slice(0, 5).map((x) => (
            <Link key={x.id} href="/bandeja" className="block px-5 py-3.5 hover:bg-muted/60" data-testid={`row-det-${x.id}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-semibold truncate">{x.clientes?.nombre ?? x.mensajes?.telefono}</p>
                <span className="text-xs text-muted-foreground shrink-0">{x.tipo_sugerido === "pedido" ? "Posible pedido" : "Posible cotización"}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{x.mensajes?.texto}</p>
            </Link>
          ))}
        </Panel>
        <Panel titulo="Cotizaciones sin fecha de seguimiento" icono={FileText} color="ciruela" cuenta={sinSeguimiento.length} vacio="Todas tienen seguimiento programado.">
          {sinSeguimiento.slice(0, 6).map((d) => <FilaDoc key={d.id} d={d} detalle={`creada ${fechaCorta(d.creado_en)}`} />)}
        </Panel>
      </div>
    </div>
  );
}
