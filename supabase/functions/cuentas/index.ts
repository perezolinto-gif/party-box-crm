import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let b: any; try { b = await req.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }

  if (b.accion === "registro") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");
    const nombre = String(b.nombre ?? "").trim();
    if (!email || password.length < 8) return json({ error: "Correo y contraseña (mínimo 8 caracteres) son obligatorios." }, 400);
    // Solo se registra quien tenga invitación activa (la primera fue sembrada para el administrador inicial)
    const { data: inv } = await sb.from("invitaciones").select("*").eq("email", email).is("usado_en", null).maybeSingle();
    if (!inv) return json({ error: "Este correo no tiene una invitación activa. Pide a la administradora que te agregue en Equipo." }, 403);
    const rol = inv.rol; const nom = nombre || inv.nombre;
    const { data: u, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre: nom } });
    if (error) return json({ error: error.message.includes("already") ? "Ese correo ya tiene cuenta. Inicia sesión." : error.message }, 400);
    await sb.from("perfiles").insert({ id: u.user.id, email, nombre: nom || email, rol });
    await sb.from("invitaciones").update({ usado_en: new Date().toISOString() }).eq("email", email);
    return json({ ok: true, rol });
  }

  if (b.accion === "restablecer") {
    // Solo administradores: asigna una contraseña temporal a un miembro
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    const { data: who } = await sb.auth.getUser(token);
    if (!who?.user) return json({ error: "No autorizado" }, 401);
    const { data: p } = await sb.from("perfiles").select("rol,activo").eq("id", who.user.id).single();
    if (!p || p.rol !== "admin" || !p.activo) return json({ error: "Solo administradores" }, 403);
    if (String(b.password ?? "").length < 8) return json({ error: "La contraseña temporal debe tener al menos 8 caracteres." }, 400);
    const { error } = await sb.auth.admin.updateUserById(b.usuario_id, { password: b.password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  return json({ error: "Acción desconocida" }, 400);
});
