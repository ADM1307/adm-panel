# ADM · Motor de Ventas Autónomo con IA

Sistema auto-hospedado que **prospecta, contacta, conversa, agenda y hace handoff** de citas calificadas para **Atlas Digital Marketing** (Chihuahua, MX). Corre 24/7 sin depender de ningún chat abierto. Código 100% de ADM, editable sin programar. Objetivo de costo: **< $40 USD/mes**.

> ¿Nuevo aquí? Lee **`CLAUDE.md`** (contexto) y luego **`BUILD_PLAN.md`** (construcción módulo por módulo). El **`docs/BLUEPRINT.md`** tiene la arquitectura completa.

## Arranque rápido (local)

```bash
# 1) Variables
cp .env.example .env      # edita credenciales

# 2) Infra (Postgres + n8n)
docker compose up -d

# 3) Esquema + semillas (verticales, secuencias, config)
DATABASE_URL="postgresql://adm:cambia_esto@localhost:5432/adm" ./db/run.sh --con-semillas

# 4) Prospectar (Google Places)
cd services/scraper && npm install
DATABASE_URL="postgresql://adm:cambia_esto@localhost:5432/adm" \
GOOGLE_PLACES_API_KEY=... npm run prospectar

# 5) Calificar leads con Claude Haiku
cd ../../agent && npm install
DATABASE_URL="..." ANTHROPIC_API_KEY=... npm run calificar
```

n8n queda en `http://localhost:5678`. El **panel de control** es `dashboard/adm-panel.html` (ábrelo en el navegador; usa datos demo hasta que lo conectes a tu API).

## Estructura
| Carpeta | Qué es | Estado |
|---|---|---|
| `db/` | Esquema Postgres, semillas, runner | ✅ validado |
| `services/scraper/` | Prospección Google Places (Node ESM) | ✅ funcional |
| `agent/` | Prompts + calificación (Claude) | ✅ base |
| `n8n/` | Workflows (crons/webhooks) | 📄 documentado |
| `dashboard/` | Panel de control | ✅ prototipo HTML |
| `docs/` | Blueprint y apoyo | ✅ |

## Cumplimiento (México · LFPDPPP)
Tabla `do_not_contact`, opt-out en cada mensaje, aviso de privacidad, ventana horaria y **human-in-the-loop** configurable. El agente **siempre** se identifica como asesora digital de ADM. Ver `docs/BLUEPRINT.md` §Compliance.

## Licencia
Software propietario de Atlas Digital Marketing. Uso interno.
