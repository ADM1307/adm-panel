# Motor de Ventas Autónomo con IA · Blueprint maestro
### ADM — Atlas Digital Marketing · Chihuahua, México · atlasdigitalmark.com

> Documento maestro de arquitectura. Es el "para qué" y el "cómo" del sistema. El repositorio de código (`CLAUDE.md` + `BUILD_PLAN.md`) es la implementación. Español de México, trato de "tú".

---

## 1. Resumen ejecutivo

Este sistema es un **agente de ventas de IA que trabaja 24/7 sin depender de ningún chat abierto**. No es un chatbot que espera a que alguien le escriba: es un motor que sale a buscar clientes, los contacta por varios canales, conversa, maneja objeciones, agenda citas y se las pasa listas a un humano para cerrar.

Su única obsesión es un número: **la agenda de citas calificadas** (meta operativa: 10 citas por semana). Todo lo demás —prospección, mensajes, llamadas— existe para alimentar ese número.

El agente **prospecta, contacta, conversa, agenda y hace handoff**. El cierre lo hace **Fernando** (humano). Esa división es intencional: la IA hace el trabajo de volumen y repetición; la persona hace la relación y la negociación final.

Está diseñado bajo tres restricciones duras: **auto-hospedado** (código 100% de ADM, editable sin programar), **barato** (objetivo < $40 USD/mes) y **conforme a la ley mexicana** de datos personales (LFPDPPP).

---

## 2. Principios no negociables

Estos cinco principios definen todas las decisiones técnicas del sistema. No se cambian.

**1. Open-source y auto-hospedable.** Todo el stack es software que ADM controla y hospeda. Nada de plataformas cerradas que secuestren los datos o suban de precio. El código es propiedad de ADM y se puede editar sin ser programador (n8n visual, plantillas en base de datos, panel de configuración).

**2. Costo mensual mínimo.** El objetivo es operar por menos de $40 USD/mes usando capas gratuitas (free tiers) y pago por uso. Un solo VPS corre todo. Se prefiere pagar por consumo real (tokens de IA, llamadas API) que por suscripciones fijas.

**3. La voz sale por un conmutador propio vía SIP.** El módulo de llamadas se conecta a un PBX propio (Asterisk, FreePBX o 3CX) por protocolo SIP. **No se usa Twilio** ni ningún servicio de voz de pago por minuto que dispare el costo. El audio se procesa con Deepgram (voz a texto), Claude (cerebro) y Cartesia (texto a voz en español de México).

**4. Cumplimiento MX (LFPDPPP).** El sistema respeta la Ley Federal de Protección de Datos Personales en Posesión de los Particulares: lista de supresión (`do_not_contact`), opt-out en cada mensaje, aviso de privacidad accesible, y el agente **siempre** se identifica como asesora digital de ADM. Nunca finge ser humano.

**5. Humano-en-el-loop configurable.** Por defecto, cada mensaje que el agente redacta queda como borrador y espera aprobación de una persona en el dashboard. Cuando el equipo confía en la calidad, se activa un flag y el sistema envía solo (con salvaguardas de score y horario).

---

## 3. Arquitectura general

El sistema es una tubería (pipeline) de datos donde un lead avanza de "descubierto" hasta "cita agendada / handoff". Cada componente hace una cosa y escribe su resultado en la base de datos; el orquestador (n8n) coordina los tiempos.

