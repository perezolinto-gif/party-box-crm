import { useState } from "react";
import { supabase, llamarCuentas } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export function Marca({ tamano = "md" }: { tamano?: "sm" | "md" | "lg"; claro?: boolean }) {
  const alto = tamano === "lg" ? "h-28" : tamano === "sm" ? "h-9" : "h-12";
  return (
    <div className="flex items-end gap-2 select-none">
      <img src="./partybox-logo.png" alt="Party Box" className={`${alto} w-auto`} draggable={false} />
      {tamano !== "lg" && <span className="mb-0.5 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-background">CRM</span>}
    </div>
  );
}

export default function Login() {
  const [modo, setModo] = useState<"entrar" | "registro">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setAviso(null); setCargando(true);
    try {
      if (modo === "registro") {
        await llamarCuentas({ accion: "registro", email, password, nombre });
        setAviso("Cuenta creada. Entrando…");
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_minmax(420px,520px)] bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-card border-r p-12 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-2 franjas" aria-hidden />
        <Marca tamano="lg" />
        <div className="relative z-10 max-w-lg">
          <p className="font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-tight">
            Cada mensaje de WhatsApp puede ser <span className="text-primary">una fiesta vendida.</span>
          </p>
          <p className="mt-4 text-base text-muted-foreground">Pedidos, cotizaciones y seguimientos de Party Box en un solo lugar.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Bandeja de WhatsApp", "Cotizaciones", "Pedidos", "Seguimiento"].map((t, i) => (
              <span key={t} className="rounded-full px-3 py-1 text-sm font-semibold text-white" style={{ background: `hsl(var(--${COLORES[i].replace("marca", "solido")}))` }}>{t}</span>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-xs text-muted-foreground">Camino de Oriente, Managua</p>
        <Confeti />
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={enviar} className="w-full max-w-sm space-y-5" data-testid="form-login">
          <div className="lg:hidden flex justify-center pb-2"><Marca /></div>
          <div>
            <h1 className="text-2xl font-bold">{modo === "entrar" ? "Iniciar sesión" : "Crear mi cuenta"}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {modo === "entrar" ? "Usa el correo con el que te invitaron." : "Solo para correos invitados por la administradora."}
            </p>
          </div>
          {modo === "registro" && (
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Tu nombre</Label>
              <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} data-testid="input-nombre" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" autoComplete={modo === "entrar" ? "current-password" : "new-password"} required minLength={modo === "registro" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
            {modo === "registro" && <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>}
          </div>
          {error && <p className="text-sm text-destructive" role="alert" data-testid="text-error">{error}</p>}
          {aviso && <p className="text-sm text-emerald-700">{aviso}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={cargando} data-testid="button-submit">
            {cargando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {modo === "entrar" ? "Entrar" : "Crear cuenta"}
          </Button>
          <button type="button" className="text-sm text-primary hover:underline" onClick={() => { setModo(modo === "entrar" ? "registro" : "entrar"); setError(null); }} data-testid="button-cambiar-modo">
            {modo === "entrar" ? "¿Te invitaron? Crea tu cuenta" : "Ya tengo cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}

const COLORES = ["marca-ciruela", "marca-rojo", "marca-ocre", "marca-azul", "marca-verde"];

function Confeti() {
  const piezas = [
    [78, 14, 0, 0], [88, 30, 1, 1], [70, 40, 2, 0], [92, 56, 3, 1], [82, 72, 4, 0], [66, 86, 0, 1], [94, 90, 1, 0], [58, 22, 3, 1],
  ] as const;
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
      {piezas.map(([x, y, c, f], i) =>
        f ? <circle key={i} cx={`${x}%`} cy={`${y}%`} r={5 + (i % 3) * 3} fill={`hsl(var(--${COLORES[c]}))`} opacity={0.5} />
          : <rect key={i} x={`${x}%`} y={`${y}%`} width={7} height={26 + (i % 2) * 10} rx={2} fill={`hsl(var(--${COLORES[c]}))`} opacity={0.55} transform={`rotate(${(i * 23) % 50 - 25})`} style={{ transformBox: "fill-box", transformOrigin: "center" }} />,
      )}
    </svg>
  );
}
