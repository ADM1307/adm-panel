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