```
                       ┌───────────────────────────────────────────────┐
                       │              n8n (orquestador 24/7)            │
                       │   crons · secuencias · webhooks · reportes     │
                       └───────────────────────────────────────────────┘
        prospecta │            califica │           contacta │        agenda │
                  ▼                     ▼                     ▼               ▼
   ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐   ┌──────────┐
   │  scraper     │   │  agent-core  │   │  outreach              │   │ booking  │
   │ Google Places│──▶│ Claude Haiku │──▶│ email (Resend)         │──▶│ Cal.com  │
   │              │   │ + Sonnet     │   │ whatsapp (Cloud API)   │   │          │
   └──────────────┘   └──────────────┘   │ voz (SIP → PBX propio) │   └──────────┘
                  │                     │  Deepgram·Claude·Cartesia│         │
                  ▼                     ▼─────────────┬────────────┘         ▼
             ┌─────────────────────────────────────────────────────┐   handoff →
             │              Postgres (fuente de verdad)             │   Fernando
             │  leads · contactos · verticales · secuencias ·        │   (humano
             │  mensajes · llamadas · citas · do_not_contact ·        │    cierra)
             │  ejecuciones · eventos · configuracion                │
             └─────────────────────────────────────────────────────┘
                                     ▲
                       ┌─────────────┴─────────────┐
                       │   Dashboard (Next.js)      │
                       │ KPIs · pipeline · aprobar  │
                       │ mensajes · config sin código│
                       └────────────────────────────┘
```

**Por qué esta forma.** La base de datos es la única fuente de verdad; cada módulo es reemplazable sin tocar a los demás porque todos hablan a través de tablas, no entre sí. n8n es el reloj y el pegamento: dispara los crons, revisa las secuencias y atiende los webhooks entrantes. El dashboard solo lee y escribe en la misma base. Si mañana ADM cambia de proveedor de email, solo se cambia el módulo de outreach; el resto ni se entera.

**Un solo VPS** corre Postgres, n8n y los servicios de Node. La voz habla con un PBX (que puede vivir en el mismo VPS o en otro). El dashboard puede correr en el VPS o en un hosting estático gratuito conectado a la misma base.

---

## 4. Stack tecnológico

| Capa | Herramienta | Por qué |
|---|---|---|
| Orquestación | **n8n** (auto-hospedado) | Visual, editable sin código; crons, webhooks y secuencias en un solo lugar. |
| Base de datos | **Postgres 16** (o Supabase) | Robusta, gratis, con JSONB para flexibilidad. Supabase da free tier gestionado. |
| Inteligencia | **Anthropic Claude** | **Haiku** (rápido/barato) para calificar y clasificar; **Sonnet** (mejor pluma) para redactar y responder. |
| Prospección | **Google Places API (New)** | Datos frescos de negocios locales: nombre, giro, teléfono, web, reseñas. |
| Email | **Resend** | Envío transaccional simple, buen free tier, buena entregabilidad. |
| WhatsApp | **WhatsApp Cloud API** | Canal directo de mayor respuesta en México. |
| Agenda | **Cal.com** | Auto-hospedable, webhooks, links prellenados. |
| Voz | **SIP → PBX propio** + Deepgram (STT) + Claude (LLM) + **Cartesia** (TTS es-MX) | Voz natural en español de México sin costo por minuto de Twilio. |
| Dashboard | **Next.js** | Panel real; el HTML de una página es el prototipo funcional. |
| Infra | **1 VPS** + `docker-compose` | Todo en una caja; costo previsible. |

---

## 5. El flujo del agente en 9 etapas

Cada lead recorre estas nueve etapas. En la base de datos se refleja en el campo `estado_pipeline`.

**Etapa 1 · Descubrir (prospección).** El `scraper` consulta Google Places por cada combinación de *giro × ciudad* (definidos en la tabla `verticales` y en la config de ciudades objetivo). Normaliza cada resultado, deduplica (por `google_place_id` o por nombre+ciudad normalizados) y escribe leads nuevos en estado `descubierta`. Cron: diario 07:00.

**Etapa 2 · Calificar (scoring ICP).** El `agent-core` toma los leads `descubierta` y le pide a **Claude Haiku** un score de 0 a 100 según las señales de dolor digital (sin web, web vieja, sin anuncios, pocas reseñas, redes abandonadas, varias sucursales). Marca `calificada` o `descartada` (anti-ICP), y genera un **hallazgo clave** concreto para el primer contacto. Cron: cada hora.

