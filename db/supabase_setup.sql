-- ADM · Setup completo para Supabase (esquema + oferta + verticales + secuencias/config)

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
-- search_path fijo (public + extensions) para que funcione igual en un Postgres
-- normal y en Supabase (donde las extensiones viven en el esquema "extensions").
CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, extensions, pg_catalog AS
$$ SELECT unaccent('unaccent'::regdictionary, $1) $$;

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

-- =====================================================================
--  ADM · Semilla de VERTICALES (giro → dolor/ángulo/servicio/persona/prueba)
--  El agente lee esta tabla para personalizar el primer contacto.
--  Editable sin código desde el dashboard (sección Verticales).
-- =====================================================================
BEGIN;

INSERT INTO verticales
  (clave, nombre, giros_google, dolor, angulo, servicio_ancla, persona_objetivo, prueba_social, ticket_estimado, prioridad)
VALUES
('restaurantes', 'Restaurantes y bares',
  ARRAY['restaurant','bar','taquería','cafetería','pizzería','marisquería'],
  'Reservaciones y pedidos se pierden en DMs; menú desactualizado; sin forma de captar al cliente que ya los buscó en Google.',
  'Convertir la búsqueda "comida cerca de mí" en reservaciones y pedidos con agenda online + WhatsApp y menú siempre al día.',
  'Sitio Pro (agenda online + catálogo + WhatsApp) o Agente de IA para reservas',
  'Dueño / gerente',
  'Un restaurante subió +3.2× sus reservaciones con agenda online y campañas locales.',
  18000, 1),

('clinicas', 'Clínicas y consultorios (dental, estética, spa)',
  ARRAY['dentist','dental clinic','medical clinic','aesthetic clinic','spa','dermatologist','physiotherapist'],
  'Pacientes agendan por teléfono en horario de oficina; sin web confiable pierden credibilidad frente a competencia.',
  'Llenar la agenda con pacientes que ya buscan tratamiento: web con agenda 24/7 + reseñas + campañas de captación.',
  'Sitio Pro con agenda online + Marketing Arranque',
  'Doctor(a) titular / administrador(a) de la clínica',
  'Una clínica de salud llegó a 1ª página de Google en 90 días y llenó su agenda de valoraciones.',
  22000, 1),

('inmobiliarias', 'Inmobiliarias y agentes',
  ARRAY['real estate agency','real estate agents'],
  'Propiedades en Facebook sin catálogo navegable; leads llegan fríos y sin seguimiento.',
  'Catálogo web filtrable + captura y seguimiento automático de leads por WhatsApp para no perder ningún interesado.',
  'Sitio Pro (catálogo + landings) o Agente de IA para leads',
  'Broker / dueño de la inmobiliaria',
  'ADM tiene 38+ marcas activas y ROAS promedio 4.7× en campañas de captación.',
  25000, 2),

('retail', 'Retail y tiendas',
  ARRAY['clothing store','boutique','shoe store','store','gift shop','furniture store'],
  'Venden por mensajes, sin tienda en línea ni forma de escalar campañas; inventario no se ve en internet.',
  'Catálogo/e-commerce + campañas Meta/Google para vender también fuera del mostrador.',
  'Sitio Pro/Custom (catálogo o e-commerce) + Marketing Escala',
  'Dueño(a) de la tienda',
  'Una marca de moda creció +180% en ventas con tienda en línea y anuncios.',
  20000, 2),

('gimnasios', 'Gimnasios y estudios fitness',
  ARRAY['gym','fitness center','crossfit box','yoga studio','pilates studio'],
  'Altas y bajas se manejan a mano; sin captación digital dependen del paso peatonal.',
  'Landing de inscripción + campañas locales + recordatorios automáticos para reducir bajas.',
  'Sitio Plus/Pro + Marketing Arranque',
  'Dueño / gerente del gimnasio',
  'ADM mantiene 91% de renovación de clientes por resultados sostenidos.',
  15000, 3),

('despachos', 'Despachos profesionales (abogados, contadores)',
  ARRAY['lawyer','law firm','accountant','accounting firm','notary'],
  'Sin presencia digital seria, la confianza se pierde; los referidos no alcanzan para crecer.',
  'Sitio profesional que transmite autoridad + captación de consultas calificadas.',
  'Sitio Pro + Marketing Arranque',
  'Socio / titular del despacho',
  'Más de 120 proyectos entregados por ADM con enfoque en resultados medibles.',
  22000, 3),

('hoteles', 'Hoteles y hospedaje',
  ARRAY['hotel','motel','bed and breakfast','hostel'],
  'Dependen de OTAs que se llevan comisión; sin motor de reservas directas dejan margen en la mesa.',
  'Reservación directa desde su web + campañas para bajar dependencia de comisiones.',
  'Sitio Custom (motor de reservas) + Marketing Escala',
  'Gerente general / dueño',
  'ADM logra ROAS promedio 4.7× ayudando a negocios a vender directo.',
  35000, 3),

('automotriz', 'Talleres y automotriz',
  ARRAY['auto repair shop','car dealer','tire shop','car wash','mechanic'],
  'Clientes buscan "taller cerca de mí" y no aparecen; citas se agendan por teléfono.',
  'Aparecer en Google local + agenda de servicios online + reseñas.',
  'Sitio Pro + SEO local',
  'Dueño del taller / gerente',
  'Casos ADM con +3× en generación de contactos por presencia local optimizada.',
  16000, 4),

