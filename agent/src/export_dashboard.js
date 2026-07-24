// =====================================================================
//  ADM · Exporta el estado del pipeline a data.json para el panel en vivo.
//  El panel (index.html) hace fetch de ./data.json y se actualiza solo.
//  Corre al final de cada ciclo (cron / GitHub Actions).
//
//  Uso:  node agent/src/export_dashboard.js [--out=./data.json]
// =====================================================================
import fs from 'node:fs';
import { pool } from './lib.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = args.out || './data.json';

async function main() {
  const { rows: leads } = await pool.query(`
    SELECT l.empresa, COALESCE(v.clave,'') AS vertical, COALESCE(l.ciudad,'') AS ciudad,
           COALESCE(l.hallazgo_clave,'') AS hallazgo, COALESCE(l.score,0) AS score,
           l.estado_pipeline AS estado,
           COALESCE((SELECT nombre FROM contactos c WHERE c.lead_id=l.id AND c.es_principal LIMIT 1),'—') AS contacto,
           COALESCE((SELECT email FROM contactos c WHERE c.lead_id=l.id AND c.es_principal AND c.email<>'' LIMIT 1), l.email_general, '') AS email,
           COALESCE((SELECT COALESCE(whatsapp,telefono) FROM contactos c WHERE c.lead_id=l.id AND c.es_principal AND COALESCE(whatsapp,telefono)<>'' LIMIT 1), l.telefono, '') AS telefono,
           COALESCE(l.sitio_web,'') AS sitio_web
    FROM leads l LEFT JOIN verticales v ON v.id=l.vertical_id
    WHERE l.estado_pipeline <> 'descartada'
    ORDER BY l.score DESC, l.creado_en DESC`);

  const { rows: inbox } = await pool.query(`
    SELECT m.id::text, l.empresa,
           COALESCE((SELECT nombre FROM contactos c WHERE c.lead_id=l.id AND c.es_principal LIMIT 1),'—') AS contacto,
           m.canal, m.estado, COALESCE(m.modelo_ia,'plantilla') AS modelo, m.asunto, m.cuerpo
    FROM mensajes m JOIN leads l ON l.id=m.lead_id
    WHERE m.direccion='saliente' AND m.estado IN ('borrador','aprobado')
    ORDER BY m.creado_en DESC LIMIT 20`);

  const { rows: citas } = await pool.query(`
    SELECT to_char(ci.inicio,'DD') AS d, lower(to_char(ci.inicio,'Mon')) AS m,
           l.empresa, ci.estado, to_char(ci.inicio,'HH24:MI') AS hora,
           COALESCE(ci.medio,'videollamada') AS medio, 'Fernando' AS closer
    FROM citas ci JOIN leads l ON l.id=ci.lead_id
    WHERE ci.estado <> 'cancelada' ORDER BY ci.inicio LIMIT 20`);

  // Llamadas grabadas por lead (para el pipeline / detalle de cada lead)
  const { rows: llamadas } = await pool.query(`
    SELECT l.empresa,
           to_char(ll.creado_en,'DD/MM HH24:MI') AS fecha,
           COALESCE(ll.resultado,'') AS resultado,
           COALESCE(ll.duracion_seg,0) AS duracion_seg,
           COALESCE(ll.resumen,'') AS resumen,
           ll.grabacion_url,
           COALESCE(ll.transcripcion,'') AS transcripcion
    FROM llamadas ll JOIN leads l ON l.id = ll.lead_id
    ORDER BY ll.creado_en DESC LIMIT 200`);

  const data = {
    last_run: new Date().toISOString(),
    leads: leads.map((l) => [l.empresa, l.vertical, l.ciudad, l.hallazgo, l.score, l.estado, l.contacto, l.email, l.telefono, l.sitio_web]),
    inbox: inbox.map((m) => ({ id: m.id, empresa: m.empresa, contacto: m.contacto, canal: m.canal,
      estado: m.estado, modelo: m.modelo, asunto: m.asunto, cuerpo: m.cuerpo })),
    citas,
    llamadas: llamadas.map((c) => ({ empresa: c.empresa, fecha: c.fecha, resultado: c.resultado,
      duracion_seg: c.duracion_seg, resumen: c.resumen, grabacion_url: c.grabacion_url, transcripcion: c.transcripcion })),
  };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`📤 data.json escrito: ${leads.length} leads, ${inbox.length} borradores, ${citas.length} citas → ${OUT}`);
  await pool.end();
}
main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