**Etapa 3 · Personalizar (primer contacto).** Para cada lead `calificada`, **Claude Sonnet** redacta el primer mensaje usando la regla de oro de ADM: **1 hallazgo concreto + 1 prueba social como referencia + 1 CTA de baja fricción** (auditoría express gratis o propuesta en 24h). El mensaje se adapta al canal (email o WhatsApp) y a la vertical (dolor/ángulo/servicio/persona). Se guarda como `borrador`.

**Etapa 4 · Aprobar (human-in-the-loop).** Si `human_in_the_loop = true`, una persona revisa y aprueba/edita los borradores en el dashboard. Si está en automático, el sistema aprueba solo los mensajes de leads con score ≥ umbral configurado. Aquí es donde ADM controla la calidad antes de escalar.

**Etapa 5 · Contactar (outreach multicanal).** El módulo de outreach envía el mensaje aprobado por el canal correspondiente: **email (Resend)** o **WhatsApp (Cloud API)**. Antes de cada envío verifica compliance: no está en `do_not_contact`, está dentro del horario permitido, no excede 3 toques. El lead pasa a `contactada`.

**Etapa 6 · Secuenciar (cadencia de 3 toques).** Si no hay respuesta, la secuencia avanza con **valor nuevo en cada toque**: email → (48h) WhatsApp → (72h) llamada de voz. Máximo 3 toques. Cada toque aporta algo distinto (un ángulo nuevo, la auditoría, un caso). Cron: cada 15 min revisa qué toques tocan.

**Etapa 7 · Conversar (manejo de objeciones).** Cuando el prospecto responde (webhook de email/WhatsApp), el lead pasa a `respondio` / `en_conversacion` y **Claude Sonnet** responde con el prompt de `reply`: maneja precio, "no tengo tiempo", "ya tengo quien me ayuda", "¿es spam?", etc. Su meta siempre es llevar a la cita. Si piden baja, opt-out inmediato.

**Etapa 8 · Agendar (Cal.com).** Cuando hay interés, el agente comparte el link de Cal.com prellenado. Al reservar, un webhook crea el registro en `citas`, cambia el lead a `cita_agendada` y notifica.

**Etapa 9 · Handoff (a Fernando).** La cita calificada se pasa a **Fernando** con todo el contexto: el hallazgo, la conversación, la vertical y las notas del agente. El lead pasa a `handoff`. Fernando llega a la llamada sabiendo exactamente con quién habla y qué le duele. Él cierra; el sistema registra `ganada` o `perdida`.

> **Llamadas a tibios (etapa transversal).** Un cron aparte (11:00 y 16:00) toma leads que abrieron o respondieron pero no agendaron, y encola llamadas de voz por SIP para empujarlos a la cita. Es el "segundo esfuerzo" automatizado.

---

## 6. ICP y verticales de ADM

**A quién le vendemos.** Negocios locales de Chihuahua y el norte de México con **dolor digital evidente** y capacidad de pago. El sistema no busca "cualquier negocio": busca los que se están dejando dinero en la mesa por no tener presencia digital decente.

**Señales que suben el score (oportunidad):** no tiene sitio web; web vieja o no responsiva; no corre anuncios; pocas o malas reseñas de Google; redes sociales abandonadas; negocio con varias sucursales (mayor ticket).

**Anti-ICP (se descarta):** negocios sin presencia posible de mejorar (ya están muy bien), fuera de la zona objetivo, o que claramente no pueden pagar los servicios de ADM.

**Las 10 verticales objetivo** (cada una con su dolor, ángulo, servicio ancla, persona objetivo y caso de prueba social, viven en la tabla `verticales` y se editan desde el dashboard):

