import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useDocumentos, usePerfiles, ESTADOS, ESTADOS_CERRADOS, dinero, fechaCorta, hoyISO } from "@/lib/crm";
import { Encabezado, EstadoPill } from "./inicio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search } from "lucide-react";

export default function Documentos({ tipo }: { tipo: "cotizacion" | "pedido" }) {
  const { data, isLoading } = useDocumentos();
  const { data: perfiles } = usePerfiles();
  const [filtro, setFiltro] = useState<string>("abiertos");
  const [q, setQ] = useState("");
  const hoy = hoyISO();

  const propios = useMemo(() => (data ?? []).filter((d) => d.tipo === tipo), [data, tipo]);
  const conteo = (e: string) => (e === "abiertos" ? propios.filter((d) => !ESTADOS_CERRADOS.includes(d.estado)).length : e === "todos" ? propios.length : propios.filter((d) => d.estado === e).length);
  const lista = propios
    .filter((d) => (filtro === "abiertos" ? !ESTADOS_CERRADOS.includes(d.estado) : filtro === "todos" ? true : d.estado === filtro))
    .filter((d) => !q || [d.numero, d.clientes?.nombre, d.clientes?.telefono, d.lugar].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => tipo === "pedido" ? (a.fecha_evento ?? "9999").localeCompare(b.fecha_evento ?? "9999") : (a.proximo_seguimiento ?? "9999").localeCompare(b.proximo_seguimiento ?? "9999"));
  const totalLista = lista.reduce((s, d) => s + (d.moneda === "NIO" ? Number(d.total) : 0), 0);

  const chips = [{ valor: "abiertos", etiqueta: "Abiertos" }, ...ESTADOS[tipo], { valor: "todos", etiqueta: "Todos" }];

  return (
    <div>
      <Encabezado
        titulo={tipo === "cotizacion" ? "Cotizaciones" : "Pedidos"}
        sub={tipo === "cotizacion" ? "Ordenadas por próximo seguimiento." : "Ordenados por fecha del evento."}
        acciones={<Button asChild data-testid="button-nuevo"><Link href={`/nuevo/${tipo}`}><Plus className="h-4 w-4 mr-1" />{tipo === "cotizacion" ? "Nueva cotización" : "Nuevo pedido"}</Link></Button>}
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button key={c.valor} onClick={() => setFiltro(c.valor)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filtro === c.valor ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
              data-testid={`chip-${c.valor}`}>
              {c.etiqueta} <span className="opacity-70 tabular-nums">{conteo(c.valor)}</span>
            </button>
          ))}
        </div>
        <div className="relative md:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar cliente o número" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-buscar" />
        </div>
      </div>

      <div className="overflow-hidden tarjeta">
        <div className="hidden md:grid grid-cols-[90px_1.4fr_110px_120px_120px_110px] gap-3 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>Número</span><span>Cliente</span><span>Evento</span><span className="text-right">{tipo === "pedido" ? "Saldo" : "Total"}</span><span>Seguimiento</span><span>Estado</span>
        </div>
        {isLoading && <div className="p-4 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
        {!isLoading && !lista.length && <p className="px-4 py-12 text-center text-sm text-muted-foreground">No hay {tipo === "cotizacion" ? "cotizaciones" : "pedidos"} en esta vista.</p>}
        <div className="divide-y">
          {lista.map((d) => {
            const vencido = d.proximo_seguimiento && d.proximo_seguimiento < hoy && !ESTADOS_CERRADOS.includes(d.estado);
            const resp = perfiles?.find((p) => p.id === d.asignado_a)?.nombre;
            return (
              <Link key={d.id} href={`/documento/${d.id}`} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/50 md:grid-cols-[90px_1.4fr_110px_120px_120px_110px] md:items-center" data-testid={`row-documento-${d.id}`}>
                <span className="text-xs font-medium text-muted-foreground md:text-sm md:text-foreground order-2 md:order-none text-right md:text-left">{d.numero}</span>
                <div className="min-w-0 order-1 md:order-none">
                  <p className="text-sm font-medium truncate">{d.clientes?.nombre ?? "Sin cliente"}</p>
                  <p className="text-xs text-muted-foreground truncate">{resp ? `Resp.: ${resp}` : "Sin asignar"}{d.lugar ? ` · ${d.lugar}` : ""}</p>
                </div>
                <span className="text-sm order-3 md:order-none">{d.fecha_evento ? fechaCorta(d.fecha_evento) : <span className="text-muted-foreground">—</span>}</span>
                <span className="text-sm font-medium tabular-nums text-right order-4 md:order-none">{dinero(tipo === "pedido" ? d.total - d.anticipo : d.total, d.moneda)}</span>
                <span className={`text-sm order-5 md:order-none ${vencido ? "font-medium text-destructive" : ""}`}>{d.proximo_seguimiento ? fechaCorta(d.proximo_seguimiento) : <span className="text-muted-foreground">—</span>}</span>
                <span className="order-6 md:order-none text-right md:text-left"><EstadoPill d={d} /></span>
              </Link>
            );
          })}
        </div>
        {lista.length > 0 && (
          <div className="flex justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>{lista.length} {lista.length === 1 ? "registro" : "registros"}</span>
            <span>Total en córdobas de esta vista: <span className="font-semibold text-foreground tabular-nums">{dinero(totalLista)}</span></span>
          </div>
        )}
      </div>
    </div>
  );
}
