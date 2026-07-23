// =====================================================================
//  ADM · Utilidades compartidas del agente (pool + plantillas + config)
// =====================================================================
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

/** Sustituye {{variables}} en una plantilla con los valores del objeto vars. */
export function render(plantilla, vars) {
  return String(plantilla ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

/** Lee una clave de configuracion (jsonb) con fallback. */
export async function cfg(clave, fallback = null) {
  const { rows } = await pool.query('SELECT valor FROM configuracion WHERE clave=$1', [clave]);
  return rows[0]?.valor ?? fallback;
}

/** ¿El contacto está en la lista de supresión (LFPDPPP)? */
export async function suprimido(email, tel) {
  const { rows } = await pool.query('SELECT esta_suprimido($1,$2) AS s', [email ?? null, tel ?? null]);
  return rows[0].s;
}

/** ¿Estamos dentro de la ventana horaria configurada? (America/Chihuahua) */
export async function enHorario(fecha = new Date()) {
  const h = await cfg('horario_envio', { inicio: '09:00', fin: '19:00', dias: [1, 2, 3, 4, 5, 6] });
  // Convertir a hora de Chihuahua sin dependencias externas.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: h.tz || 'America/Chihuahua', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(fecha);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dias[get('weekday')];
  const hhmm = `${get('hour')}:${get('minute')}`;
  const okDia = (h.dias || [1, 2, 3, 4, 5, 6]).includes(dow);
  return okDia && hhmm >= h.inicio && hhmm <= h.fin;
}

/** Registra un evento en la bitácora. */
export async function evento(leadId, tipo, payload = {}, actor = 'agente_ia') {
  await pool.query(
    'INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1,$2,$3,$4)',
    [leadId, tipo, actor, payload],
  );
}

/** Registra una ejecución (para el widget del dashboard). */
export async function ejecucion(job, estado, items = 0, resumen = null, error = null) {
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen, error_detalle)
     VALUES ($1,$2, now(), now(), $3,$4,$5)`,
    [job, estado, items, resumen, error],
  );
}