| Vertical | Dolor típico | Servicio ancla ADM |
|---|---|---|
| Restaurantes y bares | Reservas/pedidos se pierden en DMs; menú desactualizado | Sitio Pro (agenda + catálogo + WhatsApp) o Agente IA |
| Clínicas y consultorios | Agenda solo por teléfono; poca credibilidad sin web | Sitio Pro con agenda + Marketing Arranque |
| Inmobiliarias | Propiedades sin catálogo; leads fríos sin seguimiento | Sitio Pro (catálogo) o Agente IA de leads |
| Retail y tiendas | Venden por mensajes; sin tienda en línea | Sitio Pro/Custom + Marketing Escala |
| Gimnasios y fitness | Altas/bajas a mano; sin captación digital | Sitio Plus/Pro + Marketing Arranque |
| Despachos profesionales | Sin presencia seria se pierde confianza | Sitio Pro + Marketing Arranque |
| Hoteles y hospedaje | Dependen de OTAs con comisión | Sitio Custom (reservas) + Marketing Escala |
| Talleres y automotriz | No aparecen en "taller cerca de mí" | Sitio Pro + SEO local |
| Escuelas y cursos | Inscripciones sin embudo digital | Sitio Pro + Arranque + Agente IA |
| Salud y bienestar | Agenda a mano; cuesta transmitir confianza | Sitio Plus/Pro + Marketing Arranque |

**La regla de oro del mensaje.** Cada primer contacto demuestra que **miramos SU negocio**: un hallazgo concreto ("no tienes sitio web y solo 8 reseñas"), un dato de prueba social como referencia (nunca como promesa), y un CTA de baja fricción. Cadencia de máximo 3 toques, cada uno con valor nuevo.

**Lo que vende ADM (escalera de valor).** Sitios web de pago único con entrega en 48h (Plus, Pro, Custom); marketing recurrente (Arranque, Escala, A medida); y agentes de IA para automatizar leads 24/7. La prueba social real: +120 proyectos entregados, 38+ marcas activas, ROAS promedio 4.7×, 91% de renovación, con casos como +3.2× reservas en un restaurante, primera página de Google en 90 días en salud, y +180% de ventas en moda.

---

## 7. Cumplimiento en México (LFPDPPP)

El sistema está diseñado para respetar la **Ley Federal de Protección de Datos Personales en Posesión de los Particulares** y las buenas prácticas de comunicación comercial. Estas salvaguardas están en el código, no son opcionales.

**Lista de supresión (`do_not_contact`).** Cualquier persona que pida baja, se queje, o cuyo correo rebote de forma dura, entra a esta tabla. Antes de cada envío, el sistema consulta `esta_suprimido(email, telefono)`. Si está, no se contacta. Punto.

**Opt-out en cada mensaje.** Todo mensaje saliente incluye una forma clara de darse de baja ("Responde BAJA para no recibir más mensajes"). En email, además, encabezado `List-Unsubscribe`.

**Aviso de privacidad.** El primer contacto referencia el aviso de privacidad de ADM (URL configurable). El prospecto siempre puede saber quién tiene sus datos y para qué.

**Identificación honesta.** El agente **siempre** se presenta como "Sofía, asesora digital de ADM". Nunca finge ser una persona. Esto no es solo ético: sostiene la confianza de la marca.

**Ventana horaria.** Los envíos y llamadas solo ocurren dentro del horario configurado (por defecto 9:00–19:00, hora de Chihuahua), respetando el descanso de las personas.

**Cadencia limitada.** Máximo 3 toques por lead. No se persigue a nadie. Si no hay interés tras la cadencia, el lead se pausa.

**Human-in-the-loop.** La primera etapa de operación mantiene a una persona aprobando cada mensaje. Es una salvaguarda de calidad y de reputación mientras el sistema demuestra su criterio.

---

## 8. Costos reales (objetivo < $40 USD/mes)

Estimación para un volumen de operación temprano (cientos de leads nuevos y algunos miles de mensajes/mes). Las cifras son órdenes de magnitud; conviene revalidarlas con el uso real.

