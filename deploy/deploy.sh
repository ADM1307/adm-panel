#!/usr/bin/env bash
# =====================================================================
#  ADM · Despliega el Panel de Control en tu VPS con Caddy + Docker
#  Uso:  ./deploy.sh
#  Requisitos en el VPS: docker + docker compose, puertos 80/443 abiertos,
#  y (para HTTPS) un dominio apuntando a la IP del VPS.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ ADM · Deploy del panel"

# 1) .env
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "  · Creé .env desde .env.example — edítalo (dominio y contraseña) y vuelve a correr."
fi

# 2) Copiar el panel más reciente como index.html
mkdir -p site logs
cp ../dashboard/adm-panel.html site/index.html
echo "  · Panel copiado a site/index.html"

# 3) Validar la config de Caddy (no arranca si está mal)
echo "▶ Validando Caddyfile..."
docker run --rm -e PANEL_DOMAIN -e PANEL_USER -e PANEL_PASSWORD_HASH \
  --env-file .env \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.8 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# 4) Levantar
echo "▶ Levantando el panel..."
docker compose up -d

echo ""
echo "✅ Listo."
source .env 2>/dev/null || true
echo "   · HTTPS:   https://${PANEL_DOMAIN:-tu-dominio}   (si el DNS ya apunta al VPS)"
echo "   · Prueba:  http://<IP-DE-TU-VPS>:8080"
echo ""
echo "   Para ponerle contraseña: genera el hash, ponlo en .env y descomenta"
echo "   el bloque basic_auth del Caddyfile. Luego: docker compose up -d"
