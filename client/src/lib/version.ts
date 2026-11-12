// Detecta si se publicó una versión nueva del CRM y recarga sola (GitHub Pages guarda la página hasta 10 min).
function scriptActual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]');
  return s ? new URL(s.src).pathname.split("/").pop() ?? null : null;
}

async function hayNueva(): Promise<boolean> {
  const actual = scriptActual();
  if (!actual) return false; // modo desarrollo
  try {
    const r = await fetch(`./index.html?v=${Date.now()}`, { cache: "no-store" });
    const html = await r.text();
    const m = html.match(/assets\/(index-[^"']+\.js)/);
    return !!m && m[1] !== actual;
  } catch { return false; }
}

function escribiendo() {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.isContentEditable) && !!(a as HTMLInputElement).value;
}

export function vigilarVersion() {
  const revisar = async () => {
    if (document.visibilityState !== "visible" || escribiendo()) return;
    if (await hayNueva()) window.location.reload();
  };
  revisar();
  document.addEventListener("visibilitychange", revisar);
  setInterval(revisar, 5 * 60 * 1000);
}
