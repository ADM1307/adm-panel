// =====================================================================
//  ADM · Calificador por REGLAS (sin IA · GRATIS).
//  Puntúa leads 'descubierta' por señales (web, giro, reseñas), los pasa a
//  'calificada'/'descartada' y les arma una oferta a la medida con reglas.
//  Alternativa gratis a qualify.js + offer.js (que usan Claude).
//
//  Uso:  node src/qualify_reglas.js [--limite=2000]
// =====================================================================
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LIMITE = Number(args.limite ?? 2000);

const RANGOS = { 'Plus': '$6k-12k MXN', 'Pro': '$12k-22k MXN', 'Pro / Arranque': '$18k-30k MXN', 'Custom / Escala': '$28k-60k MXN' };

/** Puntúa y arma oferta con reglas (misma lógica que el panel). */
function calificar(l) {
  const motivos = [];
  let score = 50;

  if (l.tiene_web === false) { score += 30; motivos.push('sin sitio web'); }
  else if (l.tiene_web === true) { score += 5; motivos.push('ya tiene web'); }
  else { score += 15; }

  if (l.num_resenas != null && l.num_resenas < 15) { score += 10; motivos.push(`${l.num_resenas} reseñas`); }
  const prio = l.prioridad || 3;
  score += prio === 1 ? 15 : prio === 2 ? 10 : prio === 3 ? 5 : 0;

  // Negocios de mayor ticket (hoteles, hospitales, varias sucursales)
  const grande = /hotel|hospital|clinic|manufactur|planta|grupo/i.test(`${l.empresa} ${l.giro || ''}`) || (l.sucursales || 1) > 1;
  if (grande) { score += 5; motivos.push('mayor ticket'); }

  score = Math.max(0, Math.min(100, score));
  const estado = score >= 60 ? 'calificada' : 'descartada';

  // Oferta a la medida por señales
  const necesidad = l.tiene_web === false
    ? 'Sitio web nuevo (entrega 48h)'
    : 'Optimización + captación de leads';
  const paquete = grande ? 'Custom / Escala' : score >= 82 ? 'Pro / Arranque' : score >= 72 ? 'Pro' : 'Plus';
  const oferta = {
    necesidad,
    servicio: l.servicio_ancla || 'Sitio + Marketing',
    paquete,
    rango: RANGOS[paquete],
    tamano: grande ? 'grande' : 'chico',
  };
  const hallazgo = l.hallazgo_clave
    || (l.tiene_web === false ? 'Sin sitio web propio; oportunidad de captar quien lo busca en Google'
                              : 'Presencia web mejorable; oportunidad de más captación');
  return { score, estado, motivos, oferta, hallazgo };
}

async function main() {
  const { rows: leads } = await pool.query(`
    SELECT l.id, l.empresa, l.giro, l.tiene_web, l.num_resenas, l.sucursales, l.hallazgo_clave,
           v.prioridad, v.servicio_ancla
    FROM leads l LEFT JOIN verticales v ON v.id = l.vertical_id
    WHERE l.estado_pipeline = 'descubierta'
    ORDER BY l.creado_en ASC
    LIMIT $1`, [LIMITE]);

  console.log(`🧮 Calificando ${leads.length} leads por reglas (gratis)...`);
  let cal = 0, desc = 0;
  for (const l of leads) {
    const r = calificar(l);
    await pool.query(`
      UPDATE leads SET score=$2, estado_pipeline=$3, score_motivos=$4,
        oferta=$5, tamano=$6, hallazgo_clave=COALESCE(hallazgo_clave,$7)
      WHERE id=$1`,
      [l.id, r.score, r.estado, JSON.stringify(r.motivos), r.oferta, r.oferta.tamano, r.hallazgo]);
    if (r.estado === 'calificada') cal++; else desc++;
  }
  const resumen = `calificadas=${cal} descartadas=${desc} (de ${leads.length})`;
  console.log(`✅ ${resumen}`);
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen)
     VALUES ('calificacion_reglas','ok', now(), now(), $1, $2)`, [leads.length, resumen]);
  await pool.end();
}

main().catch(async (e) => { console.error('❌', e); await pool.end(); process.exit(1); });
