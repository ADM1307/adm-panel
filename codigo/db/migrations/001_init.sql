-- =====================================================================
--  ADM · Motor de Ventas Autónomo con IA
--  Migración 001 · Esquema base (Postgres 14+)
--  Código 100% propiedad de Atlas Digital Marketing. Editable sin código.
-- =====================================================================
--  Convenciones:
--   - Todo en snake_case, español de México.
--   - Timestamps en UTC (timestamptz). La app muestra America/Chihuahua.
--   - Nada se borra "duro": usamos estados y la tabla do_not_contact.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "unaccent";   -- normalización de texto/dedupe
CREATE EXTENSION IF NOT EXISTS "citext";     -- email/texto case-insensitive

-- Wrapper IMMUTABLE de unaccent para poder usarlo en índices únicos (dedupe).
CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ---------------------------------------------------------------------
-- Tipos enumerados (estados del pipeline y canales)
-- ---------------------------------------------------------------------
CREATE TYPE lead_estado AS ENUM (
  'descubierta',      -- recién scrapeada, sin calificar
  'calificada',       -- pasó el scoring del agente
  'descartada',       -- anti-ICP o do-not-contact
  'contactada',       -- se envió al menos 1 toque
  'respondio',        -- el prospecto respondió
  'en_conversacion',  -- ida y vuelta activa
  'cita_agendada',    -- reservó diagnóstico
  'handoff',          -- pasada a humano (Fernando)
  'ganada',           -- cerró contrato
  'perdida'           -- no avanzó / dijo que no
);

CREATE TYPE canal AS ENUM ('email', 'whatsapp', 'voz', 'manual', 'formulario');

CREATE TYPE direccion_msg AS ENUM ('saliente', 'entrante');

CREATE TYPE mensaje_estado AS ENUM (
  'borrador',         -- redactado por el agente, pendiente de aprobación (human-in-the-loop)
  'aprobado',         -- listo para enviar
  'programado',       -- en cola con hora de envío
  'enviado',
  'entregado',
  'leido',
  'respondido',
  'rebotado',
  'fallido',
  'cancelado'
);

CREATE TYPE cita_estado AS ENUM (
  'agendada', 'reprogramada', 'confirmada', 'realizada', 'no_asistio', 'cancelada'
);

CREATE TYPE ejecucion_estado AS ENUM ('programada', 'corriendo', 'ok', 'error', 'omitida');

-- ---------------------------------------------------------------------
-- Usuarios internos (equipo ADM). Fernando = closer humano.
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  email         citext,                       -- ver extensión citext abajo
  rol           text NOT NULL DEFAULT 'closer',   -- closer | admin | operador
  telefono      text,
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- VERTICALES · el "cerebro" de personalización por giro.
-- El agente lee dolor/ángulo/servicio/persona/prueba_social para armar
-- el primer contacto. Editable sin código desde el dashboard.
-- ---------------------------------------------------------------------
CREATE TABLE verticales (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave             text UNIQUE NOT NULL,          -- 'restaurantes', 'clinicas', ...
  nombre            text NOT NULL,                 -- "Restaurantes y bares"
  giros_google      text[] NOT NULL DEFAULT '{}',  -- términos para Google Places
  dolor             text NOT NULL,                 -- dolor digital típico
  angulo            text NOT NULL,                 -- ángulo de venta
  servicio_ancla    text NOT NULL,                 -- servicio ADM que resuelve
  persona_objetivo  text NOT NULL,                 -- a quién le hablamos (puesto)
  prueba_social     text NOT NULL,                 -- caso/dato de ADM a citar
  ticket_estimado   numeric(10,2),                 -- valor típico del proyecto (MXN)
  prioridad         int NOT NULL DEFAULT 3,        -- 1 (alta) .. 5 (baja)
  activo            boolean NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- LEADS / empresas prospectadas
-- ---------------------------------------------------------------------
CREATE TABLE leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa           text NOT NULL,
  giro              text,                          -- giro crudo (de Google/manual)
  vertical_id       uuid REFERENCES verticales(id) ON DELETE SET NULL,
  ciudad            text,
  estado            text DEFAULT 'Chihuahua',
  pais              text NOT NULL DEFAULT 'MX',

  -- Presencia digital / señales
  sitio_web         text,
  telefono          text,
  email_general     citext,
  google_place_id   text UNIQUE,                   -- clave natural para dedupe
  google_maps_url   text,
  rating_google     numeric(2,1),
  num_resenas       int,
  tiene_web         boolean,
  web_responsiva    boolean,
  corre_anuncios    boolean,
  redes             jsonb NOT NULL DEFAULT '{}',   -- {facebook:..., instagram:...}
  sucursales        int DEFAULT 1,

  -- Scoring y estado del pipeline
  estado_pipeline   lead_estado NOT NULL DEFAULT 'descubierta',
  score             int,                           -- 0..100
  score_motivos     jsonb NOT NULL DEFAULT '[]',   -- ["sin web","<10 reseñas",...]
  hallazgo_clave    text,                          -- 1 hallazgo concreto para el 1er contacto
  anti_icp          boolean NOT NULL DEFAULT false,
  anti_icp_motivo   text,

  -- Origen y asignación
  fuente            text NOT NULL DEFAULT 'google_places',  -- google_places | xlsx | manual
  asignado_a        uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  notas             text,

  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now()
);

