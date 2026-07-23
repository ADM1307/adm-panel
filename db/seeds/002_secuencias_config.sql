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
