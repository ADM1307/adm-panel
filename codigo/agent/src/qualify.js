// =====================================================================
//  ADM · agent-core · Calificar leads "descubiertos" con Claude Haiku.
//  Lee leads en estado 'descubierta', pide scoring al modelo y actualiza
//  score / estado_pipeline / hallazgo_clave. Registra evento y ejecución.
//
//  Uso:  node src/qualify.js [--limite=50]
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
const QUALIFY = fs.readFileSync(path.join(__dirname, '../prompts/qualify.md'), 'utf8');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 50);

async function main() {
  const { rows: leads } = await pool.query(`
    SELECT l.id, l.empresa, l.giro, l.ciudad, l.sitio_web, l.tiene_web, l.web_responsiva,
           l.rating_google, l.num_resenas, l.corre_anuncios, l.redes, l.sucursales,
           v.clave AS vertical
    FROM leads l
    LEFT JOIN verticales v ON v.id = l.vertical_id
    WHERE l.estado_pipeline = 'descubierta'
    ORDER BY l.creado_en ASC
    LIMIT $1`, [LIMITE]);

  console.log(`🧮 Calificando ${leads.length} leads con ${MODELOS.rapido}...`);
  let ok = 0, calificadas = 0, descartadas = 0;

  for (const lead of leads) {
    try {
      const r = await claudeJSON({
        system: SYSTEM,
        prompt: `${QUALIFY}\n\n## Lead a calificar\n\`\`\`json\n${JSON.stringify(lead)}\n\`\`\``,
        modelo: MODELOS.rapido,
        temperature: 0.2,
      });

      await pool.query(`
        UPDATE leads SET
          score = $2,
          estado_pipeline = $3,
          score_motivos = $4,
          hallazgo_clave = COALESCE($5, hallazgo_clave),
          anti_icp = $6,
          anti_icp_motivo = $7
        WHERE id = $1`,
        [lead.id, r.score, r.estado_pipeline, JSON.stringify(r.score_motivos ?? []),
         r.hallazgo_clave ?? null, r.anti_icp ?? false, r.anti_icp_motivo ?? null]);

      await pool.query(
        `INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1,'calificado','agente_ia',$2)`,
        [lead.id, r]);

      ok++;
      if (r.estado_pipeline === 'calificada') calificadas++; else descartadas++;
    } catch (e) {
      console.error(`  ⚠️  ${lead.empresa}: ${e.message}`);
    }
  }

  const resumen = `calificadas=${calificadas} descartadas=${descartadas} (de ${ok})`;
  console.log(`✅ ${resumen}`);
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen)
     VALUES ('calificacion_horaria','ok', now(), now(), $1, $2)`, [ok, resumen]);
  await pool.end();
}

main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