-- Índice único "suave" para dedupe cuando no hay place_id:
-- misma empresa normalizada + ciudad.
CREATE UNIQUE INDEX ux_leads_dedupe_nombre
  ON leads (lower(f_unaccent(empresa)), lower(f_unaccent(coalesce(ciudad,''))))
  WHERE google_place_id IS NULL;

CREATE INDEX ix_leads_estado      ON leads (estado_pipeline);
CREATE INDEX ix_leads_vertical    ON leads (vertical_id);
CREATE INDEX ix_leads_score       ON leads (score DESC);
CREATE INDEX ix_leads_creado      ON leads (creado_en DESC);

-- ---------------------------------------------------------------------
-- CONTACTOS · personas dentro de una empresa
-- ---------------------------------------------------------------------
CREATE TABLE contactos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  nombre        text,
  puesto        text,
  email         citext,
  telefono      text,                              -- E.164 preferido (+52...)
  whatsapp      text,
  es_principal  boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_contactos_lead ON contactos (lead_id);

-- ---------------------------------------------------------------------
-- SECUENCIAS (cadencias) y sus pasos · máx. 3 toques con valor nuevo
-- ---------------------------------------------------------------------
CREATE TABLE secuencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  descripcion   text,
  vertical_id   uuid REFERENCES verticales(id) ON DELETE SET NULL,  -- null = genérica
  activa        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE secuencia_pasos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secuencia_id      uuid NOT NULL REFERENCES secuencias(id) ON DELETE CASCADE,
  orden             int NOT NULL,                  -- 1,2,3
  canal             canal NOT NULL,
  espera_horas      int NOT NULL DEFAULT 0,        -- horas desde el paso anterior
  plantilla_asunto  text,                          -- email
  plantilla_cuerpo  text NOT NULL,                 -- admite variables {{empresa}} {{hallazgo}}...
  UNIQUE (secuencia_id, orden)
);

-- Inscripción de un lead en una secuencia
CREATE TABLE secuencia_inscripciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  secuencia_id  uuid NOT NULL REFERENCES secuencias(id) ON DELETE CASCADE,
  paso_actual   int NOT NULL DEFAULT 0,
  estado        text NOT NULL DEFAULT 'activa',    -- activa | pausada | completada | detenida
  proximo_toque_en timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, secuencia_id)
);
CREATE INDEX ix_inscripciones_proximo ON secuencia_inscripciones (proximo_toque_en)
  WHERE estado = 'activa';

-- ---------------------------------------------------------------------
-- MENSAJES / interacciones (email, whatsapp, voz, manual)
-- ---------------------------------------------------------------------
CREATE TABLE mensajes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contacto_id       uuid REFERENCES contactos(id) ON DELETE SET NULL,
  inscripcion_id    uuid REFERENCES secuencia_inscripciones(id) ON DELETE SET NULL,
  canal             canal NOT NULL,
  direccion         direccion_msg NOT NULL,
  estado            mensaje_estado NOT NULL DEFAULT 'borrador',
  asunto            text,
  cuerpo            text NOT NULL,
  -- IA: qué modelo lo generó y con qué costo aproximado
  generado_por_ia   boolean NOT NULL DEFAULT false,
  modelo_ia         text,                          -- 'claude-haiku' | 'claude-sonnet'
  aprobado_por      uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  -- IDs externos de proveedores (Resend, WhatsApp, etc.)
  proveedor         text,
  proveedor_msg_id  text,
  error_detalle     text,
  programado_para   timestamptz,
  enviado_en        timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensajes_lead   ON mensajes (lead_id, creado_en DESC);
CREATE INDEX ix_mensajes_estado ON mensajes (estado);
CREATE INDEX ix_mensajes_prog   ON mensajes (programado_para)
  WHERE estado IN ('aprobado','programado');

-- ---------------------------------------------------------------------
-- LLAMADAS DE VOZ (SIP/PBX propio · Deepgram/Claude/Cartesia)
-- ---------------------------------------------------------------------
CREATE TABLE llamadas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contacto_id       uuid REFERENCES contactos(id) ON DELETE SET NULL,
  direccion         direccion_msg NOT NULL DEFAULT 'saliente',
  estado            text NOT NULL DEFAULT 'programada',  -- programada|marcando|en_curso|terminada|fallida|sin_respuesta
  sip_call_id       text,
  duracion_seg      int,
  transcripcion     text,
  resumen           text,
  resultado         text,                          -- 'cita'|'no_interesado'|'volver_llamar'|'buzon'
  grabacion_url     text,
  programada_para   timestamptz,
  iniciada_en       timestamptz,
  terminada_en      timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_llamadas_lead ON llamadas (lead_id);

