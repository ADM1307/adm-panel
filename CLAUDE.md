# CLAUDE.md · Contexto del proyecto para Claude Code

> Léeme completo antes de escribir código. Este archivo es la fuente de verdad del proyecto.

## Qué estamos construyendo
El **Motor de Ventas Autónomo con IA** de **ADM — Atlas Digital Marketing** (Chihuahua, México · atlasdigitalmark.com). Un agente de IA que, **24/7 y sin depender de ningún chat abierto**:
1. **Prospecta** negocios locales que necesitan lo que vende ADM,
2. los **contacta** por correo, WhatsApp y llamada de voz,
3. **conversa** y maneja objeciones,
4. **agenda** citas de diagnóstico, y
5. hace **handoff** a un humano (Fernando) que cierra.

**Objetivo operativo del agente:** llenar la agenda de **citas calificadas** (meta: 10/semana).

## Principios NO negociables (no los cambies)
1. **Open-source y auto-hospedable.** Código 100% de ADM, editable sin programar.
2. **Costo mensual mínimo** (objetivo < $40 USD/mes): free tiers y pago por uso.
3. **La voz sale por PBX propio vía SIP** (Asterisk/FreePBX/3CX). **NO Twilio.**
4. **Cumplimiento MX (LFPDPPP):** tabla `do_not_contact`, opt-out en cada mensaje, aviso de privacidad; el agente **siempre** se identifica como asesora digital de ADM.
5. **Humano-en-el-loop configurable:** aprobar mensajes antes de enviar; flag para automatizar (`configuracion.human_in_the_loop`).

## Stack
- **Orquestador:** n8n (auto-hospedado) — crons, secuencias, webhooks.
- **Base de datos:** Postgres 16 (o Supabase).
- **IA:** Anthropic Claude — **Haiku** para calificar/clasificar, **Sonnet** para redactar/responder.
- **Prospección:** Google Places API (New), Text Search.
- **Email:** Resend. **WhatsApp:** WhatsApp Cloud API. **Agenda:** Cal.com.
- **Voz:** SIP → PBX propio + Deepgram (STT) + Claude (LLM) + Cartesia (TTS es-MX).
- **Dashboard:** Next.js (el panel HTML de una sola página es el prototipo funcional).
- **Infra:** 1 VPS corre todo (`docker-compose.yml`).

## Qué vende ADM (escalera de valor)
- **Sitios web** (pago único, entrega 48h): Plus (5 secciones, dominio, hosting, 2 correos, SEO básico) · Pro (10 secciones, landings, agenda online, catálogo, WhatsApp) · Custom (e-commerce, integraciones).
- **Marketing recurrente:** Arranque · Escala (Meta + Google Ads, automatización, contenido) · A medida.
- **Agentes de IA:** automatización de leads por WhatsApp/correo 24/7.

**Prueba social real (para mensajes):** +120 proyectos, 38+ marcas activas, ROAS 4.7×, 91% de renovación; casos: +3.2× reservas (restaurante), 1ª página de Google en 90 días (salud), +180% ventas (moda).
**Tono:** directo, resultados medibles, cero jerga. Nunca prometer resultados específicos; los casos son **referencia**.

## ICP (a quién prospectar)
Negocios locales de Chihuahua y el norte con **dolor digital evidente**. Verticales: restaurantes/bares, clínicas y consultorios (dentistas, estética, spa), inmobiliarias, retail, gimnasios/fitness, despachos (abogados, contadores), hoteles, talleres/automotriz, escuelas/cursos, salud y bienestar.
**Suben score:** sin web, web vieja/no responsiva, no corre anuncios, pocas/malas reseñas, redes abandonadas, varias sucursales.
**Anti-ICP:** sin presencia mejorable, fuera de zona, o que no puede pagar.
**Regla de mensaje:** 1 hallazgo concreto + 1 prueba social + 1 CTA de baja fricción. Cadencia máx. 3 toques con valor nuevo.

## Estructura del repo
```
db/               Esquema Postgres (migrations) + semillas (seeds) + runner
services/scraper/ Prospección Google Places (Node ESM). ✅ funcional
agent/            Núcleo IA: prompts + qualify.js (Haiku). Amplía con personalize/reply.
n8n/              Documentación de workflows (crons/webhooks) a construir en n8n.
dashboard/        Panel de control (HTML de una página → migrar a Next.js).
docs/             BLUEPRINT y material de apoyo.
docker-compose.yml  Postgres + n8n.
.env.example      Todas las variables.
BUILD_PLAN.md     Prompts módulo por módulo (síguelo en orden).
```

## Estado actual
- ✅ `db/` esquema + semillas **validados contra Postgres real** (migraciones 001 + 002).
- ✅ `services/scraper/` conecta a la DB, deduplica y escribe leads.
- ✅ `agent/`: `qualify.js` (Haiku), `offer.js` (oferta a la medida), `personalize.js` (plantillas/IA), `reply.js` (respuestas + handoff).
- ✅ `services/outreach/`: `email.js` (Resend) y `whatsapp.js` (Cloud API), con modo `--dry`. **Pipeline probado end-to-end.**
- ✅ `services/booking/calcom.js` (link + webhook). `scripts/cycle.sh` (cron gratis). Workflow n8n.
- ✅ Puede correr **GRATIS con plantillas** (sin costo de IA). Ver `docs/FREE_STACK.md`.
- ⏳ Falta: `services/voice/` (SIP, Fase 4, de pago), migrar dashboard a Next.js, más workflows n8n.

### Cómo correr el ciclo
`DRY=1 ./scripts/cycle.sh` (simula sin llaves) · `./scripts/cycle.sh` (real, lee `.env`).
Redacción gratis por defecto; `USAR_IA=true` activa Claude.

## Reglas para ti (Claude Code)
- Node **ESM** (`"type": "module"`), Node 20+. Dependencias al mínimo.
- Todo el contenido de cara al prospecto: **español de México, trato de "tú"**.
- Antes de enviar cualquier mensaje: checar `do_not_contact`, horario, cadencia y opt-out.
- No introduzcas Twilio ni servicios de voz de pago por minuto: la voz es SIP al PBX propio.
- Corre el SQL contra Postgres antes de dar por buena una migración.
