import { useState } from "react";
import { Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useDetecciones, useInvalidar, dinero, fechaCorta, fechaHora, waLink, type Deteccion } from "@/lib/crm";
import { Encabezado } from "./inicio";
import { prepararBorrador } from "./documento";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, ShoppingBag, X, MessageCircle, CalendarDays, MapPin, Banknote, Users, Upload } from "lucide-react";

export default function Bandeja() {
  const [estado, setEstado] = useState("pendiente");
  const { data, isLoading } = useDetecciones(estado);
  const invalidar = useInvalidar();
  const { perfil } = useAuth();
  const [, navegar] = useLocation();

  function convertir(d: Deteccion, tipo: "cotizacion" | "pedido") {
    const x = d.datos ?? {};
    const monto = x.montos?.[0];
    const notas = [x.invitados ? `${x.invitados} invitados` : "", !x.items?.length && monto ? `Monto mencionado: ${dinero(monto.valor, monto.moneda)}` : ""].filter(Boolean).join(" · ");
    prepararBorrador({
      deteccion_id: d.id, cliente_id: d.cliente_id, mensaje_origen_id: d.mensaje_id,
      fecha_evento: x.fecha_evento, hora_evento: x.hora_evento, lugar: x.lugar, moneda: monto?.moneda ?? "NIO",
      anticipo: tipo === "pedido" && x.items?.length && monto ? monto.valor : 0, notas,
      items: (x.items ?? []).map((i: any) => ({ producto_id: i.producto_id ?? null, descripcion: i.descripcion, cantidad: i.cantidad, precio_unitario: i.precio_unitario ?? 0 })),
    });
    navegar(`/nuevo/${tipo}`);
  }

  async function descartar(id: string) {
    await supabase.from("detecciones").update({ estado: "descartada", revisado_por: perfil?.id }).eq("id", id);
    invalidar("detecciones");
  }
  async function restaurar(id: string) {
    await supabase.from("detecciones").update({ estado: "pendiente" }).eq("id", id);
    invalidar("detecciones");
  }

  return (
    <div>
      <Encabezado titulo="Bandeja WhatsApp" sub="Mensajes de clientes que parecen pedidos o solicitudes de cotización. Revisa, ajusta y conviértelos." />
      <Tabs value={estado} onValueChange={setEstado} className="mb-4">
        <TabsList>
          <TabsTrigger value="pendiente" data-testid="tab-pendiente">Por revisar</TabsTrigger>
          <TabsTrigger value="convertida" data-testid="tab-convertida">Convertidos</TabsTrigger>
          <TabsTrigger value="descartada" data-testid="tab-descartada">Descartados</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}</div>}

      {!isLoading && !data?.length && (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{estado === "pendiente" ? "No hay mensajes por revisar" : "Nada aquí todavía"}</p>
          {estado === "pendiente" && (
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Cuando un cliente escriba pidiendo precio o confirmando un pedido, aparecerá aquí. Mientras se activa la conexión directa, puedes{" "}
              <Link href="/importar" className="text-primary hover:underline">importar o pegar chats</Link>.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {data?.map((d) => {
          const x = d.datos ?? {};
          const tel = d.clientes?.telefono ?? d.mensajes?.telefono;
          const wa = waLink(tel);
          return (
            <article key={d.id} className="rounded-xl border bg-card" data-testid={`card-deteccion-${d.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
                <div className="min-w-0">
                  {d.cliente_id ? (
                    <Link href={`/clientes/${d.cliente_id}`} className="text-sm font-semibold hover:underline">{d.clientes?.nombre ?? tel}</Link>
                  ) : <p className="text-sm font-semibold">{d.mensajes?.nombre_contacto ?? tel}</p>}
                  <p className="text-xs text-muted-foreground">{tel ? `+${tel}` : ""} · {d.mensajes ? fechaHora(d.mensajes.enviado_en) : ""}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${d.tipo_sugerido === "pedido" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
                  {d.tipo_sugerido === "pedido" ? "Posible pedido" : "Posible cotización"} · {d.confianza}%
                </span>
              </div>
              <p className="mx-4 mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm" data-testid={`text-mensaje-${d.id}`}>{d.mensajes?.texto}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pt-3 text-xs text-muted-foreground">
                {x.items?.length > 0 && <span className="text-foreground">{x.items.map((i: any) => `${i.cantidad} × ${i.descripcion}`).join(", ")}</span>}
                {x.fecha_evento && <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{fechaCorta(x.fecha_evento)}{x.hora_evento ? ` · ${x.hora_evento}` : ""}</span>}
                {x.lugar && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{x.lugar}</span>}
                {x.montos?.length > 0 && <span className="flex items-center gap-1"><Banknote className="h-3.5 w-3.5" />{x.montos.map((m: any) => dinero(m.valor, m.moneda)).join(", ")}</span>}
                {x.invitados && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{x.invitados} invitados</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t px-4 py-3">
                {estado === "pendiente" && <>
                  <Button size="sm" variant={d.tipo_sugerido === "cotizacion" ? "default" : "outline"} onClick={() => convertir(d, "cotizacion")} data-testid={`button-a-cotizacion-${d.id}`}><FileText className="h-4 w-4 mr-1" />Crear cotización</Button>
                  <Button size="sm" variant={d.tipo_sugerido === "pedido" ? "default" : "outline"} onClick={() => convertir(d, "pedido")} data-testid={`button-a-pedido-${d.id}`}><ShoppingBag className="h-4 w-4 mr-1" />Crear pedido</Button>
                  <Button size="sm" variant="ghost" onClick={() => descartar(d.id)} data-testid={`button-descartar-${d.id}`}><X className="h-4 w-4 mr-1" />No es venta</Button>
                </>}
                {estado === "convertida" && d.documento_id && <Button size="sm" variant="outline" asChild><Link href={`/documento/${d.documento_id}`}>Abrir documento</Link></Button>}
                {estado === "descartada" && <Button size="sm" variant="outline" onClick={() => restaurar(d.id)}>Volver a revisar</Button>}
                {wa && <Button size="sm" variant="ghost" asChild className="ml-auto"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-1" />Responder</a></Button>}
              </div>
            </article>
          );
        })}
      </div>
      {estado === "pendiente" && !!data?.length && (
        <p className="mt-6 text-xs text-muted-foreground flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" />¿Falta algún chat? <Link href="/importar" className="text-primary hover:underline">Impórtalo aquí</Link>.</p>
      )}
    </div>
  );
}
