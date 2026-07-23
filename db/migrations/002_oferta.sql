-- =====================================================================
--  ADM · Migración 002 · Oferta a la medida por lead
--  El agente, tras calificar, arma una oferta según las señales del
--  scraper (web/tamaño/reseñas/anuncios). Se guarda aquí.
-- =====================================================================
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS tamano text,          -- 'chico' | 'mediano' | 'grande' (estimado)
  ADD COLUMN IF NOT EXISTS oferta jsonb;         -- { necesidad, servicio, paquete, rango, argumento }

COMMENT ON COLUMN leads.oferta IS 'Oferta a la medida generada por agent/src/offer.js (Claude Sonnet).';

-- Índice para filtrar rápido los calificados que aún no tienen oferta.
CREATE INDEX IF NOT EXISTS ix_leads_sin_oferta
  ON leads (estado_pipeline)
  WHERE oferta IS NULL;

COMMIT;
