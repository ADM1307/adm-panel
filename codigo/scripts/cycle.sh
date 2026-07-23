#!/usr/bin/env bash
# =====================================================================
#  ADM · Un ciclo completo del Motor de Ventas.
#  Pensado para correr por CRON (gratis, sin depender de n8n):
#     */15 * * * *  /ruta/adm-motor-ventas/scripts/cycle.sh >> /var/log/adm.log 2>&1
#
#  Variables: lee el .env de la raíz. Pásale DRY=1 para simular envíos.
#  Uso:  ./scripts/cycle.sh            (real)
#        DRY=1 ./scripts/cycle.sh      (simulado, sin llaves de envío)
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Cargar .env si existe
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi

DRYFLAG=""
[[ "${DRY:-0}" == "1" ]] && DRYFLAG="--dry --sin-horario"

echo "── ADM ciclo $(date '+%F %T') ${DRYFLAG:+(DRY)} ──"

# 1) Prospectar (solo si hay llave de Google; si no, se salta)
if [[ -n "${GOOGLE_PLACES_API_KEY:-}" ]]; then
  node services/scraper/src/index.js || echo "scraper: aviso"
else
  echo "· scraper omitido (sin GOOGLE_PLACES_API_KEY)"
fi

# 2) Calificar + 3) Ofertar (necesitan ANTHROPIC_API_KEY)
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  node agent/src/qualify.js || echo "qualify: aviso"
  node agent/src/offer.js   || echo "offer: aviso"
else
  echo "· qualify/offer omitidos (sin ANTHROPIC_API_KEY)"
fi

# 4) Redactar outreach (GRATIS con plantillas; IA opcional con USAR_IA=true)
node agent/src/personalize.js || echo "personalize: aviso"

# 5) Enviar por correo y WhatsApp (aprobados). DRY simula sin llaves.
node services/outreach/src/email.js    $DRYFLAG || echo "email: aviso"
node services/outreach/src/whatsapp.js $DRYFLAG || echo "whatsapp: aviso"

# 6) Responder a quienes contestaron
node agent/src/reply.js || echo "reply: aviso"

echo "── fin del ciclo ──"
