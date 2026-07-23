# n8n · Workflows del Motor de Ventas ADM

n8n es el **orquestador visual** (auto-hospedado) que hace correr el sistema 24/7 sin depender de ningún chat abierto. Cada workflow es un cron o un webhook. Abre n8n en `http://localhost:5678` (usuario/clave del `.env`) y crea estos flujos. El `BUILD_PLAN.md` incluye el prompt para que Claude Code te genere el JSON importable de cada uno.

Zona horaria de todos los crons: **America/Chihuahua**.

## Workflows (crons)

| # | Workflow | Disparador | Qué hace |
|---|----------|-----------|----------|
| 1 | **prospeccion_diaria** | Cron diario 07:00 | Ejecuta `services/scraper` (verticales × ciudades), escribe leads nuevos con dedupe. |
| 2 | **calificacion_horaria** | Cron cada hora | Ejecuta `agent/qualify.js`: puntúa leads `descubierta` → `calificada`/`descartada`. |
| 3 | **secuencias_outreach** | Cron cada 15 min | Revisa `secuencia_inscripciones` con `proximo_toque_en <= now()` dentro del horario permitido; genera/aprueba/envía el toque (email→WhatsApp→voz). Respeta `do_not_contact` y `human_in_the_loop`. |
| 4 | **inscribir_calificados** | Cron cada hora | Inscribe leads `calificada` sin secuencia en la cadencia base (o la de su vertical). |
| 5 | **llamadas_tibios** | Cron 11:00 y 16:00 | Toma leads que abrieron/respondieron pero no agendaron y encola llamadas de voz (SIP) al PBX. |
| 6 | **webhook_respuestas** | Webhook (Resend/WhatsApp) | Entra respuesta → guarda mensaje entrante → `agent/reply.js` maneja objeción o agenda. |
| 7 | **webhook_calcom** | Webhook (Cal.com) | Al crearse una cita → actualiza lead a `cita_agendada`, crea `citas`, dispara handoff a Fernando. |
| 8 | **reporte_diario** | Cron diario 20:00 | Arma el resumen del día (KPIs, citas, próximas ejecuciones) y lo envía por email/WhatsApp a Fernando. |

## Registro de ejecuciones
Todos los crons escriben en la tabla `ejecuciones` (job, estado, items, resumen). El dashboard lee de ahí para el widget **"próximas ejecuciones automáticas"** que demuestra que el sistema corre solo.

## Compliance en cada envío (obligatorio)
Antes de enviar cualquier mensaje, el workflow verifica:
1. El contacto **no** está en `do_not_contact` (`SELECT esta_suprimido(email, telefono)`).
2. Estamos dentro del `horario_envio` configurado.
3. No se excede `cadencia_max_toques` (3).
4. El mensaje incluye identificación como asesora digital de ADM + opt-out + aviso de privacidad.
5. Si `human_in_the_loop = true`, el mensaje queda en `borrador` para aprobación en el dashboard.
