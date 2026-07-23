// =====================================================================
//  ADM · agent-core · Armar oferta a la medida para leads calificados.
//  Toma las señales del scraper (web/tamaño/reseñas/anuncios) y, con
//  Claude Sonnet, genera una oferta que luego usa personalize.js para
//  redactar el outreach por los 3 canales.
//
//  Uso:  node src/offer.js [--limite=50]
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { claudeJSON, MODELOS } from './anthropic.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = fs.readFileSync(path.join(__dirname, '../prompts/system.md'), 'utf8');
const OFFER = fs.readFileSync(path.join(__dirname, '../prompts/offer.md'), 'utf8');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 50);

async function main() {
  // Leads calificados que aún no tienen oferta.
  const { rows: leads } = await pool.query(`
    SELECT l.id, l.empresa, l.score, l.hallazgo_clave,
           l.tiene_web, l.web_responsiva, l.corre_anuncios,
           l.num_resenas, l.rating_google, l.sucursales,
           v.clave AS v_clave, v.servicio_ancla, v.prueba_social
    FROM leads l
    JOIN verticales v ON v.id = l.vertical_id
    WHERE l.estado_pipeline = 'calificada' AND l.oferta IS NULL
    ORDER BY l.score DESC
    LIMIT $1`, [LIMITE]);

  console.log(`🎯 Armando ofertas para ${leads.length} leads con ${MODELOS.redactor}...`);
  let ok = 0;

  for (const lead of leads) {
    const entrada = {
      empresa: lead.empresa,
      vertical: { clave: lead.v_clave, servicio_ancla: lead.servicio_ancla, prueba_social: lead.prueba_social },
      senales: {
        tiene_web: lead.tiene_web, web_responsiva: lead.web_responsiva,
        corre_anuncios: lead.corre_anuncios, num_resenas: lead.num_resenas,
        rating_google: lead.rating_google, sucursales: lead.sucursales,
      },
      hallazgo_clave: lead.hallazgo_clave, score: lead.score,
    };
    try {
      const oferta = await claudeJSON({
        system: SYSTEM,
        prompt: `${OFFER}\n\n## Lead calificado\n\`\`\`json\n${JSON.stringify(entrada)}\n\`\`\``,
        modelo: MODELOS.redactor,
        temperature: 0.5,
      });
      await pool.query(
        `UPDATE leads SET tamano = $2, oferta = $3 WHERE id = $1`,
        [lead.id, oferta.tamano ?? null, oferta]);
      await pool.query(
        `INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1,'oferta_armada','agente_ia',$2)`,
        [lead.id, oferta]);
      ok++;
      console.log(`  ✓ ${lead.empresa} → ${oferta.necesidad} (${oferta.paquete})`);
    } catch (e) {
      console.error(`  ⚠️  ${lead.empresa}: ${e.message}`);
    }
  }

  console.log(`✅ ${ok} ofertas armadas.`);
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen)
     VALUES ('ofertas','ok', now(), now(), $1, $2)`, [ok, `${ok} ofertas`]);
  await pool.end();
}

main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
