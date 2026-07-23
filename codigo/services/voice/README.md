# services/voice · Agente de voz por SIP (módulo avanzado)

> ⚠️ Este es el módulo **más complejo y el único que NO es gratis** (necesita un PBX/troncal SIP y minutos de STT/TTS). Actívalo en la **Fase 4**, cuando correo y WhatsApp ya funcionen. Por eso aquí va el diseño y el esqueleto, no una implementación cerrada: depende de tu PBX.

## Arquitectura (sin Twilio)
```
Llamada saliente ── SIP ──► PBX propio (Asterisk / FreePBX / 3CX)
        │
        ▼ audio
  Deepgram (STT es-MX) ──► Claude Sonnet (guion reply.md, meta=agendar) ──► Cartesia (TTS es-MX)
        ▲                                                                        │
        └──────────────────────────── audio de vuelta ◄──────────────────────────┘
```

## Piezas
- **Registro SIP:** una extensión en tu PBX. Librerías sugeridas: `sip.js`, `drachtio`, o `jambonz` (media server open-source que ya orquesta STT/LLM/TTS).
- **STT:** Deepgram (streaming, es-MX). Tiene crédito inicial gratis; luego pago por minuto.
- **LLM:** Claude Sonnet con el guion de `agent/prompts/reply.md` (meta: agendar).
- **TTS:** Cartesia (voz es-MX natural). Pago por caracteres/minutos.

## Flujo por llamada
1. Toma leads tibios (abrieron/respondieron y no agendaron) → cola de llamadas.
2. Marca por SIP dentro del horario permitido.
3. Al contestar: identifícate como **Sofía, asesora digital de ADM**.
4. STT → Claude → TTS en loop hasta agendar, dejar recado o colgar.
5. Guarda en la tabla `llamadas` (transcripción, resumen, resultado). Si resultado='cita', manda el link de Cal.com por WhatsApp.

## Recomendación de arranque económico
La forma más barata de tener voz es **jambonz** auto-hospedado en el mismo VPS + una troncal SIP local de bajo costo, y encender pocas llamadas al día para controlar el gasto de STT/TTS. Mientras tanto, correo + WhatsApp cubren el 90% del outreach a $0.