('educacion', 'Escuelas, cursos y academias',
  ARRAY['school','language school','driving school','tutoring center','academy'],
  'Inscripciones por temporada sin embudo digital; compiten con opciones en línea.',
  'Landing de inscripción + campañas de temporada + seguimiento automático de interesados.',
  'Sitio Pro + Marketing Arranque + Agente de IA',
  'Director(a) / coordinador(a) académico',
  'ADM ha entregado +120 proyectos con embudos de captación medibles.',
  18000, 4),

('salud_bienestar', 'Salud y bienestar',
  ARRAY['nutritionist','psychologist','wellness center','massage','alternative medicine'],
  'Agenda a mano y boca a boca; cuesta transmitir confianza y captar pacientes nuevos.',
  'Web con agenda + reseñas + contenido de confianza para captar pacientes nuevos.',
  'Sitio Plus/Pro + Marketing Arranque',
  'Profesional / dueño del consultorio',
  'Una clínica de salud alcanzó 1ª página de Google en 90 días con ADM.',
  15000, 4);

COMMIT;

-- =====================================================================
--  ADM · Semilla de USUARIOS, SECUENCIAS/PLANTILLAS y CONFIGURACIÓN
--  Cadencia máx. 3 toques con valor nuevo. Cada mensaje: 1 hallazgo +
--  1 prueba social + 1 CTA de baja fricción + opt-out (compliance MX).
--  Variables disponibles en plantillas:
--    {{empresa}} {{contacto_nombre}} {{hallazgo}} {{prueba_social}}
--    {{servicio_ancla}} {{ciudad}} {{opt_out}}
-- =====================================================================
BEGIN;

-- Usuario closer humano (handoff)
INSERT INTO usuarios (nombre, email, rol, telefono)
VALUES ('Fernando', 'fernando@atlasdigitalmark.com', 'closer', '+521614XXXXXXX')
ON CONFLICT DO NOTHING;

-- Configuración editable sin código
INSERT INTO configuracion (clave, valor, descripcion) VALUES
('human_in_the_loop', 'true'::jsonb,
  'Si es true, todo mensaje saliente queda en estado borrador y requiere aprobación humana antes de enviarse.'),
('auto_enviar_score_min', '80'::jsonb,
  'Si human_in_the_loop es false, solo se auto-envían mensajes a leads con score >= a este valor.'),
('cadencia_max_toques', '3'::jsonb,
  'Máximo de toques de outreach por lead antes de pausar.'),
('horario_envio', '{"inicio":"09:00","fin":"14:00","dias":[1,2,3,4,5,6],"tz":"America/Chihuahua"}'::jsonb,
  'Ventana horaria permitida para CONTACTAR (9:00–14:00). El scraper trabaja 24/7.'),
('firma_agente', '"Sofía, asesora digital de ADM · Atlas Digital Marketing"'::jsonb,
  'El agente SIEMPRE se identifica como asesora digital de ADM (compliance).'),
('aviso_privacidad_url', '"https://atlasdigitalmark.com/privacidad"'::jsonb,
  'Liga al aviso de privacidad que se incluye en el primer contacto.'),
('texto_opt_out', '"Responde BAJA para no recibir más mensajes."'::jsonb,
  'Texto de opt-out obligatorio en cada mensaje.'),
('ciudades_objetivo', '["Chihuahua","Delicias","Cuauhtémoc","Parral","Ciudad Juárez","Camargo"]'::jsonb,
  'Ciudades donde el scraper busca prospectos.'),
('meta_citas_semana', '10'::jsonb,
  'Meta operativa del agente: citas calificadas por semana.')
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------
-- SECUENCIA GENÉRICA (3 toques) · sirve para cualquier vertical usando variables
-- ---------------------------------------------------------------------
WITH s AS (
  INSERT INTO secuencias (nombre, descripcion, vertical_id, activa)
  VALUES ('Outreach base 3 toques',
          'Cadencia estándar multicanal: email → WhatsApp → llamada. Valor nuevo en cada toque.',
          NULL, true)
  RETURNING id
)
INSERT INTO secuencia_pasos (secuencia_id, orden, canal, espera_horas, plantilla_asunto, plantilla_cuerpo)
SELECT s.id, x.orden, x.canal::canal, x.espera, x.asunto, x.cuerpo FROM s,
(VALUES
  (1, 'email', 0,
   '{{empresa}}: una idea rápida para más clientes',
   E'Hola{{contacto_nombre_coma}}\n\nSoy Sofía, asesora digital de ADM (Atlas Digital Marketing) en Chihuahua. Revisé a {{empresa}} y noté algo concreto: {{hallazgo}}.\n\n{{prueba_social}} Por eso creo que {{servicio_ancla}} te ayudaría a captar a los clientes que ya te buscan en línea.\n\n¿Te late una auditoría express gratis de tu presencia digital? Te la mando en 24h, sin compromiso.\n\n{{firma}}\nAviso de privacidad: {{aviso_privacidad_url}}\n{{opt_out}}'),
  (2, 'whatsapp', 48,
   NULL,
   E'Hola{{contacto_nombre_coma}} soy Sofía, asesora digital de ADM. Te escribí por correo sobre {{empresa}}: {{hallazgo}}. Te preparo *gratis* una auditoría express con 3 mejoras accionables. ¿Te la comparto? {{opt_out}}'),
  (3, 'voz', 72,
   NULL,
   E'Guion de llamada: Preséntate como Sofía, asesora digital de ADM. Menciona el hallazgo "{{hallazgo}}" sobre {{empresa}}. Ofrece la auditoría express gratis y, si hay interés, agenda un diagnóstico de 15 min con Fernando. Si no hay interés, agradece y ofrece enviar la auditoría por correo. Respeta el opt-out.')
) AS x(orden, canal, espera, asunto, cuerpo);

COMMIT;
