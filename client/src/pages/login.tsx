import { useState } from "react";
import { supabase, llamarCuentas } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export function Marca({ claro = false }: { claro?: boolean }) {
  return (
    <div className="flex items-center gap-2 select-none" aria-label="Party Box">
      <span className="grid grid-cols-2 gap-[3px]" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-[3px] bg-[hsl(333_78%_58%)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[hsl(42_92%_55%)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[hsl(174_55%_45%)]" />
        <span className="h-2.5 w-2.5 rounded-[3px] bg-[hsl(262_55%_62%)]" />
      </span>
      <span className={`font-semibold tracking-tight ${claro ? "text-white" : "text-foreground"}`}>Party Box</span>
      <span className={`text-xs font-medium ${claro ? "text-white/60" : "text-muted-foreground"}`}>CRM</span>
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
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 relative overflow-hidden">
        <Marca claro />
        <div className="relative z-10 max-w-md">
          <p className="text-xl font-semibold leading-snug text-white">Cada mensaje de WhatsApp puede ser un pedido. Que ninguno se quede sin respuesta.</p>
          <p className="mt-3 text-sm text-white/65">Pedidos, cotizaciones y seguimientos de Party Box en un solo lugar.</p>
        </div>
        <Confeti />
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={enviar} className="w-full max-w-sm space-y-5" data-testid="form-login">
          <div className="lg:hidden"><Marca /></div>
          <div>
            <h1 className="text-xl font-semibold">{modo === "entrar" ? "Iniciar sesión" : "Crear mi cuenta"}</h1>
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
          <Button type="submit" className="w-full" disabled={cargando} data-testid="button-submit">
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

function Confeti() {
  const piezas = [
    [12, 18, "333 78% 58%", 0], [72, 10, "42 92% 55%", 1], [84, 46, "174 55% 45%", 0], [30, 62, "262 55% 62%", 1],
    [60, 72, "333 78% 58%", 1], [90, 82, "42 92% 55%", 0], [8, 88, "174 55% 45%", 1], [46, 30, "42 92% 55%", 0],
  ] as const;
  return (
    <svg className="absolute inset-0 w-full h-full opacity-70" aria-hidden>
      {piezas.map(([x, y, c, f], i) =>
        f ? <circle key={i} cx={`${x}%`} cy={`${y}%`} r={7 + (i % 3) * 4} fill={`hsl(${c})`} opacity={0.55} />
          : <rect key={i} x={`${x}%`} y={`${y}%`} width={16 + (i % 2) * 8} height={16 + (i % 2) * 8} rx={4} fill={`hsl(${c})`} opacity={0.5} transform={`rotate(${i * 17})`} style={{ transformBox: "fill-box", transformOrigin: "center" }} />,
      )}
    </svg>
  );
}
