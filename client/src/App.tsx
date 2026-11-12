import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useDetecciones } from "@/lib/crm";
import Login, { Marca } from "@/pages/login";
import Inicio from "@/pages/inicio";
import Bandeja from "@/pages/bandeja";
import Documentos from "@/pages/documentos";
import DocumentoEditor from "@/pages/documento";
import Clientes, { ClienteDetalle } from "@/pages/clientes";
import Importar from "@/pages/importar";
import { Catalogo, Equipo, WhatsappConfig } from "@/pages/admin";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Home, Inbox, FileText, ShoppingBag, Users, Upload, Package, UserCog, MessageCircle, LogOut, Menu, Loader2 } from "lucide-react";

const NAV = [
  { href: "/", label: "Hoy", icon: Home },
  { href: "/bandeja", label: "Bandeja WhatsApp", icon: Inbox, badge: true },
  { href: "/cotizaciones", label: "Cotizaciones", icon: FileText },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/importar", label: "Importar chats", icon: Upload },
];
const NAV_ADMIN = [
  { href: "/catalogo", label: "Catálogo", icon: Package },
  { href: "/equipo", label: "Equipo", icon: UserCog },
  { href: "/whatsapp", label: "Conexión WhatsApp", icon: MessageCircle },
];

function Navegacion({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  const { perfil, salir } = useAuth();
  const { data: pendientes } = useDetecciones("pendiente");
  const activo = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));
  const item = (n: { href: string; label: string; icon: any; badge?: boolean }) => (
    <Link key={n.href} href={n.href} onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors ${activo(n.href) ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-muted"}`}
      data-testid={`link-nav-${n.href.replace("/", "") || "hoy"}`}>
      {activo(n.href) && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary" aria-hidden />}
      <n.icon className={`h-[18px] w-[18px] shrink-0 ${activo(n.href) ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
      <span className="flex-1 min-w-0">{n.label}</span>
      {n.badge && (pendientes?.length ?? 0) > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums" data-testid="badge-pendientes">{pendientes!.length}</span>
      )}
    </Link>
  );
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="h-1.5 franjas shrink-0" aria-hidden />
      <div className="px-5 pt-5 pb-6"><Marca /></div>
      <nav className="flex-1 space-y-0.5 px-3 overflow-y-auto">
        {NAV.map(item)}
        {perfil?.rol === "admin" && (
          <>
            <p className="px-3 pt-6 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Administración</p>
            {NAV_ADMIN.map(item)}
          </>
        )}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--marca-ciruela)/.12)] text-sm font-bold text-[hsl(var(--marca-ciruela))]" aria-hidden>{(perfil?.nombre ?? "?").trim().charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" data-testid="text-usuario">{perfil?.nombre}</p>
            <p className="text-xs text-muted-foreground">{perfil?.rol === "admin" ? "Administradora" : "Ventas"}</p>
          </div>
        </div>
        <button onClick={salir} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-salir">
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="hidden lg:block sticky top-0 h-screen"><Navegacion /></aside>
      <div className="min-w-0">
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between border-b bg-card/95 backdrop-blur px-4 h-16">
          <Marca tamano="sm" />
          <Sheet open={abierto} onOpenChange={setAbierto}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menú" data-testid="button-menu"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[280px] border-0">
              <SheetTitle className="sr-only">Menú</SheetTitle>
              <Navegacion onNavigate={() => setAbierto(false)} />
            </SheetContent>
          </Sheet>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

function Rutas() {
  const { session, perfil, cargando, salir } = useAuth();
  if (cargando) return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!session) return <Login />;
  if (!perfil || !perfil.activo)
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <Marca />
          <p className="text-sm text-muted-foreground">Tu cuenta no tiene acceso activo al CRM. Pide a la administradora que revise tu usuario en Equipo.</p>
          <Button variant="outline" onClick={salir}>Cerrar sesión</Button>
        </div>
      </div>
    );
  const esAdmin = perfil.rol === "admin";
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Inicio} />
        <Route path="/bandeja" component={Bandeja} />
        <Route path="/cotizaciones">{() => <Documentos tipo="cotizacion" />}</Route>
        <Route path="/pedidos">{() => <Documentos tipo="pedido" />}</Route>
        <Route path="/nuevo/:tipo">{(p) => <DocumentoEditor nuevoTipo={p.tipo as any} />}</Route>
        <Route path="/documento/:id">{(p) => <DocumentoEditor id={p.id} />}</Route>
        <Route path="/clientes" component={Clientes} />
        <Route path="/clientes/:id">{(p) => <ClienteDetalle id={p.id} />}</Route>
        <Route path="/importar" component={Importar} />
        {esAdmin && <Route path="/catalogo" component={Catalogo} />}
        {esAdmin && <Route path="/equipo" component={Equipo} />}
        {esAdmin && <Route path="/whatsapp" component={WhatsappConfig} />}
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <Rutas />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
