# Main flows (Party Box CRM)

## Login
- Start: / (logged out)
- Steps: enter email + password, click "Entrar"
- Expect: sidebar with "Hoy", greeting "Hola, <nombre>"

## Navegación
- Steps: click each sidebar link: Hoy, Bandeja WhatsApp, Cotizaciones, Pedidos, Clientes, Importar chats, Catálogo, Equipo, Conexión WhatsApp
- Expect: each page title renders, no console errors

## Bandeja
- Expect: tabs "Por revisar / Convertidos / Descartados", empty state or detections list

## Cotizaciones / Pedidos
- Expect: estado filter chips, search box, table; "Nueva cotización" opens editor

## Editor de documento
- Start: #/nuevo/cotizacion
- Expect: Cliente search, fechas, productos list, "Agregar línea", total, Guardar

## Clientes
- Expect: list with search; click a client -> detail with documentos, conversación WhatsApp (bubbles), bitácora

## Importar chats
- Expect: tabs pegar texto / archivo

## Admin
- Catálogo (product list + add), Equipo (members + invite), Conexión WhatsApp (YCloud guide, webhook URL copy, secret "· configurada")

## Mobile 375px
- Header with logo + menu button opens sheet nav; no horizontal overflow

# Requested change: visual redesign
- Brand logo (red gift box + stripes) visible in sidebar, mobile header, login
- Brand palette (red primary, stripe colors) applied across all pages
- Larger, more readable type; nicer stat cards and panels; all flows still work
