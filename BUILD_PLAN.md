# BUILD_PLAN.md · Construcción módulo por módulo

Sigue los módulos **en orden**. Cada uno trae un **prompt listo** para pegar en Claude Code. No brinques etapas: cada módulo asume que el anterior ya corre. Marca ✅ cuando termines.

Leyenda de estado: ✅ ya viene hecho y validado · ⏳ lo construyes tú con el prompt.

---

## Módulo 1 · db-schema ✅
Esquema Postgres + semillas (verticales, secuencias, config) ya validados.
**Comprobación:** `DATABASE_URL=... ./db/run.sh --con-semillas` corre sin errores y `SELECT * FROM v_kpis;` responde.

---

## Módulo 2 · scraper-service ✅
Prospección Google Places (Node ESM) con dedupe y escritura a la DB.
**Prompt para ampliar (enriquecimiento):**
> En `services/scraper` agrega `src/enriquecer.js`: para cada lead con `sitio_web`, hace un `fetch` del home, detecta si la web es responsiva (meta viewport), estima antigüedad (framework/tecnología) y si hay pixel de Meta/Google (corre_anuncios). Actualiza `web_responsiva` y `corre_anuncios`. Respeta un timeout de 8s por sitio y no rompas si el sitio no responde.

---

## Módulo 3 · agent-core (offer + personalize + reply) ✅
Ya existen `qualify.js` (calificar) y `offer.js` (armar oferta a la medida ✅). Faltan `personalize.js` y `reply.js`.

**Flujo del pipeline (coincide con el tablero del dashboard):**
`descubierta` → *qualify* → `calificada` (+ *offer* arma la oferta) → *personalize* redacta y *outreach* envía por 3 canales → `contactada` → respuesta → `en_conversacion` → *booking* → `cita_agendada` → `handoff`.

`personalize.js` debe **leer la `oferta`** del lead (columna `leads.oferta`) para que los mensajes de correo/WhatsApp/voz vayan alineados con la necesidad y el paquete detectados.

**Prompt:**
> Usando `agent/src/anthropic.js` y los prompts `agent/prompts/personalize.md` y `reply.md`, crea:
> 1. `agent/src/personalize.js`: recibe un `lead_id`, arma el contexto (lead + vertical + config), llama a Claude Sonnet y **crea un registro en `mensajes`** en estado `borrador` (o `aprobado` si `human_in_the_loop=false` y score ≥ `auto_enviar_score_min`). Rellena variables ({{empresa}}, {{hallazgo}}, {{prueba_social}}, {{opt_out}}, firma, aviso de privacidad).
> 2. `agent/src/reply.js`: recibe un `lead_id` con un mensaje entrante nuevo, arma el historial, llama a Sonnet con `reply.md` y ejecuta la `accion` devuelta (responder/agendar/handoff/opt_out). Si es `opt_out`, inserta en `do_not_contact`. Si es `handoff`, marca el lead `handoff` y crea evento con `notas_para_humano`.
> Antes de insertar cualquier mensaje saliente, verifica `esta_suprimido()` y la ventana de `horario_envio`.

---

## Módulo 4 · verticales ✅
Tabla `verticales` con dolor/ángulo/servicio/persona/prueba_social por giro, ya sembrada (10 verticales). Editable desde el dashboard.

---

## Módulo 5 · outreach-email (Resend) ✅
**Prompt:**
> Crea `services/outreach/src/email.js` (Node ESM). Función `enviarPendientes()`: toma `mensajes` con `canal='email'` y `estado IN ('aprobado','programado')` cuya hora de envío llegó, los manda con la API de Resend (`RESEND_API_KEY`, `EMAIL_FROM`), guarda `proveedor_msg_id`, pasa el mensaje a `enviado` y el lead a `contactada`. Maneja rebotes marcando el mensaje `rebotado` y, si es rebote duro, inserta en `do_not_contact`. Incluye header `List-Unsubscribe` con el opt-out. Registra ejecución en `ejecuciones`.

---

## Módulo 6 · booking (Cal.com) ✅
**Prompt:**
> Crea `services/booking/src/calcom.js`: (a) helper `linkCita(lead)` que genera el link de Cal.com prellenado; (b) endpoint webhook `POST /webhook/calcom` que, al evento `BOOKING_CREATED`, ubica el lead por email, inserta en `citas`, cambia el lead a `cita_agendada`, crea evento y dispara handoff a Fernando (email/WhatsApp). Valida la firma del webhook de Cal.com.

---

## Módulo 7 · dashboard (Next.js) ⏳
Ya tienes el panel funcional de una sola página en `dashboard/` (HTML). Conviértelo en app real.
**Prompt:**
> Crea una app Next.js (App Router) en `dashboard/` que reproduzca las secciones del panel HTML (Panel/KPIs, Prospectos, Verticales, Secuencias, Citas, Conversaciones, Configuración) leyendo de Postgres vía route handlers. KPIs desde las vistas `v_kpis` y `v_leads_por_vertical`. La sección Conversaciones permite **aprobar/editar** mensajes en `borrador` (human-in-the-loop). Mantén modo claro/oscuro y la marca ADM. No uses localStorage.

---

## Módulo 8 · outreach-whatsapp ✅
**Prompt:**
> Crea `services/outreach/src/whatsapp.js` con WhatsApp Cloud API: enviar plantillas aprobadas, y un webhook `POST /webhook/whatsapp` (verificación con `WHATSAPP_VERIFY_TOKEN`) que guarda mensajes entrantes y dispara `agent/reply.js`. Respeta ventana de 24h de WhatsApp y usa plantillas aprobadas para el primer contacto. Opt-out "BAJA" → `do_not_contact`.

---

## Módulo 9 · voice-agent (SIP, NO Twilio) ⏳
**Prompt:**
> Crea `services/voice/` (Node ESM) que se registra como extensión SIP en el PBX propio (usa `sip.js` o `drachtio`/`jambonz` según el PBX). Flujo por llamada: audio entrante → **Deepgram** (STT es-MX) → **Claude Sonnet** (guion de `agent/prompts/reply.md`, meta = agendar) → **Cartesia** (TTS es-MX) → audio saliente. Al terminar, guarda `llamadas` (transcripcion, resumen, resultado). Si el resultado es "cita", crea el link de Cal.com y lo manda por WhatsApp. Cumple horario e identificación como asesora digital de ADM.

---

## Módulo 10 · n8n-workflows ⏳
Ver `n8n/README.md` para la lista de 8 workflows.
**Prompt:**
> Genera el JSON importable de cada workflow de `n8n/README.md` (crons en zona America/Chihuahua + webhooks). Cada workflow ejecuta el script correspondiente (Execute Command / HTTP) y escribe en `ejecuciones`. Incluye el chequeo de compliance (do_not_contact, horario, cadencia) antes de cualquier envío. Exporta los JSON a `n8n/workflows/`.

---

## Orden de arranque en producción (resumen)
1. VPS + `docker compose up -d` (Postgres + n8n).
2. `./db/run.sh --con-semillas`.
3. Cargar leads: correr scraper **o** importar la plantilla XLSX.
4. Configurar credenciales en n8n y activar los 8 workflows.
5. Dejar `human_in_the_loop=true` la primera semana; revisar borradores en el dashboard; luego automatizar.
