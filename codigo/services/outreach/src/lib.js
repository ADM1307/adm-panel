// ADM · Outreach · helpers (pool + compliance + horario). Sin dependencias externas salvo pg.
import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

export async function cfg(clave, fallback = null) {
  const { rows } = await pool.query('SELECT valor FROM configuracion WHERE clave=$1', [clave]);
  return rows[0]?.valor ?? fallback;
}
export async function suprimido(email, tel) {
  const { rows } = await pool.query('SELECT esta_suprimido($1,$2) AS s', [email ?? null, tel ?? null]);
  return rows[0].s;
}
export async function enHorario(fecha = new Date()) {
  const h = await cfg('horario_envio', { inicio: '09:00', fin: '19:00', dias: [1, 2, 3, 4, 5, 6], tz: 'America/Chihuahua' });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: h.tz || 'America/Chihuahua', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(fecha);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hhmm = `${get('hour')}:${get('minute')}`;
  return (h.dias || [1, 2, 3, 4, 5, 6]).includes(dias[get('weekday')]) && hhmm >= h.inicio && hhmm <= h.fin;
}
export async function evento(leadId, tipo, payload = {}) {
  await pool.query("INSERT INTO eventos (lead_id, tipo, actor, payload) VALUES ($1,$2,'agente_ia',$3)", [leadId, tipo, payload]);
}
export async function ejecucion(job, estado, items = 0, resumen = null) {
  await pool.query(
    `INSERT INTO ejecuciones (job, estado, iniciada_en, terminada_en, items_procesados, resumen)
     VALUES ($1,$2, now(), now(), $3,$4)`, [job, estado, items, resumen]);
}
