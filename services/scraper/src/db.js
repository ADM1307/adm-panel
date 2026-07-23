// =====================================================================
//  ADM · Scraper · capa de base de datos (Postgres)
//  Node ESM. Única dependencia: pg.
// =====================================================================
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En VPS local el SSL normalmente se apaga; en Supabase se prende.
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PGPOOL_MAX ?? 5),
});

/**
 * Inserta o actualiza un lead con dedupe.
 * - Si trae google_place_id: upsert por place_id (clave natural).
 * - Si no: el índice único (nombre+ciudad normalizados) evita duplicados.
 * Devuelve { id, insertado } o null si fue descartado por duplicado suave.
 */
export async function upsertLead(entrada) {
  // Defaults para columnas NOT NULL (permite inserts parciales manuales/XLSX).
  const lead = { fuente: 'google_places', sucursales: 1, redes: {}, estado: 'Chihuahua', ...entrada };
  const cols = [
    'empresa', 'giro', 'vertical_id', 'ciudad', 'estado', 'sitio_web',
    'telefono', 'email_general', 'google_place_id', 'google_maps_url',
    'rating_google', 'num_resenas', 'tiene_web', 'web_responsiva',
    'corre_anuncios', 'redes', 'sucursales', 'hallazgo_clave', 'fuente',
  ];
  const values = cols.map((c) => lead[c] ?? null);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  // Upsert por place_id cuando existe; si no, dejamos que el índice único
  // parcial dispare ON CONFLICT DO NOTHING sobre (nombre,ciudad).
  const sql = `
    INSERT INTO leads (${cols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (google_place_id) DO UPDATE SET
      rating_google = EXCLUDED.rating_google,
      num_resenas   = EXCLUDED.num_resenas,
      sitio_web     = COALESCE(EXCLUDED.sitio_web, leads.sitio_web),
      actualizado_en = now()
    RETURNING id, (xmax = 0) AS insertado;
  `;
  try {
    const { rows } = await pool.query(sql, values);
    return rows[0] ?? null;
  } catch (err) {
    // 23505 = unique_violation del índice suave (nombre+ciudad sin place_id).
    if (err.code === '23505') return null;
    throw err;
  }
}

/** Registra una ejecución del cron (alimenta el widget del dashboard). */
export async function registrarEjecucion({ job, estado, items = 0, resumen = null, error = null }) {
  const sql = `
    INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen, error_detalle)
    VALUES ($1, $2, now(), now(), $3, $4, $5) RETURNING id;`;
  const { rows } = await pool.query(sql, [job, estado, items, resumen, error]);
  return rows[0].id;
}

/** Deja un evento en la bitácora. */
export async function registrarEvento(leadId, tipo, payload = {}) {
  await pool.query(
    `INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1, $2, 'agente_ia', $3)`,
    [leadId, tipo, payload],
  );
}

// Permite `node src/db.js --ping` para probar la conexión.
if (process.argv.includes('--ping')) {
  try {
    const { rows } = await pool.query('SELECT now() AS ahora, current_database() AS db');
    console.log('✅ Conexión OK:', rows[0]);
  } catch (e) {
    console.error('❌ No se pudo conectar:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