| Concepto | Plan | Costo mensual aprox. |
|---|---|---|
| VPS (2 vCPU / 4 GB) | Hetzner / Contabo | $6 – $15 USD |
| Postgres | En el VPS (o Supabase free) | $0 |
| n8n | Auto-hospedado en el VPS | $0 |
| Claude Haiku (calificar) | Pago por uso | $2 – $6 USD |
| Claude Sonnet (redactar/responder) | Pago por uso | $5 – $15 USD |
| Google Places API | Crédito mensual gratuito + uso | $0 – $5 USD |
| Resend (email) | Free tier (3k/mes) → pago | $0 – $10 USD |
| WhatsApp Cloud API | Conversaciones (primeras gratis) | $0 – $8 USD |
| Cal.com | Auto-hospedado o free | $0 |
| Voz: Deepgram + Cartesia | Pago por uso (según minutos) | variable* |
| PBX (Asterisk/FreePBX) | Auto-hospedado | $0 (solo troncal SIP) |
| **Total estimado** | | **≈ $20 – $40 USD/mes** |

\* La voz es el rubro más variable: depende de cuántas llamadas se hagan. Se recomienda activarla en fase 4, ya con el resto probado, y monitorear el gasto de STT/TTS por minuto. El costo de la troncal SIP (los minutos de teléfono reales) depende del proveedor local que se conecte al PBX.

**Filosofía de costo:** se prefiere pago por uso a suscripciones fijas, y capas gratuitas siempre que se pueda. El sistema se paga solo con **una** cita que se convierta en cliente.

---

## 9. Roadmap por fases

La construcción sigue el orden de `BUILD_PLAN.md`. El principio es **poner a producir dinero lo antes posible** con el mínimo, y luego agregar canales.

**Fase 0 · Cimientos (semana 1).** Levantar el VPS, Postgres y n8n. Aplicar el esquema y las semillas (verticales, secuencias, config). Dejar el scraper prospectando y el calificador puntuando. Resultado: una base de datos que se llena sola de leads calificados de Chihuahua.

**Fase 1 · Primer canal + agenda (semana 2).** Activar outreach por **email (Resend)** con human-in-the-loop, la secuencia base y **Cal.com**. Encender el dashboard para aprobar mensajes y ver KPIs. Resultado: primeras citas agendadas y handoff a Fernando. Aquí el sistema ya genera valor.

**Fase 2 · WhatsApp + conversación (semana 3).** Sumar **WhatsApp Cloud API** como segundo toque y el módulo de `reply` para manejar objeciones automáticamente. Afinar los prompts con casos reales. Resultado: mayor tasa de respuesta y menos trabajo manual.

**Fase 3 · Automatización supervisada (semana 4).** Con confianza en la calidad, bajar el human-in-the-loop a solo-revisión de excepciones (auto-envío para score alto). Activar el cron de llamadas a tibios (encolado, aún sin voz). Resultado: el sistema opera casi solo; el equipo revisa por excepción.

**Fase 4 · Voz por SIP (semana 5+).** Conectar el **PBX propio** y el pipeline de voz (Deepgram + Claude + Cartesia es-MX). Empezar con volumen bajo de llamadas y monitorear costo y calidad. Resultado: el tercer canal cierra el círculo del outreach multicanal.

**Fase 5 · Optimización continua (permanente).** A/B de mensajes por vertical, ajuste de scoring con resultados reales de cierre, nuevos casos de prueba social, y migración del panel HTML al dashboard Next.js completo. El sistema aprende qué verticales y ángulos convierten mejor y reasigna el esfuerzo.

---

## 10. Métricas que importan

El sistema se mide por el embudo, no por la actividad. Los KPIs del dashboard:

- **Descubiertas** → cuántos leads entran (salud del scraper).
- **Calificadas** → cuántas pasan el ICP (salud del scoring y de la fuente).
- **Contactadas** → cuántas reciben outreach (throughput del sistema).
- **Respondieron** → tasa de respuesta (calidad del mensaje y del targeting).
- **Citas** → el número que importa (meta: 10/semana).
- **Citas por vertical** → dónde está funcionando mejor, para reasignar esfuerzo.
- **Próximas ejecuciones automáticas** → la prueba de que el sistema corre solo 24/7.

La estrella polar es simple: **citas calificadas en la agenda de Fernando**. Todo lo demás es un medio.

---

*Documento vivo. Se actualiza conforme el sistema evoluciona. — ADM · Atlas Digital Marketing.*