-- ---------------------------------------------------------------------
-- CITAS (Cal.com)
-- ---------------------------------------------------------------------
CREATE TABLE citas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contacto_id       uuid REFERENCES contactos(id) ON DELETE SET NULL,
  closer_id         uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  estado            cita_estado NOT NULL DEFAULT 'agendada',
  inicio            timestamptz NOT NULL,
  fin               timestamptz,
  medio             text DEFAULT 'videollamada',   -- videollamada | telefono | presencial
  cal_booking_id    text,
  cal_booking_uid   text,
  liga_reunion      text,
  notas             text,
  creado_en         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_citas_inicio ON citas (inicio);
CREATE INDEX ix_citas_estado ON citas (estado);

-- ---------------------------------------------------------------------
-- DO NOT CONTACT · cumplimiento LFPDPPP (opt-out y supresión)
-- ---------------------------------------------------------------------
CREATE TABLE do_not_contact (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext,
  telefono      text,
  motivo        text NOT NULL DEFAULT 'opt_out',   -- opt_out | queja | rebote_duro | manual
  canal_origen  canal,
  lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dnc_al_menos_un_dato CHECK (email IS NOT NULL OR telefono IS NOT NULL)
);
CREATE UNIQUE INDEX ux_dnc_email ON do_not_contact (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ux_dnc_tel   ON do_not_contact (telefono) WHERE telefono IS NOT NULL;

-- ---------------------------------------------------------------------
-- EJECUCIONES AUTOMÁTICAS (registro de los crons de n8n)
-- Alimenta el widget "próximas ejecuciones automáticas" del dashboard.
-- ---------------------------------------------------------------------
CREATE TABLE ejecuciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job           text NOT NULL,        -- 'prospeccion_diaria','calificacion_horaria',...
  estado        ejecucion_estado NOT NULL DEFAULT 'programada',
  programada_para timestamptz,
  iniciada_en   timestamptz,
  terminada_en  timestamptz,
  items_procesados int DEFAULT 0,
  resumen       text,
  error_detalle text,
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ejec_prog ON ejecuciones (programada_para);
CREATE INDEX ix_ejec_job  ON ejecuciones (job, creado_en DESC);

-- ---------------------------------------------------------------------
-- EVENTOS · bitácora de actividad (auditoría y timeline del lead)
-- ---------------------------------------------------------------------
CREATE TABLE eventos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE,
  tipo          text NOT NULL,        -- 'lead_descubierto','calificado','mensaje_enviado','respuesta','cita','handoff',...
  actor         text NOT NULL DEFAULT 'agente_ia',  -- agente_ia | sistema | <usuario>
  payload       jsonb NOT NULL DEFAULT '{}',
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_eventos_lead ON eventos (lead_id, creado_en DESC);
CREATE INDEX ix_eventos_tipo ON eventos (tipo, creado_en DESC);

-- ---------------------------------------------------------------------
-- CONFIGURACIÓN del sistema (flags editables sin código)
-- ---------------------------------------------------------------------
CREATE TABLE configuracion (
  clave         text PRIMARY KEY,
  valor         jsonb NOT NULL,
  descripcion   text,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Trigger genérico: mantener actualizado_en
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_actualizado_en() RETURNS trigger AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_upd   BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_vert_upd    BEFORE UPDATE ON verticales
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ---------------------------------------------------------------------
-- Función de compliance: ¿este lead/canal está suprimido?
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION esta_suprimido(p_email citext, p_tel text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM do_not_contact
    WHERE (p_email IS NOT NULL AND email = p_email)
       OR (p_tel   IS NOT NULL AND telefono = p_tel)
  );
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Vistas para el dashboard (KPIs)
-- ---------------------------------------------------------------------
CREATE VIEW v_kpis AS
SELECT
  count(*)                                                         AS descubiertas,
  count(*) FILTER (WHERE estado_pipeline = 'calificada')           AS calificadas,
  count(*) FILTER (WHERE estado_pipeline IN ('contactada','respondio','en_conversacion','cita_agendada','handoff','ganada')) AS contactadas,
  count(*) FILTER (WHERE estado_pipeline IN ('respondio','en_conversacion','cita_agendada','handoff','ganada')) AS respondieron,
  (SELECT count(*) FROM citas WHERE estado <> 'cancelada')         AS citas
FROM leads;

CREATE VIEW v_leads_por_vertical AS
SELECT COALESCE(v.nombre, 'Sin clasificar') AS vertical,
       count(l.*)                            AS total,
       count(l.*) FILTER (WHERE l.estado_pipeline = 'cita_agendada') AS citas
FROM leads l
LEFT JOIN verticales v ON v.id = l.vertical_id
GROUP BY 1
ORDER BY total DESC;

COMMIT;
