# Correr el Motor de Ventas 100% gratis (o casi)

El sistema está diseñado para operar con **capas gratuitas**. Aquí el stack sin costo y cómo dejarlo corriendo solo. Lo único que puede tener un costo mínimo por uso es Claude (IA) y Google Places por arriba del crédito gratis — y el motor puede correr **sin IA**, con plantillas, a $0.

## Piezas gratis
| Pieza | Opción gratis | Notas |
|---|---|---|
| **Servidor (VPS)** | **Oracle Cloud Always Free** (VM ARM 4 vCPU / 24 GB, gratis para siempre) | Alternativas: máquina propia, o una PC vieja encendida. |
| **Base de datos** | Postgres en el mismo VPS (o **Supabase** free tier) | Ya viene en `docker-compose.yml`. |
| **Orquestación** | **n8n** auto-hospedado, o **cron** del sistema con `scripts/cycle.sh` | El cron es lo más simple y gratis. |
| **Redacción** | **Plantillas** (incluidas) → $0 | Claude es opcional (`USAR_IA=true`) y muy barato. |
| **Correo** | **Resend** free: 3,000 correos/mes (100/día) | Verifica tu dominio para buena entregabilidad. |
| **WhatsApp** | **WhatsApp Cloud API**: conversaciones de servicio gratis | Requiere número y app de Meta. |
| **Agenda** | **Cal.com** plan free (o auto-hospedado) | Link prellenado + webhook. |
| **Prospección** | **Google Places**: crédito mensual gratis de Google Maps | A bajo volumen cae dentro del crédito. |
| **Voz** | (Fase 4, no gratis) | Actívala al final; correo + WhatsApp cubren el 90%. |

## Arranque gratis en 15 minutos

```bash
# 1) En tu VPS gratis (Oracle) con Docker:
git clone <tu-repo> adm && cd adm
cp .env.example .env    # pon DATABASE_URL; las llaves de envío pueden ir después

# 2) Base + n8n
docker compose up -d
DATABASE_URL="postgresql://adm:...@localhost:5432/adm" ./db/run.sh --con-semillas

# 3) Probar el pipeline SIN llaves (modo simulación):
DRY=1 ./scripts/cycle.sh      # redacta con plantillas y "envía" simulado

# 4) Cuando tengas las llaves (Google + Resend + WhatsApp), ponlas en .env
#    y quita el DRY. Programa el ciclo cada 15 min por cron:
crontab -e
# */15 * * * *  /ruta/adm/scripts/cycle.sh >> /var/log/adm.log 2>&1
```

## ¿Qué corre gratis desde el día 1?
- **Redacción con plantillas** (sin costo de IA).
- **Envío por correo** dentro del free tier de Resend.
- **Pipeline y dashboard** completos.

## ¿Qué conviene pagar (poco) cuando escales?
- **Claude** para calificar/ofrecer/redactar mejor (centavos por lead).
- **Google Places** si prospectas mucho volumen.
- **Voz** (Deepgram/Cartesia + troncal SIP) en la Fase 4.

## Orden recomendado
1. Semana 1: cron + plantillas + correo (Resend). Todo gratis.
2. Semana 2: prende Claude (`USAR_IA=true`) para mejor redacción y scoring real.
3. Semana 3: WhatsApp + Cal.com.
4. Semana 4+: voz por SIP.
