import { Link } from "wouter";
import { useDocumentos, useDetecciones, ESTADOS_CERRADOS, hoyISO, fechaCorta, dinero, etiquetaEstado, tonoEstado, type Documento } from "@/lib/crm";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Inbox, CalendarClock, PartyPopper, ArrowRight } from "lucide-react";

export function Encabezado({ titulo, sub, acciones }: { titulo: string; sub?: string; acciones?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-titulo">{titulo}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
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
    <Link href={`/documento/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors" data-testid={`row-doc-${d.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{d.clientes?.nombre ?? "Sin cliente"}</p>
        <p className="text-xs text-muted-foreground truncate">{d.numero}{detalle ? <> · {detalle}</> : null}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium tabular-nums">{dinero(d.total, d.moneda)}</p>
        <EstadoPill d={d} />
      </div>
    </Link>
  );
}

function Panel({ titulo, icono: Icono, children, vacio, enlace }: { titulo: string; icono: any; children: React.ReactNode[] | React.ReactNode; vacio: string; enlace?: { href: string; label: string } }) {
  const lista = Array.isArray(children) ? children : [children];
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icono className="h-4 w-4 text-primary" />{titulo}</h2>
        {enlace && <Link href={enlace.href} className="text-xs font-medium text-primary hover:underline flex items-center gap-1">{enlace.label}<ArrowRight className="h-3 w-3" /></Link>}
      </div>
      {lista.length ? <div className="divide-y">{lista}</div> : <p className="px-4 py-8 text-center text-sm text-muted-foreground">{vacio}</p>}
    </section>
  );
}

export default function Inicio() {
  const { perfil } = useAuth();
  const { data: docs, isLoading } = useDocumentos();
  const { data: det } = useDetecciones("pendiente");
  const hoy = hoyISO();
  const en14 = new Date(); en14.setDate(en14.getDate() + 14);
  const lim = en14.toISOString().slice(0, 10);

  const abiertos = (docs ?? []).filter((d) => !ESTADOS_CERRADOS.includes(d.estado));
  const seguimientos = abiertos.filter((d) => d.proximo_seguimiento && d.proximo_seguimiento <= hoy).sort((a, b) => a.proximo_seguimiento!.localeCompare(b.proximo_seguimiento!));
  const sinSeguimiento = abiertos.filter((d) => d.tipo === "cotizacion" && !d.proximo_seguimiento);
  const eventos = (docs ?? []).filter((d) => d.tipo === "pedido" && d.estado !== "cancelado" && d.fecha_evento && d.fecha_evento >= hoy && d.fecha_evento <= lim).sort((a, b) => a.fecha_evento!.localeCompare(b.fecha_evento!));
  const cotAbiertas = abiertos.filter((d) => d.tipo === "cotizacion");
  const fechaLarga = new Date().toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long" });

  const cifras = [
    { label: "Por revisar en WhatsApp", valor: det?.length ?? 0, href: "/bandeja" },
    { label: "Seguimientos pendientes", valor: seguimientos.length, href: "/cotizaciones" },
    { label: "Eventos en 14 días", valor: eventos.length, href: "/pedidos" },
    { label: "Cotizaciones abiertas", valor: cotAbiertas.length, href: "/cotizaciones" },
  ];

  return (
    <div>
      <Encabezado
        titulo={`Hola, ${perfil?.nombre?.split(" ")[0] ?? ""}`}
        sub={fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1)}
        acciones={<>
          <Button variant="outline" asChild data-testid="button-nueva-cotizacion"><Link href="/nuevo/cotizacion"><Plus className="h-4 w-4 mr-1" />Cotización</Link></Button>
          <Button asChild data-testid="button-nuevo-pedido"><Link href="/nuevo/pedido"><Plus className="h-4 w-4 mr-1" />Pedido</Link></Button>
        </>}
      />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {cifras.map((c) => (
          <Link key={c.label} href={c.href} className="bg-card px-4 py-3.5 hover:bg-muted/50" data-testid={`stat-${c.label}`}>
            <p className="text-xs text-muted-foreground">{c.label}</p>
            {isLoading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-0.5 text-xl font-semibold tabular-nums">{c.valor}</p>}
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel titulo="Dar seguimiento hoy" icono={CalendarClock} vacio="Nada vencido. Buen trabajo." enlace={{ href: "/cotizaciones", label: "Ver todo" }}>
          {seguimientos.slice(0, 8).map((d) => (
            <FilaDoc key={d.id} d={d} detalle={d.proximo_seguimiento! < hoy ? <span className="text-destructive font-medium">vencido {fechaCorta(d.proximo_seguimiento)}</span> : "hoy"} />
          ))}
        </Panel>
        <Panel titulo="Próximos eventos" icono={PartyPopper} vacio="No hay pedidos con evento en los próximos 14 días." enlace={{ href: "/pedidos", label: "Pedidos" }}>
          {eventos.slice(0, 8).map((d) => <FilaDoc key={d.id} d={d} detalle={`${fechaCorta(d.fecha_evento)}${d.hora_evento ? " · " + d.hora_evento : ""}`} />)}
        </Panel>
        <Panel titulo="Detectado en WhatsApp" icono={Inbox} vacio="Sin mensajes nuevos por revisar." enlace={{ href: "/bandeja", label: "Abrir bandeja" }}>
          {(det ?? []).slice(0, 5).map((x) => (
            <Link key={x.id} href="/bandeja" className="block px-4 py-3 hover:bg-muted/60" data-testid={`row-det-${x.id}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{x.clientes?.nombre ?? x.mensajes?.telefono}</p>
                <span className="text-xs text-muted-foreground shrink-0">{x.tipo_sugerido === "pedido" ? "Posible pedido" : "Posible cotización"}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{x.mensajes?.texto}</p>
            </Link>
          ))}
        </Panel>
        <Panel titulo="Cotizaciones sin fecha de seguimiento" icono={CalendarClock} vacio="Todas tienen seguimiento programado.">
          {sinSeguimiento.slice(0, 6).map((d) => <FilaDoc key={d.id} d={d} detalle={`creada ${fechaCorta(d.creado_en)}`} />)}
        </Panel>
      </div>
    </div>
  );
}
