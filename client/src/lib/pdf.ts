import { jsPDF } from "jspdf";
import { dinero, fechaCorta, type Documento, type Item } from "./crm";

const ROJO: [number, number, number] = [200, 13, 26];
const GRIS: [number, number, number] = [110, 104, 98];
const TEL_NEGOCIO = "+505 8714 5688";

async function logoDataUrl(): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const r = await fetch("./partybox-logo.png");
    const b = await r.blob();
    const url: string = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.readAsDataURL(b); });
    const img = new Image(); img.src = url; await img.decode();
    return { url, w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

/** Genera el PDF de una cotización o pedido con el logo de Party Box. */
export async function pdfDocumento(d: Documento, items: Item[], cliente?: { nombre: string; telefono?: string | null } | null): Promise<File> {
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 16;
  const titulo = d.tipo === "cotizacion" ? "Cotización" : "Pedido";

  // Franja de colores de la marca
  const colores: [number, number, number][] = [[200, 13, 26], [139, 56, 108], [164, 104, 10], [52, 94, 142], [72, 105, 33]];
  const ancho = W / 40;
  for (let i = 0; i < 40; i++) { pdf.setFillColor(...colores[i % colores.length]); pdf.rect(i * ancho, 0, ancho, 3, "F"); }

  let y = 12;
  const logo = await logoDataUrl();
  if (logo) { const h = 20, w = (logo.w / logo.h) * h; pdf.addImage(logo.url, "PNG", M, y, w, h); }
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(22); pdf.setTextColor(30, 26, 24);
  pdf.text(titulo, W - M, y + 8, { align: "right" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(...GRIS);
  pdf.text(d.numero, W - M, y + 14, { align: "right" });
  pdf.text(`Fecha: ${fechaCorta(new Date().toISOString().slice(0, 10))}`, W - M, y + 19, { align: "right" });
  y += 30;

  // Datos del cliente y del evento
  const datos: [string, string][] = [];
  if (cliente?.nombre) datos.push(["Cliente", cliente.nombre]);
  if (cliente?.telefono) datos.push(["Teléfono", `+${cliente.telefono}`]);
  if (d.fecha_evento) datos.push(["Fecha del evento", `${fechaCorta(d.fecha_evento)}${d.hora_evento ? ` · ${d.hora_evento}` : ""}`]);
  if (d.lugar) datos.push(["Lugar", d.lugar]);
  pdf.setFontSize(10);
  for (const [k, v] of datos) {
    pdf.setFont("helvetica", "bold"); pdf.setTextColor(30, 26, 24); pdf.text(`${k}:`, M, y);
    pdf.setFont("helvetica", "normal"); const lineas = pdf.splitTextToSize(v, W - M * 2 - 38); pdf.text(lineas, M + 38, y);
    y += 5.5 * lineas.length;
  }
  y += 4;

  // Tabla de productos
  const cCant = M + 2, cDesc = M + 20, cPU = W - M - 42, cTot = W - M - 2;
  const encabezado = () => {
    pdf.setFillColor(...ROJO); pdf.rect(M, y, W - M * 2, 8, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(9.5); pdf.setTextColor(255, 255, 255);
    pdf.text("Cant.", cCant, y + 5.4); pdf.text("Descripción", cDesc, y + 5.4);
    pdf.text("Precio unit.", cPU, y + 5.4, { align: "right" }); pdf.text("Total", cTot, y + 5.4, { align: "right" });
    y += 8;
  };
  encabezado();
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
  items.forEach((it, i) => {
    const desc = pdf.splitTextToSize(it.descripcion, cPU - cDesc - 22);
    const alto = Math.max(7.5, desc.length * 4.6 + 3);
    if (y + alto > H - 40) { pdf.addPage(); y = M; encabezado(); pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); }
    if (i % 2 === 1) { pdf.setFillColor(247, 244, 240); pdf.rect(M, y, W - M * 2, alto, "F"); }
    pdf.setTextColor(30, 26, 24);
    pdf.text(String(Number(it.cantidad) || 0), cCant, y + 5);
    pdf.text(desc, cDesc, y + 5);
    pdf.text(dinero(Number(it.precio_unitario) || 0, d.moneda), cPU, y + 5, { align: "right" });
    pdf.text(dinero((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), d.moneda), cTot, y + 5, { align: "right" });
    y += alto;
  });
  pdf.setDrawColor(220, 214, 207); pdf.line(M, y, W - M, y); y += 7;

  // Totales
  const fila = (k: string, v: string, fuerte = false) => {
    pdf.setFont("helvetica", fuerte ? "bold" : "normal"); pdf.setFontSize(fuerte ? 13 : 10.5); pdf.setTextColor(30, 26, 24);
    pdf.text(k, cPU, y, { align: "right" }); pdf.text(v, cTot, y, { align: "right" }); y += fuerte ? 7.5 : 6;
  };
  fila("Total", dinero(d.total, d.moneda), true);
  if (d.anticipo > 0) { fila("Anticipo recibido", dinero(d.anticipo, d.moneda)); fila("Saldo", dinero(d.total - d.anticipo, d.moneda)); }

  if (d.notas?.trim()) {
    y += 4;
    if (y > H - 50) { pdf.addPage(); y = M; }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.text("Notas", M, y); y += 5;
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(...GRIS);
    const n = pdf.splitTextToSize(d.notas.trim(), W - M * 2); pdf.text(n, M, y);
  }

  // Pie
  const paginas = pdf.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
    pdf.text(`Party Box · WhatsApp ${TEL_NEGOCIO}`, M, H - 10);
    if (paginas > 1) pdf.text(`${p} / ${paginas}`, W - M, H - 10, { align: "right" });
  }

  const nombre = `PartyBox-${titulo}-${d.numero}.pdf`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "-");
  return new File([pdf.output("blob")], nombre, { type: "application/pdf" });
}

/** En el celular abre el menú de compartir (WhatsApp); en computadora descarga el archivo. */
export async function compartirODescargar(f: File, texto?: string): Promise<"compartido" | "descargado" | "cancelado"> {
  const nav = navigator as any;
  if (nav.canShare?.({ files: [f] }) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    try { await nav.share({ files: [f], title: f.name, text: texto }); return "compartido"; }
    catch (e: any) { if (e?.name === "AbortError") return "cancelado"; }
  }
  const url = URL.createObjectURL(f);
  const a = document.createElement("a"); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "descargado";
}
