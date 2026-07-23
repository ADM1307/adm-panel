#!/usr/bin/env bash
# =====================================================================
#  ADM · Aplica migraciones y semillas contra $DATABASE_URL
#  Uso:  DATABASE_URL=postgres://... ./db/run.sh [--con-semillas]
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

: "${DATABASE_URL:?Define DATABASE_URL (ej. postgres://adm:pass@localhost:5432/adm)}"

echo "▶ Aplicando migraciones..."
for f in migrations/*.sql; do
  echo "  · $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

if [[ "${1:-}" == "--con-semillas" ]]; then
  echo "▶ Aplicando semillas..."
  for f in seeds/*.sql; do
    echo "  · $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
fi

echo "✅ Base de datos lista."
